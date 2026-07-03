import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AUTO_LANGUAGE,
  DEFAULT_LOCALE,
  enabledLocales,
  localeRegistry,
  normalizeLanguagePreference,
  resolveLanguagePreference,
  type LanguagePreference,
  type LocaleCode
} from "./locales";
import deDEMessages from "./messages/de-DE";
import enUSMessages from "./messages/en-US";
import esESMessages from "./messages/es-ES";
import faIRMessages from "./messages/fa-IR";
import frFRMessages from "./messages/fr-FR";
import jaJPMessages from "./messages/ja-JP";
import koKRMessages from "./messages/ko-KR";
import ptBRMessages from "./messages/pt-BR";
import ruRUMessages from "./messages/ru-RU";
import zhCNMessages from "./messages/zh-CN";
import zhTWMessages from "./messages/zh-TW";
import type { Messages } from "./messages/types";

export type { LanguagePreference, LocaleCode } from "./locales";
export { AUTO_LANGUAGE, DEFAULT_LOCALE, enabledLocales, localeRegistry, normalizeLanguagePreference } from "./locales";

export type TranslationParams = Record<string, string | number | boolean | null | undefined>;
export type Translate = (key: string, params?: TranslationParams) => string;

const LANGUAGE_STORAGE_KEY = "gpt-image.language";

const messagesByLocale: Record<LocaleCode, Messages> = {
  "zh-CN": zhCNMessages,
  "zh-TW": zhTWMessages,
  "en-US": enUSMessages,
  "ja-JP": jaJPMessages,
  "ko-KR": koKRMessages,
  "es-ES": esESMessages,
  "fr-FR": frFRMessages,
  "de-DE": deDEMessages,
  "pt-BR": ptBRMessages,
  "ru-RU": ruRUMessages,
  "fa-IR": faIRMessages
};

type I18nContextValue = {
  language: LanguagePreference;
  resolvedLanguage: LocaleCode;
  setLanguage: (language: LanguagePreference) => void;
  t: Translate;
  formatNumber: (value: number) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLanguagePreference(): LanguagePreference {
  if (typeof window === "undefined") return AUTO_LANGUAGE;
  try {
    return normalizeLanguagePreference(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return AUTO_LANGUAGE;
  }
}

function writeStoredLanguagePreference(language: LanguagePreference) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Keep the in-memory language when browser storage is unavailable.
  }
}

function uniqueLocales(locales: Array<LocaleCode | undefined>) {
  const seen = new Set<LocaleCode>();
  return locales.filter((locale): locale is LocaleCode => {
    if (!locale || seen.has(locale)) return false;
    seen.add(locale);
    return true;
  });
}

function fallbackChain(resolvedLanguage: LocaleCode) {
  return uniqueLocales([
    resolvedLanguage,
    localeRegistry[resolvedLanguage]?.fallback,
    "en-US",
    DEFAULT_LOCALE
  ]);
}

function interpolate(template: string, params: TranslationParams = {}) {
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => {
    const value = params[key];
    return value === null || value === undefined ? "" : String(value);
  });
}

function messageForKey(key: string, resolvedLanguage: LocaleCode) {
  for (const locale of fallbackChain(resolvedLanguage)) {
    const message = messagesByLocale[locale]?.[key];
    if (typeof message === "string") return message;
  }
  return key;
}

export function languagePreferenceLabel(language: LanguagePreference, t: Translate, resolvedLanguage: LocaleCode) {
  if (language === AUTO_LANGUAGE) return t("settings.language.auto");
  return localeRegistry[language]?.nativeName ?? localeRegistry[resolvedLanguage].nativeName;
}

export function languagePreferenceOptions(t: Translate, resolvedLanguage: LocaleCode) {
  return [
    {
      value: AUTO_LANGUAGE,
      label: t("settings.language.auto"),
      description: t("settings.language.autoDescription", { language: localeRegistry[resolvedLanguage].nativeName })
    },
    ...enabledLocales.map((locale) => ({
      value: locale.code,
      label: locale.nativeName,
      description: locale.name
    }))
  ];
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<LanguagePreference>(readStoredLanguagePreference);
  const resolvedLanguage = resolveLanguagePreference(language);

  const setLanguage = useCallback((nextLanguage: LanguagePreference) => {
    const normalized = normalizeLanguagePreference(nextLanguage);
    setLanguageState(normalized);
    writeStoredLanguagePreference(normalized);
  }, []);

  const t = useCallback<Translate>(
    (key, params) => interpolate(messageForKey(key, resolvedLanguage), params),
    [resolvedLanguage]
  );

  const formatNumber = useCallback(
    (value: number) => new Intl.NumberFormat(resolvedLanguage).format(value),
    [resolvedLanguage]
  );

  useEffect(() => {
    const locale = localeRegistry[resolvedLanguage];
    document.documentElement.lang = resolvedLanguage;
    document.documentElement.dir = "ltr";
    document.documentElement.dataset.localeDir = locale.dir;
  }, [resolvedLanguage]);

  const value = useMemo(
    () => ({ language, resolvedLanguage, setLanguage, t, formatNumber }),
    [formatNumber, language, resolvedLanguage, setLanguage, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    const resolvedLanguage = DEFAULT_LOCALE;
    return {
      language: AUTO_LANGUAGE,
      resolvedLanguage,
      setLanguage: () => undefined,
      t: ((key: string, params?: TranslationParams) => interpolate(messageForKey(key, resolvedLanguage), params)) as Translate,
      formatNumber: (value: number) => String(value)
    };
  }
  return context;
}

export function useSyncI18nPreference(languagePreference: LanguagePreference | undefined, enabled: boolean) {
  const { setLanguage } = useI18n();
  useEffect(() => {
    if (!enabled) return;
    setLanguage(normalizeLanguagePreference(languagePreference));
  }, [enabled, languagePreference, setLanguage]);
}
