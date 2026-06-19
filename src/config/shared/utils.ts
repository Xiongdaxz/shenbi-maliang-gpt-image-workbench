import type { ProviderConfig } from "../../types";

const ACCOUNT_USAGE_AUTO_REFRESH_STORAGE_KEY = "gpt-image.config.accountUsageAutoRefreshAt";
const ACCOUNT_USAGE_AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
export const REQUEST_LOG_PAGE_SIZE = 40;

export function shouldAutoRefreshAccountUsage() {
  try {
    const nowMs = Date.now();
    const lastRefreshMs = Number(window.localStorage.getItem(ACCOUNT_USAGE_AUTO_REFRESH_STORAGE_KEY) ?? 0);
    if (Number.isFinite(lastRefreshMs) && nowMs - lastRefreshMs < ACCOUNT_USAGE_AUTO_REFRESH_INTERVAL_MS) return false;
    window.localStorage.setItem(ACCOUNT_USAGE_AUTO_REFRESH_STORAGE_KEY, String(nowMs));
  } catch {
    // If browser storage is unavailable, keep the per-mount guard below as the fallback.
  }
  return true;
}

export function formatDate(value: string) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function todayInputDate() {
  return inputDateValue(new Date());
}

export function inputDateValue(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function inputDateOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return inputDateValue(date);
}

export function incrementVersionNumberText(value: string) {
  const digits = value.split("");
  let carry = 1;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    const nextDigit = Number(digits[index]) + carry;
    if (nextDigit >= 10) {
      digits[index] = "0";
      carry = 1;
    } else {
      digits[index] = String(nextDigit);
      carry = 0;
      break;
    }
  }
  return `${carry ? "1" : ""}${digits.join("")}`;
}

export function nextChangelogVersion(version?: string) {
  const currentVersion = version?.trim();
  if (!currentVersion) return "";
  const match = currentVersion.match(/^(.*?)(\d+)(\D*)$/);
  if (!match) return "";
  const [, prefix, numberText, suffix] = match;
  const nextNumberText = incrementVersionNumberText(numberText);
  return `${prefix}${nextNumberText.padStart(numberText.length, "0")}${suffix}`;
}

export function numberLabel(value: number) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

export function percentLabel(value: number) {
  return `${Number(value || 0).toFixed(1)}%`;
}

export function durationLabel(value: number) {
  if (!value) return "0 ms";
  if (value >= 1000) return `${(value / 1000).toFixed(1)} s`;
  return `${Math.round(value)} ms`;
}

export function padNumber(value: number) {
  return String(value).padStart(2, "0");
}

export function providerChannelCode(channel: ProviderConfig["channel"]) {
  return channel === "chatgpt_web" ? "CHATGPT-WEB" : channel.toUpperCase();
}

export function providerIdTimestamp(value = new Date()) {
  return [
    value.getFullYear(),
    padNumber(value.getMonth() + 1),
    padNumber(value.getDate()),
    padNumber(value.getHours()),
    padNumber(value.getMinutes())
  ].join("");
}

export function providerFormId(channel: ProviderConfig["channel"], value = new Date()) {
  return `${providerChannelCode(channel)}-${providerIdTimestamp(value)}`;
}

export function providerDateFromId(id: string) {
  const match = id.match(/-(\d{12})$/);
  if (!match) return new Date();
  const value = match[1];
  const date = new Date(
    Number(value.slice(0, 4)),
    Number(value.slice(4, 6)) - 1,
    Number(value.slice(6, 8)),
    Number(value.slice(8, 10)),
    Number(value.slice(10, 12))
  );
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function uniqueProviderFormId(channel: ProviderConfig["channel"], existingIds: string[] = [], value = new Date()) {
  const usedIds = new Set(existingIds);
  const nextDate = new Date(value);
  for (let index = 0; index < 1440; index += 1) {
    const id = providerFormId(channel, nextDate);
    if (!usedIds.has(id)) return id;
    nextDate.setMinutes(nextDate.getMinutes() + 1);
  }
  return providerFormId(channel, new Date());
}

export function isGeneratedProviderName(name: string) {
  return [
    "新的图片接口",
    "新的官网渠道",
    "新的 CPA 渠道",
    "新的 API 渠道",
    "本地图像接口",
    "CPA 额度代理",
    "ChatGPT 官网",
    "API 直连",
    "default-cpa",
    "default-chatgpt-web",
    "default-api"
  ].includes(name.trim()) || /^(CPA|API|CHATGPT-WEB)-\d{12}$/.test(name.trim());
}

export function isGeneratedProviderId(id: string) {
  const normalized = id.trim();
  return (
    normalized === "" ||
    normalized === "local-gpt-image" ||
    /^provider(?:-id)?[-_]/.test(normalized) ||
    /^default-(cpa|chatgpt-web|api)(?:-\d+)?$/.test(normalized) ||
    /^(CPA|API|CHATGPT-WEB)-\d{12}$/.test(normalized)
  );
}

export function emptyProvider(channel: ProviderConfig["channel"] = "api", existingIds: string[] = []): ProviderConfig {
  const id = uniqueProviderFormId(channel, existingIds);
  const provider: ProviderConfig = {
    id,
    name: id,
    type: "openai-compatible",
    channel,
    enabled: true,
    baseUrl: "https://api.openai.com",
    apiKeyEnv: "OPENAI_API_KEY",
    apiKeyValue: "",
    routeMode: "images_api",
    generationPath: "/v1/images/generations",
    editPath: "/v1/images/edits",
    responsesPath: "/v1/responses",
    model: "gpt-image-2",
    responsesModel: "gpt-5.5",
    sizes: ["1024x1024", "1536x2048", "1152x2048", "2048x1536", "2048x1152"],
    qualities: ["low", "medium", "high"],
    defaultSize: "auto",
    defaultQuality: "high",
    responseImagePath: "data[0].b64_json",
    proxyEnabled: false,
    quotaMode: "codex_first",
    webAccountId: "",
    webAccountIds: [],
    webAccountMode: "priority",
    webCookies: ""
  };
  return channel === "api" ? provider : providerWithChannelDefaults(provider, channel);
}

export function providerWithChannelDefaults(
  provider: ProviderConfig,
  channel: ProviderConfig["channel"],
  options: { preserveIdentity?: boolean; existingIds?: string[] } = {}
): ProviderConfig {
  const generatedId = options.preserveIdentity
    ? provider.id
    : isGeneratedProviderId(provider.id)
      ? uniqueProviderFormId(channel, options.existingIds, providerDateFromId(provider.id))
      : provider.id;
  const common = {
    ...provider,
    id: generatedId,
    name: !options.preserveIdentity && isGeneratedProviderName(provider.name) ? generatedId : provider.name,
    channel
  };
  if (channel === "chatgpt_web") {
    return {
      ...common,
      type: "chatgpt-web",
      baseUrl: "https://chatgpt.com/backend-api",
      apiKeyEnv: "",
      routeMode: "images_api",
      generationPath: "/f/conversation",
      editPath: "/f/conversation",
      responsesPath: "/codex/responses",
      model: "gpt-image-2",
      quotaMode: provider.quotaMode || "codex_first",
      webAccountMode: provider.webAccountMode || "priority",
      proxyEnabled: true
    };
  }
  if (channel === "cpa") {
    return {
      ...common,
      type: "openai-compatible",
      baseUrl: "http://127.0.0.1:8317",
      apiKeyEnv: "GPT_IMAGE_API_KEY",
      routeMode: "images_api",
      generationPath: "/v1/images/generations",
      editPath: "/v1/images/edits",
      responsesPath: "/v1/responses",
      proxyEnabled: false
    };
  }
  return {
    ...common,
    type: "openai-compatible",
    baseUrl: "https://api.openai.com",
    apiKeyEnv: "OPENAI_API_KEY",
    routeMode: "images_api",
    generationPath: "/v1/images/generations",
    editPath: "/v1/images/edits",
    responsesPath: "/v1/responses",
    proxyEnabled: false
  };
}

export const channelLabels: Record<ProviderConfig["channel"], string> = {
  cpa: "CPA 额度代理",
  chatgpt_web: "ChatGPT 官网",
  api: "API 直连"
};

export const routeModeLabels: Record<ProviderConfig["routeMode"], string> = {
  images_api: "图片接口直连",
  responses: "Responses 接口",
  auto: "失败自动切换"
};
