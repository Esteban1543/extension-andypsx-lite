import { CSS_ORIGIN, CSS_REMOVE_ATTEMPTS, isTargetUrl } from "./config.js";
import { matchesTarget } from "./url.js";

const tabQueues = new Map();

// v1.0.x inyectaba este archivo. Se limpia para no dejar CSS viejo pegado
// después de actualizar la extensión sin recargar la página.
const LEGACY_CSS_FILES = ["styles/live.css"];

function queueForTab(tabId, task) {
  const previous = tabQueues.get(tabId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(task);

  tabQueues.set(tabId, next);

  return next.finally(() => {
    if (tabQueues.get(tabId) === next) tabQueues.delete(tabId);
  });
}

function filesFor(definition) {
  const styles = Array.isArray(definition.styles) ? definition.styles : [];

  return styles
    .filter((file) => typeof file === "string" && file.length > 0)
    .map((file) => `modules/${definition.id}/${file}`);
}

async function removeCss(tabId, files) {
  for (const file of files) {
    for (let attempt = 0; attempt < CSS_REMOVE_ATTEMPTS; attempt += 1) {
      try {
        await chrome.scripting.removeCSS({
          target: { tabId },
          files: [file],
          origin: CSS_ORIGIN,
        });
      } catch {
        // removeCSS rechaza cuando ya no queda ninguna instancia de ese CSS.
        break;
      }
    }
  }
}

async function insertCss(tabId, file) {
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: [file],
      origin: CSS_ORIGIN,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.debug(`[andypsx-live] No se pudo insertar ${file}:`, detail);
  }
}

async function insertActiveModules(tabId, url, states, definitions) {
  if (!isTargetUrl(url)) return;

  for (const definition of definitions) {
    if (states?.[definition.id]?.enabled !== true) continue;
    if (!matchesTarget(url, definition.matches)) continue;

    for (const file of filesFor(definition)) {
      await insertCss(tabId, file);
    }
  }
}

// Limpia todos los módulos y vuelve a insertar solo los activos.
// La cola por pestaña evita que dos eventos "loading" dejen CSS duplicado.
// getStates se ejecuta dentro de la cola para que una lectura antigua nunca
// pise un cambio de estado más reciente.
export function syncTab(tabId, url, getStates, modules) {
  return queueForTab(tabId, async () => {
    const definitions = Array.isArray(modules) ? modules : [];
    const states =
      typeof getStates === "function" ? await getStates() : getStates;
    const allFiles = [
      ...definitions.flatMap(filesFor),
      ...LEGACY_CSS_FILES,
    ];

    await removeCss(tabId, allFiles);
    await insertActiveModules(tabId, url, states, definitions);
  });
}
