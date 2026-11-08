import { CSS_CACHE_KEY, TARGET_ORIGIN, isTargetUrl } from "./core/config.js";
import { syncTab } from "./core/css.js";
import { debug, error, initLogger, warn } from "./core/log.js";
import {
  applySessionGate,
  defaultSession,
  getSessionState,
  normalizeSession,
  watchSession,
} from "./core/session.js";
import { getModuleStates, watchModuleStates } from "./core/storage.js";
import { modules as rawModules } from "./modules/index.js";

const modules = (Array.isArray(rawModules) ? rawModules : []).filter(
  (definition) =>
    definition &&
    typeof definition.id === "string" &&
    definition.id.length > 0,
);

const sessionKnownTabs = new Set();
const MAX_CLICK_MOVES = 12;
const MAX_CLICK_DELAY_MS = 1000;
let ready = Promise.resolve();
let reloadingForTargetMismatch = false;
let cssTextPromise = null;

function logError(message, detail) {
  error(message, detail);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function getCssText() {
  if (!cssTextPromise) {
    cssTextPromise = (async () => {
      try {
        const response = await fetch(
          chrome.runtime.getURL("modules/vista-limpia/live.css"),
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const css = await response.text();
        await chrome.storage.local.set({ [CSS_CACHE_KEY]: css });
        return css;
      } catch (error) {
        const stored = await chrome.storage.local.get(CSS_CACHE_KEY);

        if (
          typeof stored[CSS_CACHE_KEY] === "string" &&
          stored[CSS_CACHE_KEY].length > 0
        ) {
          return stored[CSS_CACHE_KEY];
        }

        throw error;
      }
    })();
  }

  return cssTextPromise;
}

function reportedTargetOrigin(message, url) {
  if (
    typeof message?.targetOrigin === "string" &&
    message.targetOrigin.length > 0
  ) {
    return message.targetOrigin;
  }

  if (typeof url === "string") {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  }

  return null;
}

function reloadForTargetMismatch(origin) {
  if (reloadingForTargetMismatch) return;
  reloadingForTargetMismatch = true;

  warn(
    `Target distinto (${origin} vs ${TARGET_ORIGIN}); recargando extensión.`,
  );

  setTimeout(() => {
    try {
      chrome.runtime.reload();
    } catch (error) {
      reloadingForTargetMismatch = false;
      logError("No se pudo recargar la extensión", error);
    }
  }, 50);
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function clampDelay(value, fallback) {
  return finiteNumber(value)
    ? Math.max(0, Math.min(value, MAX_CLICK_DELAY_MS))
    : fallback;
}

function sanitizeMoves(moves) {
  if (
    !Array.isArray(moves) ||
    moves.length === 0 ||
    moves.length > MAX_CLICK_MOVES
  ) {
    return null;
  }

  const sanitized = [];

  for (const move of moves) {
    if (!move || !finiteNumber(move.x) || !finiteNumber(move.y)) {
      return null;
    }

    sanitized.push({
      x: Math.round(move.x),
      y: Math.round(move.y),
      waitMs: clampDelay(move.waitMs, 0),
    });
  }

  return sanitized;
}

async function handleTrustedClick(message, sender) {
  const tabId = sender.tab?.id;
  const url = sender.tab?.url;
  const origin = reportedTargetOrigin(message, url);

  if (origin && origin !== TARGET_ORIGIN) {
    reloadForTargetMismatch(origin);
    return { ok: false, error: "target-mismatch" };
  }

  if (typeof tabId !== "number" || !isTargetUrl(url)) {
    return { ok: false, error: "not-target" };
  }

  const moves = sanitizeMoves(message.moves);

  if (!moves || !finiteNumber(message.targetX) || !finiteNumber(message.targetY)) {
    return { ok: false, error: "invalid-click" };
  }

  const target = {
    x: Math.round(message.targetX),
    y: Math.round(message.targetY),
  };
  const hoverWaitMs = clampDelay(message.hoverWaitMs, 80);
  const pressWaitMs = clampDelay(message.pressWaitMs, 100);
  const releaseWaitMs = clampDelay(message.releaseWaitMs, 50);

  try {
    await chrome.debugger.attach({ tabId }, "1.3");
  } catch (error) {
    return {
      ok: false,
      error: `No se pudo adjuntar debugger: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  try {
    for (const move of moves) {
      await chrome.debugger.sendCommand(
        { tabId },
        "Input.dispatchMouseEvent",
        {
          type: "mouseMoved",
          x: move.x,
          y: move.y,
          button: "none",
          buttons: 0,
        },
      );
      await delay(move.waitMs);
    }

    await delay(hoverWaitMs);

    await chrome.debugger.sendCommand(
      { tabId },
      "Input.dispatchMouseEvent",
      {
        type: "mousePressed",
        x: target.x,
        y: target.y,
        button: "left",
        buttons: 1,
        clickCount: 1,
      },
    );

    await delay(pressWaitMs);

    await chrome.debugger.sendCommand(
      { tabId },
      "Input.dispatchMouseEvent",
      {
        type: "mouseReleased",
        x: target.x,
        y: target.y,
        button: "left",
        buttons: 0,
        clickCount: 1,
      },
    );

    await delay(releaseWaitMs);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `No se pudo hacer el clic: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

async function getGlobalStates() {
  const [states, session] = await Promise.all([
    getModuleStates(modules),
    getSessionState(),
  ]);

  return applySessionGate(modules, states, session);
}

async function requestTabSession(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: "session:get",
    });

    if (response?.ok && response.session) {
      const session = normalizeSession(response.session);

      if (session.origin !== TARGET_ORIGIN) {
        reloadForTargetMismatch(session.origin);
        return null;
      }

      sessionKnownTabs.add(tabId);
      return session;
    }
  } catch {
    // El content script todavía no está listo en esa pestaña.
  }

  return null;
}

async function getStatesForTab(tabId) {
  const [states, session] = await Promise.all([
    getModuleStates(modules),
    sessionKnownTabs.has(tabId) ? getSessionState() : defaultSession(),
  ]);

  return applySessionGate(modules, states, session);
}

async function injectSessionProbe(tabId) {
  try {
    debug(
      `Sesión no disponible; inyectando probe en pestaña ${tabId}.`,
    );
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["session-probe.js"],
    });
    return true;
  } catch (error) {
    logError(`No se pudo inyectar session-probe en la pestaña ${tabId}`, error);
    return false;
  }
}

async function ensureTabSession(tabId, url) {
  if (sessionKnownTabs.has(tabId)) return;

  let session = await requestTabSession(tabId);

  if (!session) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    session = await requestTabSession(tabId);
  }

  if (!session) {
    await injectSessionProbe(tabId);
    return;
  }

  await syncTab(
    tabId,
    url,
    () => getStatesForTab(tabId),
    modules,
  ).catch((error) =>
    logError(`No se pudo sincronizar la pestaña ${tabId}`, error),
  );
}

async function primeTabSessions() {
  const tabs = await targetTabs();

  await Promise.all(
    tabs.map((tab) => ensureTabSession(tab.id, tab.url)),
  );
}

async function targetTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.filter((tab) => isTargetUrl(tab.url));
}

async function refreshBadge(states) {
  const enabled = modules.some(
    (definition) => states[definition.id]?.enabled === true,
  );

  await chrome.action.setBadgeBackgroundColor({
    color: enabled ? "#22c55e" : "#64748b",
  });
  await chrome.action.setBadgeText({ text: enabled ? "ON" : "OFF" });
}

async function syncAll() {
  const tabs = await targetTabs();

  await Promise.all(
    tabs.map((tab) =>
      syncTab(
        tab.id,
        tab.url,
        () => getStatesForTab(tab.id),
        modules,
      ).catch((error) =>
        logError(`No se pudo sincronizar la pestaña ${tab.id}`, error),
      ),
    ),
  );
}

async function refreshAll() {
  const states = await getGlobalStates();

  await syncAll();
  await primeTabSessions();
  await refreshBadge(states);
}

function restart() {
  ready = refreshAll().catch((error) =>
    logError("No se pudo actualizar la extensión", error),
  );

  return ready;
}

async function applyToTab(tabId, url) {
  await ready.catch(() => {});
  await syncTab(tabId, url, () => getStatesForTab(tabId), modules);
}

// ─── al navegar dentro del sitio, mantener el estado ────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading") {
    sessionKnownTabs.delete(tabId);
  }

  if (!isTargetUrl(tab?.url)) return;

  if (changeInfo.status === "loading") {
    void applyToTab(tabId, tab.url).catch((error) =>
      logError("No se pudo aplicar el CSS al navegar", error),
    );
    return;
  }

  if (changeInfo.status === "complete") {
    void ensureTabSession(tabId, tab.url).catch((error) =>
      logError("No se pudo comprobar la sesión al cargar", error),
    );
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  sessionKnownTabs.delete(tabId);
});

// ─── el content script avisa cuando detecta login/logout ────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "modules:sync") {
    const origin = reportedTargetOrigin(message, sender.tab?.url);

    if (origin && origin !== TARGET_ORIGIN) {
      reloadForTargetMismatch(origin);
      sendResponse({ ok: false, error: "target-mismatch" });
      return true;
    }

    restart()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        logError("No se pudo resincronizar la extensión", error);
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (message?.type === "css:ensure") {
    const tabId = sender.tab?.id;
    const url = sender.tab?.url;
    const origin = reportedTargetOrigin(message, url);

    if (origin && origin !== TARGET_ORIGIN) {
      reloadForTargetMismatch(origin);
      sendResponse({ ok: false, error: "target-mismatch" });
      return true;
    }

    if (typeof tabId !== "number" || !isTargetUrl(url)) {
      sendResponse({ ok: false, error: "not-target" });
      return false;
    }

    sessionKnownTabs.add(tabId);

    syncTab(
      tabId,
      url,
      () => getStatesForTab(tabId),
      modules,
    )
      .then((inserted) => sendResponse({ ok: inserted === true }))
      .catch((error) => {
        logError("No se pudo confirmar el CSS", error);
        sendResponse({ ok: false, error: String(error) });
      });

    return true;
  }

  if (message?.type === "css:text") {
    getCssText()
      .then((css) => sendResponse({ ok: true, css }))
      .catch((error) => {
        logError("No se pudo leer el CSS", error);
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (message?.type === "trusted-click") {
    handleTrustedClick(message, sender)
      .then((result) => sendResponse(result))
      .catch((error) => {
        logError("No se pudo hacer el clic confiable", error);
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (message?.type !== "session:update") return false;

  const tabId = sender.tab?.id;
  const url = sender.tab?.url;
  const origin = reportedTargetOrigin(message, url);

  if (origin && origin !== TARGET_ORIGIN) {
    reloadForTargetMismatch(origin);
    sendResponse({ ok: false, error: "target-mismatch" });
    return false;
  }

  if (typeof tabId !== "number" || !isTargetUrl(url)) return false;

  sessionKnownTabs.add(tabId);

  applyToTab(tabId, url)
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      logError("No se pudo aplicar la sesión", error);
      sendResponse({ ok: false, error: String(error) });
    });

  return true;
});

// ─── estado inicial, instalación y cambios de configuración ─────────────────
chrome.runtime.onStartup.addListener(() => {
  void restart();
});

chrome.runtime.onInstalled.addListener(() => {
  void restart();
});

watchModuleStates(() => {
  void restart();
});

watchSession(() => {
  void restart();
});

void initLogger();
void getCssText().catch((error) =>
  logError("No se pudo preparar el CSS de respaldo", error),
);

ready = restart();
