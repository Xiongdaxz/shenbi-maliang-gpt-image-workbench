import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  compareSemver,
  parseLatestManifest,
  readPluginManifest,
  readUpdateResponseWithLimit,
  validateMarketplaceRoot
} from "../distribution/codex-marketplace/plugins/maliang-image-generator/hooks/auto-update";
import { shouldRunPowerShell } from "../distribution/codex-marketplace/plugins/maliang-image-generator/hooks/windows-update-gate";
import { resolveConfiguredMaliangPublicBaseUrl, resolveMaliangPublicBaseUrl } from "./externalMcpAuth";
import {
  buildCodexPluginArchive,
  cachedCodexPluginArchive,
  readCodexPluginVersion,
  registerInternalDistributionRoutes
} from "./internalDistributionRoutes";

const originalAppPublicUrl = Bun.env.APP_PUBLIC_URL;
const originalMaliangPublicBaseUrl = Bun.env.MALIANG_PUBLIC_BASE_URL;

function restoreEnvironment(name: "APP_PUBLIC_URL" | "MALIANG_PUBLIC_BASE_URL", value: string | undefined) {
  if (value === undefined) delete Bun.env[name];
  else Bun.env[name] = value;
}

afterEach(() => {
  restoreEnvironment("APP_PUBLIC_URL", originalAppPublicUrl);
  restoreEnvironment("MALIANG_PUBLIC_BASE_URL", originalMaliangPublicBaseUrl);
});

describe("Maliang public URL resolution", () => {
  test("uses the current request origin by default", () => {
    expect(resolveMaliangPublicBaseUrl({ requestUrl: "https://image.example.com/mcp" }))
      .toBe("https://image.example.com");
  });

  test("uses an explicit deployment URL when configured", () => {
    expect(resolveMaliangPublicBaseUrl({
      configuredUrl: "https://public.example.com/install/path",
      requestUrl: "http://127.0.0.1:8787/mcp"
    })).toBe("https://public.example.com");
  });

  test("keeps the legacy public URL compatible but rejects conflicting deployment origins", () => {
    expect(resolveConfiguredMaliangPublicBaseUrl({
      appPublicUrl: "https://image.example.com/app",
      maliangPublicBaseUrl: "https://image.example.com/legacy"
    })).toBe("https://image.example.com");
    expect(resolveConfiguredMaliangPublicBaseUrl({
      maliangPublicBaseUrl: "http://192.168.0.87:8787"
    })).toBe("http://192.168.0.87:8787");
    expect(() => resolveConfiguredMaliangPublicBaseUrl({
      appPublicUrl: "https://image.example.com",
      maliangPublicBaseUrl: "https://old-image.example.com"
    })).toThrow("配置冲突");
  });

  test("uses the backend site setting after environment overrides", () => {
    expect(resolveConfiguredMaliangPublicBaseUrl({
      sitePublicBaseUrl: "https://site-setting.example.com"
    })).toBe("https://site-setting.example.com");
    expect(resolveConfiguredMaliangPublicBaseUrl({
      appPublicUrl: "https://app-env.example.com",
      maliangPublicBaseUrl: "https://app-env.example.com/legacy",
      sitePublicBaseUrl: "https://site-setting.example.com"
    })).toBe("https://app-env.example.com");
    expect(resolveConfiguredMaliangPublicBaseUrl({
      maliangPublicBaseUrl: "https://legacy-env.example.com",
      sitePublicBaseUrl: "https://site-setting.example.com"
    })).toBe("https://legacy-env.example.com");
  });

  test("replaces a loopback request host with the available LAN address", () => {
    expect(resolveMaliangPublicBaseUrl({
      requestUrl: "http://127.0.0.1:8787/mcp",
      lanAddress: "192.168.0.87"
    })).toBe("http://192.168.0.87:8787");
  });

  test("only trusts forwarded host and protocol when proxy trust is enabled", () => {
    const input = {
      requestUrl: "http://127.0.0.1:8787/mcp",
      forwardedHost: "image.example.com",
      forwardedProto: "https"
    };
    expect(resolveMaliangPublicBaseUrl(input)).toBe("http://127.0.0.1:8787");
    expect(resolveMaliangPublicBaseUrl({ ...input, trustProxy: true })).toBe("https://image.example.com");
  });

  test("refuses to publish OAuth metadata over public HTTP", () => {
    expect(() => resolveMaliangPublicBaseUrl({ requestUrl: "http://image.example.com/mcp" }))
      .toThrow("必须使用 HTTPS");
    expect(() => resolveMaliangPublicBaseUrl({
      configuredUrl: "http://203.0.113.9:8787",
      requestUrl: "http://127.0.0.1:8787/mcp"
    })).toThrow("必须使用 HTTPS");
    expect(() => resolveMaliangPublicBaseUrl({ requestUrl: "http://fcorp.example/mcp" }))
      .toThrow("必须使用 HTTPS");
  });

  test("applies the same public-origin safety rules to static plugin archives", async () => {
    await expect(buildCodexPluginArchive("http://public.example"))
      .rejects.toThrow("必须使用 HTTPS");
    expect((await buildCodexPluginArchive("http://192.168.0.87:8787")).length).toBeGreaterThan(0);
  });
});

describe("Maliang Codex plugin distribution", () => {
  test("streams automatic-update responses through a hard size limit", async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(8));
        controller.enqueue(new Uint8Array(8));
        controller.close();
      }
    }));
    await expect(readUpdateResponseWithLimit(response, 12)).rejects.toThrow("Response exceeds size limit");
  });

  test("reports the host computer name through environment-backed MCP headers", async () => {
    const config = JSON.parse(await readFile(
      "distribution/codex-marketplace/plugins/maliang-image-generator/.mcp.json",
      "utf8"
    )) as {
      mcpServers: {
        maliang: {
          default_tools_approval_mode: string;
          env_http_headers: Record<string, string>;
        };
      };
    };
    expect(config.mcpServers.maliang.env_http_headers).toEqual({
      "X-Maliang-Device-Hostname": "HOSTNAME",
      "X-Maliang-Device-Name": "COMPUTERNAME",
      "X-Maliang-Device-Os": "OS",
      "X-Maliang-Device-Ostype": "OSTYPE"
    });
    expect(config.mcpServers.maliang.default_tools_approval_mode).toBe("approve");
  });

  test("bundles a Codex-managed local MCP for durable inline image delivery", async () => {
    const config = JSON.parse(await readFile(
      "distribution/codex-marketplace/plugins/maliang-image-generator/.mcp.json",
      "utf8"
    )) as {
      mcpServers: {
        maliang_local: {
          args: string[];
          command: string;
          cwd: string;
          default_tools_approval_mode: string;
          enabled_tools: string[];
          required: boolean;
        };
      };
    };
    expect(config.mcpServers.maliang_local).toEqual(expect.objectContaining({
      command: "node",
      args: ["./mcp/maliang-local-mcp.mjs"],
      cwd: ".",
      enabled_tools: ["upload_local_image", "save_image_result"],
      default_tools_approval_mode: "approve",
      required: false
    }));
    const localMcp = await readFile(
      "distribution/codex-marketplace/plugins/maliang-image-generator/mcp/maliang-local-mcp.mjs",
      "utf8"
    );
    expect(localMcp).toContain("uploadMaliangLocalImage");
    expect(localMcp).toContain("upload_local_image");
    expect(localMcp).toContain("saveMaliangImageResult");
    expect(localMcp).toContain("此工具不会打开浏览器");
  });

  test("uses a Codex-safe Windows Markdown image path", async () => {
    const skill = await readFile(
      "distribution/codex-marketplace/plugins/maliang-image-generator/skills/maliang-image-generator/SKILL.md",
      "utf8"
    );
    expect(skill).toContain("![神笔马良生成结果](/C:/absolute/path/image.png)");
    expect(skill).toContain("Never put a native backslash path directly inside the Markdown image target");
    expect(skill).toContain("mcp__maliang_local__upload_local_image");
    expect(skill).toContain("mcp__maliang_local__save_image_result");
    expect(skill).toContain("Never open a generated result URL");
    expect(skill).not.toContain("Otherwise open the exact signed download URL");
  });

  test("keeps OAuth browser fallback and automatic update policy deterministic in both plugin skills", async () => {
    const imageSkill = await readFile(
      "distribution/codex-marketplace/plugins/maliang-image-generator/skills/maliang-image-generator/SKILL.md",
      "utf8"
    );
    const connectionSkill = await readFile(
      "distribution/codex-marketplace/plugins/maliang-image-generator/skills/maliang-connection-help/SKILL.md",
      "utf8"
    );
    for (const skill of [imageSkill, connectionSkill]) {
      expect(skill).toContain("Codex in-app Browser");
      expect(skill).toContain("connected Chrome");
      expect(skill).toContain("Computer Use");
      expect(skill).toContain("5 seconds");
      expect(skill).toContain("loopback");
      expect(skill).toContain("stale");
    }
    for (const skill of [imageSkill, connectionSkill]) {
      expect(skill).toContain("PreToolUse");
      expect(skill).toContain("24");
      expect(skill).toContain("task");
      expect(skill).toContain("notify");
      expect(skill).toContain("off");
    }
    expect(imageSkill).toContain("defaults to `auto`");
    expect(connectionSkill).toContain("Automatic updates default to `auto`");
    expect(imageSkill).toContain("maliang_report_device");
    expect(connectionSkill).toContain("maliang_report_device");

    const pluginManifest = JSON.parse(await readFile(
      "distribution/codex-marketplace/plugins/maliang-image-generator/.codex-plugin/plugin.json",
      "utf8"
    )) as { hooks?: string; version?: string };
    expect(pluginManifest.version).toBe("0.4.8");
    expect(pluginManifest.hooks).toBe("./hooks/hooks.json");

    const hooks = JSON.parse(await readFile(
      "distribution/codex-marketplace/plugins/maliang-image-generator/hooks/hooks.json",
      "utf8"
    )) as {
      hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<Record<string, unknown>> }> };
    };
    expect(hooks.hooks.PreToolUse).toHaveLength(1);
    expect(hooks.hooks.PreToolUse[0]?.matcher).toBe("^mcp__maliang__.*$");
    expect(hooks.hooks.PreToolUse[0]?.hooks[0]).toEqual(expect.objectContaining({
      type: "command",
      command: expect.stringContaining("auto-update.mjs"),
      commandWindows: "cmd.exe /d /s /c \"\"%PLUGIN_ROOT%\\hooks\\auto-update.cmd\"\"",
      timeout: 120
    }));
    expect(String(hooks.hooks.PreToolUse[0]?.hooks[0]?.command)).toContain("command -v node");
    expect(String(hooks.hooks.PreToolUse[0]?.hooks[0]?.command)).toContain("auto-update.ts");
    expect(String(hooks.hooks.PreToolUse[0]?.hooks[0]?.command)).toContain("command -v bun");
    expect(await readFile(
      "distribution/codex-marketplace/plugins/maliang-image-generator/hooks/auto-update.ps1",
      "utf8"
    )).toContain("Install-Transactionally");
    const windowsHook = await readFile(
      "distribution/codex-marketplace/plugins/maliang-image-generator/hooks/auto-update.cmd",
      "utf8"
    );
    expect(windowsHook).toContain("auto-update.ps1");
    expect(windowsHook).not.toContain("windows-update-gate.ts");
    expect(await readFile(
      "distribution/codex-marketplace/plugins/maliang-image-generator/hooks/auto-update.mjs",
      "utf8"
    )).toContain("node:child_process");
    expect(await readFile(
      "distribution/codex-marketplace/plugins/maliang-image-generator/skills/maliang-image-generator/scripts/maliang-helper.mjs",
      "utf8"
    )).toContain("probeMaliangLocalHelper");
    expect(await readFile(
      "distribution/codex-marketplace/plugins/maliang-image-generator/mcp/maliang-local-mcp.mjs",
      "utf8"
    )).toContain("runMaliangLocalMcpServer");
  });

  test("compares SemVer and rejects a cross-origin update package", () => {
    expect(compareSemver("0.3.0", "0.2.12")).toBe(1);
    expect(compareSemver("1.0.0-beta.2", "1.0.0-beta.10")).toBe(-1);
    expect(compareSemver("1.0.0", "1.0.0+build.4")).toBe(0);

    const update = {
      protocolVersion: 1,
      comparison: "semver",
      installSelector: "maliang-image-generator@maliang-internal",
      strategy: "transactional-local-marketplace-replacement",
      defaultMode: "auto",
      automatic: true,
      requiresUserApproval: false,
      checkIntervalHours: 24,
      activation: "next-task-or-restart",
      compatibility: "compatible",
      critical: false,
      blockOldVersion: false
    };
    expect(() => parseLatestManifest({
      schemaVersion: 1,
      type: "codex-plugin-marketplace",
      marketplace: "maliang-internal",
      plugin: "maliang-image-generator",
      version: "0.4.0",
      channel: "stable",
      downloadUrl: "https://evil.example/plugin.zip",
      sha256: "a".repeat(64),
      size: 1024,
      archiveRoot: "codex-marketplace",
      mcpResource: "https://maliang.example/api/external-mcp/mcp",
      update
    }, "https://maliang.example")).toThrow("Untrusted downloadUrl origin");
  });

  test("allows trusted local or private-LAN HTTP update manifests but rejects public HTTP", () => {
    const manifestFor = (origin: string) => ({
      schemaVersion: 1,
      type: "codex-plugin-marketplace",
      marketplace: "maliang-internal",
      plugin: "maliang-image-generator",
      version: "0.4.8",
      channel: "stable",
      downloadUrl: `${origin}/plugin.zip`,
      sha256: "a".repeat(64),
      size: 1024,
      archiveRoot: "codex-marketplace",
      mcpResource: `${origin}/api/external-mcp/mcp`,
      update: {
        protocolVersion: 1,
        comparison: "semver",
        installSelector: "maliang-image-generator@maliang-internal",
        strategy: "transactional-local-marketplace-replacement",
        defaultMode: "auto",
        automatic: true,
        requiresUserApproval: false,
        checkIntervalHours: 24,
        activation: "next-task-or-restart",
        compatibility: "compatible",
        critical: false,
        blockOldVersion: false
      }
    });

    for (const origin of [
      "http://localhost:8787",
      "http://127.0.0.1:8787",
      "http://192.168.0.87:8787",
      "http://100.64.0.1:8787",
      "http://[fd00::1]:8787"
    ]) {
      expect(parseLatestManifest(manifestFor(origin), origin).downloadUrl).toBe(`${origin}/plugin.zip`);
    }
    for (const origin of ["http://maliang.example", "http://203.0.113.9:8787"]) {
      expect(() => parseLatestManifest(manifestFor(origin), origin))
        .toThrow("must use HTTPS or trusted local/private-LAN HTTP");
    }
  });

  test("accepts a private-LAN HTTP installed homepage for automatic updates", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "maliang-plugin-homepage-"));
    const manifestDirectory = path.join(directory, ".codex-plugin");
    try {
      await mkdir(manifestDirectory, { recursive: true });
      const writeManifest = (homepage: string) => writeFile(path.join(manifestDirectory, "plugin.json"), JSON.stringify({
        name: "maliang-image-generator",
        version: "0.4.8",
        homepage
      }));
      await writeManifest("http://192.168.0.87:8787/plugin");
      expect((await readPluginManifest(directory)).homepage).toBe("http://192.168.0.87:8787/plugin");
      await writeManifest("http://maliang.example/plugin");
      await expect(readPluginManifest(directory))
        .rejects.toThrow("must use HTTPS or trusted local/private-LAN HTTP");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("applies the same trusted HTTP policy in the Windows updater", async () => {
    if (process.platform !== "win32") return;
    const directory = await mkdtemp(path.join(tmpdir(), "maliang-windows-update-policy-"));
    const scriptPath = path.join(directory, "verify-policy.ps1");
    const updaterPath = path.resolve(
      "distribution/codex-marketplace/plugins/maliang-image-generator/hooks/auto-update.ps1"
    ).replaceAll("'", "''");
    try {
      await writeFile(scriptPath, `
$ErrorActionPreference = "Stop"
. '${updaterPath}'
foreach ($value in @(
  "http://localhost:8787",
  "http://127.0.0.1:8787",
  "http://192.168.0.87:8787",
  "http://100.64.0.1:8787",
  "http://[fd00::1]:8787",
  "https://maliang.example"
)) {
  Assert-AutomaticUpdateUri ([Uri]$value) "test URL"
}
foreach ($value in @(
  "http://maliang.example",
  "http://203.0.113.9:8787",
  "https://user:pass@maliang.example"
)) {
  $rejected = $false
  try { Assert-AutomaticUpdateUri ([Uri]$value) "test URL" } catch { $rejected = $true }
  if (-not $rejected) { throw "Expected rejection: $value" }
}
`);
      const processHandle = Bun.spawn([
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        scriptPath
      ], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(processHandle.stdout).text(),
        new Response(processHandle.stderr).text(),
        processHandle.exited
      ]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("keeps the legacy Windows gate compatible with 0.3.x package validation", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "maliang-update-gate-"));
    try {
      expect(await shouldRunPowerShell({ pluginData: directory })).toBe(true);
      await writeFile(path.join(directory, "update-settings.json"), JSON.stringify({ schemaVersion: 1, mode: "auto" }));
      await writeFile(path.join(directory, "update-state.json"), JSON.stringify({
        schemaVersion: 1,
        lastCheckAt: new Date().toISOString(),
        lastCheckedVersion: "0.3.0"
      }));
      expect(await shouldRunPowerShell({ pluginData: directory })).toBe(false);
      expect(await shouldRunPowerShell({ environmentMode: "off", pluginData: directory })).toBe(false);
      await writeFile(path.join(directory, "update-state.json"), JSON.stringify({
        schemaVersion: 1,
        lastCheckAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
      }));
      expect(await shouldRunPowerShell({ pluginData: directory })).toBe(true);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("validates the complete runtime Marketplace before an update switch", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "maliang-marketplace-"));
    const marketplaceRoot = path.join(directory, "codex-marketplace");
    const pluginRoot = path.join(marketplaceRoot, "plugins", "maliang-image-generator");
    const origin = "https://maliang.example";
    const mcpResource = `${origin}/api/external-mcp/mcp`;
    try {
      await cp("distribution/codex-marketplace", marketplaceRoot, { recursive: true });
      const pluginManifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
      const pluginManifest = JSON.parse(await readFile(pluginManifestPath, "utf8")) as Record<string, unknown>;
      const pluginVersion = String(pluginManifest.version);
      pluginManifest.homepage = `${origin}/plugin`;
      await writeFile(pluginManifestPath, `${JSON.stringify(pluginManifest, null, 2)}\n`);
      const mcpPath = path.join(pluginRoot, ".mcp.json");
      const mcp = JSON.parse(await readFile(mcpPath, "utf8")) as {
        mcpServers: { maliang: { oauth_resource: string; url: string } };
      };
      mcp.mcpServers.maliang.oauth_resource = mcpResource;
      mcp.mcpServers.maliang.url = mcpResource;
      await writeFile(mcpPath, `${JSON.stringify(mcp, null, 2)}\n`);

      const validated = await validateMarketplaceRoot(marketplaceRoot, pluginVersion, origin, mcpResource);
      expect(validated.pluginRoot).toBe(pluginRoot);
      expect(validated.manifest.hooks).toBe("./hooks/hooks.json");

      await mkdir(path.join(marketplaceRoot, "plugins", "unrelated-plugin"));
      await expect(validateMarketplaceRoot(marketplaceRoot, pluginVersion, origin, mcpResource))
        .rejects.toThrow("refuse to replace unrelated");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("returns one public install entry", async () => {
    Bun.env.APP_PUBLIC_URL = "https://maliang.example.com";
    Bun.env.MALIANG_PUBLIC_BASE_URL = "";
    const app = new Hono();
    registerInternalDistributionRoutes(app);

    const response = await app.request("http://127.0.0.1:8787/ai-client-install/links.json");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      publicBaseUrl: "https://maliang.example.com",
      install: {
        href: "https://maliang.example.com/install",
        instruction: "访问 https://maliang.example.com/install，安装神笔马良。"
      }
    });
  });

  test("defaults Codex to its plugin and keeps other clients on MCP", async () => {
    Bun.env.APP_PUBLIC_URL = "https://open-source.example";
    Bun.env.MALIANG_PUBLIC_BASE_URL = "";
    const app = new Hono();
    registerInternalDistributionRoutes(app);

    const response = await app.request("https://open-source.example/install/install.json");
    expect(response.status).toBe(200);
    const manifest = await response.json() as {
      execution: {
        mode: string;
        owner: string;
        required: string[];
        forbidden: string[];
        startImmediatelyAfterReading: boolean;
      };
      rules: string[];
      choices: {
        codexDefault: { install: string };
        codexMcpOnly: { when: string; install: string };
        otherClients: { install: string; clientSpecificPluginAvailable: boolean; futurePluginRule: string; forbidden: string };
      };
      manualRemoteMcp: {
        compatibleClients: string[];
        configurationScope: string;
        config: { mcpServers: { maliang: { url: string } } };
        deviceIdentity: { headersOmittedForDirectPaste: boolean; completeWith: string };
        format: string;
        mergeExistingMcpServers: boolean;
        oauth: { credentialsInConfig: boolean; forbiddenFields: string[] };
        protocolStandardSchema: boolean;
        steps: string[];
        supported: boolean;
      };
    };
    expect(manifest.execution.owner).toBe("current-ai-agent");
    expect(manifest.execution.mode).toBe("execute-installation");
    expect(manifest.execution.startImmediatelyAfterReading).toBe(true);
    expect(manifest.execution.required.join("\n")).toContain("继续执行当前客户端的真实安装");
    expect(manifest.execution.forbidden.join("\n")).toContain("只读取、复述或展示安装清单");
    expect(manifest.execution.forbidden.join("\n")).toContain("临时 HTTP 或 OAuth 脚本");
    expect(manifest.rules.join("\n")).toContain("不以电脑上是否存在 codex 命令");
    expect(manifest.choices.codexDefault.install).toBe("codex-plugin");
    expect(manifest.choices.codexMcpOnly.when).toContain("只安装 MCP");
    expect(manifest.choices.codexMcpOnly.install).toBe("remote-mcp");
    expect(manifest.choices.otherClients.install).toBe("remote-mcp");
    expect(manifest.choices.otherClients.clientSpecificPluginAvailable).toBe(false);
    expect(manifest.choices.otherClients.futurePluginRule).toContain("专用神笔马良插件包");
    expect(manifest.choices.otherClients.forbidden).toContain("不得把 Codex 插件包安装到其他客户端");
    expect(manifest.manualRemoteMcp.supported).toBe(true);
    expect(manifest.manualRemoteMcp.format).toBe("mcpServers-json");
    expect(manifest.manualRemoteMcp.configurationScope).toBe("client-convention");
    expect(manifest.manualRemoteMcp.protocolStandardSchema).toBe(false);
    expect(manifest.manualRemoteMcp.compatibleClients).toEqual(["支持 mcpServers 与 Remote HTTP url 的 MCP 客户端"]);
    expect(manifest.manualRemoteMcp.config.mcpServers.maliang.url).toBe("https://open-source.example/api/external-mcp/mcp");
    expect(manifest.manualRemoteMcp.mergeExistingMcpServers).toBe(true);
    expect(manifest.manualRemoteMcp.oauth.credentialsInConfig).toBe(false);
    expect(manifest.manualRemoteMcp.oauth.forbiddenFields).toEqual(["accessToken", "refreshToken", "tokenEndpoint"]);
    expect(manifest.manualRemoteMcp.deviceIdentity.headersOmittedForDirectPaste).toBe(true);
    expect(manifest.manualRemoteMcp.deviceIdentity.completeWith).toContain("maliang_report_device");
    expect(manifest.manualRemoteMcp.steps.join("\n")).toContain("保存并启用该 MCP Server");
  });

  test("keeps the unified install page header compact", async () => {
    Bun.env.APP_PUBLIC_URL = "https://open-source.example";
    Bun.env.MALIANG_PUBLIC_BASE_URL = "";
    const app = new Hono();
    registerInternalDistributionRoutes(app);

    const response = await app.request("https://open-source.example/install");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).not.toContain('<nav class="nav">');
    expect(html).not.toContain('<span class="eyebrow">');
    expect(html).toContain('<div class="title-row"><img class="title-logo" src="/image/logo-small.webp" alt=""><h1>安装神笔马良插件</h1>');
    expect(html).toContain('<img class="hero-art" src="/image/install/maliang-plugin-install-hero.webp"');
    expect(html).not.toContain('/image/help/maliang-help-hero-v2.webp');
    expect(html).toContain("Claude Code、TRAE Work、WorkBuddy");
    expect(html).toContain('id="manual-mcp-title">手动添加 MCP Server</h2>');
    expect(html).toContain("客户端支持 JSON 配置时，复制下面的内容并粘贴");
    expect(html).not.toContain("TRAE Work 与通用 Remote MCP 客户端");
    expect(html).not.toContain('class="manual-mcp-kicker"');
    expect(html).not.toContain('class="manual-note"');
    expect(html).toContain('data-copy-mcp data-copy-target="manual-mcp-config"');
    expect(html).toContain('&quot;mcpServers&quot;');
    expect(html).toContain('https://open-source.example/api/external-mcp/mcp');
  });

  test("builds the manifest and matching archive for the configured origin", async () => {
    Bun.env.APP_PUBLIC_URL = "https://open-source.example";
    Bun.env.MALIANG_PUBLIC_BASE_URL = "";
    const app = new Hono();
    registerInternalDistributionRoutes(app);

    const manifestResponse = await app.request("https://open-source.example/plugin/latest.json");
    expect(manifestResponse.status).toBe(200);
    const manifest = await manifestResponse.json() as {
      channel: string;
      downloadUrl: string;
      mcpResource: string;
      sha256: string;
      size: number;
      update: {
        activation: string;
        automatic: boolean;
        checkIntervalHours: number;
        checkUrl: string;
        comparison: string;
        defaultMode: string;
        hookBootstrapVersion: string;
        initialHookTrustRequired: boolean;
        legacyVersionsRequireOneManualUpdate: boolean;
        requiresUserApproval: boolean;
      };
      version: string;
    };
    expect(manifest.version).toBe(await readCodexPluginVersion());
    expect(manifest.channel).toBe("stable");
    expect(manifest.downloadUrl).toBe("https://open-source.example/plugin/download/latest");
    expect(manifest.mcpResource).toBe("https://open-source.example/api/external-mcp/mcp");
    expect(manifest.update).toEqual(expect.objectContaining({
      activation: "next-task-or-restart",
      automatic: true,
      checkIntervalHours: 24,
      checkUrl: "https://open-source.example/plugin/latest.json",
      comparison: "semver",
      defaultMode: "auto",
      hookBootstrapVersion: "0.3.0",
      initialHookTrustRequired: true,
      legacyVersionsRequireOneManualUpdate: true,
      requiresUserApproval: false
    }));
    expect(() => parseLatestManifest(manifest, "https://open-source.example")).not.toThrow();

    const archiveResponse = await app.request("https://open-source.example/plugin/download/latest");
    expect(archiveResponse.status).toBe(200);
    const archive = Buffer.from(await archiveResponse.arrayBuffer());
    expect(archive.length).toBe(manifest.size);
    expect(createHash("sha256").update(archive).digest("hex")).toBe(manifest.sha256);

    const [firstCached, secondCached] = await Promise.all([
      cachedCodexPluginArchive("https://open-source.example"),
      cachedCodexPluginArchive("https://open-source.example")
    ]);
    expect(secondCached.buffer).toBe(firstCached.buffer);
    expect(secondCached.etag).toBe(firstCached.etag);
  });

  test("describes foreground OAuth login and safe browser fallback", async () => {
    Bun.env.APP_PUBLIC_URL = "https://open-source.example";
    Bun.env.MALIANG_PUBLIC_BASE_URL = "";
    const app = new Hono();
    registerInternalDistributionRoutes(app);

    const mcpResponse = await app.request("https://open-source.example/mcp/install.json");
    expect(mcpResponse.status).toBe(200);
    const mcpManifest = await mcpResponse.json() as {
      deviceIdentity: {
        collectBy: string;
        completion: string[];
        fixedHeadersTemplate: Record<string, string>;
        reportTool: string;
        reportTiming: {
          beforeTools: string[];
          doNotWaitForUserFollowUp: boolean;
          doNotRepeatBeforeEachTaskOrImage: boolean;
          repeatPolicy: string;
          sameAgentTurn: boolean;
          serverEnforcedWhenUnknown: boolean;
          trigger: string;
        };
        requiredForEveryClient: boolean;
        templateRules: string[];
      };
      requiredTools: string[];
      manualSetup: {
        config: { mcpServers: { maliang: { url: string } } };
        format: string;
        mergeExistingMcpServers: boolean;
      };
      clients: {
        codex: {
          deviceHeadersConfigTemplate: { env_http_headers: Record<string, string> };
          login: string;
          loginBehavior: {
            browserOrder: string[];
            completionGates: string[];
            fallback: string[];
            keepProcessAlive: boolean;
            protocolVersion: number;
            run: string;
          };
          steps: string[];
        };
        claudeCode: {
          installTemplate: string;
          steps: string[];
        };
        trae: {
          activation: {
            completionGates: string[];
            manualJsonPaste: string;
            preserveExistingMcpServers: boolean;
            projectConfigCandidate: string;
            projectMcp: {
              afterUserConfirmation: string;
              enableWhenProjectConfigIsUsed: boolean;
              owner: string;
            };
            verifyCandidateIsActiveBeforeRelyingOnIt: boolean;
          };
          configContract: {
            forbiddenCredentialFields: string[];
            oauthOwnedBy: string;
            remoteHttpFields: string[];
          };
          configTemplate: {
            mcpServers: {
              maliang: {
                headers: Record<string, string>;
                url: string;
              };
            };
          };
          oauthClientIdentity: {
            allowGeneratedSuffix: boolean;
            deviceIdentityIsSeparate: boolean;
            expectedClientName: string;
            requirements: string[];
            softwareId: string;
          };
          steps: string[];
          templateValues: {
            actualDeviceHostname: { requirement: string };
            actualDeviceOs: { allowedValues: string[] };
          };
        };
        workBuddy: {
          configTemplate: { mcpServers: { maliang: { headers: Record<string, string>; url: string } } };
          steps: string[];
        };
        standard: {
          configTemplate: { mcpServers: { maliang: { headers: Record<string, string>; url: string } } };
          fallback: string;
          steps: string[];
        };
      };
    };
    expect(mcpManifest.manualSetup.format).toBe("mcpServers-json");
    expect(mcpManifest.manualSetup.config.mcpServers.maliang.url).toBe("https://open-source.example/api/external-mcp/mcp");
    expect(mcpManifest.manualSetup.mergeExistingMcpServers).toBe(true);
    expect(mcpManifest.deviceIdentity.requiredForEveryClient).toBe(true);
    expect(mcpManifest.deviceIdentity.collectBy).toBe("current-ai-agent");
    expect(mcpManifest.deviceIdentity.reportTool).toBe("maliang_report_device");
    expect(mcpManifest.deviceIdentity.reportTiming.trigger).toBe("first-authorized-tool-call-after-mcp-initialize");
    expect(mcpManifest.deviceIdentity.reportTiming.sameAgentTurn).toBe(true);
    expect(mcpManifest.deviceIdentity.reportTiming.doNotWaitForUserFollowUp).toBe(true);
    expect(mcpManifest.deviceIdentity.reportTiming.repeatPolicy).toBe("once-per-oauth-client-until-device-changes");
    expect(mcpManifest.deviceIdentity.reportTiming.doNotRepeatBeforeEachTaskOrImage).toBe(true);
    expect(mcpManifest.deviceIdentity.reportTiming.serverEnforcedWhenUnknown).toBe(true);
    expect(mcpManifest.deviceIdentity.reportTiming.beforeTools).toContain("maliang_account_status");
    expect(mcpManifest.deviceIdentity.reportTiming.beforeTools).toContain("maliang_generate_image");
    expect(mcpManifest.deviceIdentity.fixedHeadersTemplate).toEqual({
      "X-Maliang-Device-Name": "__ACTUAL_DEVICE_HOSTNAME__",
      "X-Maliang-Device-Os": "__ACTUAL_DEVICE_OS__"
    });
    expect(mcpManifest.deviceIdentity.templateRules.join("\n")).toContain("无论固定请求头是否生效");
    expect(mcpManifest.deviceIdentity.completion.join("\n")).toContain("reported=true");
    expect(mcpManifest.requiredTools).toContain("maliang_report_device");
    expect(mcpManifest.clients.codex.login).toBe("codex mcp login maliang");
    expect(mcpManifest.clients.codex.loginBehavior.protocolVersion).toBe(1);
    expect(mcpManifest.clients.codex.loginBehavior.run).toBe("foreground-streaming");
    expect(mcpManifest.clients.codex.loginBehavior.keepProcessAlive).toBe(true);
    expect(mcpManifest.clients.codex.loginBehavior.browserOrder).toEqual([
      "system-default",
      "codex-in-app-browser",
      "connected-chrome",
      "computer-use",
      "user-clickable-link"
    ]);
    expect(mcpManifest.clients.codex.loginBehavior.completionGates).toHaveLength(5);
    expect(mcpManifest.clients.codex.loginBehavior.completionGates.join("\n")).toContain("maliang_report_device");
    expect(mcpManifest.clients.codex.loginBehavior.fallback.join("\n")).toContain("不得自行拼接、改写或复用授权地址");
    expect(mcpManifest.clients.codex.deviceHeadersConfigTemplate.env_http_headers["X-Maliang-Device-Name"]).toBe("COMPUTERNAME");
    expect(mcpManifest.clients.codex.steps.join("\n")).toContain("maliang_report_device");
    expect(mcpManifest.clients.claudeCode.installTemplate).toContain("--header \"X-Maliang-Device-Name: __ACTUAL_DEVICE_HOSTNAME__\"");
    expect(mcpManifest.clients.claudeCode.steps.join("\n")).toContain("直接执行");
    expect(mcpManifest.clients.claudeCode.steps.join("\n")).toContain("maliang_report_device");
    expect(mcpManifest.clients.trae.configTemplate.mcpServers.maliang.url).toBe("https://open-source.example/api/external-mcp/mcp");
    expect(mcpManifest.clients.trae.configTemplate.mcpServers.maliang.headers).toEqual({
      "X-Maliang-Device-Name": "__ACTUAL_DEVICE_HOSTNAME__",
      "X-Maliang-Device-Os": "__ACTUAL_DEVICE_OS__"
    });
    expect(mcpManifest.clients.trae.configContract.remoteHttpFields).toEqual(["url", "headers"]);
    expect(mcpManifest.clients.trae.configContract.oauthOwnedBy).toBe("TRAE Work");
    expect(mcpManifest.clients.trae.configContract.forbiddenCredentialFields).toEqual(["accessToken", "refreshToken", "tokenEndpoint"]);
    expect(mcpManifest.clients.trae.oauthClientIdentity.expectedClientName).toBe("TRAE Work");
    expect(mcpManifest.clients.trae.oauthClientIdentity.softwareId).toBe("trae-work");
    expect(mcpManifest.clients.trae.oauthClientIdentity.allowGeneratedSuffix).toBe(false);
    expect(mcpManifest.clients.trae.oauthClientIdentity.deviceIdentityIsSeparate).toBe(true);
    expect(mcpManifest.clients.trae.oauthClientIdentity.requirements.join("\n")).toContain("不得手工调用 /oauth/register");
    expect(mcpManifest.clients.trae.oauthClientIdentity.requirements.join("\n")).toContain("随机数、时间戳、设备主机名");
    expect(mcpManifest.clients.trae.activation.projectConfigCandidate).toBe("<project>/.trae/mcp.json");
    expect(mcpManifest.clients.trae.activation.verifyCandidateIsActiveBeforeRelyingOnIt).toBe(true);
    expect(mcpManifest.clients.trae.activation.preserveExistingMcpServers).toBe(true);
    expect(mcpManifest.clients.trae.activation.manualJsonPaste).toBe("last-resort-only");
    expect(mcpManifest.clients.trae.activation.projectMcp.enableWhenProjectConfigIsUsed).toBe(true);
    expect(mcpManifest.clients.trae.activation.projectMcp.owner).toBe("current-ai-agent");
    expect(mcpManifest.clients.trae.activation.projectMcp.afterUserConfirmation).toContain("不得要求用户另发一条");
    expect(mcpManifest.clients.trae.activation.completionGates.join("\n")).toContain("当前 MCP 列表");
    expect(mcpManifest.clients.trae.activation.completionGates.join("\n")).toContain("Token 交换与 MCP initialize");
    expect(mcpManifest.clients.trae.templateValues.actualDeviceHostname.requirement).toContain("不得保留占位符");
    expect(mcpManifest.clients.trae.templateValues.actualDeviceOs.allowedValues).toEqual(["Windows", "macOS", "Linux"]);
    expect(mcpManifest.clients.trae.steps.join("\n")).toContain("实际配置文件");
    expect(mcpManifest.clients.trae.steps.join("\n")).toContain("启用项目级 MCP");
    expect(mcpManifest.clients.trae.steps.join("\n")).toContain("不等待下一条对话");
    expect(mcpManifest.clients.trae.steps.join("\n")).toContain("不以粘贴整份 JSON 覆盖");
    expect(mcpManifest.clients.trae.steps.join("\n")).toContain("不得用 Python、urllib、curl");
    expect(mcpManifest.clients.trae.steps.join("\n")).toContain("Token 交换与 MCP initialize");
    expect(mcpManifest.clients.trae.steps.join("\n")).toContain("maliang_report_device");
    expect(mcpManifest.clients.trae.steps.join("\n")).toContain("不等待用户下一条对话");
    expect(mcpManifest.clients.workBuddy.configTemplate.mcpServers.maliang.headers["X-Maliang-Device-Name"]).toBe("__ACTUAL_DEVICE_HOSTNAME__");
    expect(mcpManifest.clients.workBuddy.steps.join("\n")).toContain("maliang_report_device");
    expect(mcpManifest.clients.standard.configTemplate.mcpServers.maliang.headers["X-Maliang-Device-Name"]).toBe("__ACTUAL_DEVICE_HOSTNAME__");
    expect(mcpManifest.clients.standard.steps.join("\n")).toContain("当前智能体定位宿主实际使用");
    expect(mcpManifest.clients.standard.fallback).toContain("仍继续完成原生 OAuth");

    const pluginResponse = await app.request("https://open-source.example/plugin/install.json");
    expect(pluginResponse.status).toBe(200);
    const pluginManifest = await pluginResponse.json() as {
      authentication: string;
      durableInstallDirectory: { macos: string; windows: string };
      oauthLogin: { browserOrder: string[]; keepProcessAlive: boolean };
      platformCompatibility: { macos: string[]; shared: string[]; windows: string[] };
      prerequisites: string[];
      updatePolicy: {
        apply: string[];
        check: string[];
        defaultMode: string;
        rollback: string[];
        supportedModes: string[];
        trigger: string;
        versionSource: string;
      };
      version: string;
      steps: string[];
      safety: string[];
    };
    expect(pluginManifest.version).toBe(await readCodexPluginVersion());
    expect(pluginManifest.authentication).toBe("oauth-on-install");
    expect(pluginManifest.oauthLogin.keepProcessAlive).toBe(true);
    expect(pluginManifest.oauthLogin.browserOrder[1]).toBe("codex-in-app-browser");
    expect(pluginManifest.updatePolicy.versionSource).toBe(".codex-plugin/plugin.json");
    expect(pluginManifest.updatePolicy.defaultMode).toBe("auto");
    expect(pluginManifest.updatePolicy.supportedModes).toEqual(["auto", "notify", "off"]);
    expect(pluginManifest.updatePolicy.trigger).toContain("PreToolUse Hook");
    expect(pluginManifest.updatePolicy.check.join("\n")).toContain("默认 auto");
    expect(pluginManifest.updatePolicy.check.join("\n")).toContain("首个包含自动更新 Hook");
    expect(pluginManifest.updatePolicy.check.join("\n")).toContain("审查并信任");
    expect(pluginManifest.updatePolicy.apply.join("\n")).toContain("sha256");
    expect(pluginManifest.updatePolicy.apply.join("\n")).toContain("拒绝符号链接");
    expect(pluginManifest.updatePolicy.rollback.join("\n")).toContain("恢复旧目录");
    expect(pluginManifest.updatePolicy.rollback.join("\n")).toContain("继续本次马良工具调用");
    expect(pluginManifest.prerequisites.join("\n")).toContain("Node 20+");
    expect(pluginManifest.prerequisites.join("\n")).toContain("Remote MCP 核心能力仍可安装");
    expect(pluginManifest.durableInstallDirectory.macos).toBe("~/Library/Application Support/ShenbiMaliang/codex-marketplace");
    expect(pluginManifest.platformCompatibility.shared.join("\n")).toContain("同一个插件 ZIP");
    expect(pluginManifest.platformCompatibility.shared.join("\n")).toContain("maliang_local.upload_local_image");
    expect(pluginManifest.platformCompatibility.shared.join("\n")).toContain("唯一权威实现");
    expect(pluginManifest.platformCompatibility.shared.join("\n")).toContain("maliang_local stdio MCP");
    expect(pluginManifest.platformCompatibility.shared.join("\n")).toContain("绝不自动打开");
    expect(pluginManifest.platformCompatibility.macos.join("\n")).toContain("Application Support 含空格");
    expect(pluginManifest.platformCompatibility.macos.join("\n")).toContain("不要照抄 PowerShell");
    expect(pluginManifest.platformCompatibility.windows.join("\n")).toContain("%LOCALAPPDATA%");
    expect(pluginManifest.platformCompatibility.windows.join("\n")).toContain("/C:/");
    expect(pluginManifest.steps.join("\n")).toContain("ON_INSTALL");
    expect(pluginManifest.steps.join("\n")).toContain("不要把 Added plugin 当成授权成功");
    expect(pluginManifest.steps.join("\n")).toContain("按钮会锁定并显示处理中");
    expect(pluginManifest.steps.join("\n")).toContain("Codex 内置浏览器");
    expect(pluginManifest.steps.join("\n")).toContain("保持回调监听存活");
    expect(pluginManifest.steps.join("\n")).toContain("maliang_account_status");
    expect(pluginManifest.steps.join("\n")).toContain("maliang_local.upload_local_image");
    expect(pluginManifest.steps.join("\n")).toContain("maliang_local.save_image_result");
    expect(pluginManifest.steps.join("\n")).toContain("不要求用户重复上传");
    expect(pluginManifest.steps.join("\n")).toContain("恢复旧目录");
    expect(pluginManifest.steps.join("\n")).toContain("保留最近一个旧目录备份直到下一次兼容更新开始前");
    expect(pluginManifest.steps.join("\n")).not.toContain("清理下载 ZIP、空暂存目录和旧目录备份");
    expect(pluginManifest.safety.join("\n")).toContain("不隐藏运行 codex mcp login");
    expect(pluginManifest.safety.join("\n")).toContain("短超时调用");
    expect(pluginManifest.safety.join("\n")).toContain("登录命令成功结束");
    expect(pluginManifest.safety.join("\n")).toContain("当前客户端不是 Codex 时立即停止");
  });
});
