import { existsSync, readFileSync } from "node:fs";
import { CONFIG_FILE } from "./paths";

function stripTomlComment(line: string) {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "#" && !quoted) return line.slice(0, index);
  }
  return line;
}

export function readConfigTomlBoolean(section: string, key: string, fallback = false) {
  if (!existsSync(CONFIG_FILE)) return fallback;
  let currentSection = "";
  try {
    const content = readFileSync(CONFIG_FILE, "utf8");
    for (const rawLine of content.split(/\r?\n/)) {
      const line = stripTomlComment(rawLine).trim();
      if (!line) continue;
      const sectionMatch = line.match(/^\[([^\]]+)\]$/);
      if (sectionMatch) {
        currentSection = sectionMatch[1].trim();
        continue;
      }
      if (currentSection !== section) continue;
      const valueMatch = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(true|false)\s*$/i);
      if (!valueMatch || valueMatch[1] !== key) continue;
      return valueMatch[2].toLowerCase() === "true";
    }
  } catch {
    return fallback;
  }
  return fallback;
}

export function imageEditMaskDebugEnabled() {
  return readConfigTomlBoolean("debug", "image_edit_mask", false);
}
