import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { CHATGPT_WEB_BRIDGE_SETUP_ERROR_ENV } from "./constants";

const MINIMUM_PYTHON_MAJOR = 3;
const MINIMUM_PYTHON_MINOR = 10;
const REQUIREMENTS_RELATIVE_PATH = path.join("scripts", "requirements-chatgpt-web.lock.txt");
const PROJECT_VENV_RELATIVE_PATH = path.join("runtime", "chatgpt-web-venv");
const REQUIREMENTS_MARKER_NAME = ".requirements.sha256";
const PROVISIONING_LOCK_NAME = "chatgpt-web-python-runtime.lock";
const PYTHON_COMMAND_TIMEOUT_MS = 60 * 1000;
const PYTHON_VENV_CREATE_TIMEOUT_MS = 2 * 60 * 1000;
const PYTHON_PIP_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const PROVISIONING_LOCK_WAIT_MS = 15 * 60 * 1000;
const PROVISIONING_LOCK_INVALID_GRACE_MS = 5 * 1000;
const PROVISIONING_LOCK_POLL_MS = 250;
const DEPENDENCY_IMPORT_CHECK = "import requests, curl_cffi, PIL";

type PythonCommand = {
  executable: string;
  prefixArgs: string[];
};

type PythonProbe = {
  major: number;
  minor: number;
  executable: string;
};

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

export type ChatGptWebPythonRuntime = {
  pythonPath: string;
  venvDirectory: string | null;
  requirementsInstalled: boolean;
};

export type ChatGptWebPythonRuntimeOptions = {
  rootDirectory: string;
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
};

export function chatGptWebPythonRuntimeFailureSummary(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(/\r?\n/, 1)[0]?.trim().slice(0, 600) || "Python 环境准备失败";
}

export function chatGptWebPythonBridgeUnavailableMessage(
  environment: Record<string, string | undefined> = process.env
) {
  const setupError = String(environment[CHATGPT_WEB_BRIDGE_SETUP_ERROR_ENV] ?? "").trim();
  return setupError ? `ChatGPT 官网普通额度运行环境不可用：${setupError}` : "";
}

function runCommand(
  command: PythonCommand,
  args: string[],
  cwd: string,
  timeout = PYTHON_COMMAND_TIMEOUT_MS
): CommandResult {
  const result = spawnSync(command.executable, [...command.prefixArgs, ...args], {
    cwd,
    encoding: "utf8",
    timeout,
    windowsHide: true,
    env: {
      ...process.env,
      PIP_DISABLE_PIP_VERSION_CHECK: "1"
    }
  });
  return {
    status: result.status,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    error: result.error
  };
}

function commandText(command: PythonCommand, args: string[]) {
  return [command.executable, ...command.prefixArgs, ...args]
    .map((part) => (/\s/.test(part) ? JSON.stringify(part) : part))
    .join(" ");
}

function commandFailure(command: PythonCommand, args: string[], result: CommandResult) {
  const detail = [result.error?.message, result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
  const suffix = detail ? `\n${detail.slice(-3000)}` : "";
  return new Error(`命令执行失败：${commandText(command, args)}${suffix}`);
}

function runChecked(command: PythonCommand, args: string[], cwd: string, timeout?: number) {
  const result = runCommand(command, args, cwd, timeout);
  if (result.status !== 0) throw commandFailure(command, args, result);
  return result;
}

export function chatGptWebRequirementsHash(contents: string | Buffer) {
  return createHash("sha256").update(contents).digest("hex");
}

export function chatGptWebVenvPythonPath(
  rootDirectory: string,
  platform: NodeJS.Platform = process.platform
) {
  return platform === "win32"
    ? path.join(rootDirectory, PROJECT_VENV_RELATIVE_PATH, "Scripts", "python.exe")
    : path.join(rootDirectory, PROJECT_VENV_RELATIVE_PATH, "bin", "python");
}

export function chatGptWebPythonCandidates(
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env
): PythonCommand[] {
  const explicitBasePython = String(environment.CHATGPT_WEB_BASE_PYTHON ?? "").trim();
  if (explicitBasePython) return [{ executable: explicitBasePython, prefixArgs: [] }];
  return platform === "win32"
    ? [
        { executable: "py", prefixArgs: ["-3"] },
        { executable: "python", prefixArgs: [] }
      ]
    : [
        { executable: "python3", prefixArgs: [] },
        { executable: "python", prefixArgs: [] }
      ];
}

export function chatGptWebRequirementsNeedInstall(
  installedHash: string,
  currentHash: string,
  importsAvailable: boolean
) {
  return !importsAvailable || installedHash.trim() !== currentHash;
}

function parsePythonProbe(stdout: string): PythonProbe | null {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const lastLine = lines.at(-1);
  if (!lastLine) return null;
  try {
    const parsed = JSON.parse(lastLine) as Partial<PythonProbe>;
    const major = Number(parsed.major);
    const minor = Number(parsed.minor);
    const executable = String(parsed.executable ?? "").trim();
    if (!Number.isInteger(major) || !Number.isInteger(minor) || !executable) return null;
    return { major, minor, executable };
  } catch {
    return null;
  }
}

function probePython(command: PythonCommand, rootDirectory: string) {
  const args = [
    "-c",
    "import json,sys; print(json.dumps({'major':sys.version_info.major,'minor':sys.version_info.minor,'executable':sys.executable}))"
  ];
  const result = runCommand(command, args, rootDirectory);
  if (result.status !== 0) return null;
  const probe = parsePythonProbe(result.stdout);
  if (!probe) return null;
  if (
    probe.major < MINIMUM_PYTHON_MAJOR
    || (probe.major === MINIMUM_PYTHON_MAJOR && probe.minor < MINIMUM_PYTHON_MINOR)
  ) {
    return null;
  }
  return probe;
}

function findBasePython(
  rootDirectory: string,
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv
) {
  const candidates = chatGptWebPythonCandidates(platform, environment);
  for (const candidate of candidates) {
    if (probePython(candidate, rootDirectory)) return candidate;
  }
  const attempted = candidates.map((candidate) => commandText(candidate, ["--version"])).join("、");
  throw new Error(
    `未找到 Python ${MINIMUM_PYTHON_MAJOR}.${MINIMUM_PYTHON_MINOR}+。已尝试：${attempted}。`
    + "请安装 Python，或通过 CHATGPT_WEB_BASE_PYTHON 指定解释器。"
  );
}

function atomicWrite(filePath: string, content: string) {
  const temporaryPath = `${filePath}.tmp`;
  writeFileSync(temporaryPath, content, "utf8");
  renameSync(temporaryPath, filePath);
}

function errorCode(error: unknown) {
  return typeof error === "object" && error ? String((error as { code?: unknown }).code ?? "") : "";
}

function sleepSynchronously(milliseconds: number) {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds);
}

function lockOwnerPid(lockPath: string) {
  try {
    const owner = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: unknown };
    const pid = Number(owner.pid);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
}

function removeAbandonedLock(lockPath: string) {
  const ownerPid = lockOwnerPid(lockPath);
  if (ownerPid !== null && processIsAlive(ownerPid)) return false;
  if (ownerPid === null) {
    try {
      if (Date.now() - statSync(lockPath).mtimeMs < PROVISIONING_LOCK_INVALID_GRACE_MS) return false;
    } catch {
      return false;
    }
  }
  try {
    unlinkSync(lockPath);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return true;
    return false;
  }
}

function withProvisioningLock<T>(lockPath: string, callback: () => T): T {
  const startedAt = Date.now();
  let lockHandle: number | null = null;
  while (lockHandle === null) {
    try {
      lockHandle = openSync(lockPath, "wx");
      writeFileSync(lockHandle, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), "utf8");
      closeSync(lockHandle);
    } catch (error) {
      if (lockHandle !== null) {
        try {
          closeSync(lockHandle);
        } catch {
          // The handle may already be closed after a partial write failure.
        }
        lockHandle = null;
      }
      if (errorCode(error) !== "EEXIST") throw error;
      if (removeAbandonedLock(lockPath)) continue;
      if (Date.now() - startedAt >= PROVISIONING_LOCK_WAIT_MS) {
        throw new Error(`等待 ChatGPT 官网桥接环境准备超时：${lockPath}`);
      }
      sleepSynchronously(PROVISIONING_LOCK_POLL_MS);
    }
  }

  try {
    return callback();
  } finally {
    try {
      unlinkSync(lockPath);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        console.warn(`清理 ChatGPT 官网桥接环境锁失败：${lockPath}`, error);
      }
    }
  }
}

function explicitRuntimeMarker(rootDirectory: string, pythonPath: string) {
  const identity = createHash("sha256").update(path.resolve(pythonPath)).digest("hex").slice(0, 16);
  return path.join(rootDirectory, "runtime", `chatgpt-web-python-${identity}.sha256`);
}

function prepareChatGptWebPythonRuntime(
  options: ChatGptWebPythonRuntimeOptions
): ChatGptWebPythonRuntime {
  const rootDirectory = path.resolve(options.rootDirectory);
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const log = options.log ?? (() => undefined);
  const requirementsPath = path.join(rootDirectory, REQUIREMENTS_RELATIVE_PATH);
  if (!existsSync(requirementsPath)) {
    throw new Error(`缺少 ChatGPT 官网桥接依赖文件：${requirementsPath}`);
  }

  const requirementsHash = chatGptWebRequirementsHash(readFileSync(requirementsPath));
  const explicitPython = String(environment.CHATGPT_WEB_BRIDGE_PYTHON ?? "").trim();
  const venvDirectory = explicitPython ? null : path.join(rootDirectory, PROJECT_VENV_RELATIVE_PATH);
  let pythonCommand: PythonCommand;
  let pythonProbe: PythonProbe | null;

  if (explicitPython) {
    pythonCommand = { executable: explicitPython, prefixArgs: [] };
    pythonProbe = probePython(pythonCommand, rootDirectory);
    if (!pythonProbe) {
      throw new Error(
        `CHATGPT_WEB_BRIDGE_PYTHON 指向的解释器不可用或版本低于 Python ${MINIMUM_PYTHON_MAJOR}.${MINIMUM_PYTHON_MINOR}：${explicitPython}`
      );
    }
    log(`使用指定的 ChatGPT 官网桥接 Python：${pythonProbe.executable}`);
  } else {
    const venvPythonPath = chatGptWebVenvPythonPath(rootDirectory, platform);
    if (!existsSync(venvPythonPath)) {
      mkdirSync(path.dirname(venvDirectory!), { recursive: true });
      const basePython = findBasePython(rootDirectory, platform, environment);
      log(`首次创建 ChatGPT 官网桥接环境：${venvDirectory}`);
      try {
        runChecked(
          basePython,
          ["-m", "venv", venvDirectory!],
          rootDirectory,
          PYTHON_VENV_CREATE_TIMEOUT_MS
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `${detail}\n无法创建 Python VENV。Linux 如缺少 venv 模块，请先安装 python3-venv。`
        );
      }
    }
    pythonCommand = { executable: venvPythonPath, prefixArgs: [] };
    pythonProbe = probePython(pythonCommand, rootDirectory);
    if (!pythonProbe) {
      throw new Error(`项目 Python VENV 已损坏或不可用：${venvPythonPath}。请移走该目录后重新启动。`);
    }
    log(`使用项目 ChatGPT 官网桥接环境：${pythonProbe.executable}`);
  }

  pythonCommand = { executable: pythonProbe.executable, prefixArgs: [] };
  mkdirSync(path.join(rootDirectory, "runtime"), { recursive: true });
  const markerPath = venvDirectory
    ? path.join(venvDirectory, REQUIREMENTS_MARKER_NAME)
    : explicitRuntimeMarker(rootDirectory, pythonProbe.executable);
  const installedHash = existsSync(markerPath) ? readFileSync(markerPath, "utf8").trim() : "";
  const importResult = runCommand(pythonCommand, ["-c", DEPENDENCY_IMPORT_CHECK], rootDirectory);
  const importsAvailable = importResult.status === 0;
  const needsInstall = chatGptWebRequirementsNeedInstall(installedHash, requirementsHash, importsAvailable);

  if (needsInstall) {
    log("正在安装或更新 ChatGPT 官网桥接 Python 依赖……");
    const pipCheck = runCommand(pythonCommand, ["-m", "pip", "--version"], rootDirectory);
    if (pipCheck.status !== 0) {
      runChecked(
        pythonCommand,
        ["-m", "ensurepip", "--upgrade"],
        rootDirectory,
        PYTHON_VENV_CREATE_TIMEOUT_MS
      );
    }
    runChecked(
      pythonCommand,
      ["-m", "pip", "install", "--disable-pip-version-check", "--requirement", requirementsPath],
      rootDirectory,
      PYTHON_PIP_INSTALL_TIMEOUT_MS
    );
    if (venvDirectory) {
      runChecked(pythonCommand, ["-m", "pip", "check"], rootDirectory);
    }
  }

  const finalImportCheck = runCommand(pythonCommand, ["-c", DEPENDENCY_IMPORT_CHECK], rootDirectory);
  if (finalImportCheck.status !== 0) {
    throw commandFailure(pythonCommand, ["-c", DEPENDENCY_IMPORT_CHECK], finalImportCheck);
  }
  if (needsInstall) atomicWrite(markerPath, `${requirementsHash}\n`);
  log(needsInstall ? "ChatGPT 官网桥接 Python 依赖已就绪。" : "ChatGPT 官网桥接 Python 依赖检查通过。");

  return {
    pythonPath: pythonProbe.executable,
    venvDirectory,
    requirementsInstalled: needsInstall
  };
}

export function ensureChatGptWebPythonRuntime(
  options: ChatGptWebPythonRuntimeOptions
): ChatGptWebPythonRuntime {
  const rootDirectory = path.resolve(options.rootDirectory);
  const runtimeDirectory = path.join(rootDirectory, "runtime");
  mkdirSync(runtimeDirectory, { recursive: true });
  return withProvisioningLock(
    path.join(runtimeDirectory, PROVISIONING_LOCK_NAME),
    () => prepareChatGptWebPythonRuntime({ ...options, rootDirectory })
  );
}
