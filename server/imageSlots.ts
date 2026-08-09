export type StoredImageSlotItem = {
  id: string;
  job_image_index: unknown;
};

export function storedImageSlotIndexes<T extends StoredImageSlotItem>(images: T[], requestedImageCount: number) {
  const indexesByImageId = new Map<string, number>();
  const usedIndexes = new Set<number>();
  const normalizedRequestedImageCount = Math.max(1, Math.trunc(Number(requestedImageCount)) || 1);
  const slotCapacity = normalizedRequestedImageCount + images.length;
  for (const image of images) {
    const imageIndex = Math.trunc(Number(image.job_image_index));
    if (!Number.isSafeInteger(imageIndex) || imageIndex < 1 || imageIndex > slotCapacity || usedIndexes.has(imageIndex)) continue;
    indexesByImageId.set(image.id, imageIndex);
    usedIndexes.add(imageIndex);
  }
  let nextAvailableIndex = 1;
  for (const image of images) {
    if (indexesByImageId.has(image.id)) continue;
    while (nextAvailableIndex <= slotCapacity && usedIndexes.has(nextAvailableIndex)) nextAvailableIndex += 1;
    if (nextAvailableIndex > slotCapacity) continue;
    indexesByImageId.set(image.id, nextAvailableIndex);
    usedIndexes.add(nextAvailableIndex);
  }
  return indexesByImageId;
}

export function storedImageCompletionState<T extends StoredImageSlotItem>(images: T[], requestedImageCount: number) {
  const normalizedRequestedImageCount = Math.max(1, Math.trunc(Number(requestedImageCount)) || 1);
  const slotIndexes = Array.from(storedImageSlotIndexes(images, normalizedRequestedImageCount).values());
  const completedRequestedSlotCount = new Set(
    slotIndexes.filter((index) => index >= 1 && index <= normalizedRequestedImageCount)
  ).size;
  return {
    slotIndexes,
    completedRequestedSlotCount,
    totalStoredImageCount: images.length,
    remainingRequestedSlotCount: Math.max(0, normalizedRequestedImageCount - completedRequestedSlotCount)
  };
}
