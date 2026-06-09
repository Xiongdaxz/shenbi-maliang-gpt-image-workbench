import type { Message, WorkImage } from "../types";
import { imageCreatedTime } from "./imageTimeline";

export function workImageFromMessage(message: Message): WorkImage | null {
  if (!message.imageUrl || !message.imageId) return null;
  return {
    id: message.imageId,
    url: message.imageUrl,
    originalUrl: message.imageOriginalUrl ?? message.imageUrl,
    previewUrl: message.imagePreviewUrl ?? message.imageUrl,
    thumbnailUrl: message.imageThumbnailUrl ?? message.imagePreviewUrl ?? message.imageUrl,
    prompt: message.imagePrompt ?? message.content,
    originPrompt: message.imageOriginPrompt ?? message.imagePrompt ?? message.content,
    sessionId: null,
    jobId: null,
    kind: message.imageKind ?? "generation",
    size: message.imageSize ?? "",
    imageWidth: message.imageWidth ?? 0,
    imageHeight: message.imageHeight ?? 0,
    imageFileSize: message.imageFileSize ?? 0,
    quality: message.imageQuality ?? "",
    providerId: message.imageProviderId ?? "",
    parentImageId: message.parentImageId,
    suggestedCaseTitle: message.imageSuggestedCaseTitle ?? "",
    suggestedCaseCategoryIds: message.imageSuggestedCaseCategoryIds ?? [],
    suggestedAssetName: message.imageSuggestedAssetName ?? message.imageSuggestedCaseTitle ?? "",
    suggestedAssetCategoryIds: message.imageSuggestedAssetCategoryIds ?? [],
    favoriteCount: 0,
    favorited: false,
    referenceImages: message.referenceImages ?? [],
    createdAt: message.createdAt
  };
}

export function uniqueWorkImages(images: WorkImage[]) {
  const seen = new Set<string>();
  return images.filter((image) => {
    if (seen.has(image.id)) return false;
    seen.add(image.id);
    return true;
  });
}

export function newestWorkImages(images: WorkImage[]) {
  return [...images].sort((a, b) => imageCreatedTime(b.createdAt) - imageCreatedTime(a.createdAt));
}
