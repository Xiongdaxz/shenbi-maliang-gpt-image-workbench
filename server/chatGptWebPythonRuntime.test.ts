import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  chatGptWebPythonCandidates,
  chatGptWebPythonBridgeUnavailableMessage,
  chatGptWebPythonRuntimeFailureSummary,
  chatGptWebRequirementsHash,
  chatGptWebRequirementsNeedInstall,
  chatGptWebVenvPythonPath
} from "./chatGptWebPythonRuntime";

describe("ChatGPT Web Python runtime", () => {
  test("uses a stable SHA-256 requirements marker", () => {
    expect(chatGptWebRequirementsHash("requests>=2.31.0\n")).toBe(
      "ed73ba11243a0099034f10ac500db984959bb8f37086532f864d75a3620916c8"
    );
  });

  test("uses platform-specific project venv interpreter paths", () => {
    const root = path.resolve("workspace");
    expect(chatGptWebVenvPythonPath(root, "win32")).toBe(
      path.join(root, "runtime", "chatgpt-web-venv", "Scripts", "python.exe")
    );
    expect(chatGptWebVenvPythonPath(root, "linux")).toBe(
      path.join(root, "runtime", "chatgpt-web-venv", "bin", "python")
    );
  });

  test("prefers an explicit base interpreter without parsing shell arguments", () => {
    expect(chatGptWebPythonCandidates("win32", { CHATGPT_WEB_BASE_PYTHON: "D:\\Python312\\python.exe" })).toEqual([
      { executable: "D:\\Python312\\python.exe", prefixArgs: [] }
    ]);
  });

  test("falls back to standard platform launchers", () => {
    expect(chatGptWebPythonCandidates("win32", {})).toEqual([
      { executable: "py", prefixArgs: ["-3"] },
      { executable: "python", prefixArgs: [] }
    ]);
    expect(chatGptWebPythonCandidates("linux", {})).toEqual([
      { executable: "python3", prefixArgs: [] },
      { executable: "python", prefixArgs: [] }
    ]);
  });

  test("installs only when imports are missing or requirements changed", () => {
    expect(chatGptWebRequirementsNeedInstall("same", "same", true)).toBe(false);
    expect(chatGptWebRequirementsNeedInstall("old", "new", true)).toBe(true);
    expect(chatGptWebRequirementsNeedInstall("same", "same", false)).toBe(true);
  });

  test("keeps the runtime failure state concise and single-line", () => {
    expect(chatGptWebPythonRuntimeFailureSummary(new Error("first line\nsecret detail"))).toBe("first line");
  });

  test("turns a startup setup failure into an actionable provider error", () => {
    expect(chatGptWebPythonBridgeUnavailableMessage({ CHATGPT_WEB_BRIDGE_SETUP_ERROR: "缺少 Python" })).toBe(
      "ChatGPT 官网普通额度运行环境不可用：缺少 Python"
    );
    expect(chatGptWebPythonBridgeUnavailableMessage({})).toBe("");
  });

  test("uses exact versions in the automatic-install lock file", () => {
    const lock = readFileSync(path.resolve(import.meta.dir, "../scripts/requirements-chatgpt-web.lock.txt"), "utf8");
    const direct = readFileSync(path.resolve(import.meta.dir, "../scripts/requirements-chatgpt-web.txt"), "utf8");
    const lockedNames = new Set(
      lock.split(/\r?\n/).map((line) => line.split("==", 1)[0]?.trim().toLowerCase()).filter(Boolean)
    );
    const directNames = direct
      .split(/\r?\n/)
      .map((line) => line.split(">=", 1)[0]?.trim().toLowerCase())
      .filter(Boolean);
    expect(lock).not.toContain(">=");
    expect(lock).toContain("requests==2.34.2");
    expect(lock).toContain("curl_cffi==0.16.3");
    expect(lock).toContain("pillow==12.3.0");
    expect(directNames.every((name) => lockedNames.has(name))).toBe(true);
  });
});
