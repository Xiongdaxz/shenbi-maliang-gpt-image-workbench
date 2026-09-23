import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./paths";
import { normalizeSemver } from "../src/lib/semver";

export const APP_VERSION_OVERRIDE_ENV = "GPT_IMAGE_APP_VERSION_OVERRIDE";
export const APP_UPDATE_PREVIEW_ENV = "GPT_IMAGE_APP_UPDATE_PREVIEW";

let cachedVersion = "";

export function resolveApplicationVersion(packageVersion: unknown, overrideVersion: unknown, previewEnabled = false) {
  const previewVersion = previewEnabled ? normalizeSemver(overrideVersion) : null;
  return previewVersion ?? normalizeSemver(packageVersion) ?? "unknown";
}

export function applicationVersion() {
  if (cachedVersion) return cachedVersion;
  try {
    const parsed = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version?: unknown };
    cachedVersion = resolveApplicationVersion(
      parsed.version,
      Bun.env[APP_VERSION_OVERRIDE_ENV],
      Bun.env[APP_UPDATE_PREVIEW_ENV] === "1"
    );
  } catch {
    cachedVersion = resolveApplicationVersion(
      null,
      Bun.env[APP_VERSION_OVERRIDE_ENV],
      Bun.env[APP_UPDATE_PREVIEW_ENV] === "1"
    );
  }
  return cachedVersion;
}
