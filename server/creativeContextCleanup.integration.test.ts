import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "bun:test";

test("chat deletion releases creative profile selections without losing live references or frozen history", async () => {
  const parent = path.resolve(".tmp/creative-context-cleanup");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, "run-"));
  const child = Bun.spawn([process.execPath, "server/creativeContextCleanup.integration.runner.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, GPT_IMAGE_DATA_DIR: directory, GPT_IMAGE_APP_DB_PATH: path.join(directory, "app.db"), GPT_IMAGE_CONFIG_DB_PATH: path.join(directory, "config.db") },
    stdout: "pipe", stderr: "pipe"
  });
  const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exit !== 0) throw new Error(`Creative context cleanup failed (${exit})\n${stdout}\n${stderr}`);
  expect(stdout).toContain("CREATIVE_CONTEXT_CLEANUP_OK");
}, 30000);
