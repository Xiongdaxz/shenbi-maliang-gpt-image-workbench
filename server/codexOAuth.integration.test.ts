import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "bun:test";

test("independent Codex binding, encrypted storage, refresh, callbacks and account-pool integration", async () => {
  const parent = path.resolve(".tmp/codex-binding-tests"); await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, "run-"));
  for (const phase of ["suite", "restart"]) {
    const child = Bun.spawn([process.execPath, "server/codexOAuth.integration.runner.ts", phase], { cwd: process.cwd(),
      env: { ...process.env, GPT_IMAGE_DATA_DIR: directory, GPT_IMAGE_APP_DB_PATH: path.join(directory, "app.db"),
        GPT_IMAGE_CONFIG_DB_PATH: path.join(directory, "config.db"), GPT_IMAGE_CODEX_KEY_PATH: path.join(directory, "private", "codex.key") }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (exit !== 0) throw new Error(`${phase}: ${stdout}\n${stderr}`);
    console.info(stdout.split("\n").find(line => line.startsWith("CODEX_BINDING_OK")));
    expect(stdout).toContain("CODEX_BINDING_OK");
  }
}, 120000);
