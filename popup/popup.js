import { ACTIVE_TARGET, TARGET_ORIGIN, TARGET_URL, isTargetUrl } from "../core/config.js";
import {
  defaultSession,
  getSessionState,
  isSessionActive,
  normalizeSession,
  watchSession,
} from "../core/session.js";
import { getModuleStates, setModuleEnabled } from "../core/storage.js";
import { modules as rawModules } from "../modules/index.js";

const modules = (Array.isArray(rawModules) ? rawModules : []).filter(
  (definition) =>
    definition &&
    typeof definition.id === "string" &&
    definition.id.length > 0,
);

const elements = {
  version: document.getElementById("version"),
  targetUrl: document.getElementById("target-url"),
  targetMode: document.getElementById("target-mode"),
  sessionState: document.getElementById("session-state"),
  currentUrl: document.getElementById("current-url"),
  openTarget: document.getElementById("open-target"),
  reloadPage: document.getElementById("reload-page"),
  status: document.getElementById("status"),
  moduleList: document.getElementById("module-list"),
};

let states = {};
let sessionInfo = {
  session: defaultSession(),
  tabIsTarget: false,
  tabId: null,
  tabUrl: null,
  fresh: false,
};
let ready = false;

function showStatus(text, tone = "neutral") {
  elements.status.textContent = text;
  elements.status.dataset.tone = tone;
  elements.status.hidden = false;
}

function hideStatus() {
  elements.status.hidden = true;
  elements.status.textContent = "";
  delete elements.status.dataset.tone;
}

function isSessionUsable() {
  if (sessionInfo.tabIsTarget) {
    return sessionInfo.fresh === true && isSessionActive(sessionInfo.session);
  }

  return isSessionActive(sessionInfo.session);
}

function sessionBlockNote() {
  if (sessionInfo.tabIsTarget && !sessionInfo.fresh) {
    return "Recarga la página para comprobar la sesión.";
  }

  if (!sessionInfo.tabIsTarget && !sessionInfo.session.known) {
    return "Abre la página objetivo.";
  }

  if (!sessionInfo.session.known) {
    return "Comprobando sesión...";
  }

  if (sessionInfo.session.reason === "live-disconnected") {
    return "Reconecta Live para activar.";
  }

  return "Inicia sesión para activar.";
}

function setLocalEnabled(definition, enabled) {
  states = {
    ...states,
    [definition.id]: {
      ...(states[definition.id] ?? {}),
      enabled,
      settings: states[definition.id]?.settings ?? {},
    },
  };
}

async function saveToggle(definition, input, row) {
  if (definition.requiresSession === true && !isSessionUsable()) {
    return;
  }

  const name = definition.name || definition.id;
  const previous = Boolean(states[definition.id]?.enabled);
  const next = input.checked;

  hideStatus();
  input.disabled = true;
  row.dataset.saving = "true";

  try {
    await setModuleEnabled(definition.id, next);
    setLocalEnabled(definition, next);
  } catch (error) {
    input.checked = previous;
    showStatus(`No se pudo guardar "${name}".`, "error");
    console.error("[andypsx-live] No se pudo guardar el módulo:", error);
  } finally {
    input.disabled = false;
    delete row.dataset.saving;
  }
}

function createModuleCopy(definition, nameId, descriptionId, note) {
  const copy = document.createElement("span");
  copy.className = "copy";

  const name = document.createElement("span");
  name.className = "label";
  name.id = nameId;
  name.textContent = definition.name || definition.id;
  copy.append(name);

  if (definition.description) {
    const description = document.createElement("span");
    description.className = "desc";
    description.id = descriptionId;
    description.textContent = definition.description;
    copy.append(description);
  }

  if (note) {
    const noteElement = document.createElement("span");
    noteElement.className = "note";
    noteElement.textContent = note;
    copy.append(noteElement);
  }

  return copy;
}

function createModuleSwitch({
  definition,
  nameId,
  descriptionId,
  inputId,
  row,
  checked,
  disabled,
}) {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "toggle-input";
  input.id = inputId;
  input.checked = checked;
  input.disabled = disabled;
  input.setAttribute("aria-labelledby", nameId);
  if (definition.description) {
    input.setAttribute("aria-describedby", descriptionId);
  }
  input.addEventListener("change", () => {
    void saveToggle(definition, input, row);
  });

  const track = document.createElement("span");
  track.className = "track";
  track.setAttribute("aria-hidden", "true");

  const thumb = document.createElement("span");
  thumb.className = "thumb";
  track.append(thumb);

  return { input, track };
}

function createModuleRow(definition, { checked, disabled, note }) {
  const safeId = definition.id.replace(/[^a-zA-Z0-9_-]/g, "-");
  const nameId = `module-name-${safeId}`;
  const descriptionId = `module-description-${safeId}`;
  const inputId = `toggle-${safeId}`;

  const row = document.createElement("li");
  row.className = "module-row";

  const label = document.createElement("label");
  label.className = "fila";
  label.htmlFor = inputId;

  const { input, track } = createModuleSwitch({
    definition,
    nameId,
    descriptionId,
    inputId,
    row,
    checked,
    disabled,
  });

  label.append(
    createModuleCopy(definition, nameId, descriptionId, note),
    input,
    track,
  );
  row.append(label);

  return row;
}

function renderSession() {
  const { session, tabIsTarget, fresh, tabUrl } = sessionInfo;

  elements.currentUrl.textContent = tabUrl
    ? `Pestaña: ${tabUrl}`
    : "Pestaña: —";
  elements.currentUrl.dataset.match = tabIsTarget ? "true" : "false";
  elements.reloadPage.hidden = !(tabIsTarget && !fresh);

  let text = "Comprobando sesión...";
  let tone = "neutral";

  if (tabIsTarget && !fresh) {
    text = "Sesión sin comprobar";
    tone = "warn";
  } else if (!tabIsTarget && !session.known) {
    text = "Abre la página objetivo";
  } else if (!session.known) {
    text = "Comprobando sesión...";
  } else if (session.loggedIn) {
    text = "Sesión iniciada";
    tone = "ok";
  } else if (session.reason === "live-disconnected") {
    text = "Reconecta Live";
    tone = "warn";
  } else {
    text = "Sin sesión";
    tone = "warn";
  }

  elements.sessionState.textContent = text;
  elements.sessionState.dataset.tone = tone;
}

function renderModules() {
  elements.moduleList.replaceChildren();

  if (modules.length === 0) {
    showStatus("Todavía no hay módulos registrados.");
    return;
  }

  hideStatus();
  const activeSession = isSessionUsable();

  for (const definition of modules) {
    const blocked = definition.requiresSession === true && !activeSession;
    const storedEnabled = Boolean(states[definition.id]?.enabled);
    const note = blocked ? sessionBlockNote() : null;

    elements.moduleList.append(
      createModuleRow(definition, {
        checked: blocked ? false : storedEnabled,
        disabled: blocked,
        note,
      }),
    );
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

async function readSessionForActiveTab() {
  const tab = await getActiveTab().catch((error) => {
    console.error("[andypsx-live] No se pudo leer la pestaña activa:", error);
    return null;
  });
  const tabUrl = typeof tab?.url === "string" ? tab.url : null;
  const tabId = typeof tab?.id === "number" ? tab.id : null;
  const tabIsTarget = Boolean(tab && isTargetUrl(tab.url));

  if (tabIsTarget) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: "session:get",
      });

      if (response?.ok && response.session) {
        const session = normalizeSession(response.session);

        if (session.origin === TARGET_ORIGIN) {
          return {
            session,
            tabIsTarget: true,
            tabId,
            tabUrl,
            fresh: true,
          };
        }
      }
    } catch (error) {
      console.debug(
        "[andypsx-live] No se pudo pedir la sesión a la pestaña:",
        error,
      );
    }
  }

  return {
    session: await getSessionState(),
    tabIsTarget,
    tabId,
    tabUrl,
    fresh: false,
  };
}

async function load() {
  showStatus("Cargando...");

  try {
    const [nextStates, nextSessionInfo] = await Promise.all([
      getModuleStates(modules),
      readSessionForActiveTab(),
    ]);

    states = nextStates;
    sessionInfo = nextSessionInfo;
    ready = true;
    renderSession();
    renderModules();

    if (sessionInfo.tabIsTarget && !sessionInfo.fresh) {
      void chrome.runtime
        .sendMessage({ type: "modules:sync", targetOrigin: TARGET_ORIGIN })
        .catch((error) =>
          console.debug("[andypsx-live] No se pudo pedir resync:", error),
        );
    }
  } catch (error) {
    showStatus("No se pudo leer la configuración de módulos.", "error");
    console.error("[andypsx-live] No se pudo cargar el popup:", error);
  }
}

function bindEvents() {
  elements.openTarget.addEventListener("click", () => {
    chrome.tabs.create({ url: TARGET_URL }).catch((error) => {
      showStatus("No se pudo abrir la página objetivo.", "error");
      console.error("[andypsx-live] No se pudo abrir la página:", error);
    });
  });

  elements.reloadPage.addEventListener("click", () => {
    if (typeof sessionInfo.tabId !== "number") return;

    chrome.tabs
      .reload(sessionInfo.tabId)
      .then(() => window.close())
      .catch((error) => {
        showStatus("No se pudo recargar la página.", "error");
        console.error("[andypsx-live] No se pudo recargar la página:", error);
      });
  });
}

elements.version.textContent = `v${chrome.runtime.getManifest().version}`;
elements.targetUrl.textContent = TARGET_URL;
elements.targetUrl.title = TARGET_URL;
elements.targetMode.textContent =
  ACTIVE_TARGET === "local" ? "Local" : "Producción";

bindEvents();

watchSession((session) => {
  sessionInfo = {
    ...sessionInfo,
    session,
    fresh: sessionInfo.tabIsTarget ? true : sessionInfo.fresh,
  };
  if (!ready) return;
  renderSession();
  renderModules();
});

void load();
