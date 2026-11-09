import { TARGETS, isKnownTargetOrigin } from "./config.js";
import { log, warn } from "./log.js";

// Una clave de sesión POR ORIGIN: "session:https://andypsx.com",
// "session:http://127.0.0.1:8765". Así la copia local y producción no se
// pisan entre sí (v1.5.0 usaba un slot único y el último que guardaba ganaba).
const SESSION_PREFIX = "session:";
const LEGACY_SESSION_KEY = "session";
const PRODUCTION_ORIGIN = new URL(TARGETS.production.url).origin;

const ACCOUNT_SELECTOR = 'section[aria-label="Tu cuenta del directo"]';
const LOGIN_PATTERN = /inicia(?:r)? sesi[oó]n/i;
const LOGOUT_PATTERN = /desconectar/i;
const MOCHUELOS_PATTERN = /tus mochuelos/i;
const RECONNECT_PATTERN =
  /reconectar live|sesi[oó]n del directo ha caducado|conecta tu cuenta del directo/i;
const SESSION_CHECK_INTERVAL_MS = 2000;
const SESSION_DEBOUNCE_MS = 250;

// Falso cuando la extensión se recarga/actualiza con la pestaña abierta.
function extensionRuntimeAlive() {
  try {
    return (
      typeof globalThis.chrome !== "undefined" &&
      typeof globalThis.chrome.runtime?.sendMessage === "function"
    );
  } catch {
    return false;
  }
}

function isInvalidatedError(error) {
  const message = error?.message ?? String(error);
  return /extension context invalidated|cannot read properties of undefined \(reading '(sendMessage|storage|runtime|onMessage|tabs|scripting|alarms|local|sync|id)'\)/i.test(
    message,
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function defaultSession() {
  return {
    known: false,
    loggedIn: false,
    origin: null,
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
        : null,
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

function sessionKey(origin) {
  return SESSION_PREFIX + origin;
}

function isValidSession(session) {
  return session.origin !== null && isKnownTargetOrigin(session.origin);
}

// Migra el slot único de <= v1.5.0 a la clave por origin. Idempotente: si la
// clave vieja no existe, no hace nada.
async function migrateLegacySession() {
  try {
    const stored = await chrome.storage.local.get(LEGACY_SESSION_KEY);

    if (stored[LEGACY_SESSION_KEY] === undefined) return;

    const legacy = normalizeSession(stored[LEGACY_SESSION_KEY]);

    if (isValidSession(legacy)) {
      const key = sessionKey(legacy.origin);
      const existing = await chrome.storage.local.get(key);

      if (existing[key] === undefined) {
        await chrome.storage.local.set({ [key]: legacy });
      }
    }

    await chrome.storage.local.remove(LEGACY_SESSION_KEY);
  } catch {
    // Sin migración: la próxima detección de sesión escribe el slot nuevo.
  }
}

let legacyMigration = null;

function migrateLegacySessionOnce() {
  if (!legacyMigration) {
    legacyMigration = migrateLegacySession();
  }

  return legacyMigration;
}

// expectedOrigin (opcional): origin de la URL que se está comprobando. Con él
// se lee solo el slot de ese origen. Sin él (p. ej. el badge) se prefiere el
// slot de producción y, si no existe, el primero válido.
export async function getSessionState(expectedOrigin = null) {
  try {
    await migrateLegacySessionOnce();

    if (typeof expectedOrigin === "string" && expectedOrigin.length > 0) {
      const key = sessionKey(expectedOrigin);
      const stored = await chrome.storage.local.get(key);
      const session = normalizeSession(stored[key]);

      return session.origin === expectedOrigin && isValidSession(session)
        ? session
        : defaultSession();
    }

    const all = await chrome.storage.local.get(null);
    const sessions = Object.entries(all)
      .filter(([key]) => key.startsWith(SESSION_PREFIX))
      .map(([, value]) => normalizeSession(value))
      .filter(isValidSession);

    const production = sessions.find((s) => s.origin === PRODUCTION_ORIGIN);
    return production ?? sessions[0] ?? defaultSession();
  } catch (error) {
    if (isInvalidatedError(error)) throw error;
    warn("No se pudo leer la sesión:", error);
    return defaultSession();
  }
}

async function saveSessionState(session) {
  const next = {
    ...normalizeSession(session),
    origin: location.origin,
    updatedAt: Date.now(),
  };

  await chrome.storage.local.set({ [sessionKey(location.origin)]: next });
  return next;
}

export function watchSession(callback) {
  if (typeof callback !== "function") {
    throw new TypeError("watchSession necesita una función.");
  }

  const listener = (changes, areaName) => {
    if (areaName !== "local") return;

    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith(SESSION_PREFIX)) continue;

      const session = normalizeSession(change.newValue);

      if (isValidSession(session)) {
        callback(session);
      }
    }
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

    // Contexto invalidado: no hay chrome.* que usar; detener sin warnings.
    if (!extensionRuntimeAlive()) {
      stopped = true;
      return null;
    }

    const domSession = readSessionFromDom(document);
    const changed =
      !last ||
      last.known !== domSession.known ||
      last.loggedIn !== domSession.loggedIn;

    if (!changed) {
      last = domSession;
      return { ...domSession, origin: location.origin, updatedAt: Date.now() };
    }

    try {
      await saveSessionState(domSession);
    } catch (error) {
      if (isInvalidatedError(error)) {
        stopped = true;
        return null;
      }

      warn("No se pudo guardar la sesión:", error);
      return { ...domSession, origin: location.origin, updatedAt: Date.now() };
    }

    last = domSession;

    const sessionLabel = !domSession.known
      ? "desconocida"
      : domSession.loggedIn
        ? "iniciada"
        : "no iniciada";
    log(`Sesión: ${sessionLabel}.`);

    try {
      chrome.runtime.sendMessage({
        type: "session:update",
      }).catch(() => {});
    } catch {
      // El background puede no estar disponible en ese instante.
    }

    if (typeof onChange === "function") {
      try {
        onChange(domSession);
      } catch (error) {
        warn("Error al notificar la sesión:", error);
      }
    }

    return { ...domSession, origin: location.origin, updatedAt: Date.now() };
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

      try {
        chrome.runtime?.onMessage?.removeListener?.(messageListener);
      } catch {
        // Contexto ya invalidado: no hay listener que quitar.
      }
    },
  };
}
