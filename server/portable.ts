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

function withPath(baseUrl: string, pathname: string) {
  const url = new URL(baseUrl);
  url.pathname = pathname;
  return url.toString();
}

async function canFetch(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);

  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function isWorkbenchRunning(url: string) {
  if (await canFetch(withPath(url, "/api/health"))) return true;
  return canFetch(url);
}

function isAddressInUse(error: unknown) {
  const code = typeof error === "object" && error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "EADDRINUSE" || /EADDRINUSE|address already in use/i.test(message);
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

const url = localUrl();

if (await isWorkbenchRunning(url)) {
  console.log(`Shenbi Maliang is already running at ${url}. Opening the existing app window.`);
  if (Bun.env.SHENBI_OPEN_BROWSER !== "0") {
    openBrowser(url);
  }
  process.exit(0);
}

try {
  await import("./index");
} catch (error) {
  if (isAddressInUse(error)) {
    console.log(`Shenbi Maliang is already running at ${url}. Opening the existing app window.`);
    if (Bun.env.SHENBI_OPEN_BROWSER !== "0") {
      openBrowser(url);
    }
    process.exit(0);
  }
  throw error;
}

if (Bun.env.SHENBI_OPEN_BROWSER !== "0") {
  setTimeout(() => openBrowser(url), 500);
}
console.log(`Open ${url} in your browser. Keep this process running while using the app.`);
