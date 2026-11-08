import { isTargetUrl } from "./config.js";

function matchesPattern(pattern, url) {
  if (typeof pattern !== "string" || typeof url !== "string") return false;
  if (!pattern.includes("*")) return pattern === url;

  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");

  return new RegExp(`^${source}$`).test(url);
}

// Los patrones relativos se resuelven contra el origin de la propia URL,
// no contra un origin global: el target se detecta por hostname.
function resolvePattern(pattern, origin) {
  if (typeof pattern !== "string" || pattern.length === 0) return "";
  if (/^https?:\/\//i.test(pattern)) return pattern;
  if (pattern.startsWith("/")) return `${origin}${pattern}`;
  return `${origin}/${pattern}`;
}

export function matchesTarget(url, patterns) {
  if (!isTargetUrl(url) || !Array.isArray(patterns)) return false;

  let origin = "";
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }

  return patterns.some((pattern) =>
    matchesPattern(resolvePattern(pattern, origin), url),
  );
}
