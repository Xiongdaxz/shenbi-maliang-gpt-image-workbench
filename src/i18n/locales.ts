export const DEFAULT_LOCALE = "zh-CN" as const;
export const AUTO_LANGUAGE = "auto" as const;

export const LOCALE_CODES = ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR", "es-ES", "fr-FR", "de-DE", "pt-BR", "ru-RU", "fa-IR"] as const;

export type LocaleCode = (typeof LOCALE_CODES)[number];
export type LanguagePreference = typeof AUTO_LANGUAGE | LocaleCode;
export type TextDirection = "ltr" | "rtl";

export type LocaleDefinition = {
  code: LocaleCode;
  name: string;
  nativeName: string;
  dir: TextDirection;
  enabled: boolean;
  fallback?: LocaleCode;
};

export const localeRegistry: Record<LocaleCode, LocaleDefinition> = {
  "zh-CN": {
    code: "zh-CN",
    name: "Simplified Chinese",
    nativeName: "简体中文",
    dir: "ltr",
    enabled: true,
    fallback: "en-US"
  },
  "zh-TW": {
    code: "zh-TW",
    name: "Traditional Chinese",
    nativeName: "繁體中文",
    dir: "ltr",
    enabled: true,
    fallback: "zh-CN"
  },
  "en-US": {
    code: "en-US",
    name: "English",
    nativeName: "English",
    dir: "ltr",
    enabled: true,
    fallback: "zh-CN"
  },
  "ja-JP": {
    code: "ja-JP",
    name: "Japanese",
    nativeName: "日本語",
    dir: "ltr",
    enabled: true,
    fallback: "en-US"
  },
  "ko-KR": {
    code: "ko-KR",
    name: "Korean",
    nativeName: "한국어",
    dir: "ltr",
    enabled: true,
    fallback: "en-US"
  },
  "es-ES": {
    code: "es-ES",
    name: "Spanish",
    nativeName: "Español",
    dir: "ltr",
    enabled: true,
    fallback: "en-US"
  },
  "fr-FR": {
    code: "fr-FR",
    name: "French",
    nativeName: "Français",
    dir: "ltr",
    enabled: true,
    fallback: "en-US"
  },
  "de-DE": {
    code: "de-DE",
    name: "German",
    nativeName: "Deutsch",
    dir: "ltr",
    enabled: true,
    fallback: "en-US"
  },
  "pt-BR": {
    code: "pt-BR",
    name: "Portuguese (Brazil)",
    nativeName: "Português (Brasil)",
    dir: "ltr",
    enabled: true,
    fallback: "en-US"
  },
  "ru-RU": {
    code: "ru-RU",
    name: "Russian",
    nativeName: "Русский",
    dir: "ltr",
    enabled: true,
    fallback: "en-US"
  },
  "fa-IR": {
    code: "fa-IR",
    name: "Persian",
    nativeName: "فارسی",
    dir: "rtl",
    enabled: true,
    fallback: "en-US"
  }
};

export const enabledLocales = LOCALE_CODES.map((code) => localeRegistry[code]).filter((locale) => locale.enabled);

const localeCodeSet = new Set<string>(LOCALE_CODES);

export function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === "string" && localeCodeSet.has(value);
}

export function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === AUTO_LANGUAGE || isLocaleCode(value);
}

export function normalizeLanguagePreference(value: unknown): LanguagePreference {
  return isLanguagePreference(value) ? value : AUTO_LANGUAGE;
}

function normalizeBrowserLanguage(value: string) {
  return value.trim().replace("_", "-");
}

export function detectLocale(languages: readonly string[] = []): LocaleCode {
  for (const rawLanguage of languages) {
    const language = normalizeBrowserLanguage(rawLanguage);
    const matchedLocale = LOCALE_CODES.find((code) => code.toLowerCase() === language.toLowerCase());
    if (matchedLocale) return matchedLocale;
    const normalized = language.toLowerCase();
    if (normalized.startsWith("zh-hant") || normalized === "zh-tw" || normalized === "zh-hk" || normalized === "zh-mo") return "zh-TW";
    if (normalized.startsWith("zh-hans") || normalized === "zh-cn" || normalized === "zh-sg") return "zh-CN";
    const base = normalized.split("-")[0];
    if (base === "zh") return "zh-CN";
    if (base === "en") return "en-US";
    if (base === "ja") return "ja-JP";
    if (base === "ko") return "ko-KR";
    if (base === "es") return "es-ES";
    if (base === "fr") return "fr-FR";
    if (base === "de") return "de-DE";
    if (base === "pt") return "pt-BR";
    if (base === "ru") return "ru-RU";
    if (base === "fa") return "fa-IR";
  }
  return DEFAULT_LOCALE;
}

export function resolveLanguagePreference(preference: LanguagePreference, languages?: readonly string[]): LocaleCode {
  if (preference !== AUTO_LANGUAGE) return preference;
  const browserLanguages =
    languages ??
    (typeof navigator === "undefined" ? [] : Array.from(navigator.languages?.length ? navigator.languages : [navigator.language]));
  return detectLocale(browserLanguages);
}
