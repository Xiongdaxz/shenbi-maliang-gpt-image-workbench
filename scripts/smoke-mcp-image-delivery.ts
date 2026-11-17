import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "bun:sqlite";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

export async function smokeMcpImageDelivery(input: {
  db: Database; origin: string; root: string; accessToken: string; deviceName: string;
  fixtureImagePath?: string;
}) {
  const { db, origin, root, accessToken, deviceName } = input;
  const original = input.fixtureImagePath
    ? await readFile(input.fixtureImagePath)
    : Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR8UAAAAASUVORK5CYII=", "base64");
  assert.deepEqual(original.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "The existing smoke image must be a PNG");
  await writeFile(path.join(root, "data", "image-delivery-smoke.png"), original);
  const createdAt = new Date().toISOString();
  for (const [jobId, imageId, status] of [["job_wb_a", "img_wb_a", "succeeded"], ["job_wb_b", "img_wb_b", "failed"]]) {
    db.query(`insert into sessions(id,user_id,title,created_at,updated_at) values(?, 'smoke-user', 'Image delivery test', ?, ?)`)
      .run(jobId, createdAt, createdAt);
    db.query(`insert into image_jobs(id,user_id,session_id,type,status,prompt,provider_id,source_image_ids,request_json,created_at,updated_at)
      values(?,'smoke-user',?,'generation',?,'existing image fixture','test-provider','[]','{}',?,?)`).run(jobId, jobId, status, createdAt, createdAt);
    db.query(`insert into images(id,user_id,session_id,job_id,path,prompt,kind,size,quality,provider_id,created_at)
      values(?,'smoke-user',?,?,'image-delivery-smoke.png','existing image fixture','generation','1x1','auto','test-provider',?)`)
      .run(imageId, jobId, jobId, createdAt);
  }

  // Only the original remote MCP is connected. No local MCP process or helper is used.
  const remote = new Client({ name: "workbuddy-text-relay-fixture", version: "1" }, { versionNegotiation: { mode: "legacy" } });
  try {
    await remote.connect(new StreamableHTTPClientTransport(new URL(`${origin}/api/external-mcp/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${accessToken}` } }
    }));
    assert.equal(remote.getProtocolEra(), "legacy");
    const report = await remote.callTool({ name: "maliang_report_device", arguments: {
      deviceName, deviceType: process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux"
    } });
    assert.ok(!report.isError);
    const query = (await remote.listTools()).tools.find(tool => tool.name === "maliang_get_image_job");
    assert.ok(query);
    assert.deepEqual(Object.keys(query.inputSchema.properties ?? {}), ["jobId"]);
    for (const route of ["/mcp/workbuddy/install.json", "/mcp/workbuddy/maliang-workbuddy-mcp.mjs", "/mcp/workbuddy/THIRD_PARTY_NOTICES.txt"]) {
      assert.equal((await fetch(`${origin}${route}`)).status, 404);
    }

    for (const [jobId, status] of [["job_wb_a", "succeeded"], ["job_wb_b", "failed"]]) {
      const result = await remote.callTool({ name: "maliang_get_image_job", arguments: { jobId } });
      assert.ok(!result.isError);
      // WorkBuddy can receive only text. Read no structuredContent or resource link here.
      const text = result.content?.filter(item => item.type === "text").map(item => item.text).join("\n") ?? "";
      const data = JSON.parse(text.slice(text.indexOf("{"))) as {
        status: string; imageResults: { imageId: string; downloadUrl: string }[];
      };
      assert.equal(data.status, status);
      assert.equal(data.imageResults.length, 1);
      // The smoke server advertises a synthetic public origin; route that URL to loopback.
      const downloadUrl = new URL(data.imageResults[0]!.downloadUrl);
      const response = await fetch(new URL(downloadUrl.pathname, origin), { redirect: "error" });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.deepEqual(bytes, original);
      // Simulate the host's existing download/file tools, not its proprietary UI renderer.
      const task = path.join(root, jobId!);
      await mkdir(task);
      const localPath = path.join(task, "host-saved.png");
      await writeFile(localPath, bytes, { flag: "wx" });
      assert.ok(path.isAbsolute(localPath));
      assert.deepEqual(await readFile(localPath), original);
      const link = result.content?.find(item => item.type === "resource_link");
      assert.ok(link && link.type === "resource_link");
      assert.equal(link.uri, data.imageResults[0]!.downloadUrl);
      assert.deepEqual((result.structuredContent as { imageResults?: unknown } | undefined)?.imageResults, data.imageResults);
    }
    return {
      remoteMcpOnly: true, textOnlyImageResults: true, resourceLinkOriginal: true,
      hostSavedOriginalBytes: true, failedJobWithPartialResult: true, removedHelperRoutes: true,
      originalBytes: original.length, originalSha256: createHash("sha256").update(original).digest("hex")
    };
  } finally {
    await remote.close();
  }
}
