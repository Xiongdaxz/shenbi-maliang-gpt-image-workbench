import type { Hono } from "hono";
import { UNCATEGORIZED_CASE_CATEGORY_ID, ensureCategoryIds, makeCategorySlug } from "./categories";
import { generateCaseTitle, resolveCaseCategoryIds, suggestCaseFields } from "./caseSuggestions";
import { caseUsageSourceFromCaseItem, caseUsageSourceKey, type CaseUsageSource } from "./caseUsage";
import { appDb, getAll, getOne, run } from "./db";
import { globalSwitchEnabled } from "./globalSwitches";
import { ensureImageSourceReferences } from "./imageReferenceBackfill";
import { boundedPaginationFromQuery, pageInfo, pageSlice } from "./pagination";
import { assetUrlFromAssetId, imageOriginPromptsByImageIds, imageReferencesByImageIds, imageUrlFromImageId } from "./serializers";
import type { AssetRow, ImageRow } from "./types";
import { approvedCaseSql, makeId, normalizeIdList, normalizeReviewStatus, now, visibleAssetSql, visibleCaseSql, type ReviewStatus } from "./utils";
import { requireUser } from "./auth";
import { imageBatchResult, parseImageBatchIds } from "./imageBatch";

type CaseItemRow = {
  id: string;
  group_id: string | null;
  category_id: string;
  user_id: string | null;
  image_id: string | null;
  asset_id: string | null;
  include_references: number | null;
  review_status: string | null;
  review_requested_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  reject_reason: string | null;
  source_username: string | null;
  image_width: number | null;
  image_height: number | null;
  image_file_size: number | null;
  title: string;
  prompt: string;
  image_url: string;
  created_at: string;
};

type CaseGroupImageRow = {
  id: string;
  group_id: string;
  user_id: string | null;
  image_id: string | null;
  asset_id: string | null;
  image_url: string;
  sort_order: number;
  is_cover: number;
  image_width: number | null;
  image_height: number | null;
  image_file_size: number | null;
};

type PublicCaseGroupImage = {
  id: string;
  sourceType: "image" | "asset" | "url";
  sourceId: string;
  imageUrl: string;
  imageOriginalUrl: string;
  imagePreviewUrl: string;
  imageThumbnailUrl: string;
  downloadSourceType: "image" | "asset" | null;
  downloadSourceId: string | null;
  imageWidth: number;
  imageHeight: number;
  imageFileSize: number;
  isCover: boolean;
  sortOrder: number;
  referenceImages: ReturnType<typeof imageReferencesByImageIds> extends Map<string, infer T> ? T : never;
};

type PublicCaseItem = {
  id: string;
  title: string;
  prompt: string;
  imageUrl: string;
  imageOriginalUrl: string;
  imagePreviewUrl: string;
  imageThumbnailUrl: string;
  downloadSourceType: "image" | "asset" | null;
  downloadSourceId: string | null;
  createdAt: string;
  imageWidth: number;
  imageHeight: number;
  imageFileSize: number;
  useCount: number;
  favoriteCount: number;
  favorited: boolean;
  sourceUsername: string;
  canDelete: boolean;
  groupId: string;
  categoryIds: string[];
  categoryNames: string[];
  includeReferences: boolean;
  reviewStatus: ReviewStatus;
  reviewRequestedAt: string;
  reviewedAt: string;
  rejectReason: string;
  images: PublicCaseGroupImage[];
  imageCount: number;
  coverImageId: string;
  referenceImages: PublicCaseGroupImage["referenceImages"];
  _categoryId: string;
  _imageId: string | null;
  _includeReferences: boolean;
};

function caseReviewState(timestamp: string) {
  const approved = !globalSwitchEnabled("case_review");
  return {
    reviewStatus: approved ? ("approved" as const) : ("pending" as const),
    reviewRequestedAt: timestamp,
    reviewedAt: approved ? timestamp : null,
    reviewedBy: approved ? "global_switch" : "",
    rejectReason: ""
  };
}

function groupIdFromItem(item: { group_id?: string | null; id: string }) {
  return item.group_id?.trim() || item.id;
}

function sourceFromCaseItemWithGroupCount(item: CaseItemRow, groupImageCounts: Map<string, number>): CaseUsageSource {
  const groupId = groupIdFromItem(item);
  if ((groupImageCounts.get(groupId) ?? 0) > 1) {
    return { sourceUserId: item.user_id ?? "", sourceType: "case_group", sourceId: groupId };
  }
  if (item.image_id) return { sourceUserId: item.user_id ?? "", sourceType: "image", sourceId: item.image_id };
  if (item.asset_id) return { sourceUserId: item.user_id ?? "", sourceType: "asset", sourceId: item.asset_id };
  return { sourceUserId: item.user_id ?? "", sourceType: "url", sourceId: item.image_url };
}

function groupImageRowsByGroupIds(groupIds: string[]) {
  const ids = Array.from(new Set(groupIds.map((id) => id.trim()).filter(Boolean)));
  const map = new Map<string, CaseGroupImageRow[]>();
  if (ids.length === 0) return map;
  const rows = getAll<CaseGroupImageRow>(
    appDb,
    `select case_group_images.id, case_group_images.group_id, case_group_images.user_id,
            case_group_images.image_id, case_group_images.asset_id, case_group_images.image_url,
            case_group_images.sort_order, case_group_images.is_cover,
            coalesce(images.image_width, assets.image_width, 0) as image_width,
            coalesce(images.image_height, assets.image_height, 0) as image_height,
            coalesce(images.image_file_size, assets.size, 0) as image_file_size
     from case_group_images
     left join images on images.id = case_group_images.image_id
     left join assets on assets.id = case_group_images.asset_id
     where case_group_images.group_id in (${ids.map(() => "?").join(", ")})
     order by case_group_images.group_id asc, case_group_images.sort_order asc, case_group_images.rowid asc`,
    ...ids
  );
  for (const row of rows) {
    const items = map.get(row.group_id) ?? [];
    items.push(row);
    map.set(row.group_id, items);
  }
  return map;
}

function publicGroupImage(
  row: CaseGroupImageRow,
  referenceMap: ReturnType<typeof imageReferencesByImageIds>,
  includeReferences: boolean
): PublicCaseGroupImage {
  const sourceType = row.image_id ? "image" : row.asset_id ? "asset" : "url";
  const sourceId = row.image_id ?? row.asset_id ?? row.image_url;
  const imageUrl = row.image_id
    ? imageUrlFromImageId(row.image_id)
    : row.asset_id
      ? assetUrlFromAssetId(row.asset_id)
      : row.image_url;
  const imagePreviewUrl = row.image_id
    ? imageUrlFromImageId(row.image_id, "preview")
    : row.asset_id
      ? assetUrlFromAssetId(row.asset_id, "preview")
      : imageUrl;
  const imageThumbnailUrl = row.image_id
    ? imageUrlFromImageId(row.image_id, "thumb")
    : row.asset_id
      ? assetUrlFromAssetId(row.asset_id, "thumb")
      : imagePreviewUrl;
  return {
    id: row.id,
    sourceType,
    sourceId,
    imageUrl,
    imageOriginalUrl: imageUrl,
    imagePreviewUrl,
    imageThumbnailUrl,
    downloadSourceType: row.image_id ? "image" : row.asset_id ? "asset" : null,
    downloadSourceId: row.image_id ?? row.asset_id ?? null,
    imageWidth: row.image_width ?? 0,
    imageHeight: row.image_height ?? 0,
    imageFileSize: row.image_file_size ?? 0,
    isCover: row.is_cover === 1,
    sortOrder: row.sort_order ?? 0,
    referenceImages: includeReferences && row.image_id ? referenceMap.get(row.image_id) ?? [] : []
  };
}

function fallbackGroupImageFromCaseItem(item: PublicCaseItem): PublicCaseGroupImage {
  return {
    id: `${item.groupId}:cover`,
    sourceType: item.downloadSourceType ?? "url",
    sourceId: item.downloadSourceId ?? item.imageUrl,
    imageUrl: item.imageUrl,
    imageOriginalUrl: item.imageOriginalUrl,
    imagePreviewUrl: item.imagePreviewUrl,
    imageThumbnailUrl: item.imageThumbnailUrl,
    downloadSourceType: item.downloadSourceType,
    downloadSourceId: item.downloadSourceId,
    imageWidth: item.imageWidth,
    imageHeight: item.imageHeight,
    imageFileSize: item.imageFileSize,
    isCover: true,
    sortOrder: 0,
    referenceImages: item.referenceImages
  };
}

function resolveCaseItem(caseId: string, userId?: string) {
  const ownerClause = userId ? " and case_items.user_id = ?" : "";
  const params = userId ? [caseId, caseId, userId] : [caseId, caseId];
  return getOne<CaseItemRow>(
    appDb,
    `select case_items.id, case_items.group_id, case_items.category_id, case_items.user_id,
            case_items.image_id, case_items.asset_id, coalesce(case_items.include_references, 1) as include_references,
            coalesce(case_items.review_status, 'approved') as review_status,
            case_items.review_requested_at, case_items.reviewed_at, case_items.reviewed_by, case_items.reject_reason,
            users.username as source_username,
            coalesce(images.image_width, assets.image_width, 0) as image_width,
            coalesce(images.image_height, assets.image_height, 0) as image_height,
            coalesce(images.image_file_size, assets.size, 0) as image_file_size,
            case_items.title, case_items.prompt, case_items.image_url, case_items.created_at
     from case_items
     left join users on users.id = case_items.user_id
     left join images on images.id = case_items.image_id
     left join assets on assets.id = case_items.asset_id
     where (case_items.id = ? or case_items.group_id = ?)${ownerClause}
     order by case_items.rowid asc
     limit 1`,
    ...params
  );
}

function resolveOwnedCaseItem(caseId: string, userId: string) {
  return resolveCaseItem(caseId, userId);
}

function resolveVisibleCaseItem(caseId: string, userId: string) {
  return getOne<CaseItemRow>(
    appDb,
    `select case_items.id, case_items.group_id, case_items.category_id, case_items.user_id,
            case_items.image_id, case_items.asset_id, coalesce(case_items.include_references, 1) as include_references,
            coalesce(case_items.review_status, 'approved') as review_status,
            case_items.review_requested_at, case_items.reviewed_at, case_items.reviewed_by, case_items.reject_reason,
            users.username as source_username,
            coalesce(images.image_width, assets.image_width, 0) as image_width,
            coalesce(images.image_height, assets.image_height, 0) as image_height,
            coalesce(images.image_file_size, assets.size, 0) as image_file_size,
            case_items.title, case_items.prompt, case_items.image_url, case_items.created_at
     from case_items
     left join users on users.id = case_items.user_id
     left join images on images.id = case_items.image_id
     left join assets on assets.id = case_items.asset_id
     where (case_items.id = ? or case_items.group_id = ?)
       and ${visibleCaseSql("case_items")}
     order by case_items.rowid asc
     limit 1`,
    caseId,
    caseId,
    userId
  );
}

function coverGroupImage(groupId: string) {
  return getOne<CaseGroupImageRow>(
    appDb,
    `select case_group_images.id, case_group_images.group_id, case_group_images.user_id,
            case_group_images.image_id, case_group_images.asset_id, case_group_images.image_url,
            case_group_images.sort_order, case_group_images.is_cover,
            coalesce(images.image_width, assets.image_width, 0) as image_width,
            coalesce(images.image_height, assets.image_height, 0) as image_height,
            coalesce(images.image_file_size, assets.size, 0) as image_file_size
     from case_group_images
     left join images on images.id = case_group_images.image_id
     left join assets on assets.id = case_group_images.asset_id
     where case_group_images.group_id = ?
     order by case_group_images.is_cover desc, case_group_images.sort_order asc, case_group_images.rowid asc
     limit 1`,
    groupId
  );
}

function publicVisibleCaseDetail(caseId: string, userId: string) {
  const item = resolveVisibleCaseItem(caseId, userId);
  if (!item) return null;
  const groupId = groupIdFromItem(item);
  const categoryRows = getAll<{ id: string; name: string }>(
    appDb,
    `select distinct case_categories.id, case_categories.name, case_categories.sort_order
     from case_items
     join case_categories on case_categories.id = case_items.category_id
     where coalesce(nullif(case_items.group_id, ''), case_items.id) = ?
       and case_categories.type = 'case'
     order by case_categories.sort_order asc, case_categories.rowid asc`,
    groupId
  );
  const visibleCategories = categoryRows.filter((category) => category.id !== UNCATEGORIZED_CASE_CATEGORY_ID);
  const groupRows = groupImageRowsByGroupIds([groupId]).get(groupId) ?? [];
  const imageIds = groupRows.map((row) => row.image_id ?? "").filter(Boolean);
  const referenceMap = imageReferencesByImageIds(imageIds);
  const groupImages = groupRows
    .map((row) => publicGroupImage(row, referenceMap, item.include_references !== 0))
    .sort((left, right) => left.sortOrder - right.sortOrder);
  const fallbackImageUrl = item.image_id
    ? imageUrlFromImageId(item.image_id)
    : item.asset_id
      ? assetUrlFromAssetId(item.asset_id)
      : item.image_url;
  const fallbackPreviewUrl = item.image_id
    ? imageUrlFromImageId(item.image_id, "preview")
    : item.asset_id
      ? assetUrlFromAssetId(item.asset_id, "preview")
      : fallbackImageUrl;
  const fallbackThumbnailUrl = item.image_id
    ? imageUrlFromImageId(item.image_id, "thumb")
    : item.asset_id
      ? assetUrlFromAssetId(item.asset_id, "thumb")
      : fallbackPreviewUrl;
  const groupCounts = new Map([[groupId, groupRows.length || 1]]);
  const source = sourceFromCaseItemWithGroupCount(item, groupCounts);
  const sourceUserId = source.sourceUserId || "";
  const useCount = getOne<{ total: number }>(
    appDb,
    `select count(*) as total
     from case_prompt_usage_events
     where source_user_id = ? and source_type = ? and source_id = ?`,
    sourceUserId,
    source.sourceType,
    source.sourceId
  )?.total ?? 0;
  const favorite = getOne<{ total: number; current_user_favorited: number }>(
    appDb,
    `select count(*) as total,
            max(case when user_id = ? then 1 else 0 end) as current_user_favorited
     from case_favorites
     where source_user_id = ? and source_type = ? and source_id = ?`,
    userId,
    sourceUserId,
    source.sourceType,
    source.sourceId
  );
  const baseItem: PublicCaseItem = {
    id: item.id,
    title: item.title,
    prompt: item.prompt,
    imageUrl: fallbackImageUrl,
    imageOriginalUrl: fallbackImageUrl,
    imagePreviewUrl: fallbackPreviewUrl,
    imageThumbnailUrl: fallbackThumbnailUrl,
    downloadSourceType: item.image_id ? "image" : item.asset_id ? "asset" : null,
    downloadSourceId: item.image_id ?? item.asset_id ?? null,
    createdAt: item.created_at,
    imageWidth: item.image_width ?? 0,
    imageHeight: item.image_height ?? 0,
    imageFileSize: item.image_file_size ?? 0,
    useCount,
    favoriteCount: Number(favorite?.total ?? 0),
    favorited: Boolean(favorite?.current_user_favorited),
    sourceUsername: item.source_username ?? "未知用户",
    canDelete: item.user_id === userId,
    groupId,
    categoryIds: visibleCategories.map((category) => category.id),
    categoryNames: visibleCategories.map((category) => category.name),
    includeReferences: item.include_references !== 0,
    reviewStatus: normalizeReviewStatus(item.review_status),
    reviewRequestedAt: item.review_requested_at ?? "",
    reviewedAt: item.reviewed_at ?? "",
    rejectReason: item.reject_reason ?? "",
    images: [],
    imageCount: 1,
    coverImageId: item.image_id ?? item.asset_id ?? item.image_url,
    referenceImages: item.include_references !== 0 && item.image_id ? referenceMap.get(item.image_id) ?? [] : [],
    _categoryId: item.category_id,
    _imageId: item.image_id,
    _includeReferences: item.include_references !== 0
  };
  const publicImages = groupImages.length > 0 ? groupImages : [fallbackGroupImageFromCaseItem(baseItem)];
  const cover = publicImages.find((image) => image.isCover) ?? publicImages[0];
  const { _categoryId, _imageId, _includeReferences, ...publicItem } = baseItem;
  return {
    ...publicItem,
    imageUrl: cover.imageUrl,
    imageOriginalUrl: cover.imageOriginalUrl,
    imagePreviewUrl: cover.imagePreviewUrl,
    imageThumbnailUrl: cover.imageThumbnailUrl,
    downloadSourceType: cover.downloadSourceType,
    downloadSourceId: cover.downloadSourceId,
    imageWidth: cover.imageWidth,
    imageHeight: cover.imageHeight,
    imageFileSize: cover.imageFileSize,
    images: publicImages,
    imageCount: publicImages.length,
    coverImageId: cover.sourceId,
    referenceImages: cover.referenceImages
  };
}

export function registerCaseRoutes(api: Hono) {
api.get("/cases", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const currentUserId = user.id;
  const pagination = boundedPaginationFromQuery(c);
  const selectedCategoryIds = normalizeIdList(c.req.query("categoryIds") ?? c.req.query("categoryId"));
  const mineOnly = c.req.query("mineOnly") === "true" || c.req.query("mineOnly") === "1";
  const favoriteOnly = c.req.query("favoriteOnly") === "true" || c.req.query("favoriteOnly") === "1";
  const keyword = String(c.req.query("keyword") ?? "").trim().toLowerCase();
  const categories = getAll<{ id: string; name: string; slug: string }>(
    appDb,
    "select id, name, slug from case_categories where type = 'case' order by sort_order asc"
  );

  const scopedItems = getAll<CaseItemRow>(
    appDb,
    `select case_items.id, case_items.group_id, case_items.category_id, case_items.user_id, case_items.image_id, case_items.asset_id,
            coalesce(case_items.include_references, 1) as include_references,
            coalesce(case_items.review_status, 'approved') as review_status,
            case_items.review_requested_at, case_items.reviewed_at, case_items.reviewed_by, case_items.reject_reason,
            users.username as source_username,
            coalesce(images.image_width, assets.image_width, 0) as image_width,
            coalesce(images.image_height, assets.image_height, 0) as image_height,
            coalesce(images.image_file_size, assets.size, 0) as image_file_size,
            case_items.title, case_items.prompt, case_items.image_url, case_items.created_at
     from case_items
     left join users on users.id = case_items.user_id
     left join images on images.id = case_items.image_id
     left join assets on assets.id = case_items.asset_id
     where ${visibleCaseSql("case_items")}
     order by case_items.created_at desc, case_items.rowid desc`,
    currentUserId
  );
  const publicItems = scopedItems.filter((item) => normalizeReviewStatus(item.review_status) === "approved");
  const ownItems = scopedItems.filter((item) => item.user_id === currentUserId);
  const groupImageCounts = new Map(
    getAll<{ group_id: string; image_count: number }>(
      appDb,
      "select group_id, count(*) as image_count from case_group_images group by group_id"
    ).map((row) => [row.group_id, row.image_count])
  );
  const usageRows = getAll<{
    source_user_id: string | null;
    source_type: CaseUsageSource["sourceType"];
    source_id: string;
    use_count: number;
  }>(
    appDb,
    `select source_user_id, source_type, source_id, count(*) as use_count
     from case_prompt_usage_events
     group by source_user_id, source_type, source_id`
  );
  const usageCountBySource = new Map(
    usageRows.map((row) => [
      caseUsageSourceKey({
        sourceUserId: row.source_user_id ?? "",
        sourceType: row.source_type,
        sourceId: row.source_id
      }),
      row.use_count
    ])
  );
  const favoriteRows = getAll<{
    source_user_id: string | null;
    source_type: CaseUsageSource["sourceType"];
    source_id: string;
    favorite_count: number;
    current_user_favorited: number;
  }>(
    appDb,
    `select source_user_id, source_type, source_id, count(*) as favorite_count,
            max(case when user_id = ? then 1 else 0 end) as current_user_favorited
     from case_favorites
     group by source_user_id, source_type, source_id`,
    currentUserId
  );
  const favoriteCountBySource = new Map<string, number>();
  const currentUserFavoriteSources = new Set<string>();
  for (const row of favoriteRows) {
    const sourceKey = caseUsageSourceKey({
      sourceUserId: row.source_user_id ?? "",
      sourceType: row.source_type,
      sourceId: row.source_id
    });
    favoriteCountBySource.set(sourceKey, row.favorite_count);
    if (row.current_user_favorited) currentUserFavoriteSources.add(sourceKey);
  }
  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));
  const caseGroupCategoryIds = new Map<string, string[]>();
  for (const item of scopedItems) {
    const groupId = groupIdFromItem(item);
    const categoryIds = caseGroupCategoryIds.get(groupId) ?? [];
    if (!categoryIds.includes(item.category_id)) categoryIds.push(item.category_id);
    caseGroupCategoryIds.set(groupId, categoryIds);
  }

  function toPublicCaseItem(item: CaseItemRow): PublicCaseItem {
    const groupId = groupIdFromItem(item);
    const categoryIds = caseGroupCategoryIds.get(groupId) ?? [item.category_id];
    const visibleCategoryIds = categoryIds.filter((categoryId) => categoryId !== UNCATEGORIZED_CASE_CATEGORY_ID);
    const sourceKey = caseUsageSourceKey(sourceFromCaseItemWithGroupCount(item, groupImageCounts));
    const imageUrl = item.image_id
      ? imageUrlFromImageId(item.image_id)
      : item.asset_id
        ? assetUrlFromAssetId(item.asset_id)
        : item.image_url;
    const imagePreviewUrl = item.image_id
      ? imageUrlFromImageId(item.image_id, "preview")
      : item.asset_id
        ? assetUrlFromAssetId(item.asset_id, "preview")
        : imageUrl;
    const imageThumbnailUrl = item.image_id
      ? imageUrlFromImageId(item.image_id, "thumb")
      : item.asset_id
        ? assetUrlFromAssetId(item.asset_id, "thumb")
        : imageUrl;
    return {
      id: item.id,
      title: item.title,
      prompt: item.prompt,
      imageUrl,
      imageOriginalUrl: imageUrl,
      imagePreviewUrl,
      imageThumbnailUrl,
      downloadSourceType: item.image_id ? "image" : item.asset_id ? "asset" : null,
      downloadSourceId: item.image_id ?? item.asset_id ?? null,
      createdAt: item.created_at,
      imageWidth: item.image_width ?? 0,
      imageHeight: item.image_height ?? 0,
      imageFileSize: item.image_file_size ?? 0,
      useCount: usageCountBySource.get(sourceKey) ?? 0,
      favoriteCount: favoriteCountBySource.get(sourceKey) ?? 0,
      favorited: currentUserFavoriteSources.has(sourceKey),
      sourceUsername: item.source_username ?? "未知用户",
      canDelete: item.user_id === currentUserId,
      groupId,
      categoryIds: visibleCategoryIds,
      categoryNames: visibleCategoryIds.map((categoryId) => categoryNameById.get(categoryId)).filter((name): name is string => Boolean(name)),
      includeReferences: item.include_references !== 0,
      reviewStatus: normalizeReviewStatus(item.review_status),
      reviewRequestedAt: item.review_requested_at ?? "",
      reviewedAt: item.reviewed_at ?? "",
      rejectReason: item.reject_reason ?? "",
      images: [],
      imageCount: 1,
      coverImageId: item.image_id ?? item.asset_id ?? item.image_url,
      referenceImages: [],
      _categoryId: item.category_id,
      _imageId: item.image_id,
      _includeReferences: item.include_references !== 0
    };
  }

  function dedupeCaseItems(sourceRows: CaseItemRow[]) {
    const seenItems = new Set<string>();
    const result: PublicCaseItem[] = [];
    for (const item of sourceRows) {
      const publicItem = toPublicCaseItem(item);
      const itemKey = publicItem.groupId || publicItem.id;
      if (seenItems.has(itemKey)) continue;
      seenItems.add(itemKey);
      result.push(publicItem);
    }
    return result;
  }

  function matchesKeyword(item: PublicCaseItem) {
    if (!keyword) return true;
    const haystack = [item.title, item.prompt, ...item.categoryNames].join(" ").toLowerCase();
    return haystack.includes(keyword);
  }

  function filteredCaseItems(sourceRows: CaseItemRow[], onlyMine: boolean, onlyFavorite = false) {
    return dedupeCaseItems(sourceRows)
      .filter((item) => !onlyMine || item.canDelete)
      .filter((item) => !onlyFavorite || item.favorited)
      .filter(matchesKeyword);
  }

  const selectedCategorySet = new Set(selectedCategoryIds);
  const activeRows = mineOnly ? ownItems : publicItems;
  const selectedRows = selectedCategoryIds.length > 0 ? activeRows.filter((item) => selectedCategorySet.has(item.category_id)) : activeRows;
  const visibleItems = filteredCaseItems(selectedRows, mineOnly, favoriteOnly);
  const pagedItems = pageSlice(visibleItems, pagination);
  const filtersActive = selectedCategoryIds.length > 0 || mineOnly || favoriteOnly || Boolean(keyword);
  const responseItems = pagination.enabled || filtersActive ? pagedItems : activeRows.map(toPublicCaseItem);
  const groupImageRows = groupImageRowsByGroupIds(responseItems.map((item) => item.groupId));
  const groupImageIds = responseItems.flatMap((item) => groupImageRows.get(item.groupId) ?? []).map((item) => item.image_id ?? "");
  const imageReferenceMap = imageReferencesByImageIds(groupImageIds);
  const hydratedItems = responseItems.map((item) => {
    const images = (groupImageRows.get(item.groupId) ?? [])
      .map((row) => publicGroupImage(row, imageReferenceMap, item.includeReferences))
      .sort((left, right) => left.sortOrder - right.sortOrder);
    const publicImages = images.length > 0 ? images : [fallbackGroupImageFromCaseItem(item)];
    const cover = publicImages.find((image) => image.isCover) ?? publicImages[0];
    return {
      ...item,
      imageUrl: cover.imageUrl,
      imageOriginalUrl: cover.imageOriginalUrl,
      imagePreviewUrl: cover.imagePreviewUrl,
      imageThumbnailUrl: cover.imageThumbnailUrl,
      downloadSourceType: cover.downloadSourceType,
      downloadSourceId: cover.downloadSourceId,
      imageWidth: cover.imageWidth,
      imageHeight: cover.imageHeight,
      imageFileSize: cover.imageFileSize,
      images: publicImages,
      imageCount: publicImages.length,
      coverImageId: cover.sourceId,
      referenceImages: cover.referenceImages
    };
  });
  const caseStyleCategories = categories.filter((category) => category.id !== UNCATEGORIZED_CASE_CATEGORY_ID);
  const publicItemsByCategory = new Map<string, Array<Omit<PublicCaseItem, "_categoryId" | "_imageId" | "_includeReferences">>>();

  for (const item of hydratedItems) {
    const { _categoryId, _imageId, _includeReferences, ...publicItem } = item;
    const targetItems = publicItemsByCategory.get(_categoryId) ?? [];
    targetItems.push(publicItem);
    publicItemsByCategory.set(_categoryId, targetItems);
  }

  return c.json({
    pageInfo: pageInfo(visibleItems.length, pagination),
    counts: {
      all: filteredCaseItems(publicItems, false).length,
      mine: filteredCaseItems(ownItems, false).length,
      favorite: filteredCaseItems(publicItems, false, true).length,
      byCategory: Object.fromEntries(
        caseStyleCategories.map((category) => [
          category.id,
          filteredCaseItems(publicItems.filter((item) => item.category_id === category.id), false).length
        ])
      )
    },
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      items: publicItemsByCategory.get(category.id) ?? []
    }))
  });
});

api.get("/cases/contributors", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const contributors = getAll<{
    user_id: string;
    username: string;
    avatar_path: string;
    updated_at: string;
    contribution_count: number;
    latest_contribution_at: string;
  }>(
    appDb,
    `select users.id as user_id, users.username, users.avatar_path, users.updated_at,
            count(distinct coalesce(nullif(case_items.group_id, ''), case_items.id)) as contribution_count,
            max(coalesce(case_items.reviewed_at, case_items.created_at)) as latest_contribution_at
     from case_items
     join users on users.id = case_items.user_id
     where ${approvedCaseSql("case_items")} and users.disabled = 0
     group by users.id, users.username, users.avatar_path, users.updated_at
     order by contribution_count desc, latest_contribution_at desc, lower(users.username) asc, users.id asc
     limit 6`
  );
  return c.json({
    contributors: contributors.map((contributor) => ({
      userId: contributor.user_id,
      username: contributor.username,
      avatarUrl: contributor.avatar_path
        ? `/api/files/user-avatar/${encodeURIComponent(contributor.user_id)}?v=${encodeURIComponent(contributor.updated_at || "")}`
        : "",
      contributionCount: contributor.contribution_count
    }))
  });
});

api.get("/cases/:caseId", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const caseItem = publicVisibleCaseDetail(c.req.param("caseId"), user.id);
  if (!caseItem) return c.json({ error: "灵感不存在" }, 404);
  return c.json({ caseItem });
});

api.post("/cases/categories", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) return c.json({ error: "请填写风格名称" }, 400);
  const existing = getOne<{ id: string }>(
    appDb,
    "select id from case_categories where type = 'case' and lower(name) = lower(?)",
    name
  );
  if (existing) return c.json({ error: "风格已存在" }, 400);

  const id = makeId("casecat");
  const slug = makeCategorySlug(name, "case");
  const sortOrder =
    (getOne<{ max_sort: number | null }>(appDb, "select max(sort_order) as max_sort from case_categories where type = 'case'")
      ?.max_sort ?? 0) + 10;
  run(
    appDb,
    "insert into case_categories (id, type, name, slug, sort_order) values (?, ?, ?, ?, ?)",
    id,
    "case",
    name,
    slug,
    sortOrder
  );
  return c.json({ category: { id, name, slug, items: [] } });
});

api.post("/cases/from-images", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const parsed = parseImageBatchIds(body.imageIds, 20);
  if (parsed.error) return c.json({ error: parsed.error }, 400);
  const includeReferences = body.includeReferences !== false ? 1 : 0;
  const placeholders = parsed.imageIds.map(() => "?").join(", ");
  const images = getAll<ImageRow>(
    appDb,
    `select * from images where user_id = ? and id in (${placeholders})`,
    user.id,
    ...parsed.imageIds
  );
  const imageById = new Map(images.map((image) => [image.id, image]));
  const originPrompts = imageOriginPromptsByImageIds(images.map((image) => image.id));
  const duplicateRows = getAll<{ image_id: string }>(
    appDb,
    `select distinct image_id
     from case_group_images
     where user_id = ? and image_id in (${placeholders})`,
    user.id,
    ...parsed.imageIds
  );
  const duplicateIds = new Set(duplicateRows.map((row) => row.image_id));
  const items = [];
  for (const imageId of parsed.imageIds) {
    const image = imageById.get(imageId);
    if (!image) {
      items.push({ imageId, status: "not_found" as const, reason: "图片不存在" });
      continue;
    }
    if (duplicateIds.has(image.id)) {
      items.push({ imageId, status: "duplicate" as const, reason: "已经加入灵感空间" });
      continue;
    }
    try {
      const prompt = originPrompts.get(image.id) ?? image.prompt;
      const suggestion = await suggestCaseFields(prompt);
      const categoryIds = suggestion.categoryIds.length > 0 && ensureCategoryIds(suggestion.categoryIds, "case")
        ? suggestion.categoryIds
        : [UNCATEGORIZED_CASE_CATEGORY_ID];
      const title = suggestion.title.trim() || await generateCaseTitle(prompt);
      run(
        appDb,
        "update images set suggested_case_title = ?, suggested_case_category_ids_json = ? where id = ? and user_id = ?",
        title,
        JSON.stringify(categoryIds),
        image.id,
        user.id
      );
      if (includeReferences) {
        await ensureImageSourceReferences(user.id, image).catch((error) => {
          console.warn("批量灵感素材来源补全失败", image.id, error);
        });
      }
      const createdAt = now();
      const groupId = makeId("casegrp");
      const reviewState = caseReviewState(createdAt);
      const createRecords = appDb.transaction(() => {
        run(
          appDb,
          `insert into case_group_images (
            id, group_id, user_id, image_id, asset_id, image_url, sort_order, is_cover, created_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          makeId("caseimg"),
          groupId,
          user.id,
          image.id,
          null,
          imageUrlFromImageId(image.id),
          0,
          1,
          createdAt
        );
        let firstCaseItemId = "";
        for (const categoryId of categoryIds) {
          const caseItemId = makeId("case");
          if (!firstCaseItemId) firstCaseItemId = caseItemId;
          run(
            appDb,
            `insert into case_items (
              id, group_id, category_id, user_id, image_id, asset_id, include_references,
              review_status, review_requested_at, reviewed_at, reviewed_by, reject_reason,
              title, prompt, image_url, created_at
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            caseItemId,
            groupId,
            categoryId,
            user.id,
            image.id,
            null,
            includeReferences,
            reviewState.reviewStatus,
            reviewState.reviewRequestedAt,
            reviewState.reviewedAt,
            reviewState.reviewedBy,
            reviewState.rejectReason,
            title,
            prompt,
            imageUrlFromImageId(image.id),
            createdAt
          );
        }
        return firstCaseItemId;
      });
      items.push({ imageId, status: "created" as const, targetId: createRecords() });
    } catch (error) {
      items.push({ imageId, status: "failed" as const, reason: error instanceof Error ? error.message : "创建灵感失败" });
    }
  }
  return c.json(imageBatchResult(items));
});

api.post("/cases", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const bodyImageIds = normalizeIdList(body.imageIds);
  const singleImageId = String(body.imageId ?? "").trim();
  const imageIds = bodyImageIds.length > 0 ? bodyImageIds : singleImageId ? [singleImageId] : [];
  const skipDuplicates = body.duplicateMode === "skip" && bodyImageIds.length > 0;
  const assetId = String(body.assetId ?? "").trim();
  const rawCategoryIds: unknown[] = Array.isArray(body.categoryIds) ? body.categoryIds : [body.categoryId];
  const categoryIds: string[] = Array.from(
    new Set<string>(
      rawCategoryIds
        .map((value: unknown) => String(value ?? "").trim())
        .filter((value): value is string => Boolean(value))
    )
  );
  const rawTitle = String(body.title ?? "").trim();
  const rawPrompt = String(body.prompt ?? "").trim();
  const autoCategory = body.autoCategory !== false;
  const includeReferences = body.includeReferences !== false ? 1 : 0;
  if ((imageIds.length === 0 && !assetId) || (imageIds.length > 0 && assetId)) {
    return c.json({ error: "请选择图片" }, 400);
  }
  if (imageIds.length > 20) return c.json({ error: "单次最多加入 20 张图片" }, 400);
  if (!rawPrompt) return c.json({ error: "请填写提示内容" }, 400);

  const images = imageIds.length > 0
    ? getAll<ImageRow>(appDb, `select * from images where user_id = ? and id in (${imageIds.map(() => "?").join(", ")})`, user.id, ...imageIds)
    : [];
  const imageById = new Map(images.map((image) => [image.id, image]));
  const missingImageIds = imageIds.filter((id) => !imageById.has(id));
  const loadedOrderedImages = imageIds.map((id) => imageById.get(id)).filter((image): image is ImageRow => Boolean(image));
  if (imageIds.length > 0 && missingImageIds.length > 0 && !skipDuplicates) return c.json({ error: "图片不存在" }, 404);
  const asset = assetId
    ? getOne<AssetRow>(
        appDb,
        `select * from assets where id = ? and ${visibleAssetSql("assets")}`,
        assetId,
        user.id
      )
    : null;
  if (assetId && !asset) return c.json({ error: "素材不存在" }, 404);
  if (categoryIds.length > 0 && !ensureCategoryIds(categoryIds, "case")) return c.json({ error: "灵感风格不存在" }, 400);

  let duplicateImageIds: string[] = [];
  if (loadedOrderedImages.length > 0) {
    const existingImages = getAll<{ image_id: string }>(
      appDb,
      `select distinct image_id
       from case_group_images
       where user_id = ? and image_id in (${imageIds.map(() => "?").join(", ")})`,
      user.id,
      ...imageIds
    );
    duplicateImageIds = existingImages.map((item) => item.image_id);
    if (duplicateImageIds.length > 0 && !skipDuplicates) {
      return c.json({ error: loadedOrderedImages.length > 1 ? "部分图片已经加入灵感空间" : "已经加入了" }, 409);
    }
  } else if (asset) {
    const existingAsset = getOne<{ id: string }>(
      appDb,
      "select id from case_group_images where user_id = ? and asset_id = ? limit 1",
      user.id,
      asset.id
    );
    if (existingAsset) return c.json({ error: "已经加入了" }, 409);
  }

  const duplicateImageIdSet = new Set(duplicateImageIds);
  const orderedImages = skipDuplicates
    ? loadedOrderedImages.filter((image) => !duplicateImageIdSet.has(image.id))
    : loadedOrderedImages;
  const skippedImageIds = imageIds.filter((id) => missingImageIds.includes(id) || duplicateImageIdSet.has(id));
  if (imageIds.length > 0 && orderedImages.length === 0) {
    return c.json({ caseItems: [], skipped: skippedImageIds.length, createdImageIds: [], skippedImageIds });
  }

  const prompt = rawPrompt;
  const targetCategoryIds = await resolveCaseCategoryIds(prompt, categoryIds, autoCategory);
  if (!ensureCategoryIds(targetCategoryIds, "case")) return c.json({ error: "灵感风格不存在" }, 400);

  const title = rawTitle || await generateCaseTitle(prompt);
  if (!title) return c.json({ error: "标题生成失败，请手动填写标题" }, 400);

  const coverImageId = String(body.coverImageId ?? "").trim();
  const coverImage = orderedImages.find((image) => image.id === coverImageId) ?? orderedImages[0] ?? null;
  const groupId = makeId("casegrp");
  const createdAt = now();
  const coverImageUrl = coverImage
    ? imageUrlFromImageId(coverImage.id)
    : asset
      ? assetUrlFromAssetId(asset.id)
      : "";
  if (includeReferences) {
    for (const image of orderedImages) {
      await ensureImageSourceReferences(user.id, image).catch((error) => {
        console.warn("灵感素材来源补全失败", error);
      });
    }
  }
  if (orderedImages.length > 0) {
    orderedImages.forEach((image, index) => {
      run(
        appDb,
        `insert into case_group_images (
          id, group_id, user_id, image_id, asset_id, image_url, sort_order, is_cover, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        makeId("caseimg"),
        groupId,
        user.id,
        image.id,
        null,
        imageUrlFromImageId(image.id),
        index,
        image.id === coverImage?.id ? 1 : 0,
        createdAt
      );
    });
  } else if (asset) {
    run(
      appDb,
      `insert into case_group_images (
        id, group_id, user_id, image_id, asset_id, image_url, sort_order, is_cover, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      makeId("caseimg"),
      groupId,
      user.id,
      null,
      asset.id,
      assetUrlFromAssetId(asset.id),
      0,
      1,
      createdAt
    );
  }

  const caseItems: Array<Record<string, string | number | boolean | string[]>> = [];
  const reviewState = caseReviewState(createdAt);
  for (const categoryId of targetCategoryIds) {
    const id = makeId("case");
    run(
      appDb,
      `insert into case_items (
        id, group_id, category_id, user_id, image_id, asset_id, include_references,
        review_status, review_requested_at, reviewed_at, reviewed_by, reject_reason,
        title, prompt, image_url, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      groupId,
      categoryId,
      user.id,
      coverImage?.id ?? null,
      asset?.id ?? null,
      includeReferences,
      reviewState.reviewStatus,
      reviewState.reviewRequestedAt,
      reviewState.reviewedAt,
      reviewState.reviewedBy,
      reviewState.rejectReason,
      title,
      prompt,
      coverImageUrl,
      createdAt
    );
    caseItems.push({
      id,
      groupId,
      categoryId,
      categoryIds: targetCategoryIds,
      title,
      prompt,
      imageUrl: coverImageUrl,
      imageOriginalUrl: coverImageUrl,
      imagePreviewUrl: coverImage ? imageUrlFromImageId(coverImage.id, "preview") : asset ? assetUrlFromAssetId(asset.id, "preview") : coverImageUrl,
      imageThumbnailUrl: coverImage ? imageUrlFromImageId(coverImage.id, "thumb") : asset ? assetUrlFromAssetId(asset.id, "thumb") : coverImageUrl,
      imageWidth: coverImage?.image_width ?? asset?.image_width ?? 0,
      imageHeight: coverImage?.image_height ?? asset?.image_height ?? 0,
      imageFileSize: coverImage?.image_file_size ?? asset?.size ?? 0,
      imageCount: orderedImages.length || (asset ? 1 : 0),
      useCount: 0,
      canDelete: true,
      reviewStatus: reviewState.reviewStatus,
      reviewRequestedAt: reviewState.reviewRequestedAt,
      reviewedAt: reviewState.reviewedAt ?? "",
      rejectReason: reviewState.rejectReason
    });
  }
  return c.json({
    caseItems,
    skipped: skippedImageIds.length,
    createdImageIds: orderedImages.map((image) => image.id),
    skippedImageIds
  });
});

api.put("/cases/:caseId/favorite", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const caseId = c.req.param("caseId");
  const body = await c.req.json().catch(() => ({}));
  const favorited = Boolean(body.favorited);
  const item = resolveVisibleCaseItem(caseId, user.id);
  if (!item) return c.json({ error: "灵感不存在" }, 404);

  const source = caseUsageSourceFromCaseItem(item);
  if (!source.sourceId) return c.json({ error: "灵感来源不存在" }, 400);
  const sourceUserId = source.sourceUserId || "";
  if (favorited) {
    run(
      appDb,
      `insert or ignore into case_favorites (
        id, user_id, source_user_id, source_type, source_id, created_at
      ) values (?, ?, ?, ?, ?, ?)`,
      makeId("casefav"),
      user.id,
      sourceUserId,
      source.sourceType,
      source.sourceId,
      now()
    );
  } else {
    run(
      appDb,
      "delete from case_favorites where user_id = ? and source_user_id = ? and source_type = ? and source_id = ?",
      user.id,
      sourceUserId,
      source.sourceType,
      source.sourceId
    );
  }
  const favoriteCount =
    getOne<{ total: number }>(
      appDb,
      "select count(*) as total from case_favorites where source_user_id = ? and source_type = ? and source_id = ?",
      sourceUserId,
      source.sourceType,
      source.sourceId
    )?.total ?? 0;
  return c.json({ favorited, favoriteCount });
});

api.put("/cases/:caseId/cover", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const item = resolveOwnedCaseItem(c.req.param("caseId"), user.id);
  if (!item) return c.json({ error: "灵感不存在" }, 404);
  const groupId = groupIdFromItem(item);
  const body = await c.req.json().catch(() => ({}));
  const targetId = String(body.groupImageId ?? body.imageId ?? body.assetId ?? body.sourceId ?? "").trim();
  if (!targetId) return c.json({ error: "请选择封面图" }, 400);
  const target = getOne<CaseGroupImageRow>(
    appDb,
    `select case_group_images.id, case_group_images.group_id, case_group_images.user_id,
            case_group_images.image_id, case_group_images.asset_id, case_group_images.image_url,
            case_group_images.sort_order, case_group_images.is_cover,
            coalesce(images.image_width, assets.image_width, 0) as image_width,
            coalesce(images.image_height, assets.image_height, 0) as image_height,
            coalesce(images.image_file_size, assets.size, 0) as image_file_size
     from case_group_images
     left join images on images.id = case_group_images.image_id
     left join assets on assets.id = case_group_images.asset_id
     where case_group_images.group_id = ?
       and (case_group_images.id = ? or case_group_images.image_id = ? or case_group_images.asset_id = ? or case_group_images.image_url = ?)
     limit 1`,
    groupId,
    targetId,
    targetId,
    targetId,
    targetId
  );
  if (!target) return c.json({ error: "封面图不在当前灵感中" }, 404);
  const nextImageUrl = target.image_id ? imageUrlFromImageId(target.image_id) : target.asset_id ? assetUrlFromAssetId(target.asset_id) : target.image_url;
  const reviewState = caseReviewState(now());
  run(appDb, "update case_group_images set is_cover = 0 where group_id = ?", groupId);
  run(appDb, "update case_group_images set is_cover = 1 where id = ? and group_id = ?", target.id, groupId);
  run(
    appDb,
    `update case_items
     set image_id = ?, asset_id = ?, image_url = ?,
         review_status = ?, review_requested_at = ?, reviewed_at = ?, reviewed_by = ?, reject_reason = ''
     where group_id = ? and user_id = ?`,
    target.image_id,
    target.asset_id,
    nextImageUrl,
    reviewState.reviewStatus,
    reviewState.reviewRequestedAt,
    reviewState.reviewedAt,
    reviewState.reviewedBy,
    groupId,
    user.id
  );
  return c.json({ ok: true, groupId, coverImageId: target.image_id ?? target.asset_id ?? target.image_url, reviewStatus: reviewState.reviewStatus });
});

api.patch("/cases/:caseId", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const caseId = c.req.param("caseId");
  const body = await c.req.json().catch(() => ({}));
  const title = String(body.title ?? "").trim();
  const prompt = String(body.prompt ?? "").trim();
  const hasCategoryIds = Object.prototype.hasOwnProperty.call(body, "categoryIds");
  const hasCategoryId = Object.prototype.hasOwnProperty.call(body, "categoryId");
  const hasIncludeReferences = Object.prototype.hasOwnProperty.call(body, "includeReferences");
  const categoryIds = hasCategoryIds ? normalizeIdList(body.categoryIds) : normalizeIdList(body.categoryId);
  if (!title || !prompt) return c.json({ error: "请填写标题和描述" }, 400);
  const item = resolveOwnedCaseItem(caseId, user.id);
  if (!item) return c.json({ error: "灵感不存在" }, 404);
  const groupId = groupIdFromItem(item);
  const nextIncludeReferences = hasIncludeReferences ? (body.includeReferences !== false ? 1 : 0) : (item.include_references !== 0 ? 1 : 0);
  const reviewState = caseReviewState(now());
  if (!hasCategoryIds && !hasCategoryId) {
    run(
      appDb,
      `update case_items
       set title = ?, prompt = ?, include_references = ?,
           review_status = ?, review_requested_at = ?, reviewed_at = ?, reviewed_by = ?, reject_reason = ''
       where group_id = ? and user_id = ?`,
      title,
      prompt,
      nextIncludeReferences,
      reviewState.reviewStatus,
      reviewState.reviewRequestedAt,
      reviewState.reviewedAt,
      reviewState.reviewedBy,
      groupId,
      user.id
    );
    return c.json({ caseItems: [{ id: item.id, groupId, categoryIds: [item.category_id], title, prompt, reviewStatus: reviewState.reviewStatus }] });
  }
  const targetCategoryIds = categoryIds.length > 0 ? categoryIds : [UNCATEGORIZED_CASE_CATEGORY_ID];
  if (!ensureCategoryIds(targetCategoryIds, "case")) return c.json({ error: "灵感风格不存在" }, 400);

  const sourceRows = getAll<{ id: string; category_id: string; title: string; prompt: string; created_at: string }>(
    appDb,
    "select id, category_id, title, prompt, created_at from case_items where user_id = ? and group_id = ?",
    user.id,
    groupId
  );
  const rowsByCategory = new Map<string, { id: string; category_id: string; title: string; prompt: string; created_at: string }>();
  for (const row of sourceRows) rowsByCategory.set(row.category_id, row);
  const selectedCategoryIds = new Set(targetCategoryIds);
  const caseItems: Array<Record<string, string | string[]>> = [];
  const createdAt = sourceRows
    .map((row) => row.created_at)
    .filter(Boolean)
    .sort()[0] ?? now();
  const cover = coverGroupImage(groupId);
  const coverImageUrl = cover?.image_id ? imageUrlFromImageId(cover.image_id) : cover?.asset_id ? assetUrlFromAssetId(cover.asset_id) : cover?.image_url ?? item.image_url;
  for (const categoryId of targetCategoryIds) {
    const existing = rowsByCategory.get(categoryId);
    if (existing) {
      run(
        appDb,
        `update case_items
         set title = ?, prompt = ?, include_references = ?,
             review_status = ?, review_requested_at = ?, reviewed_at = ?, reviewed_by = ?, reject_reason = ''
         where id = ? and user_id = ?`,
        title,
        prompt,
        nextIncludeReferences,
        reviewState.reviewStatus,
        reviewState.reviewRequestedAt,
        reviewState.reviewedAt,
        reviewState.reviewedBy,
        existing.id,
        user.id
      );
      caseItems.push({ id: existing.id, groupId, categoryIds: targetCategoryIds, title, prompt, reviewStatus: reviewState.reviewStatus });
      continue;
    }
    const id = makeId("case");
    run(
      appDb,
      `insert into case_items (
        id, group_id, category_id, user_id, image_id, asset_id, include_references,
        review_status, review_requested_at, reviewed_at, reviewed_by, reject_reason,
        title, prompt, image_url, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      groupId,
      categoryId,
      user.id,
      cover?.image_id ?? item.image_id,
      cover?.asset_id ?? item.asset_id,
      nextIncludeReferences,
      reviewState.reviewStatus,
      reviewState.reviewRequestedAt,
      reviewState.reviewedAt,
      reviewState.reviewedBy,
      reviewState.rejectReason,
      title,
      prompt,
      coverImageUrl,
      createdAt
    );
    caseItems.push({ id, groupId, categoryIds: targetCategoryIds, title, prompt, reviewStatus: reviewState.reviewStatus });
  }
  for (const row of sourceRows) {
    if (!selectedCategoryIds.has(row.category_id)) run(appDb, "delete from case_items where id = ? and user_id = ?", row.id, user.id);
  }
  return c.json({ caseItems });
});

api.post("/cases/:caseId/review/submit", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const item = resolveOwnedCaseItem(c.req.param("caseId"), user.id);
  if (!item) return c.json({ error: "灵感不存在" }, 404);
  const groupId = groupIdFromItem(item);
  const reviewState = caseReviewState(now());
  run(
    appDb,
    `update case_items
     set review_status = ?, review_requested_at = ?, reviewed_at = ?, reviewed_by = ?, reject_reason = ''
     where group_id = ? and user_id = ?`,
    reviewState.reviewStatus,
    reviewState.reviewRequestedAt,
    reviewState.reviewedAt,
    reviewState.reviewedBy,
    groupId,
    user.id
  );
  return c.json({ ok: true, groupId, reviewStatus: reviewState.reviewStatus });
});

api.delete("/cases/:caseId", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const item = resolveOwnedCaseItem(c.req.param("caseId"), user.id);
  if (!item) return c.json({ error: "灵感不存在" }, 404);
  const groupId = groupIdFromItem(item);
  const source = caseUsageSourceFromCaseItem(item);
  run(
    appDb,
    "delete from case_favorites where source_user_id = ? and source_type = ? and source_id = ?",
    source.sourceUserId || "",
    source.sourceType,
    source.sourceId
  );
  run(appDb, "delete from case_group_images where group_id = ? and user_id = ?", groupId, user.id);
  run(appDb, "delete from case_items where group_id = ? and user_id = ?", groupId, user.id);
  return c.json({ ok: true });
});
}
