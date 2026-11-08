import { TARGET_ORIGIN, isTargetUrl } from "./core/config.js";
import { syncTab } from "./core/css.js";
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
let ready = Promise.resolve();

function logError(message, error) {
  console.error(`[andypsx-live] ${message}`, error);
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

      if (session.origin !== TARGET_ORIGIN) return null;

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
    console.log(
      `[andypsx-live] Sesión no disponible; inyectando probe en pestaña ${tabId}.`,
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
    restart()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        logError("No se pudo resincronizar la extensión", error);
        sendResponse({ ok: false, error: String(error) });
      });
    return true;
  }

  if (message?.type !== "session:update") return false;

  const tabId = sender.tab?.id;
  const url = sender.tab?.url;

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

ready = restart();
