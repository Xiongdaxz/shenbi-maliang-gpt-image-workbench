import packageJson from "../package.json" with { type: "json" };
import { APP_UPDATE_PREVIEW_ENV, APP_VERSION_OVERRIDE_ENV } from "../server/appVersion";
import { normalizeSemver } from "../src/lib/semver";

function nextPatchVersion(version: string) {
  const [core] = version.split("-", 1);
  const [major, minor, patch] = core.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

const installedVersion = normalizeSemver(packageJson.version);
if (!installedVersion) throw new Error(`package.json version is not valid SemVer: ${packageJson.version}`);

const requestedOverride = normalizeSemver(Bun.env[APP_VERSION_OVERRIDE_ENV]);
const previewVersion = requestedOverride ?? nextPatchVersion(installedVersion);
Bun.env[APP_VERSION_OVERRIDE_ENV] = previewVersion;
Bun.env[APP_UPDATE_PREVIEW_ENV] = "1";

console.log("\n========================================");
console.log(" App update preview mode");
console.log("========================================");
console.log(` Frontend build:  ${installedVersion}`);
console.log(` Simulated server: ${previewVersion}`);
console.log(" Stop this process to leave preview mode; package.json is not changed.\n");

await import("./start-server");
