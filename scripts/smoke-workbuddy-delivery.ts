import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "bun:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

type Delivery = { jobId: string; deliveryChallenge: string; images: { imageId: string; ticket: string; expiresAt: string }[] };

// WorkBuddy hands only text blocks to the model. Deliberately ignore structuredContent here.
function relayedText(result: Awaited<ReturnType<Client["callTool"]>>) {
  assert.ok(Array.isArray(result.content) && result.content.every(item => item.type === "text"));
  const text = result.content.map(item => item.text).join("\n");
  return JSON.parse(text.slice(text.indexOf("{")));
}

export async function smokeWorkBuddyDelivery(input: {
  db: Database; origin: string; root: string; accessToken: string; deviceName: string;
  beforeResultResponse: (jobId: string, hook: () => Promise<void>) => void;
}) {
  const { db, origin, root, accessToken, deviceName } = input;
  const manifestResponse = await fetch(`${origin}/mcp/workbuddy/install.json`);
  assert.equal(manifestResponse.status, 200);
  const manifest = await manifestResponse.json() as { helper: { url: string; bytes: number; sha256: string; noticesUrl: string } };
  const bundleUrl = new URL(manifest.helper.url);
  assert.equal(bundleUrl.pathname, "/mcp/workbuddy/maliang-workbuddy-mcp.mjs");
  const bundleResponse = await fetch(`${origin}${bundleUrl.pathname}`);
  assert.equal(bundleResponse.status, 200);
  const bundle = Buffer.from(await bundleResponse.arrayBuffer());
  assert.equal(bundle.length, manifest.helper.bytes);
  assert.equal(createHash("sha256").update(bundle).digest("hex"), manifest.helper.sha256);
  const noticesUrl = new URL(manifest.helper.noticesUrl);
  assert.equal(noticesUrl.origin, bundleUrl.origin);
  assert.equal(noticesUrl.pathname, "/mcp/workbuddy/THIRD_PARTY_NOTICES.txt");
  const noticesResponse = await fetch(`${origin}${noticesUrl.pathname}`);
  assert.equal(noticesResponse.status, 200);
  assert.match(await noticesResponse.text(), /^@modelcontextprotocol\/sdk \S+/m);

  const helper = path.join(root, "maliang-workbuddy-mcp.mjs");
  await writeFile(helper, bundle);
  const taskA = path.join(root, "task-a");
  const taskB = path.join(root, "task-b");
  await Promise.all([mkdir(taskA), mkdir(taskB)]);
  const original = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR8UAAAAASUVORK5CYII=", "base64");
  await writeFile(path.join(root, "data", "workbuddy-smoke.png"), original);
  const createdAt = new Date().toISOString();
  for (const [jobId, imageId, status] of [["job_wb_a", "img_wb_a", "succeeded"], ["job_wb_b", "img_wb_b", "failed"]]) {
    db.query(`insert into sessions(id,user_id,title,created_at,updated_at) values(?, 'smoke-user', 'WorkBuddy test', ?, ?)`)
      .run(jobId, createdAt, createdAt);
    db.query(`insert into image_jobs(id,user_id,session_id,type,status,prompt,provider_id,source_image_ids,request_json,created_at,updated_at)
      values(?,'smoke-user',?,'generation',?,'test fixture','test-provider','[]','{}',?,?)`).run(jobId, jobId, status, createdAt, createdAt);
    db.query(`insert into images(id,user_id,session_id,job_id,path,prompt,kind,size,quality,provider_id,created_at)
      values(?,'smoke-user',?,?,'workbuddy-smoke.png','test fixture','generation','1x1','auto','test-provider',?)`)
      .run(imageId, jobId, jobId, createdAt);
  }

  const remote = new Client({ name: "workbuddy-text-relay-fixture", version: "1" });
  const local = new Client({ name: "workbuddy-local-fixture", version: "1" });
  try {
    await remote.connect(new StreamableHTTPClientTransport(new URL(`${origin}/api/external-mcp/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${accessToken}` } }
    }));
    const report = await remote.callTool({ name: "maliang_report_device", arguments: { deviceName, deviceType: process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux" } });
    assert.ok(!report.isError);
    await local.connect(new StdioClientTransport({ command: "node", args: [helper], env: {
      MALIANG_WORKBUDDY_ORIGIN: origin, MALIANG_WORKBUDDY_ALLOW_INSECURE_LOCAL: "true",
      MALIANG_WORKBUDDY_WORKSPACE_ROOTS: JSON.stringify([root])
    } }));
    assert.deepEqual((await local.listTools()).tools.map(tool => tool.name).sort(), ["prepare_image_delivery", "save_image_results"]);
    const outside = await local.callTool({ name: "prepare_image_delivery", arguments: { jobId: "job_wb_a", workspacePath: path.dirname(root) } });
    assert.equal(outside.isError, true);
    const prepare = async (jobId: string, workspacePath: string, status: string) => {
      const args = relayedText(await local.callTool({ name: "prepare_image_delivery", arguments: { jobId, workspacePath } }));
      const text = relayedText(await remote.callTool({ name: "maliang_get_image_job", arguments: { jobId, workBuddyDeliveryChallenge: args.deliveryChallenge } }));
      assert.equal(text.status, status);
      assert.deepEqual(text.imageResults, []);
      assert.ok(!JSON.stringify(text).includes("/mcp/image-result/"));
      return text.workBuddyDelivery as Delivery;
    };
    const [a, b] = await Promise.all([prepare("job_wb_a", taskA, "succeeded"), prepare("job_wb_b", taskB, "failed")]);
    const item = a.images[0]!;
    const withoutProof = await fetch(`${origin}/mcp/workbuddy-image-result/${a.jobId}/${item.imageId}`, {
      method: "POST", headers: { "X-Maliang-Delivery-Ticket": item.ticket }
    });
    assert.equal(withoutProof.status, 404);
    const mixed = await local.callTool({ name: "save_image_results", arguments: { ...b, images: a.images } });
    assert.equal(mixed.isError, true);
    const results = await Promise.all([a, b].map(async (delivery, index) => {
      const payload = relayedText(await local.callTool({ name: "save_image_results", arguments: delivery }));
      assert.equal(payload.status, "completed");
      assert.equal(payload.files.length, 1);
      const [file] = payload.files as string[];
      assert.equal(path.relative(path.join(index === 0 ? taskA : taskB, "generated-images"), path.dirname(file!)), "");
      assert.equal(payload.images[0].localPath, file);
      assert.deepEqual(await readFile(file!), original);
      return file;
    }));
    assert.notEqual(results[0], results[1]);

    // Simulate a task folder being replaced while the original is being downloaded.
    const verifiedRoot = await realpath(root);
    const changedTask = path.join(verifiedRoot, "task-changing");
    const previousTask = path.join(verifiedRoot, "task-before-change");
    await mkdir(changedTask);
    const changed = await prepare(a.jobId, changedTask, "succeeded");
    input.beforeResultResponse(changed.jobId, async () => {
      const from = await realpath(changedTask);
      assert.equal(path.relative(verifiedRoot, path.dirname(from)), "");
      assert.equal(path.relative(verifiedRoot, path.dirname(previousTask)), "");
      await rename(from, previousTask);
      await mkdir(changedTask);
    });
    const prevented = await local.callTool({ name: "save_image_results", arguments: changed });
    assert.equal(prevented.isError, true);
    const blocked = relayedText(prevented);
    assert.equal(blocked.status, "failed");
    assert.deepEqual(blocked.files, []);
    assert.match(blocked.failures[0].error, /原任务目录已改变/);
    assert.deepEqual(await readdir(changedTask), []);
    assert.deepEqual(await readdir(previousTask), []);
    return {
      textRelay: true, verifiedOriginalBytes: true, isolatedTaskFolders: true,
      failedJobWithPartialResult: true, proofRequired: true, blockedReplacedTaskDirectory: true
    };
  } finally {
    await Promise.allSettled([local.close(), remote.close()]);
  }
}
