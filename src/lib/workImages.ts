import type { LibraryImageCard, Message, WorkImage } from "../types";
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

export function workImageFromLibraryCard(card: LibraryImageCard): WorkImage {
  const originalUrl = `/api/files/images/${encodeURIComponent(card.id)}`;
  return {
    id: card.id,
    sessionId: card.sessionId,
    jobId: null,
    url: originalUrl,
    originalUrl,
    previewUrl: `${originalUrl}?variant=preview`,
    thumbnailUrl: card.thumbnailUrl,
    prompt: card.prompt,
    originPrompt: card.prompt,
    kind: card.kind,
    size: card.size,
    imageWidth: card.imageWidth,
    imageHeight: card.imageHeight,
    imageFileSize: card.imageFileSize,
    quality: card.quality,
    providerId: card.providerId,
    parentImageId: null,
    favoriteCount: card.favoriteCount,
    favorited: card.favorited,
    createdAt: card.createdAt
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

export function orderedWorkImages(images: WorkImage[], sort: "asc" | "desc") {
  return [...images].sort((a, b) => {
    const createdDiff = imageCreatedTime(a.createdAt) - imageCreatedTime(b.createdAt);
    const stableDiff = createdDiff || a.id.localeCompare(b.id);
    return sort === "asc" ? stableDiff : -stableDiff;
  });
}

export function chronologicalWorkImages(images: WorkImage[]) {
  return orderedWorkImages(images, "asc");
}
