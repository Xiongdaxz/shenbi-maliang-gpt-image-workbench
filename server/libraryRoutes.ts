import type { Context } from "hono";
import { Hono } from "hono";
import { UNCATEGORIZED_CASE_CATEGORY_ID } from "./categories";
import { requireUser } from "./auth";
import { appDb, getAll, getOne } from "./db";
import { globalSwitchEnabled } from "./globalSwitches";
import {
  decodeLibraryCursor,
  libraryCursorWhere,
  libraryFilterSignature,
  libraryLimit,
  libraryPageInfo,
  type LibraryKind,
  type LibrarySortDirection
} from "./libraryCursor";
import { imageDateSearchConditions } from "./imageSearch";
import { assetUrlFromAssetId, imageUrlFromImageId } from "./serializers";
import type { AssetRow, ImageRow } from "./types";
import {
  approvedCaseSql,
  approvedSharedAssetSql,
  normalizeAssetShareStatus,
  normalizeAssetSpace,
  normalizeIdList,
  normalizeReviewStatus
} from "./utils";

type LibraryPageInfo = { limit: number; nextCursor: string | null; hasMore: boolean };
type FacetCacheEntry = { expiresAt: number; value: unknown };
type CategoryRow = { id: string; name: string; slug: string; sort_order?: number };

const facetCache = new Map<string, FacetCacheEntry>();
const FACET_CACHE_MS = 30_000;
const FACET_CACHE_MAX_ENTRIES = 2_000;
export function invalidateLibraryFacetCache(kind?: LibraryKind) {
  if (!kind) {
    facetCache.clear();
    return;
  }
  for (const key of facetCache.keys()) {
    if (key.includes(`:${kind}:`)) facetCache.delete(key);
  }
}

function cachedFacet<T>(key: string, load: () => T) {
  const cached = facetCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;
  if (cached) facetCache.delete(key);
  const value = load();
  while (facetCache.size >= FACET_CACHE_MAX_ENTRIES) {
    const oldestKey = facetCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    facetCache.delete(oldestKey);
  }
  facetCache.set(key, { expiresAt: Date.now() + FACET_CACHE_MS, value });
  return value;
}

function startLibraryTiming() {
  const startedAt = performance.now();
  return (c: Context, name: string) => {
    const duration = performance.now() - startedAt;
    c.header("Server-Timing", `${name};dur=${duration.toFixed(1)}`);
    if (duration >= 200) console.warn(`图库查询较慢：${name} ${duration.toFixed(1)}ms`);
  };
}

function invalidCursorResponse(c: Context, error: unknown) {
  return c.json({ error: error instanceof Error ? error.message : "图库游标无效" }, 400);
}

function categoryRows(type: "case" | "asset") {
  return getAll<CategoryRow>(
    appDb,
    "select id, name, slug, sort_order from case_categories where type = ? order by sort_order asc, rowid asc",
    type
  );
}

function imageListFilter(c: Context, userId: string) {
  const keyword = String(c.req.query("keyword") ?? "").trim().toLowerCase();
  const sort: LibrarySortDirection = String(c.req.query("sort") ?? "desc") === "asc" ? "asc" : "desc";
  const favoriteOnly = c.req.query("favoriteOnly") === "true" || c.req.query("favoriteOnly") === "1";
  const sessionId = String(c.req.query("sessionId") ?? "").trim();
  const anchorId = String(c.req.query("anchorId") ?? "").trim();
  const where = ["images.user_id = ?"];
  const params: Array<string | number> = [userId];
  if (sessionId) {
    where.push("images.session_id = ?");
    params.push(sessionId);
  }
  if (keyword) {
    const like = `%${keyword}%`;
    const kindClauses: string[] = [];
    const dateClauses: string[] = [];
    const dateParams: string[] = [];
    if ("生成".includes(keyword) || keyword.includes("生成")) kindClauses.push("images.kind = 'generation'");
    if ("编辑".includes(keyword) || keyword.includes("编辑")) kindClauses.push("images.kind = 'edit'");
    const dateSearch = imageDateSearchConditions(keyword, "images.created_at");
    dateClauses.push(...dateSearch.clauses);
    dateParams.push(...dateSearch.params);
    where.push(`(
      lower(images.prompt) like ? or lower(images.kind) like ? or lower(images.size) like ?
      or lower(images.quality) like ? or lower(images.provider_id) like ? or lower(images.created_at) like ?
      ${kindClauses.length ? `or ${kindClauses.join(" or ")}` : ""}
      ${dateClauses.length ? `or ${dateClauses.join(" or ")}` : ""}
    )`);
    params.push(like, like, like, like, like, like, ...dateParams);
  }
  if (favoriteOnly) {
    where.push("exists (select 1 from image_favorites where image_favorites.user_id = ? and image_favorites.image_id = images.id)");
    params.push(userId);
  }
  return { keyword, sort, favoriteOnly, sessionId, anchorId, where: where.join(" and "), params };
}

function imageCard(row: ImageRow, favorite: { favorite_count: number; current_user_favorited: number } | undefined) {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.prompt,
    prompt: row.prompt,
    thumbnailUrl: imageUrlFromImageId(row.id, "thumb"),
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    imageFileSize: row.image_file_size,
    kind: row.kind === "edit" ? "edit" as const : "generation" as const,
    size: row.size,
    quality: row.quality,
    providerId: row.provider_id,
    favoriteCount: Number(favorite?.favorite_count ?? 0),
    favorited: Boolean(favorite?.current_user_favorited),
    createdAt: row.created_at,
    sourceType: "image" as const,
    sourceId: row.id
  };
}

function assetListFilter(c: Context, userId: string, options: { includeSpace?: boolean; includeCategories?: boolean } = {}) {
  const keyword = String(c.req.query("keyword") ?? "").trim().toLowerCase();
  const categoryIds = normalizeIdList(c.req.query("categoryIds") ?? c.req.query("categoryId"));
  const requestedSpace = String(c.req.query("space") ?? "all").trim();
  const space = requestedSpace === "shared" || requestedSpace === "private" ? requestedSpace : "all";
  const where = [`(assets.user_id = ? or ${approvedSharedAssetSql("assets")})`];
  const params: Array<string | number> = [userId];
  if ((options.includeSpace ?? true) && space === "shared") where.push(approvedSharedAssetSql("assets"));
  if ((options.includeSpace ?? true) && space === "private") {
    where.push("assets.user_id = ? and assets.space = 'private'");
    params.push(userId);
  }
  if ((options.includeCategories ?? true) && categoryIds.length > 0) {
    where.push(`exists (
      select 1 from asset_categories ac_filter
      where ac_filter.asset_id = assets.id and ac_filter.category_id in (${categoryIds.map(() => "?").join(", ")})
    )`);
    params.push(...categoryIds);
  }
  if (keyword) {
    const like = `%${keyword}%`;
    const labelClauses: string[] = [];
    if ("共享".includes(keyword) || keyword.includes("共享")) labelClauses.push(approvedSharedAssetSql("assets"));
    if ("我的".includes(keyword) || keyword.includes("我的")) labelClauses.push("(assets.user_id = ? and assets.space = 'private')");
    if ("待审核".includes(keyword) || keyword.includes("待审核")) labelClauses.push("(assets.user_id = ? and assets.share_status = 'pending')");
    if ("审核未通过".includes(keyword) || keyword.includes("未通过")) labelClauses.push("(assets.user_id = ? and assets.share_status = 'rejected')");
    where.push(`(
      lower(assets.name) like ? or lower(coalesce(users.username, '')) like ?
      or lower(assets.space) like ? or lower(coalesce(assets.share_status, '')) like ?
      or exists (
        select 1 from asset_categories ac_keyword
        join case_categories cc_keyword on cc_keyword.id = ac_keyword.category_id
        where ac_keyword.asset_id = assets.id and cc_keyword.type = 'asset' and lower(cc_keyword.name) like ?
      )
      ${labelClauses.length > 0 ? `or ${labelClauses.join(" or ")}` : ""}
    )`);
    params.push(like, like, like, like, like);
    if (labelClauses.some((clause) => clause.includes("assets.space = 'private'"))) params.push(userId);
    if (labelClauses.some((clause) => clause.includes("share_status = 'pending'"))) params.push(userId);
    if (labelClauses.some((clause) => clause.includes("share_status = 'rejected'"))) params.push(userId);
  }
  return { keyword, categoryIds, space, where: where.join(" and "), params };
}

function assetCategoryMap(assetIds: string[]) {
  const result = new Map<string, Array<{ id: string; name: string }>>();
  if (assetIds.length === 0) return result;
  const rows = getAll<{ asset_id: string; id: string; name: string }>(
    appDb,
    `select asset_categories.asset_id, case_categories.id, case_categories.name
     from asset_categories join case_categories on case_categories.id = asset_categories.category_id
     where asset_categories.asset_id in (${assetIds.map(() => "?").join(", ")})
     order by case_categories.sort_order asc, case_categories.rowid asc`,
    ...assetIds
  );
  for (const row of rows) {
    const items = result.get(row.asset_id) ?? [];
    items.push({ id: row.id, name: row.name });
    result.set(row.asset_id, items);
  }
  return result;
}

function assetCard(row: AssetRow, categories: Array<{ id: string; name: string }>, userId: string) {
  const space = normalizeAssetSpace(row.space);
  const shareStatus = normalizeAssetShareStatus(row.share_status);
  return {
    id: row.id,
    title: row.name,
    name: row.name,
    thumbnailUrl: assetUrlFromAssetId(row.id, "thumb"),
    mimeType: row.mime_type,
    size: row.size,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    createdAt: row.created_at,
    sourceUsername: row.source_username ?? "未知用户",
    canEdit: row.user_id === userId,
    space,
    shared: shareStatus === "approved" && (space === "shared" || Boolean(row.shared)),
    shareStatus,
    shareRequestedAt: row.share_requested_at ?? "",
    shareReviewedAt: row.share_reviewed_at ?? "",
    shareRejectReason: row.share_reject_reason ?? "",
    categoryIds: categories.map((category) => category.id),
    categoryNames: categories.map((category) => category.name),
    sourceType: "asset" as const,
    sourceId: row.id
  };
}

type CaseListRow = {
  id: string;
  case_item_id: string;
  createdAt: string;
  title: string;
  prompt: string;
  user_id: string | null;
  source_username: string | null;
  image_id: string | null;
  asset_id: string | null;
  image_url: string;
  image_width: number;
  image_height: number;
  image_file_size: number;
  include_references: number;
  review_status: string;
  review_requested_at: string | null;
  reviewed_at: string | null;
  reject_reason: string | null;
};

function caseFilter(c: Context) {
  return {
    keyword: String(c.req.query("keyword") ?? "").trim().toLowerCase(),
    categoryIds: normalizeIdList(c.req.query("categoryIds") ?? c.req.query("categoryId")),
    mineOnly: c.req.query("mineOnly") === "true" || c.req.query("mineOnly") === "1",
    favoriteOnly: c.req.query("favoriteOnly") === "true" || c.req.query("favoriteOnly") === "1"
  };
}

function caseListRows(c: Context, userId: string, limit: number, cursorValue?: string) {
  const filters = caseFilter(c);
  const signature = libraryFilterSignature("cases", filters);
  const cursor = decodeLibraryCursor(cursorValue, { kind: "cases", signature, sort: "desc" });
  const params: Array<string | number> = [];
  const activeSql = filters.mineOnly ? "case_items.user_id = ?" : approvedCaseSql("case_items");
  if (filters.mineOnly) params.push(userId);
  const filterClauses: string[] = [];
  if (filters.categoryIds.length > 0) {
    const categoryVisibilitySql = filters.mineOnly ? "ci_category.user_id = ?" : approvedCaseSql("ci_category");
    filterClauses.push(`coalesce(nullif(case_items.group_id, ''), case_items.id) in (
      select coalesce(nullif(ci_category.group_id, ''), ci_category.id) from case_items ci_category
      where ci_category.category_id in (${filters.categoryIds.map(() => "?").join(", ")})
        and ${categoryVisibilitySql}
    )`);
    params.push(...filters.categoryIds);
    if (filters.mineOnly) params.push(userId);
  }
  if (filters.keyword) {
    const like = `%${filters.keyword}%`;
    const keywordVisibilitySql = filters.mineOnly ? "ci_keyword.user_id = ?" : approvedCaseSql("ci_keyword");
    filterClauses.push(`(
      lower(case_items.title) like ? or lower(case_items.prompt) like ?
      or coalesce(nullif(case_items.group_id, ''), case_items.id) in (
        select coalesce(nullif(ci_keyword.group_id, ''), ci_keyword.id) from case_items ci_keyword
        join case_categories cc_keyword on cc_keyword.id = ci_keyword.category_id
        where lower(cc_keyword.name) like ?
          and ${keywordVisibilitySql}
      )
    )`);
    params.push(like, like, like);
    if (filters.mineOnly) params.push(userId);
  }
  const newerActiveSql = filters.mineOnly ? "newer.user_id = ?" : approvedCaseSql("newer");
  const representativeSql = `and (
    coalesce(case_items.group_id, '') = '' or not exists (
      select 1 from case_items newer
      where newer.group_id = case_items.group_id and ${newerActiveSql}
        and (newer.created_at > case_items.created_at or (newer.created_at = case_items.created_at and newer.id > case_items.id))
    )
  )`;
  if (filters.mineOnly) params.push(userId);
  const groupKeySql = "coalesce(nullif(case_items.group_id, ''), case_items.id)";
  const multiImageSql = `exists (
    select 1 from case_group_images cgi_multi where cgi_multi.group_id = ${groupKeySql} limit 1 offset 1
  )`;
  const favoriteSql = filters.favoriteOnly
    ? `and exists (
         select 1 from case_favorites cf
         where cf.user_id = ? and coalesce(cf.source_user_id, '') = coalesce(case_items.user_id, '')
           and (
             (${multiImageSql} and cf.source_type = 'case_group' and cf.source_id = ${groupKeySql})
             or (not ${multiImageSql} and (
               (cf.source_type = 'image' and cf.source_id = case_items.image_id)
               or (cf.source_type = 'asset' and cf.source_id = case_items.asset_id)
               or (cf.source_type = 'url' and cf.source_id = case_items.image_url)
             ))
           )
       )`
    : "";
  if (filters.favoriteOnly) params.push(userId);
  const cursorWhere = libraryCursorWhere(cursor, { createdAt: "case_items.created_at", id: groupKeySql }, "desc");
  const rows = getAll<CaseListRow>(
    appDb,
    `select ${groupKeySql} as id, case_items.id as case_item_id, case_items.created_at as createdAt,
            case_items.title, case_items.prompt, case_items.user_id, users.username as source_username,
            case_items.image_id, case_items.asset_id, case_items.image_url,
            coalesce(images.image_width, assets.image_width, 0) as image_width,
            coalesce(images.image_height, assets.image_height, 0) as image_height,
            coalesce(images.image_file_size, assets.size, 0) as image_file_size,
            coalesce(case_items.include_references, 1) as include_references,
            coalesce(case_items.review_status, 'approved') as review_status,
            case_items.review_requested_at, case_items.reviewed_at, case_items.reject_reason
     from case_items
     left join users on users.id = case_items.user_id
     left join images on images.id = case_items.image_id
     left join assets on assets.id = case_items.asset_id
     where ${activeSql}${filterClauses.length ? ` and ${filterClauses.join(" and ")}` : ""}
       ${representativeSql} ${favoriteSql}${cursorWhere.sql}
     order by case_items.created_at desc, ${groupKeySql} desc
     limit ?`,
    ...params,
    ...cursorWhere.params,
    limit + 1
  );
  return { filters, signature, rows };
}

function caseCategoriesByGroup(groupIds: string[], options: { userId?: string; mineOnly?: boolean } = {}) {
  const result = new Map<string, Array<{ id: string; name: string }>>();
  if (groupIds.length === 0) return result;
  const visibilitySql = options.mineOnly && options.userId ? "case_items.user_id = ?" : approvedCaseSql("case_items");
  const rows = getAll<{ group_id: string; id: string; name: string }>(
    appDb,
    `select distinct coalesce(nullif(case_items.group_id, ''), case_items.id) as group_id,
            case_categories.id, case_categories.name, case_categories.sort_order
     from case_items join case_categories on case_categories.id = case_items.category_id
     where coalesce(nullif(case_items.group_id, ''), case_items.id) in (${groupIds.map(() => "?").join(", ")})
       and case_categories.type = 'case' and case_categories.id <> ?
       and ${visibilitySql}
     order by case_categories.sort_order asc`,
    ...groupIds,
    UNCATEGORIZED_CASE_CATEGORY_ID,
    ...(options.mineOnly && options.userId ? [options.userId] : [])
  );
  for (const row of rows) {
    const items = result.get(row.group_id) ?? [];
    items.push({ id: row.id, name: row.name });
    result.set(row.group_id, items);
  }
  return result;
}

function caseCovers(groupIds: string[]) {
  const result = new Map<string, { image_id: string | null; asset_id: string | null; image_url: string; image_width: number; image_height: number; image_file_size: number; group_image_count: number }>();
  if (groupIds.length === 0) return result;
  const rows = getAll<{ group_id: string; image_id: string | null; asset_id: string | null; image_url: string; image_width: number; image_height: number; image_file_size: number; group_image_count: number; cover_rank: number }>(
    appDb,
    `select * from (
       select case_group_images.group_id, case_group_images.image_id, case_group_images.asset_id, case_group_images.image_url,
              coalesce(images.image_width, assets.image_width, 0) as image_width,
              coalesce(images.image_height, assets.image_height, 0) as image_height,
              coalesce(images.image_file_size, assets.size, 0) as image_file_size,
              count(*) over (partition by case_group_images.group_id) as group_image_count,
              row_number() over (partition by case_group_images.group_id
                order by case_group_images.is_cover desc, case_group_images.sort_order asc, case_group_images.id asc) as cover_rank
       from case_group_images
       left join images on images.id = case_group_images.image_id
       left join assets on assets.id = case_group_images.asset_id
       where case_group_images.group_id in (${groupIds.map(() => "?").join(", ")})
     ) where cover_rank = 1`,
    ...groupIds
  );
  rows.forEach((row) => result.set(row.group_id, row));
  return result;
}

type CaseCover = ReturnType<typeof caseCovers> extends Map<string, infer T> ? T : never;
type CaseSource = { sourceUserId: string; sourceType: "image" | "asset" | "url" | "case_group"; sourceId: string };
type CaseEngagement = { useCount: number; favoriteCount: number; favorited: boolean };

function caseSource(row: CaseListRow, cover: CaseCover | undefined): CaseSource {
  if ((cover?.group_image_count ?? 0) > 1) {
    return { sourceUserId: row.user_id ?? "", sourceType: "case_group", sourceId: row.id };
  }
  const imageId = cover?.image_id ?? row.image_id;
  if (imageId) return { sourceUserId: row.user_id ?? "", sourceType: "image", sourceId: imageId };
  const assetId = cover?.asset_id ?? row.asset_id;
  if (assetId) return { sourceUserId: row.user_id ?? "", sourceType: "asset", sourceId: assetId };
  return { sourceUserId: row.user_id ?? "", sourceType: "url", sourceId: cover?.image_url || row.image_url };
}

function caseSourceKey(source: CaseSource) {
  return `${source.sourceUserId}\u0000${source.sourceType}\u0000${source.sourceId}`;
}

function caseEngagementBySource(sources: CaseSource[], userId: string) {
  const uniqueSources = Array.from(new Map(sources.map((source) => [caseSourceKey(source), source])).values());
  const result = new Map<string, CaseEngagement>();
  if (uniqueSources.length === 0) return result;
  const tuples = uniqueSources.map(() => "(?, ?, ?)").join(", ");
  const params = uniqueSources.flatMap((source) => [source.sourceUserId, source.sourceType, source.sourceId]);
  const usageRows = getAll<{ source_user_id: string | null; source_type: CaseSource["sourceType"]; source_id: string; count: number }>(
    appDb,
    `select coalesce(source_user_id, '') as source_user_id, source_type, source_id, count(*) as count
     from case_prompt_usage_events
     where (coalesce(source_user_id, ''), source_type, source_id) in (${tuples})
     group by coalesce(source_user_id, ''), source_type, source_id`,
    ...params
  );
  const favoriteRows = getAll<{ source_user_id: string | null; source_type: CaseSource["sourceType"]; source_id: string; count: number; favorited: number }>(
    appDb,
    `select coalesce(source_user_id, '') as source_user_id, source_type, source_id, count(*) as count,
            max(case when user_id = ? then 1 else 0 end) as favorited
     from case_favorites
     where (coalesce(source_user_id, ''), source_type, source_id) in (${tuples})
     group by coalesce(source_user_id, ''), source_type, source_id`,
    userId,
    ...params
  );
  for (const source of uniqueSources) result.set(caseSourceKey(source), { useCount: 0, favoriteCount: 0, favorited: false });
  for (const row of usageRows) {
    const key = caseSourceKey({ sourceUserId: row.source_user_id ?? "", sourceType: row.source_type, sourceId: row.source_id });
    const current = result.get(key);
    if (current) current.useCount = Number(row.count ?? 0);
  }
  for (const row of favoriteRows) {
    const key = caseSourceKey({ sourceUserId: row.source_user_id ?? "", sourceType: row.source_type, sourceId: row.source_id });
    const current = result.get(key);
    if (current) {
      current.favoriteCount = Number(row.count ?? 0);
      current.favorited = Boolean(row.favorited);
    }
  }
  return result;
}

function caseCard(row: CaseListRow, categories: Array<{ id: string; name: string }>, cover: CaseCover | undefined, userId: string, engagement: CaseEngagement) {
  const imageId = cover?.image_id ?? row.image_id;
  const assetId = cover?.asset_id ?? row.asset_id;
  const externalUrl = cover?.image_url || row.image_url;
  const source = caseSource(row, cover);
  const thumbnailUrl = imageId
    ? imageUrlFromImageId(imageId, "thumb")
    : assetId
      ? assetUrlFromAssetId(assetId, "thumb")
      : externalUrl;
  return {
    id: row.id,
    caseItemId: row.case_item_id,
    groupId: row.id,
    title: row.title,
    prompt: row.prompt,
    thumbnailUrl,
    imageWidth: cover?.image_width ?? row.image_width,
    imageHeight: cover?.image_height ?? row.image_height,
    imageFileSize: cover?.image_file_size ?? row.image_file_size,
    useCount: engagement.useCount,
    favoriteCount: engagement.favoriteCount,
    favorited: engagement.favorited,
    sourceUsername: row.source_username ?? "未知用户",
    canDelete: row.user_id === userId,
    categoryIds: categories.map((category) => category.id),
    categoryNames: categories.map((category) => category.name),
    includeReferences: row.include_references !== 0,
    reviewStatus: normalizeReviewStatus(row.review_status),
    reviewRequestedAt: row.review_requested_at ?? "",
    reviewedAt: row.reviewed_at ?? "",
    rejectReason: row.reject_reason ?? "",
    imageCount: Math.max(1, cover?.group_image_count ?? 1),
    downloadSourceType: imageId ? "image" as const : assetId ? "asset" as const : null,
    downloadSourceId: imageId ?? assetId ?? null,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    createdAt: row.createdAt
  };
}

function libraryResponse<T>(c: Context, name: string, finish: (c: Context, name: string) => void, items: T[], pageInfo: LibraryPageInfo) {
  finish(c, name);
  return c.json({ items, pageInfo });
}

export function registerLibraryRoutes(api: Hono) {
  for (const kind of ["images", "assets", "cases"] as const) {
    api.use(`/${kind}/*`, async (c, next) => {
      await next();
      if (c.req.method !== "GET" && c.res.status < 400) invalidateLibraryFacetCache(kind);
    });
  }

  api.get("/library/images", async (c) => {
    const finish = startLibraryTiming();
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const filter = imageListFilter(c, user.id);
    const signature = libraryFilterSignature("images", {
      keyword: filter.keyword,
      favoriteOnly: filter.favoriteOnly,
      sessionId: filter.sessionId,
      anchorId: filter.anchorId,
      sort: filter.sort
    });
    let cursor;
    try {
      cursor = decodeLibraryCursor(c.req.query("cursor"), { kind: "images", signature, sort: filter.sort });
    } catch (error) {
      return invalidCursorResponse(c, error);
    }
    const limit = libraryLimit(c.req.query("limit"));
    const cursorWhere = libraryCursorWhere(cursor, { createdAt: "images.created_at", id: "images.id" }, filter.sort);
    const anchor = !cursor && filter.anchorId
      ? getOne<{ id: string; created_at: string }>(
          appDb,
          `select images.id, images.created_at from images where ${filter.where} and images.id = ?`,
          ...filter.params,
          filter.anchorId
        )
      : null;
    if (!cursor && filter.anchorId && !anchor) {
      return libraryResponse(c, "library-images", finish, [], { limit, nextCursor: null, hasMore: false });
    }
    const anchorWhere = anchor
      ? filter.sort === "asc"
        ? { sql: " and (images.created_at > ? or (images.created_at = ? and images.id >= ?))", params: [anchor.created_at, anchor.created_at, anchor.id] }
        : { sql: " and (images.created_at < ? or (images.created_at = ? and images.id <= ?))", params: [anchor.created_at, anchor.created_at, anchor.id] }
      : { sql: "", params: [] as string[] };
    const rows = getAll<ImageRow>(
      appDb,
      `select images.* from images where ${filter.where}${anchorWhere.sql}${cursorWhere.sql}
       order by images.created_at ${filter.sort}, images.id ${filter.sort} limit ?`,
      ...filter.params,
      ...anchorWhere.params,
      ...cursorWhere.params,
      limit + 1
    );
    const page = libraryPageInfo(
      rows.map((row) => ({ ...row, id: row.id, createdAt: row.created_at })),
      limit,
      { kind: "images", signature, sort: filter.sort }
    );
    const favoriteRows = page.items.length
      ? getAll<{ image_id: string; favorite_count: number; current_user_favorited: number }>(
          appDb,
          `select image_id, count(*) as favorite_count,
                  max(case when user_id = ? then 1 else 0 end) as current_user_favorited
           from image_favorites where image_id in (${page.items.map(() => "?").join(", ")}) group by image_id`,
          user.id,
          ...page.items.map((row) => row.id)
        )
      : [];
    const favorites = new Map(favoriteRows.map((row) => [row.image_id, row]));
    return libraryResponse(c, "library-images", finish, page.items.map((row) => imageCard(row, favorites.get(row.id))), page.pageInfo);
  });

  api.get("/library/images/facets", async (c) => {
    const finish = startLibraryTiming();
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const filter = imageListFilter(c, user.id);
    const baseFilter = imageListFilter(c, user.id);
    const baseWhere = baseFilter.where.replace(/ and exists \(select 1 from image_favorites[\s\S]*?images\.id\)$/, "");
    const baseParams = filter.favoriteOnly ? baseFilter.params.slice(0, -1) : baseFilter.params;
    const key = `${user.id}:images:${libraryFilterSignature("images", { keyword: filter.keyword, sessionId: filter.sessionId })}`;
    const value = cachedFacet(key, () => {
      const counts = getOne<{ all_count: number; favorite_count: number }>(
        appDb,
        `select count(*) as all_count,
                count(case when exists (
                  select 1 from image_favorites where image_favorites.user_id = ? and image_favorites.image_id = images.id
                ) then 1 end) as favorite_count
         from images where ${baseWhere}`,
        user.id,
        ...baseParams,
      );
      return { all: counts?.all_count ?? 0, favorite: counts?.favorite_count ?? 0 };
    });
    finish(c, "library-image-facets");
    return c.json(value);
  });

  api.get("/library/assets", async (c) => {
    const finish = startLibraryTiming();
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const filter = assetListFilter(c, user.id);
    const signature = libraryFilterSignature("assets", {
      keyword: filter.keyword,
      categoryIds: filter.categoryIds,
      space: filter.space
    });
    let cursor;
    try {
      cursor = decodeLibraryCursor(c.req.query("cursor"), { kind: "assets", signature, sort: "desc" });
    } catch (error) {
      return invalidCursorResponse(c, error);
    }
    const limit = libraryLimit(c.req.query("limit"));
    const cursorWhere = libraryCursorWhere(cursor, { createdAt: "assets.created_at", id: "assets.id" }, "desc");
    const rows = getAll<AssetRow>(
      appDb,
      `select assets.*, users.username as source_username
       from assets left join users on users.id = assets.user_id
       where ${filter.where}${cursorWhere.sql}
       order by assets.created_at desc, assets.id desc limit ?`,
      ...filter.params,
      ...cursorWhere.params,
      limit + 1
    );
    const page = libraryPageInfo(
      rows.map((row) => ({ ...row, id: row.id, createdAt: row.created_at })),
      limit,
      { kind: "assets", signature, sort: "desc" }
    );
    const categories = assetCategoryMap(page.items.map((row) => row.id));
    return libraryResponse(c, "library-assets", finish, page.items.map((row) => assetCard(row, categories.get(row.id) ?? [], user.id)), page.pageInfo);
  });

  api.get("/library/assets/facets", async (c) => {
    const finish = startLibraryTiming();
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const current = assetListFilter(c, user.id);
    const key = `${user.id}:assets:${libraryFilterSignature("assets", { keyword: current.keyword, categoryIds: current.categoryIds, space: current.space })}`;
    const value = cachedFacet(key, () => {
      const tagBase = assetListFilter(c, user.id, { includeCategories: false });
      const spaceBase = assetListFilter(c, user.id, { includeSpace: false });
      const tagRows = getAll<{ category_id: string | null; count: number }>(
        appDb,
        `select asset_categories.category_id, count(distinct assets.id) as count
         from assets left join users on users.id = assets.user_id
         left join asset_categories on asset_categories.asset_id = assets.id
         where ${tagBase.where} group by asset_categories.category_id`,
        ...tagBase.params
      );
      const tagAll = getOne<{ count: number }>(
        appDb,
        `select count(*) as count from assets left join users on users.id = assets.user_id where ${tagBase.where}`,
        ...tagBase.params
      )?.count ?? 0;
      const spaces = getOne<{ all_count: number; shared_count: number; private_count: number }>(
        appDb,
        `select count(distinct assets.id) as all_count,
                count(distinct case when ${approvedSharedAssetSql("assets")} then assets.id end) as shared_count,
                count(distinct case when assets.user_id = ? and assets.space = 'private' then assets.id end) as private_count
         from assets left join users on users.id = assets.user_id where ${spaceBase.where}`,
        user.id,
        ...spaceBase.params
      );
      return {
        tags: { all: tagAll, byCategory: Object.fromEntries(tagRows.filter((row) => row.category_id).map((row) => [row.category_id!, row.count])) },
        spaces: { all: spaces?.all_count ?? 0, shared: spaces?.shared_count ?? 0, private: spaces?.private_count ?? 0 }
      };
    });
    finish(c, "library-asset-facets");
    return c.json(value);
  });

  api.get("/library/cases", async (c) => {
    const finish = startLibraryTiming();
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const limit = libraryLimit(c.req.query("limit"));
    let loaded;
    try {
      loaded = caseListRows(c, user.id, limit, c.req.query("cursor"));
    } catch (error) {
      return invalidCursorResponse(c, error);
    }
    const page = libraryPageInfo(loaded.rows, limit, { kind: "cases", signature: loaded.signature, sort: "desc" });
    const groupIds = page.items.map((row) => row.id);
    const categories = caseCategoriesByGroup(groupIds, { userId: user.id, mineOnly: loaded.filters.mineOnly });
    const covers = caseCovers(groupIds);
    const sources = page.items.map((row) => caseSource(row, covers.get(row.id)));
    const engagements = caseEngagementBySource(sources, user.id);
    return libraryResponse(
      c,
      "library-cases",
      finish,
      page.items.map((row) => {
        const cover = covers.get(row.id);
        const source = caseSource(row, cover);
        return caseCard(
          row,
          categories.get(row.id) ?? [],
          cover,
          user.id,
          engagements.get(caseSourceKey(source)) ?? { useCount: 0, favoriteCount: 0, favorited: false }
        );
      }),
      page.pageInfo
    );
  });

  api.get("/library/cases/facets", async (c) => {
    const finish = startLibraryTiming();
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const keyword = String(c.req.query("keyword") ?? "").trim().toLowerCase();
    const like = `%${keyword}%`;
    const publicKeywordSql = keyword
      ? `and (lower(ci.title) like ? or lower(ci.prompt) like ? or coalesce(nullif(ci.group_id, ''), ci.id) in (
           select coalesce(nullif(ck.group_id, ''), ck.id) from case_items ck join case_categories cc on cc.id = ck.category_id
           where lower(cc.name) like ?
             and ${approvedCaseSql("ck")}
         ))`
      : "";
    const publicKeywordParams = keyword ? [like, like, like] : [];
    const mineKeywordSql = keyword
      ? `and (lower(ci.title) like ? or lower(ci.prompt) like ? or coalesce(nullif(ci.group_id, ''), ci.id) in (
           select coalesce(nullif(ck.group_id, ''), ck.id) from case_items ck join case_categories cc on cc.id = ck.category_id
           where lower(cc.name) like ? and ck.user_id = ?
         ))`
      : "";
    const mineKeywordParams = keyword ? [like, like, like, user.id] : [];
    const key = `${user.id}:cases:${libraryFilterSignature("cases", { keyword })}`;
    const value = cachedFacet(key, () => {
      const groupKeySql = "coalesce(nullif(ci.group_id, ''), ci.id)";
      const multiImageSql = `exists (
        select 1 from case_group_images cgi_multi where cgi_multi.group_id = ${groupKeySql} limit 1 offset 1
      )`;
      const favoriteSql = `and exists (
        select 1 from case_favorites cf
        where cf.user_id = ? and coalesce(cf.source_user_id, '') = coalesce(ci.user_id, '')
          and (
            (${multiImageSql} and cf.source_type = 'case_group' and cf.source_id = ${groupKeySql})
            or (not ${multiImageSql} and (
              (cf.source_type = 'image' and cf.source_id = ci.image_id)
              or (cf.source_type = 'asset' and cf.source_id = ci.asset_id)
              or (cf.source_type = 'url' and cf.source_id = ci.image_url)
            ))
          )
      )`;
      const all = getOne<{ count: number }>(
        appDb,
        `select count(distinct ${groupKeySql}) as count from case_items ci
         where ${approvedCaseSql("ci")} ${publicKeywordSql}`,
        ...publicKeywordParams
      )?.count ?? 0;
      const mine = getOne<{ count: number }>(
        appDb,
        `select count(distinct ${groupKeySql}) as count from case_items ci
         where ci.user_id = ? ${mineKeywordSql}`,
        user.id,
        ...mineKeywordParams
      )?.count ?? 0;
      const favorite = getOne<{ count: number }>(
        appDb,
        `select count(distinct ${groupKeySql}) as count from case_items ci
         where ${approvedCaseSql("ci")} ${publicKeywordSql} ${favoriteSql}`,
        ...publicKeywordParams,
        user.id
      )?.count ?? 0;
      const categoryCounts = getAll<{ category_id: string; count: number }>(
        appDb,
        `select ci.category_id, count(distinct ${groupKeySql}) as count
         from case_items ci
         where ${approvedCaseSql("ci")} and ci.category_id <> ? ${publicKeywordSql}
         group by ci.category_id`,
        UNCATEGORIZED_CASE_CATEGORY_ID,
        ...publicKeywordParams
      );
      const countByCategory = new Map(categoryCounts.map((row) => [row.category_id, Number(row.count ?? 0)]));
      const categories = categoryRows("case").filter((category) => category.id !== UNCATEGORIZED_CASE_CATEGORY_ID);
      return {
        all,
        mine,
        favorite,
        byCategory: Object.fromEntries(categories.map((category) => [category.id, countByCategory.get(category.id) ?? 0]))
      };
    });
    finish(c, "library-case-facets");
    return c.json(value);
  });

  api.get("/cases/categories", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    return c.json({ categories: categoryRows("case").map(({ sort_order: _sortOrder, ...category }) => ({ ...category, items: [] })) });
  });

  api.get("/cases/starter", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const limit = Math.min(20, libraryLimit(c.req.query("limit")));
    const excludedIds = new Set(normalizeIdList(c.req.query("excludeIds")).slice(0, 60));
    const allCandidates = caseListRows(c, user.id, 60).rows.slice(0, 60);
    const availableCandidates = allCandidates.filter((item) => !excludedIds.has(item.id));
    const candidates = availableCandidates.length >= limit
      ? availableCandidates
      : [...availableCandidates, ...allCandidates.filter((item) => excludedIds.has(item.id))];
    const candidateCategories = caseCategoriesByGroup(candidates.map((item) => item.id));
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    const selected: typeof candidates = [];
    const styles = new Set<string>();
    const ids = new Set<string>();
    for (const item of shuffled) {
      if (selected.length >= limit) break;
      const nextStyle = (candidateCategories.get(item.id) ?? []).find((category) => !styles.has(category.id));
      if (ids.has(item.id) || !nextStyle) continue;
      selected.push(item);
      ids.add(item.id);
      styles.add(nextStyle.id);
    }
    for (const item of shuffled) {
      if (selected.length >= limit) break;
      if (ids.has(item.id)) continue;
      selected.push(item);
      ids.add(item.id);
    }
    const covers = caseCovers(selected.map((item) => item.id));
    const sources = selected.map((item) => caseSource(item, covers.get(item.id)));
    const engagements = caseEngagementBySource(sources, user.id);
    return c.json({
      items: selected.map((item) => {
        const cover = covers.get(item.id);
        const source = caseSource(item, cover);
        return caseCard(
          item,
          candidateCategories.get(item.id) ?? [],
          cover,
          user.id,
          engagements.get(caseSourceKey(source)) ?? { useCount: 0, favoriteCount: 0, favorited: false }
        );
      })
    });
  });
}
