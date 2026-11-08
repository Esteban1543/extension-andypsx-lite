// Cambia solo este archivo para mover la extensión entre local y producción.
// 1. Ajusta la URL del target si hace falta.
// 2. Cambia ACTIVE_TARGET a "local" o "production".
// 3. Recarga la extensión en chrome://extensions y la página objetivo.

export const TARGETS = {
  local: {
    url: "http://127.0.0.1:8765/index.html",
  },
  production: {
    url: "https://andypsx.com/live",
  },
};

export const ACTIVE_TARGET = "local";
export const TARGET_URL = TARGETS[ACTIVE_TARGET].url;
export const TARGET_ORIGIN = new URL(TARGET_URL).origin;
const TARGET_PATH = new URL(TARGET_URL).pathname;

function normalizePath(path) {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

export function isTargetPage(url) {
  if (!isTargetUrl(url)) return false;

  try {
    return normalizePath(new URL(url).pathname) === normalizePath(TARGET_PATH);
  } catch {
    return false;
  }
}

export const STORAGE_KEYS = Object.freeze({
  modules: "modules",
});

export const DEBUG_KEY = "debug";
export const CSS_CACHE_KEY = "styleSource";

// Clave antigua (v1.0.x). Se migra a modules.vista-limpia.enabled.
export const LEGACY_STORAGE_KEY = "andypsxLiveEnabled";

// AUTHOR mantiene el mismo comportamiento que Stylus. USER haría que nuestro
// !important aplastara los !important del sitio y cambiaría el aspecto.
export const CSS_ORIGIN = "AUTHOR";

// Cada removeCSS elimina una instancia. El límite limpia duplicados antiguos.
export const CSS_REMOVE_ATTEMPTS = 8;

export function isTargetUrl(url) {
  if (typeof url !== "string") return false;

  try {
    return new URL(url).origin === TARGET_ORIGIN;
  } catch {
    return false;
  }
}
