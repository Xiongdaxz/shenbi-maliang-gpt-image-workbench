import { isUncategorizedCaseCategory, UNCATEGORIZED_CASE_CATEGORY_ID } from "./cases";
import { imageCreatedTime } from "./imageTimeline";
import type { CaseCategory, CaseMaterialItem } from "../types";

export type GalleryCaseItem = CaseCategory["items"][number] & {
  styleId: string;
  styleName: string;
};

export function visibleCaseStyleNames(item: { categoryNames: string[]; styleName?: string }) {
  return (item.categoryNames.length > 0 ? item.categoryNames : [item.styleName ?? ""]).map((name) => name.trim()).filter(Boolean);
}

export function caseStyleCategories(categories: CaseCategory[]) {
  return categories.filter((category) => !isUncategorizedCaseCategory(category));
}

export function buildGalleryCaseItems(sourceCategories: CaseCategory[]) {
  const filteredItems = sourceCategories
    .flatMap((category) =>
      category.items.map((item) => ({
        ...item,
        styleId: category.id,
        styleName: category.name,
        categoryIds: item.categoryIds.filter((categoryId) => categoryId !== UNCATEGORIZED_CASE_CATEGORY_ID),
        categoryNames: item.categoryNames.filter((name) => name.trim())
      }))
    )
    .sort((a, b) => imageCreatedTime(b.createdAt) - imageCreatedTime(a.createdAt));
  const seenItems = new Set<string>();
  return filteredItems.filter((item) => {
    const itemKey = item.groupId || item.id;
    if (seenItems.has(itemKey)) return false;
    seenItems.add(itemKey);
    return true;
  });
}

export function caseMaterialFromCaseItem(item: CaseCategory["items"][number]): CaseMaterialItem {
  const caseItemId = item.groupId || item.id;
  return {
    id: caseItemId,
    caseItemId,
    title: item.title,
    prompt: item.prompt,
    url: item.imageUrl,
    originalUrl: item.imageOriginalUrl ?? item.imageUrl,
    previewUrl: item.imagePreviewUrl ?? item.imageUrl,
    thumbnailUrl: item.imageThumbnailUrl ?? item.imagePreviewUrl ?? item.imageUrl,
    imageWidth: item.imageWidth,
    imageHeight: item.imageHeight,
    imageFileSize: item.imageFileSize,
    sourceType: item.downloadSourceType,
    sourceId: item.downloadSourceId,
    sourceUsername: item.sourceUsername,
    categoryNames: item.categoryNames,
    createdAt: item.createdAt
  };
}
