import { normalizeSemver } from "./semver";

declare const __APP_VERSION__: string | undefined;

const embeddedVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "";

export const APP_VERSION = normalizeSemver(embeddedVersion) ?? "0.0.0-dev";
