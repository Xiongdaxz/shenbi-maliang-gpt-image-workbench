import type { AssetItem, CaseMaterialItem, Message, MessageSourceReferenceImage } from "../types";

export type SubmitRequest = {
  clientRequestId: string;
  pendingScope: string;
  mode: "generation" | "edit";
  sessionId?: string;
  providerId?: string;
  prompt: string;
  size?: string;
  quality?: string;
  n?: number;
  caseItemId?: string;
  sourceImageIds?: string[];
  sourceAssetIds?: string[];
  sourceCaseItemIds?: string[];
  sourceReferenceIds?: string[];
  sourceInlineImages?: Array<{ id?: string; name?: string; dataUrl: string }>;
  referenceAssetId?: string;
  maskDataUrl?: string;
  hideReference?: boolean;
  revisionRootId?: string;
  editedMessageId?: string;
  branchId?: string;
  parentBranchId?: string;
  branchForkMessageId?: string;
  branchRootMessageId?: string;
};

export type ScrollJumpTarget = "top" | "bottom";

export const NEW_SESSION_PENDING_SCOPE = "__new_session__";

export function createSubmitRequestId() {
  return `submit-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeMessageIdList(value: unknown) {
  const rawValues =
    typeof value === "string" && value.trim().startsWith("[")
      ? (() => {
          try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [value];
          } catch {
            return [value];
          }
        })()
      : Array.isArray(value)
        ? value
        : [value];
  return unique(rawValues.map((item) => String(item ?? "").trim()).filter(Boolean));
}

function messageMetadataString(message: Message, key: string) {
  const value = message.metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function referenceImageFromMessage(message: Message, sourceImageIds: string[]): MessageSourceReferenceImage | null {
  const url = message.referenceImageUrl ?? "";
  if (message.referenceImageKind !== "image" || !url) return null;
  const imageId = message.imageId ?? sourceImageIds[0] ?? "";
  return {
    id: imageId ? `image:${imageId}` : url,
    sourceAssetId: null,
    kind: "image",
    name: message.referenceImagePrompt ?? message.imagePrompt ?? "引用图片",
    url,
    originalUrl: message.referenceImageOriginalUrl ?? url,
    previewUrl: message.referenceImagePreviewUrl ?? url,
    thumbnailUrl: message.referenceImageThumbnailUrl ?? message.referenceImagePreviewUrl ?? url,
    imageWidth: message.referenceImageWidth ?? message.imageWidth ?? 0,
    imageHeight: message.referenceImageHeight ?? message.imageHeight ?? 0
  };
}

function referenceAssetFromMessage(message: Message, sourceAssetIds: string[]): MessageSourceReferenceImage | null {
  const url = message.referenceImageUrl ?? "";
  if (message.referenceImageKind !== "asset" || !url) return null;
  const sourceAssetId = messageMetadataString(message, "referenceAssetId") || sourceAssetIds[0] || null;
  return {
    id: sourceAssetId ? `asset:${sourceAssetId}` : url,
    sourceAssetId,
    kind: "asset",
    name: message.referenceImagePrompt ?? "素材",
    url,
    originalUrl: message.referenceImageOriginalUrl ?? url,
    previewUrl: message.referenceImagePreviewUrl ?? url,
    thumbnailUrl: message.referenceImageThumbnailUrl ?? message.referenceImagePreviewUrl ?? url,
    imageWidth: message.referenceImageWidth ?? 0,
    imageHeight: message.referenceImageHeight ?? 0
  };
}

function uniqueReferenceImages(references: MessageSourceReferenceImage[]) {
  const seen = new Set<string>();
  return references.filter((reference) => {
    const key = reference.sourceReferenceId
      ? `message-source:${reference.sourceReferenceId}`
      : reference.sourceAssetId
        ? `asset:${reference.sourceAssetId}`
        : `${reference.kind}:${reference.id || reference.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function sourceSnapshotFromMessage(message: Message) {
  const metadataSourceImageIds = normalizeMessageIdList(message.metadata?.sourceImageIds);
  const sourceImageIds = unique([
    ...metadataSourceImageIds,
    ...(message.referenceImageKind === "image" && message.imageId ? [message.imageId] : [])
  ]);
  const metadataSourceAssetIds = normalizeMessageIdList(message.metadata?.sourceAssetIds);
  const metadataReferenceAssetId = messageMetadataString(message, "referenceAssetId");
  const sourceReferenceAssets = (message.sourceReferenceImages ?? []).filter((item) => item.kind === "asset");
  const sourceReferenceIds = unique([
    ...normalizeMessageIdList(message.metadata?.sourceReferenceIds),
    ...sourceReferenceAssets.map((item) => item.sourceReferenceId ?? "").filter(Boolean)
  ]);
  const sourceReferenceAssetSnapshots = sourceReferenceAssets.filter((item) => item.sourceReferenceId);
  const sourceCaseReferences = sourceReferenceAssets.filter((item) => item.sourceCaseItemId);
  const metadataSourceCaseItemIds = normalizeMessageIdList(message.metadata?.sourceCaseItemIds);
  const sourceCaseItemIds = unique([
    ...(sourceReferenceIds.length > 0 ? [] : metadataSourceCaseItemIds),
    ...sourceCaseReferences.filter((item) => !item.sourceReferenceId).map((item) => item.sourceCaseItemId ?? "").filter(Boolean)
  ]);
  const sourceAssetIds = unique([
    ...(sourceReferenceIds.length > 0 ? [] : metadataSourceAssetIds),
    ...(sourceReferenceIds.length === 0 && metadataReferenceAssetId ? [metadataReferenceAssetId] : []),
    ...sourceReferenceAssets
      .filter((item) => !item.sourceCaseItemId && !item.sourceReferenceId)
      .map((item) => item.sourceAssetId ?? "")
      .filter(Boolean)
  ]);
  const fallbackAssetReference = sourceReferenceAssets.length === 0 ? referenceAssetFromMessage(message, sourceAssetIds) : null;
  const assetReferences = uniqueReferenceImages([
    ...sourceReferenceAssets.filter((item) => !item.sourceCaseItemId),
    ...(fallbackAssetReference ? [fallbackAssetReference] : [])
  ]);
  const primaryImageReference = referenceImageFromMessage(message, sourceImageIds);
  const materialReferences = uniqueReferenceImages([...sourceReferenceAssetSnapshots, ...sourceCaseReferences, ...assetReferences]);
  const references = uniqueReferenceImages([...(primaryImageReference ? [primaryImageReference] : []), ...materialReferences]);

  return {
    sourceImageIds,
    sourceAssetIds,
    sourceCaseItemIds,
    sourceReferenceIds,
    referenceAssetId: sourceAssetIds.includes(metadataReferenceAssetId) ? metadataReferenceAssetId : sourceAssetIds[0] ?? "",
    primaryImageReference,
    assetReferences,
    caseReferences: sourceCaseReferences,
    materialReferences,
    references,
    hideReference: message.metadata?.hideReference === true
  };
}

export function sourceReferenceFromAsset(asset: AssetItem): MessageSourceReferenceImage {
  if (asset.temporary || asset.dataUrl) {
    return {
      id: `inline:${asset.id}`,
      sourceAssetId: null,
      sourceType: "pasted",
      sourceId: null,
      kind: "asset",
      name: asset.name,
      url: asset.url,
      originalUrl: asset.originalUrl ?? asset.url,
      previewUrl: asset.previewUrl ?? asset.url,
      thumbnailUrl: asset.thumbnailUrl ?? asset.previewUrl ?? asset.url,
      imageWidth: asset.imageWidth,
      imageHeight: asset.imageHeight
    };
  }
  return {
    id: `asset:${asset.id}`,
    sourceAssetId: asset.id,
    sourceType: "asset",
    sourceId: asset.id,
    kind: "asset",
    name: asset.name,
    url: asset.url,
    originalUrl: asset.originalUrl ?? asset.url,
    previewUrl: asset.previewUrl ?? asset.url,
    thumbnailUrl: asset.thumbnailUrl ?? asset.previewUrl ?? asset.url,
    imageWidth: asset.imageWidth,
    imageHeight: asset.imageHeight
  };
}

export function sourceReferenceFromCaseMaterial(caseMaterial: CaseMaterialItem): MessageSourceReferenceImage {
  return {
    id: `case:${caseMaterial.caseItemId}`,
    sourceAssetId: null,
    sourceCaseItemId: caseMaterial.caseItemId,
    sourceType: caseMaterial.sourceType,
    sourceId: caseMaterial.sourceId,
    kind: "asset",
    name: caseMaterial.title || "灵感素材",
    url: caseMaterial.url,
    originalUrl: caseMaterial.originalUrl ?? caseMaterial.url,
    previewUrl: caseMaterial.previewUrl ?? caseMaterial.url,
    thumbnailUrl: caseMaterial.thumbnailUrl ?? caseMaterial.previewUrl ?? caseMaterial.url,
    imageWidth: caseMaterial.imageWidth,
    imageHeight: caseMaterial.imageHeight
  };
}
