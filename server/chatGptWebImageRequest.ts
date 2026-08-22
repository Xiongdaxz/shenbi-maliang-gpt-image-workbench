import { isTransparentImageRequest } from "../src/lib/imageBackground";
import { normalizeQuotaMode } from "./utils";

export type ChatGptWebQuota = "codex" | "official";

export const CHATGPT_WEB_TRANSPARENT_BACKGROUND_QUOTA_ERROR =
  "透明背景当前仅支持 ChatGPT 官网额度，请将该渠道的额度模式改为“官网优先”或“只走官网”。";

export function resolveChatGptWebImageQuotaOrder(
  quotaMode: unknown,
  payload: Record<string, unknown>
): ChatGptWebQuota[] {
  const normalizedQuotaMode = normalizeQuotaMode(String(quotaMode ?? ""));
  if (isTransparentImageRequest(payload)) {
    return normalizedQuotaMode === "codex_only" ? [] : ["official"];
  }
  if (normalizedQuotaMode === "official_first") return ["official", "codex"];
  if (normalizedQuotaMode === "codex_only") return ["codex"];
  if (normalizedQuotaMode === "official_only") return ["official"];
  return ["codex", "official"];
}
