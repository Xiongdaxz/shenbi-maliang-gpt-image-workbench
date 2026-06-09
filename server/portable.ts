import { spawn } from "node:child_process";
import path from "node:path";

function isCompiledExecutable() {
  return !/^bun(?:\.exe)?$/i.test(path.basename(process.execPath));
}

function portableRoot() {
  return path.dirname(process.execPath);
}

function localUrl() {
  const port = Number(Bun.env.PORT ?? 8787);
  const hostname = String(Bun.env.HOST ?? "0.0.0.0").trim() || "0.0.0.0";
  const displayHost = hostname === "0.0.0.0" ? "127.0.0.1" : hostname;
  return `http://${displayHost}:${port}`;
}

function openBrowser(url: string) {
  const platform = process.platform;
  const command = platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];

  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
  } catch (error) {
    console.warn(`Failed to open browser automatically. Open ${url} manually.`, error);
  }
}

if (isCompiledExecutable()) {
  process.chdir(portableRoot());
}

await import("./index");

const url = localUrl();
if (Bun.env.SHENBI_OPEN_BROWSER !== "0") {
  setTimeout(() => openBrowser(url), 500);
}
console.log(`Open ${url} in your browser. Keep this process running while using the app.`);
