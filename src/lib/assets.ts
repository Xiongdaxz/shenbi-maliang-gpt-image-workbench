import type { AssetItem } from "../types";

const DEFAULT_ASSET_NAME_MAX_LENGTH = 18;

const ASSET_SPACE_LABEL: Record<AssetItem["space"], string> = {
  shared: "共享",
  private: "我的"
};

export type AssetUploadMode = "private" | "shared" | "private_shared";

export const ASSET_UPLOAD_MODE_OPTIONS: Array<{ value: AssetUploadMode; label: string; description: string }> = [
  { value: "shared", label: "申请共享", description: "提交后台审核，通过后其他人可以查看和使用。" },
  { value: "private", label: "我的", description: "仅自己可见和使用，适合个人素材。" },
  { value: "private_shared", label: "保存并申请共享", description: "先保存在我的素材中，同时提交后台审核。" }
];

export function splitFileDisplayName(name: string) {
  const normalized = name.trim();
  const match = normalized.match(/^(.*?)(\.[^.\s\\/]*)$/);
  if (!match || !match[1]) return { base: normalized, ext: "" };
  return { base: match[1], ext: match[2] };
}

export function assetSpaceLabel(asset: AssetItem) {
  if (asset.space === "private" && asset.shareStatus === "pending") return "待审核";
  if (asset.space === "private" && asset.shareStatus === "rejected") return "未通过";
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
