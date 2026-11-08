import { LEGACY_STORAGE_KEY, STORAGE_KEYS } from "./config.js";

const MODULES_KEY = STORAGE_KEYS.modules;
let storageQueue = Promise.resolve();

function withStorageLock(task) {
  const next = storageQueue.then(task, task);
  storageQueue = next.catch(() => {});
  return next;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function cleanDefinitions(definitions) {
  if (!Array.isArray(definitions)) return [];

  return definitions.filter(
    (definition) =>
      isRecord(definition) &&
      typeof definition.id === "string" &&
      definition.id.length > 0,
  );
}

function defaultSettingsFor(definition) {
  return isRecord(definition.defaultSettings)
    ? clone(definition.defaultSettings)
    : {};
}

function settingsFor(definition, entry) {
  const fallback = defaultSettingsFor(definition);

  return isRecord(entry?.settings)
    ? { ...fallback, ...clone(entry.settings) }
    : fallback;
}

function enabledFor(definition, entry, legacyEnabled) {
  if (typeof entry?.enabled === "boolean") return entry.enabled;

  // La clave antigua solo se aplica al módulo marcado como legacy y solo
  // mientras no exista un estado nuevo para ese módulo.
  if (
    !entry &&
    definition.legacyState === true &&
    typeof legacyEnabled === "boolean"
  ) {
    return legacyEnabled;
  }

  return Boolean(definition.defaultEnabled);
}

function normalizeStates(definitions, raw) {
  const nextStates = { ...raw.modules };

  for (const definition of definitions) {
    const entry = isRecord(raw.modules[definition.id])
      ? raw.modules[definition.id]
      : null;

    nextStates[definition.id] = {
      enabled: enabledFor(definition, entry, raw.legacyEnabled),
      settings: settingsFor(definition, entry),
    };
  }

  return nextStates;
}

async function readRaw() {
  const stored = await chrome.storage.sync.get([MODULES_KEY, LEGACY_STORAGE_KEY]);

  return {
    modules: isRecord(stored[MODULES_KEY]) ? stored[MODULES_KEY] : {},
    legacyEnabled: stored[LEGACY_STORAGE_KEY],
  };
}

async function removeLegacyKey() {
  try {
    await chrome.storage.sync.remove(LEGACY_STORAGE_KEY);
  } catch (error) {
    console.warn("[andypsx-live] No se pudo borrar la clave antigua:", error);
  }
}

async function migrateLegacy(definitions, raw, nextStates) {
  if (typeof raw.legacyEnabled !== "boolean") return;

  const needsMigration = definitions.some(
    (definition) =>
      definition.legacyState === true && !isRecord(raw.modules[definition.id]),
  );

  if (!needsMigration) return;

  await chrome.storage.sync.set({ [MODULES_KEY]: nextStates });
  await removeLegacyKey();
}

function withEnabledModule(modules, id, enabled) {
  const entry = isRecord(modules[id]) ? modules[id] : {};

  return {
    ...modules,
    [id]: {
      ...entry,
      enabled: Boolean(enabled),
      settings: isRecord(entry.settings) ? entry.settings : {},
    },
  };
}

export function getModuleStates(definitions) {
  const known = cleanDefinitions(definitions);

  return withStorageLock(async () => {
    const raw = await readRaw();
    const nextStates = normalizeStates(known, raw);

    await migrateLegacy(known, raw, nextStates);

    return nextStates;
  });
}

export function setModuleEnabled(id, enabled) {
  if (typeof id !== "string" || id.length === 0) {
    return Promise.reject(
      new TypeError("El id del módulo debe ser una cadena no vacía."),
    );
  }

  return withStorageLock(async () => {
    const raw = await readRaw();

    await chrome.storage.sync.set({
      [MODULES_KEY]: withEnabledModule(raw.modules, id, enabled),
    });

    await removeLegacyKey();
  });
}

export function watchModuleStates(callback) {
  if (typeof callback !== "function") {
    throw new TypeError("watchModuleStates necesita una función.");
  }

  const listener = (changes, areaName) => {
    if (areaName !== "sync" || !changes[MODULES_KEY]) return;
    callback(changes[MODULES_KEY].newValue ?? {});
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
