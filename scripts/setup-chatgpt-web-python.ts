import path from "node:path";
import { ensureChatGptWebPythonRuntime } from "../server/chatGptWebPythonRuntime";

const rootDirectory = path.resolve(import.meta.dir, "..");

try {
  const runtime = ensureChatGptWebPythonRuntime({
    rootDirectory,
    log: (message) => console.log(`[ChatGPT Web] ${message}`)
  });
  console.log(`[ChatGPT Web] Python: ${runtime.pythonPath}`);
} catch (error) {
  console.error(`[ChatGPT Web] Python 环境准备失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
