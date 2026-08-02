import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
// @ts-expect-error The shipped .mjs helper is intentionally plain JavaScript for Node/Bun portability.
import { saveMaliangImageResult, uploadMaliangLocalImage } from "../distribution/codex-marketplace/plugins/maliang-image-generator/skills/maliang-image-generator/scripts/maliang-helper.mjs";
// @ts-expect-error The shipped .mjs MCP is intentionally plain JavaScript for Node portability.
import { handleMaliangLocalMcpRequest } from "../distribution/codex-marketplace/plugins/maliang-image-generator/mcp/maliang-local-mcp.mjs";

const temporaryDirectories: string[] = [];
const helperPath = path.resolve(
  "distribution/codex-marketplace/plugins/maliang-image-generator/skills/maliang-image-generator/scripts/maliang-helper.mjs"
);
const localMcpPath = path.resolve(
  "distribution/codex-marketplace/plugins/maliang-image-generator/mcp/maliang-local-mcp.mjs"
);
const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("Maliang local MCP protocol negotiation", () => {
  test("keeps supported requests and falls back from unknown client versions", async () => {
    const supported = await handleMaliangLocalMcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" }
    });
    const unknown = await handleMaliangLocalMcpRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: { protocolVersion: "2099-01-01" }
    });

    expect(supported.result.protocolVersion).toBe("2025-06-18");
    expect(unknown.result.protocolVersion).toBe("2025-06-18");
  });
});

async function runHelper(
  runner: "node" | "bun",
  args: string[],
  environment: Record<string, string> = {},
  input?: Record<string, unknown>,
  executablePath = helperPath
) {
  const processHandle = Bun.spawn([runner, executablePath, ...args], {
    env: { ...Bun.env, ...environment },
    stdin: input ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe"
  });
  if (input && processHandle.stdin) {
    processHandle.stdin.write(JSON.stringify(input));
    processHandle.stdin.end();
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(processHandle.stdout).text(),
    new Response(processHandle.stderr).text(),
    processHandle.exited
  ]);
  if (exitCode !== 0) throw new Error(`${runner} helper failed (${exitCode}): ${stderr || stdout}`);
  return JSON.parse(stdout) as Record<string, unknown>;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("Maliang local image persistence", () => {
  const trustedRuntime = { trustedOrigin: "https://maliang.example" };
  const resultUrl = "https://maliang.example/mcp/image-result/v2.payload.signature";

  test("saves a validated image under an immutable content-addressed name", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "maliang-image-test-"));
    temporaryDirectories.push(outputRoot);
    const source = pngBytes;

    const result = await saveMaliangImageResult({
      url: resultUrl,
      imageId: "img_test"
    }, {
      ...trustedRuntime,
      outputRoots: [outputRoot],
      fetchImage: async () => new Response(source, { headers: { "content-type": "image/png" } })
    });

    expect(path.basename(result.path)).toMatch(/^img_test-[a-f0-9]{12}\.png$/);
    expect(result.mimeType).toBe("image/png");
    expect(result.bytes).toBe(source.length);
    expect(await readFile(result.path)).toEqual(source);
  });

  test("rejects non-image responses", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "maliang-image-test-"));
    temporaryDirectories.push(outputRoot);

    await expect(saveMaliangImageResult({
      url: resultUrl,
      imageId: "img_test"
    }, {
      ...trustedRuntime,
      outputRoots: [outputRoot],
      fetchImage: async () => new Response("not an image", { headers: { "content-type": "text/html" } })
    })).rejects.toThrow("不支持的图片类型");
  });

  test("allows concurrent attempts to persist the same validated image", async () => {
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "maliang-image-test-"));
    temporaryDirectories.push(outputRoot);
    const concurrentPngBytes = Buffer.concat([pngBytes, Buffer.alloc(8 * 1024 * 1024)]);
    const input = {
      url: resultUrl,
      imageId: "img_concurrent"
    };
    const runtime = {
      ...trustedRuntime,
      outputRoots: [outputRoot],
      fetchImage: async () => new Response(concurrentPngBytes, { headers: { "content-type": "image/png" } })
    };

    const [first, second] = await Promise.all([
      saveMaliangImageResult(input, runtime),
      saveMaliangImageResult(input, runtime)
    ]);

    expect(second.path).toBe(first.path);
    expect(await readFile(first.path)).toEqual(concurrentPngBytes);
  });
});

describe("Maliang automatic local attachment upload", () => {
  const trustedRuntime = { trustedOrigin: "https://maliang.example" };
  const uploadUrl = "https://maliang.example/mcp/upload/private-token-1234567890";

  test("posts the Codex attachment as the expected multipart image", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "maliang-upload-test-"));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, "熊猫.png");
    const source = pngBytes;
    await writeFile(filePath, source);

    const result = await uploadMaliangLocalImage({
      uploadUrl,
      file: filePath
    }, {
      ...trustedRuntime,
      fetchUpload: async (url: URL, init?: RequestInit) => {
        expect(url.toString()).toBe(uploadUrl);
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("accept")).toBe("application/json");
        const form = init?.body as FormData;
        const file = form.get("file");
        expect(file).toBeInstanceOf(File);
        expect((file as File).name).toBe("熊猫.png");
        expect((file as File).type).toBe("image/png");
        expect(Buffer.from(await (file as File).arrayBuffer())).toEqual(source);
        return Response.json({ uploadId: "mcpupload_test", assetId: "asset_test", status: "uploaded" });
      }
    });

    expect(result).toEqual({
      status: "uploaded",
      fileName: "熊猫.png",
      mimeType: "image/png",
      bytes: source.length,
      uploadId: "mcpupload_test",
      assetId: "asset_test"
    });
  });

  test("rejects invalid URLs, directories, non-images, and oversized files before upload", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "maliang-upload-test-"));
    temporaryDirectories.push(directory);
    const textPath = path.join(directory, "fake.png");
    const imagePath = path.join(directory, "large.png");
    await writeFile(textPath, "not an image");
    await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    await expect(uploadMaliangLocalImage({ uploadUrl: "file:///tmp/upload", file: imagePath }, trustedRuntime))
      .rejects.toThrow("只允许 HTTP(S)");
    await expect(uploadMaliangLocalImage({ uploadUrl, file: directory }, trustedRuntime))
      .rejects.toThrow("不是普通文件");
    await expect(uploadMaliangLocalImage({ uploadUrl, file: textPath }, trustedRuntime))
      .rejects.toThrow("只支持有效的 PNG");
    await expect(uploadMaliangLocalImage({ uploadUrl, file: imagePath }, { ...trustedRuntime, maxUploadBytes: 4 }))
      .rejects.toThrow("超过 0 MB 上限");
    await expect(uploadMaliangLocalImage({
      uploadUrl: "https://evil.example/mcp/upload/private-token-1234567890",
      file: imagePath
    }, trustedRuntime)).rejects.toThrow("不属于已配置");
    await expect(uploadMaliangLocalImage({
      uploadUrl: "https://maliang.example/not-upload/private-token-1234567890",
      file: imagePath
    }, trustedRuntime)).rejects.toThrow("路径不符合");

    const publicHostnameStartingWithFc = "https://fcloud.example/mcp/upload/private-token-1234567890";
    const accepted = await uploadMaliangLocalImage({ uploadUrl: publicHostnameStartingWithFc, file: imagePath }, {
      trustedOrigin: "https://fcloud.example",
      fetchUpload: async () => Response.json({ uploadId: "mcpupload_public", status: "uploaded" })
    });
    expect(accepted.uploadId).toBe("mcpupload_public");
  });

  test("does not treat a generic 2xx HTML page as a completed upload", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "maliang-upload-test-"));
    temporaryDirectories.push(directory);
    const imagePath = path.join(directory, "image.png");
    await writeFile(imagePath, pngBytes);

    await expect(uploadMaliangLocalImage({
      uploadUrl,
      file: imagePath
    }, {
      ...trustedRuntime,
      fetchUpload: async () => new Response("<html>ok</html>", {
        status: 200,
        headers: { "content-type": "text/html" }
      })
    })).rejects.toThrow("非 JSON 响应");
  });

  test("bounds the upload confirmation response while ignoring caller limit overrides", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "maliang-upload-test-"));
    temporaryDirectories.push(directory);
    const imagePath = path.join(directory, "image.png");
    await writeFile(imagePath, pngBytes);

    await expect(uploadMaliangLocalImage({
      uploadUrl,
      file: imagePath,
      maxBytes: Number.MAX_SAFE_INTEGER
    }, {
      ...trustedRuntime,
      fetchUpload: async () => new Response(`{"status":"uploaded","uploadId":"${"a".repeat(40 * 1024)}"}`, {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    })).rejects.toThrow("响应超过 32 KB 上限");
  });
});

describe("Maliang portable helper CLI", () => {
  test("runs the same .mjs with Bun and with Node 20+ when available", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "maliang-helper-cli-"));
    temporaryDirectories.push(directory);
    const attachmentPath = path.join(directory, "attachment.png");
    await writeFile(attachmentPath, pngBytes);

    let uploadedBytes = Buffer.alloc(0);
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/mcp/image-result/v2.payload.signature") {
          return new Response(pngBytes, { headers: { "content-type": "image/png" } });
        }
        if (url.pathname === "/mcp/upload/abcdefghijklmnopqrstuvwxyz") {
          const form = await request.formData();
          const file = form.get("file");
          if (!(file instanceof File)) return new Response("missing file", { status: 400 });
          uploadedBytes = Buffer.from(await file.arrayBuffer());
          return Response.json({ uploadId: "mcpupload_cli", assetId: "asset_cli", status: "uploaded" });
        }
        return new Response("not found", { status: 404 });
      }
    });

    try {
      const packagedHelperPath = path.join(directory, "maliang-helper.mjs");
      const packagedHelper = (await readFile(helperPath, "utf8"))
        .replaceAll("__MALIANG_PUBLIC_BASE_URL__", server.url.origin)
        .replaceAll("__MALIANG_ALLOW_INSECURE_LOCAL__", "true");
      await writeFile(packagedHelperPath, packagedHelper);
      const bunProbe = await runHelper("bun", ["probe"], {}, undefined, packagedHelperPath);
      expect(bunProbe.runtime).toBe("bun");
      expect(bunProbe.deviceName).toBe(os.hostname());

      let uploadRunner: "node" | "bun" = "bun";
      if (Bun.which("node")) {
        const nodeProbe = await runHelper("node", ["probe"], {}, undefined, packagedHelperPath);
        const nodeMajor = Number(String(nodeProbe.runtimeVersion).split(".")[0]);
        if (nodeMajor >= 20) {
          expect(nodeProbe.runtime).toBe("node");
          expect(nodeProbe.deviceName).toBe(os.hostname());
          uploadRunner = "node";
        }
      }

      const upload = await runHelper(uploadRunner, ["upload", "--stdin"], {}, {
        uploadUrl: `${server.url}mcp/upload/abcdefghijklmnopqrstuvwxyz`,
        file: attachmentPath
      }, packagedHelperPath);
      expect(upload).toEqual(expect.objectContaining({
        status: "uploaded",
        uploadId: "mcpupload_cli",
        assetId: "asset_cli",
        bytes: pngBytes.length
      }));
      expect(uploadedBytes).toEqual(pngBytes);

      const save = await runHelper("bun", ["save", "--stdin"], { CODEX_HOME: directory }, {
        url: `${server.url}mcp/image-result/v2.payload.signature`,
        imageId: "img_cli"
      }, packagedHelperPath);
      const savedPath = String(save.path);
      expect(savedPath).toContain(path.join("generated_images", "maliang"));
      expect(await readFile(savedPath)).toEqual(pngBytes);
    } finally {
      server.stop(true);
    }
  });
});

describe("Maliang Codex-managed local MCP", () => {
  test("uploads an attachment and saves the original image through managed stdio", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "maliang-local-mcp-"));
    temporaryDirectories.push(directory);
    const pluginRoot = path.join(directory, "plugin");
    const packagedHelperPath = path.join(
      pluginRoot,
      "skills",
      "maliang-image-generator",
      "scripts",
      "maliang-helper.mjs"
    );
    const packagedLocalMcpPath = path.join(pluginRoot, "mcp", "maliang-local-mcp.mjs");
    await mkdir(path.dirname(packagedHelperPath), { recursive: true });
    await mkdir(path.dirname(packagedLocalMcpPath), { recursive: true });
    await mkdir(path.join(pluginRoot, ".codex-plugin"), { recursive: true });
    const attachmentPath = path.join(directory, "熊猫.png");
    await writeFile(attachmentPath, pngBytes);
    let uploadedBytes = Buffer.alloc(0);

    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const requestPath = new URL(request.url).pathname;
        if (requestPath === "/mcp/upload/managed-upload-token-1234567890") {
          const form = await request.formData();
          const file = form.get("file");
          if (!(file instanceof File)) return new Response("missing file", { status: 400 });
          uploadedBytes = Buffer.from(await file.arrayBuffer());
          return Response.json({ uploadId: "mcpupload_managed", assetId: "asset_managed", status: "uploaded" });
        }
        if (requestPath === "/mcp/image-result/v2.payload.signature") {
          return new Response(pngBytes, { headers: { "content-type": "image/png" } });
        }
        return new Response("not found", { status: 404 });
      }
    });

    try {
      const packagedHelper = (await readFile(helperPath, "utf8"))
        .replaceAll("__MALIANG_PUBLIC_BASE_URL__", server.url.origin)
        .replaceAll("__MALIANG_ALLOW_INSECURE_LOCAL__", "true");
      await writeFile(packagedHelperPath, packagedHelper);
      await writeFile(packagedLocalMcpPath, await readFile(localMcpPath));
      await writeFile(
        path.join(pluginRoot, ".codex-plugin", "plugin.json"),
        JSON.stringify({ name: "maliang-image-generator", version: "0.4.7" })
      );

      const processHandle = Bun.spawn(["node", packagedLocalMcpPath], {
        cwd: pluginRoot,
        env: { ...Bun.env, CODEX_HOME: directory },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe"
      });
      const requests = [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } }
        },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "upload_local_image",
            arguments: {
              uploadUrl: `${server.url}mcp/upload/managed-upload-token-1234567890`,
              uploadId: "mcpupload_managed",
              filePath: attachmentPath
            }
          }
        },
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: {
            name: "save_image_result",
            arguments: {
              url: `${server.url}mcp/image-result/v2.payload.signature`,
              imageId: "img_managed"
            }
          }
        }
      ];
      processHandle.stdin.write(`${requests.map((request) => JSON.stringify(request)).join("\n")}\n`);
      processHandle.stdin.end();
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(processHandle.stdout).text(),
        new Response(processHandle.stderr).text(),
        processHandle.exited
      ]);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const responses = stdout.trim().split("\n").map((line) => JSON.parse(line)) as Array<Record<string, any>>;
      expect(responses).toHaveLength(4);
      expect(responses[0]?.result.serverInfo).toEqual(expect.objectContaining({
        name: "maliang-local-image-store",
        version: "0.4.7"
      }));
      expect(responses[1]?.result.tools).toEqual(expect.arrayContaining([expect.objectContaining({
        name: "upload_local_image",
        description: expect.stringContaining("不打开浏览器")
      }), expect.objectContaining({
        name: "save_image_result",
        description: expect.stringContaining("不会打开浏览器")
      })]));
      expect(responses[2]?.result.structuredContent).toEqual(expect.objectContaining({
        status: "uploaded",
        uploadId: "mcpupload_managed",
        assetId: "asset_managed",
        bytes: pngBytes.length
      }));
      expect(uploadedBytes).toEqual(pngBytes);
      const savedPath = String(responses[3]?.result.structuredContent.path);
      expect(savedPath).toContain(path.join("generated_images", "maliang"));
      expect(await readFile(savedPath)).toEqual(pngBytes);
      expect(stdout).not.toContain("managed-upload-token-1234567890");
      expect(stdout).not.toContain("v2.payload.signature");
    } finally {
      server.stop(true);
    }
  });

  test("rejects a mismatched uploadId without exposing the one-time URL", async () => {
    const uploadUrl = "https://maliang.example/mcp/upload/private-token-1234567890";
    const response = await handleMaliangLocalMcpRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "upload_local_image",
        arguments: {
          uploadUrl,
          uploadId: "mcpupload_expected",
          filePath: "C:/attachment.png"
        }
      }
    }, {
      uploadImage: async () => ({
        status: "uploaded",
        uploadId: "mcpupload_other",
        fileName: "attachment.png",
        mimeType: "image/png",
        bytes: pngBytes.length
      })
    });

    expect(response.result.isError).toBe(true);
    expect(response.result.content[0]?.text).toContain("uploadId 不一致");
    expect(JSON.stringify(response)).not.toContain(uploadUrl);
  });
});
