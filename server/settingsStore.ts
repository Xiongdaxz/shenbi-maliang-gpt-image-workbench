import { configDb, getOne } from "./db";
import { DEFAULT_IMAGE_RESULT_RETRY_COUNT, requestImageResultRetryCount } from "./constants";
import { globalSwitchEnabled } from "./globalSwitches";
import type { DebugSettings, ImageGenerationSettings, ProviderRow, ProxySettings } from "./types";
import { inferChannelFromType, maskSecret, normalizeImageGenerationMode, normalizeProviderChannel } from "./utils";

export function cpaAccount(includeSecret = false) {
  const row = getOne<{
    id: string;
    enabled: number;
    account_name: string;
    sync_url: string;
    username: string;
    password_secret: string;
    token_secret: string;
    frequency_minutes: number;
    last_status: string | null;
    updated_at: string;
  }>(
    configDb,
    "select * from cpa_accounts order by updated_at desc limit 1"
  );

  if (!row) {
    return {
      enabled: globalSwitchEnabled("cpa_sync"),
      syncUrl: "",
      passwordSecret: "",
      frequencyMinutes: 60,
      lastStatus: "",
      updatedAt: ""
    };
  }

  return {
    enabled: globalSwitchEnabled("cpa_sync"),
    syncUrl: row.sync_url,
    passwordSecret: includeSecret ? row.password_secret : maskSecret(row.password_secret),
    frequencyMinutes: row.frequency_minutes,
    lastStatus: row.last_status ?? "",
    updatedAt: row.updated_at
  };
}

export function imageGenerationSettings(): ImageGenerationSettings {
  const row = getOne<{ mode: string; result_retry_count: number | null; updated_at: string }>(
    configDb,
    "select mode, result_retry_count, updated_at from image_generation_settings where id = ? limit 1",
    "default"
  );
  if (!row) {
    return {
      mode: "auto",
      resultRetryCount: DEFAULT_IMAGE_RESULT_RETRY_COUNT,
      updatedAt: ""
    };
  }
  return {
    mode: normalizeImageGenerationMode(row.mode),
    resultRetryCount: requestImageResultRetryCount(row.result_retry_count),
    updatedAt: row.updated_at ?? ""
  };
}

export function debugSettings(): DebugSettings {
  const row = getOne<{
    image_edit_mask: number;
    updated_at: string;
  }>(configDb, "select * from debug_settings where id = ? limit 1", "default");

  return {
    imageEditMask: globalSwitchEnabled("debug_image_edit_mask"),
    updatedAt: row?.updated_at ?? ""
  };
}

export function proxySettings(): ProxySettings {
  const row = getOne<{
    enabled: number;
    url: string;
    retry_count: number;
    apply_chatgpt_web: number;
    apply_cpa: number;
    apply_api: number;
    updated_at: string;
  }>(configDb, "select * from proxy_settings where id = ? limit 1", "default");

  if (!row) {
    return {
      enabled: globalSwitchEnabled("proxy_service"),
      url: "",
      retryCount: 2,
      applyChatgptWeb: true,
      applyCpa: false,
      applyApi: false,
      updatedAt: ""
    };
  }

  const rawRetryCount = Number(row.retry_count ?? 2);
  return {
    enabled: globalSwitchEnabled("proxy_service"),
    url: row.url,
    retryCount: Number.isFinite(rawRetryCount) ? Math.max(0, Math.min(10, Math.trunc(rawRetryCount))) : 2,
    applyChatgptWeb: Boolean(row.apply_chatgpt_web),
    applyCpa: Boolean(row.apply_cpa),
    applyApi: Boolean(row.apply_api),
    updatedAt: row.updated_at
  };
}

export function shouldUseProxy(provider: ProviderRow) {
  const settings = proxySettings();
  if (!settings.enabled || !settings.url || !provider.proxy_enabled) return false;
  const channel = normalizeProviderChannel(provider.channel || inferChannelFromType(provider.type));
  if (channel === "cpa") return settings.applyCpa;
  if (channel === "chatgpt_web") return settings.applyChatgptWeb;
  if (channel === "api") return settings.applyApi;
  return false;
}
