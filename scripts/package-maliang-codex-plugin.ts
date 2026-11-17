import { createHash } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveConfiguredMaliangPublicBaseUrl, validateMaliangPublicOrigin } from "../server/externalMcpAuth";
import { buildCodexPluginArchive, readCodexPluginVersion } from "../server/internalDistributionRoutes";

const requestedVersion = String(process.argv[2] ?? "").trim();
const explicitPublicBaseUrl = String(process.argv[3] ?? "").trim();
const profile = String(process.argv[4] ?? "codex");
if (profile !== "codex" && profile !== "portable") throw new Error("Package profile must be codex or portable");
const publicBaseUrl = explicitPublicBaseUrl
  ? validateMaliangPublicOrigin(explicitPublicBaseUrl)
  : resolveConfiguredMaliangPublicBaseUrl({
      appPublicUrl: Bun.env.APP_PUBLIC_URL,
      maliangPublicBaseUrl: Bun.env.MALIANG_PUBLIC_BASE_URL
    });
const repoRoot = process.cwd();
const releaseDirectory = path.join(repoRoot, "distribution", "releases");

if (!publicBaseUrl) {
  throw new Error("Static packaging requires a public base URL as the second argument or APP_PUBLIC_URL. The server download route generates a package automatically from the current request address.");
}

const version = await readCodexPluginVersion();
if (requestedVersion && requestedVersion !== version) {
  throw new Error(`Version mismatch: plugin.json is ${version}, requested package is ${requestedVersion}`);
}
const archivePath = path.join(releaseDirectory, `${profile === "portable" ? "maliang-agent-plugin" : "maliang-internal-marketplace"}-${version}.zip`);

await mkdir(releaseDirectory, { recursive: true });
await unlink(archivePath).catch((error: NodeJS.ErrnoException) => {
  if (error.code !== "ENOENT") throw error;
});
await writeFile(archivePath, await buildCodexPluginArchive(publicBaseUrl, version, profile));

const info = await stat(archivePath);
const sha256 = createHash("sha256").update(await readFile(archivePath)).digest("hex");

console.log(JSON.stringify({ version, profile, publicBaseUrl, path: archivePath, size: info.size, sha256 }, null, 2));
