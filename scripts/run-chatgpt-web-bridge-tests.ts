import { spawnSync } from "node:child_process";
import path from "node:path";
import { ensureChatGptWebPythonRuntime } from "../server/chatGptWebPythonRuntime";

const rootDirectory = path.resolve(import.meta.dir, "..");
const runtime = ensureChatGptWebPythonRuntime({
  rootDirectory,
  log: (message) => console.log(`[ChatGPT Web] ${message}`)
});
const result = spawnSync(
  runtime.pythonPath,
  ["-B", "-m", "unittest", "discover", "-s", "scripts", "-p", "test_chatgpt_web_bridge.py"],
  {
    cwd: rootDirectory,
    stdio: "inherit",
    windowsHide: true
  }
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
