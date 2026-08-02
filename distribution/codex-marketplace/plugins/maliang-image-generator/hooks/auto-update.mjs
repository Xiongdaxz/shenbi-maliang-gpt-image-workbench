import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// distribution/codex-marketplace/plugins/maliang-image-generator/hooks/auto-update.ts
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  appendFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
var PLUGIN_NAME = "maliang-image-generator";
var MARKETPLACE_NAME = "maliang-internal";
var SELECTOR = `${PLUGIN_NAME}@${MARKETPLACE_NAME}`;
var UPDATE_CHECK_PATH = "/plugin/latest.json";
var DEFAULT_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
var LOCK_STALE_MS = 10 * 60 * 1000;
var MAX_MANIFEST_BYTES = 256 * 1024;
var MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
var MAX_EXTRACTED_BYTES = 200 * 1024 * 1024;
var MAX_EXTRACTED_FILES = 500;
var COMMAND_TIMEOUT_MS = 60000;
function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function requireString(value, field) {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`Invalid ${field}`);
  return value.trim();
}
function requireBoolean(value, field) {
  if (typeof value !== "boolean")
    throw new Error(`Invalid ${field}`);
  return value;
}
function requireInteger(value, field, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid ${field}`);
  }
  return value;
}
var SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
function parseSemVer(value) {
  const match = SEMVER_PATTERN.exec(value);
  if (!match)
    throw new Error(`Invalid SemVer: ${value}`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : []
  };
}
function compareSemver(left, right) {
  const a = parseSemVer(left);
  const b = parseSemVer(right);
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key])
      return a[key] > b[key] ? 1 : -1;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    if (a.prerelease.length === b.prerelease.length)
      return 0;
    return a.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0;index < length; index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined)
      return -1;
    if (rightPart === undefined)
      return 1;
    if (leftPart === rightPart)
      continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric)
      return Number(leftPart) > Number(rightPart) ? 1 : -1;
    if (leftNumeric !== rightNumeric)
      return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}
function privateOrLoopbackHostname(hostname) {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized === "localhost" || normalized.endsWith(".localhost"))
    return true;
  const ipVersion = isIP(normalized);
  if (ipVersion === 6) {
    return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
  }
  if (ipVersion !== 4)
    return false;
  const parts = normalized.split(".").map((part) => Number(part));
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 169 && parts[1] === 254 || parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31 || parts[0] === 192 && parts[1] === 168 || parts[0] === 100 && (parts[1] ?? 0) >= 64 && (parts[1] ?? 0) <= 127;
}
function validateAutomaticUpdateUrl(url, field) {
  if (url.username || url.password)
    throw new Error(`${field} contains credentials`);
  if (url.protocol === "https:")
    return;
  if (url.protocol === "http:" && privateOrLoopbackHostname(url.hostname))
    return;
  throw new Error(`${field} must use HTTPS or trusted local/private-LAN HTTP`);
}
function parseTrustedUrl(value, field, expectedOrigin) {
  const url = new URL(requireString(value, field));
  validateAutomaticUpdateUrl(url, field);
  if (url.origin !== expectedOrigin)
    throw new Error(`Untrusted ${field} origin`);
  return url.href;
}
function parseLatestManifest(value, expectedOrigin) {
  if (!isObject(value) || value.schemaVersion !== 1)
    throw new Error("Invalid update manifest schemaVersion");
  if (value.type !== "codex-plugin-marketplace")
    throw new Error("Invalid update manifest type");
  if (value.marketplace !== MARKETPLACE_NAME || value.plugin !== PLUGIN_NAME) {
    throw new Error("Update manifest targets a different plugin");
  }
  if (value.channel !== "stable" || value.archiveRoot !== "codex-marketplace") {
    throw new Error("Update manifest is not the stable Maliang archive");
  }
  const version = requireString(value.version, "version");
  parseSemVer(version);
  const size = requireInteger(value.size, "size", 1, MAX_ARCHIVE_BYTES);
  const sha256 = requireString(value.sha256, "sha256").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256))
    throw new Error("Invalid sha256");
  const downloadUrl = parseTrustedUrl(value.downloadUrl, "downloadUrl", expectedOrigin);
  const mcpResource = parseTrustedUrl(value.mcpResource, "mcpResource", expectedOrigin);
  if (!isObject(value.update) || value.update.protocolVersion !== 1) {
    throw new Error("Unsupported update protocol");
  }
  const update = value.update;
  if (update.comparison !== "semver" || update.installSelector !== SELECTOR || update.strategy !== "transactional-local-marketplace-replacement" || update.defaultMode !== "auto" || update.automatic !== true || update.requiresUserApproval !== false || update.activation !== "next-task-or-restart") {
    throw new Error("Unsupported update policy");
  }
  if (update.compatibility !== "compatible" && update.compatibility !== "incompatible") {
    throw new Error("Invalid update compatibility");
  }
  return {
    schemaVersion: 1,
    type: "codex-plugin-marketplace",
    marketplace: MARKETPLACE_NAME,
    plugin: PLUGIN_NAME,
    version,
    channel: "stable",
    downloadUrl,
    sha256,
    size,
    archiveRoot: "codex-marketplace",
    mcpResource,
    update: {
      protocolVersion: 1,
      comparison: "semver",
      installSelector: SELECTOR,
      strategy: "transactional-local-marketplace-replacement",
      defaultMode: "auto",
      automatic: true,
      requiresUserApproval: false,
      checkIntervalHours: requireInteger(update.checkIntervalHours, "checkIntervalHours", 1, 168),
      activation: "next-task-or-restart",
      compatibility: update.compatibility,
      critical: requireBoolean(update.critical, "critical"),
      blockOldVersion: requireBoolean(update.blockOldVersion, "blockOldVersion")
    }
  };
}
async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}
async function readPluginManifest(pluginRoot) {
  const value = await readJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"));
  if (!isObject(value))
    throw new Error("Invalid installed plugin manifest");
  const manifest = {
    name: requireString(value.name, "plugin name"),
    version: requireString(value.version, "plugin version"),
    homepage: requireString(value.homepage, "plugin homepage"),
    hooks: typeof value.hooks === "string" ? value.hooks : undefined
  };
  if (manifest.name !== PLUGIN_NAME)
    throw new Error("Installed plugin name mismatch");
  parseSemVer(manifest.version);
  const homepage = new URL(manifest.homepage);
  validateAutomaticUpdateUrl(homepage, "Installed plugin homepage");
  return manifest;
}
function checkUrlFromHomepage(homepage) {
  const origin = new URL(homepage).origin;
  return new URL(UPDATE_CHECK_PATH, origin).href;
}
async function readUpdateResponseWithLimit(response, maximumBytes) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0)
    throw new Error("Invalid response size limit");
  const declaredLengthText = response.headers.get("content-length");
  if (declaredLengthText) {
    const declaredLength = Number(declaredLengthText);
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0)
      throw new Error("Invalid Content-Length");
    if (declaredLength > maximumBytes)
      throw new Error("Response exceeds size limit");
  }
  if (!response.body)
    return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done)
      break;
    size += value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel().catch(() => {
        return;
      });
      throw new Error("Response exceeds size limit");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}
async function fetchBytes(url, timeoutMs, maximumBytes) {
  const controller = new AbortController;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json, application/zip" },
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok)
      throw new Error(`HTTP ${response.status} from ${new URL(url).pathname}`);
    return await readUpdateResponseWithLimit(response, maximumBytes);
  } finally {
    clearTimeout(timeout);
  }
}
async function fetchLatestManifest(checkUrl) {
  const origin = new URL(checkUrl).origin;
  const bytes = await fetchBytes(checkUrl, 1e4, MAX_MANIFEST_BYTES);
  return parseLatestManifest(JSON.parse(bytes.toString("utf8")), origin);
}
async function defaultCommandRunner(command, timeoutMs = COMMAND_TIMEOUT_MS) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const stdout = [];
    const stderr = [];
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      if (timedOut) {
        reject(new Error(`Command timed out: ${command[0]}`));
        return;
      }
      resolve({
        exitCode: exitCode ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8")
      });
    });
  });
}
function parseCommandJson(result, label) {
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed: ${(result.stderr || result.stdout).trim().slice(0, 500)}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}
function normalizeExtendedWindowsPath(value) {
  if (value.startsWith("\\\\?\\UNC\\"))
    return `\\\\${value.slice(8)}`;
  if (value.startsWith("\\\\?\\"))
    return value.slice(4);
  return value;
}
function isPathInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || !relative.startsWith("..") && !path.isAbsolute(relative);
}
async function getInstalledPlugin(runner) {
  const value = parseCommandJson(await runner(["codex", "plugin", "list", "--json"]), "codex plugin list");
  const installed = Array.isArray(value.installed) ? value.installed : [];
  const plugin = installed.find((entry) => entry.pluginId === SELECTOR);
  if (!plugin)
    throw new Error(`Installed plugin ${SELECTOR} was not found`);
  const version = requireString(plugin.version, "installed plugin version");
  parseSemVer(version);
  if (plugin.enabled !== true)
    throw new Error(`Installed plugin ${SELECTOR} is disabled`);
  if (plugin.marketplaceSource?.sourceType !== "local")
    throw new Error("Maliang Marketplace is not a local source");
  const marketplaceRoot = path.resolve(normalizeExtendedWindowsPath(requireString(plugin.marketplaceSource?.source, "marketplace source")));
  const pluginSource = path.resolve(normalizeExtendedWindowsPath(requireString(plugin.source?.path, "plugin source")));
  if (path.parse(marketplaceRoot).root === marketplaceRoot || !isPathInside(marketplaceRoot, pluginSource)) {
    throw new Error("Unsafe Maliang Marketplace path");
  }
  return { marketplaceRoot, pluginSource, version };
}
async function assertSafeTree(directory, totals = { bytes: 0, files: 0 }) {
  const directoryInfo = await lstat(directory);
  if (directoryInfo.isSymbolicLink() || !directoryInfo.isDirectory()) {
    throw new Error("Marketplace root must be a real directory");
  }
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const info = await lstat(entryPath);
    if (info.isSymbolicLink())
      throw new Error(`Archive contains a symbolic link: ${entry.name}`);
    if (info.isDirectory())
      await assertSafeTree(entryPath, totals);
    else if (info.isFile()) {
      totals.files += 1;
      totals.bytes += info.size;
      if (totals.files > MAX_EXTRACTED_FILES || totals.bytes > MAX_EXTRACTED_BYTES) {
        throw new Error("Archive extracted contents exceed safety limits");
      }
    } else {
      throw new Error(`Archive contains an unsupported file type: ${entry.name}`);
    }
  }
  return totals;
}
async function validateMarketplaceRoot(marketplaceRoot, expectedVersion, expectedOrigin, expectedMcpResource) {
  await assertSafeTree(marketplaceRoot);
  const marketplace = await readJson(path.join(marketplaceRoot, ".agents", "plugins", "marketplace.json"));
  if (!isObject(marketplace) || marketplace.name !== MARKETPLACE_NAME || !Array.isArray(marketplace.plugins)) {
    throw new Error("Archive Marketplace manifest is invalid");
  }
  if (marketplace.plugins.length !== 1) {
    throw new Error("Automatic updates require a dedicated Maliang Marketplace");
  }
  const rootEntries = await readdir(marketplaceRoot, { withFileTypes: true });
  if (rootEntries.length !== 2 || !rootEntries.every((entry2) => entry2.isDirectory() && [".agents", "plugins"].includes(entry2.name)))
    throw new Error("Automatic updates refuse a shared Marketplace directory");
  const pluginEntries = await readdir(path.join(marketplaceRoot, "plugins"), { withFileTypes: true });
  if (pluginEntries.length !== 1 || !pluginEntries[0]?.isDirectory() || pluginEntries[0].name !== PLUGIN_NAME) {
    throw new Error("Automatic updates refuse to replace unrelated Marketplace plugins");
  }
  const entry = marketplace.plugins[0];
  if (!isObject(entry) || !isObject(entry.source) || entry.source.source !== "local" || entry.source.path !== `./plugins/${PLUGIN_NAME}`) {
    throw new Error("Archive Marketplace plugin source is invalid");
  }
  const pluginRoot = path.join(marketplaceRoot, "plugins", PLUGIN_NAME);
  const manifest = await readPluginManifest(pluginRoot);
  if (manifest.version !== expectedVersion)
    throw new Error("Archive plugin version mismatch");
  if (new URL(manifest.homepage).origin !== expectedOrigin)
    throw new Error("Archive plugin homepage origin mismatch");
  if (manifest.hooks !== "./hooks/hooks.json")
    throw new Error("Archive plugin Hook manifest is missing");
  const hooks = await readJson(path.join(pluginRoot, "hooks", "hooks.json"));
  if (!isObject(hooks) || !isObject(hooks.hooks) || !Array.isArray(hooks.hooks.PreToolUse)) {
    throw new Error("Archive PreToolUse Hook is missing");
  }
  const hookText = JSON.stringify(hooks.hooks);
  if (!hookText.includes("^mcp__maliang__.*$") || !hookText.includes("auto-update.ts") || !hookText.includes("auto-update.mjs") || !hookText.includes("auto-update.cmd")) {
    throw new Error("Archive automatic update Hook is invalid");
  }
  await stat(path.join(pluginRoot, "hooks", "auto-update.ts"));
  await stat(path.join(pluginRoot, "hooks", "auto-update.mjs"));
  await stat(path.join(pluginRoot, "hooks", "auto-update.ps1"));
  await stat(path.join(pluginRoot, "hooks", "auto-update.cmd"));
  await stat(path.join(pluginRoot, "hooks", "windows-update-gate.ts"));
  await stat(path.join(pluginRoot, "skills", "maliang-connection-help", "SKILL.md"));
  await stat(path.join(pluginRoot, "skills", "maliang-image-generator", "SKILL.md"));
  await stat(path.join(pluginRoot, "skills", "maliang-image-generator", "scripts", "maliang-helper.mjs"));
  await stat(path.join(pluginRoot, "mcp", "maliang-local-mcp.mjs"));
  const mcp = await readJson(path.join(pluginRoot, ".mcp.json"));
  if (!isObject(mcp) || !isObject(mcp.mcpServers) || !isObject(mcp.mcpServers.maliang) || !isObject(mcp.mcpServers.maliang_local)) {
    throw new Error("Archive Maliang MCP config is invalid");
  }
  if (mcp.mcpServers.maliang.url !== expectedMcpResource || mcp.mcpServers.maliang.oauth_resource !== expectedMcpResource || mcp.mcpServers.maliang.default_tools_approval_mode !== "approve") {
    throw new Error("Archive Maliang MCP endpoint mismatch");
  }
  const localMcp = mcp.mcpServers.maliang_local;
  if (localMcp.command !== "node" || localMcp.cwd !== "." || !Array.isArray(localMcp.args) || localMcp.args[0] !== "./mcp/maliang-local-mcp.mjs" || !Array.isArray(localMcp.enabled_tools) || !localMcp.enabled_tools.includes("upload_local_image") || !localMcp.enabled_tools.includes("save_image_result") || localMcp.default_tools_approval_mode !== "approve" || localMcp.required !== false) {
    throw new Error("Archive Maliang local image MCP config is invalid");
  }
  return { manifest, pluginRoot };
}
function quotePowerShellLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
async function extractArchive(archivePath, destination, runner) {
  await mkdir(destination, { recursive: false });
  let command;
  if (process.platform === "win32") {
    command = [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Expand-Archive -LiteralPath ${quotePowerShellLiteral(archivePath)} -DestinationPath ${quotePowerShellLiteral(destination)} -Force`
    ];
  } else if (process.platform === "darwin") {
    command = ["ditto", "-x", "-k", archivePath, destination];
  } else {
    command = ["unzip", "-q", archivePath, "-d", destination];
  }
  const result = await runner(command, 60000);
  if (result.exitCode !== 0) {
    throw new Error(`Archive extraction failed: ${(result.stderr || result.stdout).trim().slice(0, 500)}`);
  }
}
async function downloadAndStage(latest, pluginData, marketplaceRoot, runner) {
  const nonce = randomUUID();
  const archivePath = path.join(pluginData, `maliang-update-${latest.version}-${nonce}.zip`);
  const extractionDirectory = path.join(path.dirname(marketplaceRoot), `.maliang-extract-${nonce}`);
  try {
    const archive = await fetchBytes(latest.downloadUrl, 45000, MAX_ARCHIVE_BYTES);
    if (archive.length !== latest.size)
      throw new Error("Downloaded archive size mismatch");
    if (createHash("sha256").update(archive).digest("hex") !== latest.sha256) {
      throw new Error("Downloaded archive SHA-256 mismatch");
    }
    await writeFile(archivePath, archive, { flag: "wx" });
    await extractArchive(archivePath, extractionDirectory, runner);
    const entries = await readdir(extractionDirectory, { withFileTypes: true });
    if (entries.length !== 1 || !entries[0]?.isDirectory() || entries[0].name !== latest.archiveRoot) {
      throw new Error("Downloaded archive root mismatch");
    }
    const stagedRoot = path.join(extractionDirectory, latest.archiveRoot);
    await validateMarketplaceRoot(stagedRoot, latest.version, new URL(latest.downloadUrl).origin, latest.mcpResource);
    return { archivePath, extractionDirectory, stagedRoot };
  } catch (error) {
    await rm(extractionDirectory, { force: true, recursive: true }).catch(() => {
      return;
    });
    await rm(archivePath, { force: true }).catch(() => {
      return;
    });
    throw error;
  }
}
async function verifyInstalledVersion(expectedVersion, runner) {
  const installed = await getInstalledPlugin(runner);
  if (installed.version !== expectedVersion) {
    throw new Error(`Codex still reports plugin ${installed.version} after installing ${expectedVersion}`);
  }
  return installed;
}
async function refreshSelector(runner) {
  const result = await runner(["codex", "plugin", "add", SELECTOR, "--json"], 60000);
  if (result.exitCode !== 0) {
    throw new Error(`Plugin refresh failed: ${(result.stderr || result.stdout).trim().slice(0, 500)}`);
  }
}
async function installTransactionally(latest, currentVersion, pluginData, marketplaceRoot, runner) {
  await validateMarketplaceRoot(marketplaceRoot, currentVersion, new URL(latest.downloadUrl).origin, latest.mcpResource);
  const staged = await downloadAndStage(latest, pluginData, marketplaceRoot, runner);
  const nonce = randomUUID();
  const backupPath = `${marketplaceRoot}.backup-${currentVersion}-${nonce}`;
  const failedPath = `${marketplaceRoot}.failed-${latest.version}-${nonce}`;
  let currentMoved = false;
  let stagedMoved = false;
  try {
    await rename(marketplaceRoot, backupPath);
    currentMoved = true;
    await rename(staged.stagedRoot, marketplaceRoot);
    stagedMoved = true;
    await refreshSelector(runner);
    await verifyInstalledVersion(latest.version, runner);
    return { backupPath };
  } catch (error) {
    let rollbackError;
    try {
      if (stagedMoved)
        await rename(marketplaceRoot, failedPath);
      if (currentMoved)
        await rename(backupPath, marketplaceRoot);
      if (currentMoved)
        await refreshSelector(runner);
      await rm(failedPath, { force: true, recursive: true }).catch(() => {
        return;
      });
    } catch (caught) {
      rollbackError = caught;
    }
    if (rollbackError) {
      throw new Error(`Update failed and rollback needs manual recovery. Backup: ${backupPath}. Cause: ${String(error)}. Rollback: ${String(rollbackError)}`);
    }
    throw error;
  } finally {
    await rm(staged.extractionDirectory, { force: true, recursive: true }).catch(() => {
      return;
    });
    await rm(staged.archivePath, { force: true }).catch(() => {
      return;
    });
  }
}
function statePath(pluginData) {
  return path.join(pluginData, "update-state.json");
}
async function readState(pluginData) {
  try {
    const value = await readJson(statePath(pluginData));
    return isObject(value) && value.schemaVersion === 1 ? value : { schemaVersion: 1 };
  } catch (error) {
    if (error.code === "ENOENT")
      return { schemaVersion: 1 };
    throw error;
  }
}
async function writeState(pluginData, state) {
  const target = statePath(pluginData);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}
`, { flag: "wx" });
  await rename(temporary, target);
}
async function logEvent(pluginData, message) {
  const logPath = path.join(pluginData, "auto-update.log");
  try {
    const info = await stat(logPath);
    if (info.size > 256 * 1024)
      await rename(logPath, `${logPath}.previous`).catch(() => {
        return;
      });
  } catch (error) {
    if (error.code !== "ENOENT")
      throw error;
  }
  await appendFile(logPath, `${new Date().toISOString()} ${message.replace(/[\r\n]+/g, " ").slice(0, 1000)}
`);
}
async function readMode(pluginData) {
  const environmentMode = String(process.env.MALIANG_PLUGIN_UPDATE_MODE ?? "").trim().toLowerCase();
  if (environmentMode) {
    if (environmentMode === "auto" || environmentMode === "notify" || environmentMode === "off")
      return environmentMode;
    throw new Error("MALIANG_PLUGIN_UPDATE_MODE must be auto, notify, or off");
  }
  const settingsPath = path.join(pluginData, "update-settings.json");
  try {
    const value = await readJson(settingsPath);
    if (isObject(value) && (value.mode === "auto" || value.mode === "notify" || value.mode === "off"))
      return value.mode;
    throw new Error("update-settings.json mode must be auto, notify, or off");
  } catch (error) {
    if (error.code !== "ENOENT")
      throw error;
    await writeFile(settingsPath, `${JSON.stringify({ schemaVersion: 1, mode: "auto" }, null, 2)}
`, { flag: "wx" });
    return "auto";
  }
}
function lastCheckIsFresh(state, intervalMs) {
  if (!state.lastCheckAt)
    return false;
  const checkedAt = Date.parse(state.lastCheckAt);
  return Number.isFinite(checkedAt) && Date.now() - checkedAt >= 0 && Date.now() - checkedAt < intervalMs;
}
async function acquireLock(pluginData) {
  const lockPath = path.join(pluginData, "auto-update.lock");
  try {
    await mkdir(lockPath);
  } catch (error) {
    if (error.code !== "EEXIST")
      throw error;
    const info = await stat(lockPath);
    if (Date.now() - info.mtimeMs < LOCK_STALE_MS)
      return null;
    await rm(lockPath, { force: true, recursive: true });
    await mkdir(lockPath);
  }
  return async () => rm(lockPath, { force: true, recursive: true });
}
function updateContext(message) {
  return {
    systemMessage: message,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: message
    }
  };
}
function blockingOutput(reason) {
  return {
    systemMessage: reason,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason
    }
  };
}
function printHookOutput(value) {
  process.stdout.write(`${JSON.stringify(value)}
`);
}
async function readHookInput() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim())
    return {};
  const value = JSON.parse(text);
  return isObject(value) ? value : {};
}
async function cleanupPreviousBackup(state, currentVersion, marketplaceRoot) {
  if (!state.pendingBackupPath || state.pendingVersion !== currentVersion)
    return false;
  const backupPath = path.resolve(state.pendingBackupPath);
  const expectedPrefix = `${marketplaceRoot}.backup-`;
  if (path.dirname(backupPath) !== path.dirname(marketplaceRoot) || !backupPath.startsWith(expectedPrefix)) {
    throw new Error("Refusing to remove an unsafe Marketplace backup path");
  }
  await rm(backupPath, { force: true, recursive: true });
  delete state.pendingBackupPath;
  delete state.pendingVersion;
  delete state.pendingSessionId;
  return true;
}
async function runAutoUpdate(options) {
  const pluginRoot = path.resolve(options?.pluginRoot ?? requireString(process.env.PLUGIN_ROOT, "PLUGIN_ROOT"));
  const pluginData = path.resolve(options?.pluginData ?? requireString(process.env.PLUGIN_DATA, "PLUGIN_DATA"));
  const hookInput = options?.hookInput ?? await readHookInput();
  const runner = options?.runner ?? defaultCommandRunner;
  await mkdir(pluginData, { recursive: true });
  const releaseLock = await acquireLock(pluginData);
  if (!releaseLock)
    return;
  try {
    const mode = await readMode(pluginData);
    if (mode === "off")
      return;
    const state = await readState(pluginData);
    const current = await readPluginManifest(pluginRoot);
    if (state.blockedReason) {
      if (state.blockedVersion && compareSemver(current.version, state.blockedVersion) >= 0) {
        delete state.blockedReason;
        delete state.blockedVersion;
        await writeState(pluginData, state);
      } else {
        printHookOutput(blockingOutput(state.blockedReason));
        return;
      }
    }
    if (lastCheckIsFresh(state, DEFAULT_CHECK_INTERVAL_MS))
      return;
    const checkUrl = checkUrlFromHomepage(current.homepage);
    let latest;
    try {
      latest = await fetchLatestManifest(checkUrl);
      state.lastCheckAt = new Date().toISOString();
      state.lastCheckedVersion = latest.version;
      delete state.lastError;
      delete state.lastErrorAt;
      await writeState(pluginData, state);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      state.lastCheckAt = new Date().toISOString();
      state.lastErrorAt = state.lastCheckAt;
      state.lastError = message.slice(0, 1000);
      await writeState(pluginData, state);
      await logEvent(pluginData, `check-failed ${message}`);
      printHookOutput(updateContext(`神笔马良自动更新检查失败，当前工具继续使用 ${current.version}：${message}`));
      return;
    }
    if (compareSemver(latest.version, current.version) <= 0) {
      await logEvent(pluginData, `up-to-date ${current.version}`);
      return;
    }
    if (latest.update.compatibility === "incompatible") {
      const reason = `神笔马良 ${latest.version} 是不兼容更新，未自动覆盖当前 ${current.version}。`;
      await logEvent(pluginData, `incompatible ${current.version} -> ${latest.version}`);
      if (latest.update.critical && latest.update.blockOldVersion) {
        state.blockedReason = `${reason} 此版本已被标记为必须迁移，请先按 /plugin/install.json 完成人工更新。`;
        state.blockedVersion = latest.version;
        await writeState(pluginData, state);
        printHookOutput(blockingOutput(state.blockedReason));
      } else {
        printHookOutput(updateContext(`${reason} 当前调用继续；请在方便时执行人工更新。`));
      }
      return;
    }
    if (mode === "notify") {
      await logEvent(pluginData, `available ${current.version} -> ${latest.version}`);
      printHookOutput(updateContext(`神笔马良有可用更新 ${current.version} -> ${latest.version}；当前模式为 notify，未自动安装。`));
      return;
    }
    const installed = await getInstalledPlugin(runner);
    if (compareSemver(latest.version, installed.version) <= 0) {
      await logEvent(pluginData, `already-installed ${installed.version}; loaded ${current.version}`);
      printHookOutput(updateContext(`神笔马良 ${installed.version} 已安装；当前任务仍加载 ${current.version}，请新建任务或重启 Codex 后生效。`));
      return;
    }
    if (installed.version !== current.version) {
      throw new Error(`Loaded plugin ${current.version} does not match installed plugin ${installed.version}`);
    }
    if (await cleanupPreviousBackup(state, current.version, installed.marketplaceRoot)) {
      await writeState(pluginData, state);
      await logEvent(pluginData, `previous backup removed before updating ${current.version}`);
    }
    const result = await installTransactionally(latest, current.version, pluginData, installed.marketplaceRoot, runner);
    state.pendingBackupPath = result.backupPath;
    state.pendingVersion = latest.version;
    state.pendingSessionId = typeof hookInput.session_id === "string" ? hookInput.session_id : undefined;
    await writeState(pluginData, state);
    await logEvent(pluginData, `installed ${current.version} -> ${latest.version}; backup ${result.backupPath}`);
    printHookOutput(updateContext(`神笔马良已自动更新 ${current.version} -> ${latest.version}。当前工具调用继续使用已加载版本；新版本将在下个任务或重启 Codex 后生效。OAuth 凭据未被清除。`));
  } finally {
    await releaseLock();
  }
}
async function main() {
  const pluginData = process.env.PLUGIN_DATA ? path.resolve(process.env.PLUGIN_DATA) : undefined;
  try {
    await runAutoUpdate();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (pluginData) {
      await mkdir(pluginData, { recursive: true }).catch(() => {
        return;
      });
      await logEvent(pluginData, `update-failed ${message}`).catch(() => {
        return;
      });
      const state = await readState(pluginData).catch(() => ({ schemaVersion: 1 }));
      state.lastCheckAt = new Date().toISOString();
      state.lastErrorAt = state.lastCheckAt;
      state.lastError = message.slice(0, 1000);
      await writeState(pluginData, state).catch(() => {
        return;
      });
    }
    printHookOutput(updateContext(`神笔马良自动更新失败，已保留当前版本并继续本次工具调用：${message}`));
  }
}
var isMainModule = __require.main == __require.module === true || Boolean(process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url));
if (isMainModule)
  await main();
export {
  validateMarketplaceRoot,
  runAutoUpdate,
  readUpdateResponseWithLimit,
  readPluginManifest,
  parseLatestManifest,
  main,
  compareSemver
};
