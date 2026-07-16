import type { AssetItem } from "../types";

const DEFAULT_ASSET_NAME_MAX_LENGTH = 18;

const ASSET_SPACE_LABEL: Record<AssetItem["space"], string> = {
  shared: "共享",
  private: "我的"
};

export type AssetUploadMode = "private" | "shared" | "private_shared";

export const ASSET_UPLOAD_MODE_OPTIONS: Array<{ value: AssetUploadMode; label: string; description: string }> = [
  { value: "shared", label: "共享", description: "仅保存到共享素材中，所有人可以查看和使用。" },
  { value: "private", label: "我的", description: "仅自己可见和使用，适合个人素材。" },
  { value: "private_shared", label: "我的+共享", description: "同时保存在我的素材中，并共享给所有人使用。" }
];

export function assetUploadModeI18nKey(
  mode: AssetUploadMode,
  field: "label" | "description",
  reviewEnabled: boolean
) {
  const noReviewVariant = !reviewEnabled && mode !== "private" ? ".noReview" : "";
  return `asset.uploadMode.${mode}${noReviewVariant}.${field}`;
}

export function splitFileDisplayName(name: string) {
  const normalized = name.trim();
  const match = normalized.match(/^(.*?)(\.[^.\s\\/]*)$/);
  if (!match || !match[1]) return { base: normalized, ext: "" };
  return { base: match[1], ext: match[2] };
}

export function assetSpaceLabel(asset: AssetItem) {
  if (asset.shareStatus === "pending") return "待审核";
  if (asset.shareStatus === "rejected") return "未通过";
  if (asset.space === "private" && asset.shared) return asset.canEdit ? "我的并共享" : "共享";
  return ASSET_SPACE_LABEL[asset.space];
}

export function defaultAssetNameFromPrompt(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const firstSentence = normalized.match(/^(.+?)([。！？!?；;.]|$)/)?.[1]?.trim() || normalized;
  const seed = firstSentence || "素材图片";
  const chars = Array.from(seed);
  return chars.length > DEFAULT_ASSET_NAME_MAX_LENGTH ? `${chars.slice(0, DEFAULT_ASSET_NAME_MAX_LENGTH).join("")}...` : seed;
}
