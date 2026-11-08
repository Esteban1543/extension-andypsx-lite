// El target se detecta en runtime según el hostname de la URL visitada.
// No hay constante "ACTIVE_TARGET" versionada: la build commiteada funciona
// igual en producción y en local sin editar nada.
//
// - http://127.0.0.1:<puerto>/... o http://localhost:<puerto>/... → local
//   (copia servida con `python3 -m http.server`, página /index.html).
// - https://andypsx.com/... → producción (página /live).

export const TARGETS = Object.freeze({
  local: Object.freeze({
    url: "http://127.0.0.1:8765/index.html",
    label: "Local",
  }),
  production: Object.freeze({
    url: "https://andypsx.com/live",
    label: "Producción",
  }),
});

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);
const PRODUCTION_HOSTNAME = "andypsx.com";
const PRODUCTION_PAGE_PATH = "/live";
const LOCAL_PAGE_PATHS = new Set(["/", "/index.html"]);

function normalizePath(path) {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function parseUrl(url) {
  if (typeof url !== "string" || url.length === 0) return null;

  try {
    return new URL(url);
  } catch {
    return null;
  }
}

// Devuelve el target implícito para una URL, o null si la URL no es de
// ningún target. El origin se toma de la propia URL: en local vale cualquier
// puerto; en producción solo https://andypsx.com.
export function targetForUrl(url) {
  const parsed = parseUrl(url);
  if (!parsed) return null;

  if (parsed.protocol === "http:" && LOCAL_HOSTNAMES.has(parsed.hostname)) {
    return {
      key: "local",
      origin: parsed.origin,
      url: TARGETS.local.url,
      label: TARGETS.local.label,
    };
  }

  if (
    parsed.protocol === "https:" &&
    parsed.hostname === PRODUCTION_HOSTNAME
  ) {
    return {
      key: "production",
      origin: parsed.origin,
      url: TARGETS.production.url,
      label: TARGETS.production.label,
    };
  }

  return null;
}

export function isTargetUrl(url) {
  return targetForUrl(url) !== null;
}

export function isTargetPage(url) {
  const parsed = parseUrl(url);
  if (!parsed) return false;

  const path = normalizePath(parsed.pathname);

  if (parsed.protocol === "http:" && LOCAL_HOSTNAMES.has(parsed.hostname)) {
    return LOCAL_PAGE_PATHS.has(path);
  }

  if (
    parsed.protocol === "https:" &&
    parsed.hostname === PRODUCTION_HOSTNAME
  ) {
    return path === PRODUCTION_PAGE_PATH;
  }

  return false;
}

// ¿Este origin pertenece a algún target conocido? Se usa para validar la
// sesión guardada cuando no hay una URL de referencia (p. ej. el badge).
export function isKnownTargetOrigin(origin) {
  const parsed = parseUrl(origin);
  return parsed !== null && targetForUrl(parsed.href) !== null;
}

export const STORAGE_KEYS = Object.freeze({
  modules: "modules",
});

export const DEBUG_KEY = "debug";

// Clave antigua (v1.0.x). Se migra a modules.vista-limpia.enabled.
export const LEGACY_STORAGE_KEY = "andypsxLiveEnabled";

// AUTHOR mantiene el mismo comportamiento que Stylus. USER haría que nuestro
// !important aplastara los !important del sitio y cambiaría el aspecto.
export const CSS_ORIGIN = "AUTHOR";

// Cada removeCSS elimina una instancia. El límite limpia duplicados antiguos.
export const CSS_REMOVE_ATTEMPTS = 8;
