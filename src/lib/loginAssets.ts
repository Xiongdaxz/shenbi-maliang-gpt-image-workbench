import type { LoginAssets } from "../api";

export type LoginTheme = "light" | "dark";

const LOGIN_THEME_STORAGE_KEY = "gpt-image-login-theme";
const LOGIN_REMEMBER_STORAGE_KEY = "gpt-image-login-remember";

type RememberedLogin = {
  account: string;
  password: string;
};

const DEFAULT_LOGIN_BACKGROUNDS: Record<LoginTheme, string[]> = {
  light: [
    "/login/login_1.png",
    "/login/login_2.png",
    "/login/login_3.png",
    "/login/login_4.png",
    "/login/login_5.png"
  ],
  dark: [
    "/login/login_dark_1.png",
    "/login/login_dark_2.png",
    "/login/login_dark_3.png",
    "/login/login_dark_4.png",
    "/login/login_dark_5.png"
  ]
};

const DEFAULT_LOGIN_TITLE_ART: Record<LoginTheme, string> = {
  light: "/login/login_title.png",
  dark: "/login/login_dark_title.png"
};

const DEFAULT_LOGIN_TITLE_FALLBACKS = [
  "/login/login_title.png",
  "/login/login_title2.png",
  "/login/login_title1.png",
  "/login/logon_title.png"
];

export const DEFAULT_LOGIN_ASSETS: LoginAssets = {
  backgrounds: DEFAULT_LOGIN_BACKGROUNDS,
  titles: DEFAULT_LOGIN_TITLE_ART,
  titleFallbacks: DEFAULT_LOGIN_TITLE_FALLBACKS
};

export const LOGIN_BACKGROUND_AUTO_INTERVAL_MS = 10_000;
export const LOGIN_BACKGROUND_FADE_MS = 900;
export const LOGIN_BACKGROUND_PRELOAD_STEP_MS = 45;

export function readLoginThemePreference(): LoginTheme {
  if (typeof window === "undefined") return "light";
  try {
    return window.localStorage.getItem(LOGIN_THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function writeLoginThemePreference(theme: LoginTheme) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOGIN_THEME_STORAGE_KEY, theme);
  } catch {
    // Theme persistence is a small enhancement; the switch still works without storage.
  }
}

export function readRememberedLogin(): RememberedLogin {
  if (typeof window === "undefined") return { account: "", password: "" };
  try {
    const saved = JSON.parse(window.localStorage.getItem(LOGIN_REMEMBER_STORAGE_KEY) || "{}") as Partial<RememberedLogin>;
    return {
      account: typeof saved.account === "string" ? saved.account : "",
      password: typeof saved.password === "string" ? saved.password : ""
    };
  } catch {
    return { account: "", password: "" };
  }
}

export function writeRememberedLogin(account: string, password: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOGIN_REMEMBER_STORAGE_KEY, JSON.stringify({ account, password }));
  } catch {
    // Login still succeeds if browser storage is unavailable.
  }
}

export function clearRememberedLogin() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LOGIN_REMEMBER_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures.
  }
}

export function loginBackgroundsFor(assets: LoginAssets, theme: LoginTheme) {
  const backgrounds = assets.backgrounds[theme].filter(Boolean);
  return backgrounds.length > 0 ? backgrounds : DEFAULT_LOGIN_BACKGROUNDS[theme];
}

export function loginTitleFor(assets: LoginAssets, theme: LoginTheme) {
  return assets.titles[theme] || DEFAULT_LOGIN_TITLE_ART[theme];
}

export function loginTitleFallbacksFor(assets: LoginAssets) {
  return Array.from(new Set([...assets.titleFallbacks, ...DEFAULT_LOGIN_TITLE_FALLBACKS]));
}

export function normalizeLoginAssets(assets: LoginAssets): LoginAssets {
  return {
    backgrounds: {
      light: assets.backgrounds.light.filter(Boolean),
      dark: assets.backgrounds.dark.filter(Boolean)
    },
    titles: {
      light: assets.titles.light || DEFAULT_LOGIN_TITLE_ART.light,
      dark: assets.titles.dark || DEFAULT_LOGIN_TITLE_ART.dark
    },
    titleFallbacks: loginTitleFallbacksFor(assets)
  };
}

export function pickLoginBackground(theme: LoginTheme, previous?: string, assets = DEFAULT_LOGIN_ASSETS) {
  const backgrounds = loginBackgroundsFor(assets, theme);
  const candidates = backgrounds.length > 1 ? backgrounds.filter((item) => item !== previous) : backgrounds;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? backgrounds[0];
}

export function nextLoginBackground(theme: LoginTheme, current: string, assets = DEFAULT_LOGIN_ASSETS) {
  const backgrounds = loginBackgroundsFor(assets, theme);
  const currentIndex = backgrounds.indexOf(current);
  return backgrounds[(currentIndex + 1 + backgrounds.length) % backgrounds.length] ?? backgrounds[0];
}
