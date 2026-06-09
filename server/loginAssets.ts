import { readdir } from "node:fs/promises";
import path from "node:path";
import { LOGIN_ASSET_EXTENSIONS } from "./constants";
import { DIST_LOGIN_DIR, PUBLIC_LOGIN_DIR } from "./paths";

function loginAssetUrl(fileName: string) {
  return `/login/${encodeURIComponent(fileName)}`;
}

function loginAssetStem(fileName: string) {
  return path.parse(fileName).name.toLowerCase();
}

function isLoginImageFile(fileName: string) {
  return LOGIN_ASSET_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function isLoginDarkBackground(fileName: string) {
  const stem = loginAssetStem(fileName);
  return stem.startsWith("login_dark_") && !stem.includes("title");
}

function isLoginLightBackground(fileName: string) {
  const stem = loginAssetStem(fileName);
  return stem.startsWith("login_") && !stem.startsWith("login_dark_") && !stem.includes("title") && stem !== "login_phone";
}

function isLoginDarkTitle(fileName: string) {
  const stem = loginAssetStem(fileName);
  return stem === "login_dark_title" || stem.startsWith("login_dark_title");
}

function isLoginLightTitle(fileName: string) {
  const stem = loginAssetStem(fileName);
  return !stem.startsWith("login_dark_") && (stem === "login_title" || stem.startsWith("login_title") || stem === "logon_title" || stem.startsWith("logon_title"));
}

function naturalLoginFileSort(a: string, b: string) {
  return a.localeCompare(b, "zh-CN", { numeric: true, sensitivity: "base" });
}

export async function loginAssetFiles() {
  const files = new Map<string, string>();
  for (const directory of [PUBLIC_LOGIN_DIR, DIST_LOGIN_DIR]) {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && isLoginImageFile(entry.name)) {
          const key = entry.name.toLowerCase();
          if (!files.has(key)) files.set(key, entry.name);
        }
      }
    } catch {
      // The login folder is optional in fresh checkouts; the frontend keeps fallback assets.
    }
  }
  return Array.from(files.values()).sort(naturalLoginFileSort);
}

function findLoginTitle(files: string[], stems: string[]) {
  return stems.map((stem) => files.find((file) => loginAssetStem(file) === stem)).find(Boolean);
}

function loginTitleCandidates(files: string[], preferredStems: string[], predicate: (fileName: string) => boolean) {
  return Array.from(
    new Set([
      ...preferredStems.map((stem) => findLoginTitle(files, [stem])).filter((file): file is string => Boolean(file)),
      ...files.filter(predicate)
    ])
  );
}

export function buildLoginAssets(files: string[]) {
  const lightBackgrounds = files.filter(isLoginLightBackground).map(loginAssetUrl);
  const darkBackgrounds = files.filter(isLoginDarkBackground).map(loginAssetUrl);
  const lightTitleFiles = loginTitleCandidates(files, ["login_title", "login_title2", "login_title1", "logon_title"], isLoginLightTitle);
  const darkTitleFiles = loginTitleCandidates(files, ["login_dark_title"], isLoginDarkTitle);
  const lightTitle = lightTitleFiles[0] ?? "";
  const darkTitle = darkTitleFiles[0] ?? lightTitle;

  return {
    backgrounds: {
      light: lightBackgrounds,
      dark: darkBackgrounds
    },
    titles: {
      light: lightTitle ? loginAssetUrl(lightTitle) : "",
      dark: darkTitle ? loginAssetUrl(darkTitle) : ""
    },
    titleFallbacks: Array.from(new Set([...lightTitleFiles, ...darkTitleFiles].filter(Boolean))).map(loginAssetUrl)
  };
}

function safeLoginAssetRequestName(value: string) {
  let fileName = value.trim();
  try {
    fileName = decodeURIComponent(fileName);
  } catch {
    // If the browser already decoded the name, keep the original value.
  }
  if (!fileName || fileName.includes("/") || fileName.includes("\\") || fileName.includes("\0")) return "";
  if (path.basename(fileName) !== fileName || !isLoginImageFile(fileName)) return "";
  return fileName;
}

export async function loginAssetFile(requestName: string) {
  const fileName = safeLoginAssetRequestName(requestName);
  if (!fileName) return null;
  for (const directory of [PUBLIC_LOGIN_DIR, DIST_LOGIN_DIR]) {
    const file = Bun.file(path.join(directory, fileName));
    if (await file.exists()) return { fileName, file };
  }
  return null;
}
