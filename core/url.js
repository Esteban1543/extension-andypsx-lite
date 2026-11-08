import { TARGET_ORIGIN, isTargetUrl } from "./config.js";

function matchesPattern(pattern, url) {
  if (typeof pattern !== "string" || typeof url !== "string") return false;
  if (!pattern.includes("*")) return pattern === url;

  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");

  return new RegExp(`^${source}$`).test(url);
}

function resolvePattern(pattern) {
  if (typeof pattern !== "string" || pattern.length === 0) return "";
  if (/^https?:\/\//i.test(pattern)) return pattern;
  if (pattern.startsWith("/")) return `${TARGET_ORIGIN}${pattern}`;
  return `${TARGET_ORIGIN}/${pattern}`;
}

export function matchesTarget(url, patterns) {
  if (!isTargetUrl(url) || !Array.isArray(patterns)) return false;

  return patterns.some((pattern) => matchesPattern(resolvePattern(pattern), url));
}
