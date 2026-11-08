import { DEBUG_KEY } from "./config.js";

let debugEnabled = false;

export async function initLogger() {
  try {
    const stored = await chrome.storage.local.get(DEBUG_KEY);
    debugEnabled = stored[DEBUG_KEY] === true;
  } catch {
    debugEnabled = false;
  }

  return debugEnabled;
}

export function isDebugEnabled() {
  return debugEnabled;
}

export function log(...args) {
  if (debugEnabled) console.log(...args);
}

export function warn(...args) {
  if (debugEnabled) console.warn(...args);
}

export function debug(...args) {
  if (debugEnabled) console.debug(...args);
}

export function error(...args) {
  if (debugEnabled) console.error("Extension:", ...args);
}
