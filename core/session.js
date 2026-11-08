import { TARGET_ORIGIN } from "./config.js";

const SESSION_KEY = "session";

const ACCOUNT_SELECTOR = 'section[aria-label="Tu cuenta del directo"]';
const LOGIN_PATTERN = /inicia(?:r)? sesi[oó]n/i;
const LOGOUT_PATTERN = /desconectar/i;
const MOCHUELOS_PATTERN = /tus mochuelos/i;
const RECONNECT_PATTERN =
  /reconectar live|sesi[oó]n del directo ha caducado|conecta tu cuenta del directo/i;
const SESSION_CHECK_INTERVAL_MS = 2000;
const SESSION_DEBOUNCE_MS = 250;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function defaultSession() {
  return {
    known: false,
    loggedIn: false,
    origin: TARGET_ORIGIN,
    reason: "unknown",
    updatedAt: 0,
  };
}

export function normalizeSession(value) {
  if (!isRecord(value)) return defaultSession();

  return {
    known: value.known === true,
    loggedIn: value.loggedIn === true,
    origin:
      typeof value.origin === "string" && value.origin.length > 0
        ? value.origin
        : TARGET_ORIGIN,
    reason:
      typeof value.reason === "string" && value.reason.length > 0
        ? value.reason
        : "unknown",
    updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0,
  };
}

export function isSessionActive(session) {
  return session?.known === true && session?.loggedIn === true;
}

function findAccountSection(doc) {
  const direct = doc.querySelector(ACCOUNT_SELECTOR);
  if (direct) return direct;

  for (const section of doc.querySelectorAll("aside section")) {
    const heading = section.querySelector("h2");
    if (/^tu directo$/i.test((heading?.textContent ?? "").trim())) {
      return section;
    }
  }

  return null;
}

function readSessionFromDom(doc = document) {
  const section = findAccountSection(doc);
  if (!section) {
    return { known: false, loggedIn: false, reason: "account-missing" };
  }

  const controls = [...section.querySelectorAll("button, a")];

  if (controls.some((control) => LOGOUT_PATTERN.test(control.textContent ?? ""))) {
    return { known: true, loggedIn: true, reason: "logout-action" };
  }

  if (controls.some((control) => LOGIN_PATTERN.test(control.textContent ?? ""))) {
    return { known: true, loggedIn: false, reason: "login-action" };
  }

  const text = section.textContent ?? "";

  if (RECONNECT_PATTERN.test(text)) {
    return { known: true, loggedIn: false, reason: "live-disconnected" };
  }

  if (LOGOUT_PATTERN.test(text)) {
    return { known: true, loggedIn: true, reason: "logout-text" };
  }

  if (LOGIN_PATTERN.test(text)) {
    return { known: true, loggedIn: false, reason: "login-text" };
  }

  if (MOCHUELOS_PATTERN.test(text)) {
    return { known: true, loggedIn: true, reason: "mochuelos" };
  }

  return { known: false, loggedIn: false, reason: "unknown" };
}

export async function getSessionState() {
  try {
    const stored = await chrome.storage.local.get(SESSION_KEY);
    const session = normalizeSession(stored[SESSION_KEY]);

    return session.origin === TARGET_ORIGIN ? session : defaultSession();
  } catch (error) {
    console.warn("[andypsx-live] No se pudo leer la sesión:", error);
    return defaultSession();
  }
}

async function saveSessionState(session) {
  const next = {
    ...normalizeSession(session),
    origin: TARGET_ORIGIN,
    updatedAt: Date.now(),
  };

  await chrome.storage.local.set({ [SESSION_KEY]: next });
  return next;
}

export function watchSession(callback) {
  if (typeof callback !== "function") {
    throw new TypeError("watchSession necesita una función.");
  }

  const listener = (changes, areaName) => {
    if (areaName !== "local" || !changes[SESSION_KEY]) return;

    const session = normalizeSession(changes[SESSION_KEY].newValue);
    callback(session.origin === TARGET_ORIGIN ? session : defaultSession());
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export function applySessionGate(definitions, states, session) {
  const next = { ...(isRecord(states) ? states : {}) };
  const active = isSessionActive(session);

  for (const definition of Array.isArray(definitions) ? definitions : []) {
    if (!definition || definition.requiresSession !== true) continue;

    const entry = next[definition.id];
    if (!entry) continue;

    next[definition.id] = {
      ...entry,
      enabled: entry.enabled === true && active,
    };
  }

  return next;
}

export function startSessionWatcher({ onChange, shouldCheck = () => true } = {}) {
  let last = null;
  let stopped = false;
  let debounceTimer = null;
  let checking = null;

  async function readAndSave() {
    if (stopped || !shouldCheck()) return null;

    const domSession = readSessionFromDom(document);
    const changed =
      !last ||
      last.known !== domSession.known ||
      last.loggedIn !== domSession.loggedIn;

    if (!changed) {
      last = domSession;
      return { ...domSession, origin: TARGET_ORIGIN, updatedAt: Date.now() };
    }

    try {
      await saveSessionState(domSession);
    } catch (error) {
      console.warn("[andypsx-live] No se pudo guardar la sesión:", error);
      return { ...domSession, origin: TARGET_ORIGIN, updatedAt: Date.now() };
    }

    last = domSession;

    const sessionLabel = !domSession.known
      ? "desconocida"
      : domSession.loggedIn
        ? "iniciada"
        : "no iniciada";
    console.log(`[andypsx-live] Sesión: ${sessionLabel}.`);

    try {
      chrome.runtime.sendMessage({ type: "session:update" }).catch(() => {});
    } catch {
      // El background puede no estar disponible en ese instante.
    }

    if (typeof onChange === "function") {
      try {
        onChange(domSession);
      } catch (error) {
        console.warn("[andypsx-live] Error al notificar la sesión:", error);
      }
    }

    return { ...domSession, origin: TARGET_ORIGIN, updatedAt: Date.now() };
  }

  function check() {
    if (stopped) return Promise.resolve(null);
    if (checking) return checking;

    checking = readAndSave().finally(() => {
      checking = null;
    });

    return checking;
  }

  function scheduleCheck() {
    if (stopped) return;
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      void check();
    }, SESSION_DEBOUNCE_MS);
  }

  const observer = new MutationObserver(scheduleCheck);
  const root = document.body ?? document.documentElement;
  if (root) {
    observer.observe(root, { childList: true, subtree: true });
  }

  const interval = window.setInterval(() => {
    void check();
  }, SESSION_CHECK_INTERVAL_MS);

  const handleVisibility = () => {
    if (!document.hidden) scheduleCheck();
  };

  window.addEventListener("pageshow", scheduleCheck);
  document.addEventListener("visibilitychange", handleVisibility);

  const messageListener = (message, sender, sendResponse) => {
    if (message?.type !== "session:get") return false;

    check()
      .then((session) => sendResponse({ ok: true, session }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));

    return true;
  };

  chrome.runtime.onMessage.addListener(messageListener);

  const ready = check();

  return {
    ready,
    check,
    destroy() {
      stopped = true;
      observer.disconnect();
      window.clearInterval(interval);
      window.clearTimeout(debounceTimer);
      window.removeEventListener("pageshow", scheduleCheck);
      document.removeEventListener("visibilitychange", handleVisibility);
      chrome.runtime.onMessage.removeListener(messageListener);
    },
  };
}
