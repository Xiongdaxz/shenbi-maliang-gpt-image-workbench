import path from "node:path";
import {
  chatGptWebPythonRuntimeFailureSummary,
  ensureChatGptWebPythonRuntime
} from "../server/chatGptWebPythonRuntime";
import { CHATGPT_WEB_BRIDGE_SETUP_ERROR_ENV } from "../server/constants";

const rootDirectory = path.resolve(import.meta.dir, "..");
const launcherSetupError = String(Bun.env[CHATGPT_WEB_BRIDGE_SETUP_ERROR_ENV] ?? "").trim();
if (launcherSetupError) {
  console.warn(
    "[ChatGPT Web] Python 环境准备失败，官网普通额度回退暂不可用；CPA、API 和 Codex Responses 路径仍可继续使用。",
    launcherSetupError
  );
} else {
  try {
    const runtime = ensureChatGptWebPythonRuntime({
      rootDirectory,
      log: (message) => console.log(`[ChatGPT Web] ${message}`)
    });
    Bun.env.CHATGPT_WEB_BRIDGE_PYTHON = runtime.pythonPath;
    delete process.env[CHATGPT_WEB_BRIDGE_SETUP_ERROR_ENV];
  } catch (error) {
    const summary = chatGptWebPythonRuntimeFailureSummary(error);
    Bun.env[CHATGPT_WEB_BRIDGE_SETUP_ERROR_ENV] = summary;
    console.warn(
      "[ChatGPT Web] Python 环境准备失败，官网普通额度回退暂不可用；CPA、API 和 Codex Responses 路径仍可继续使用。",
      error instanceof Error ? error.message : String(error)
    );
  }
}

await import("../server/index");
