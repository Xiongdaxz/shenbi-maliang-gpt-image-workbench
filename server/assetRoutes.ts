import type { Context, Hono } from "hono";
import { createHash } from "node:crypto";
import { ensureCategoryIds, makeCategorySlug } from "./categories";
import { caseMaterialSourceById } from "./caseMaterialSources";
import { appDb, getAll, getOne, run } from "./db";
import { globalSwitchEnabled } from "./globalSwitches";
import { readImageDimensions } from "./imageDimensions";
import { imageExtensionFromMime } from "./imageFiles";
import { pageInfo, paginationFromQuery } from "./pagination";
import { generatePromptSummaryTitle } from "./promptTitle";
import { deleteStoredFilesIfUnreferenced, readStoredFile, secureAssetPath, writeEncryptedFile } from "./secureFiles";
import { assetUrlFromAssetId, imageOriginPromptsByImageIds } from "./serializers";
import { deleteImageDerivativesForSources, imageDerivativePathsForSources, warmImageDerivatives } from "./imageDerivatives";
import type { AssetRow, AssetSpace, ImageRow } from "./types";
import {
  approvedSharedAssetSql,
  makeId,
  normalizeAssetNameInput,
  normalizeAssetShareStatus,
  normalizeAssetSpace,
  normalizeAssetUploadMode,
  normalizeIdList,
  now,
  visibleAssetSql
} from "./utils";
import { requireUser } from "./auth";
import { imageBatchResult, parseImageBatchIds } from "./imageBatch";
import { suggestAssetCategoryIds } from "./assetSuggestions";

const DEFAULT_ASSET_NAME_MAX_LENGTH = 18;

function assetContentHash(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function assetContentHashFromPath(relativePath: string) {
  try {
    return assetContentHash(await readStoredFile(relativePath));
  } catch {
    return "";
  }
}

function defaultAssetNameFromPrompt(prompt: string) {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  const firstSentence = normalized.match(/^(.+?)([。！？!?；;.]|$)/)?.[1]?.trim() || normalized;
  const seed = firstSentence || "素材图片";
  const chars = Array.from(seed);
  return chars.length > DEFAULT_ASSET_NAME_MAX_LENGTH ? `${chars.slice(0, DEFAULT_ASSET_NAME_MAX_LENGTH).join("")}...` : seed;
}

async function generateAssetNameFromPrompt(prompt: string) {
  return generatePromptSummaryTitle(prompt, {
    fallbackTitle: defaultAssetNameFromPrompt(prompt),
    logLabel: "素材名称自动生成失败",
    logSource: "asset-name",
    maxLength: DEFAULT_ASSET_NAME_MAX_LENGTH,
    systemPrompt: "你是素材库命名助手。请把生图提示词精简成一个中文素材名称，让用户一眼知道素材主体、用途或场景。名称应简短清晰，4到16个字。只输出名称，不要扩展名、引号、标点、说明或 Markdown。",
    userLabel: "生图提示词",
    temperature: 0.25
  });
}

export function registerAssetRoutes(api: Hono) {
function assetCategoryMap(assetIds: string[]) {
  const map = new Map<string, Array<{ id: string; name: string }>>();
  if (assetIds.length === 0) return map;
  const rows = getAll<{ asset_id: string; id: string; name: string }>(
    appDb,
    `select asset_categories.asset_id, case_categories.id, case_categories.name
     from asset_categories
     join case_categories on case_categories.id = asset_categories.category_id
     where asset_categories.asset_id in (${assetIds.map(() => "?").join(", ")})
       and case_categories.type = 'asset'
     order by case_categories.sort_order asc`,
    ...assetIds
  );
  for (const row of rows) {
    const items = map.get(row.asset_id) ?? [];
    items.push({ id: row.id, name: row.name });
    map.set(row.asset_id, items);
  }
  return map;
}

function publicAsset(row: AssetRow, categoryMap: Map<string, Array<{ id: string; name: string }>>, currentUserId: string) {
  const categories = categoryMap.get(row.id) ?? [];
  const space = normalizeAssetSpace(row.space);
  const shareStatus = normalizeAssetShareStatus(row.share_status);
  const shared = shareStatus === "approved" && (space === "shared" || Boolean(row.shared));
  const originalUrl = assetUrlFromAssetId(row.id);
  return {
    id: row.id,
    space,
    name: row.name,
    url: originalUrl,
    originalUrl,
    previewUrl: assetUrlFromAssetId(row.id, "preview"),
    thumbnailUrl: assetUrlFromAssetId(row.id, "thumb"),
    mimeType: row.mime_type,
    size: row.size,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    createdAt: row.created_at,
    sourceUsername: row.source_username ?? "未知用户",
    canEdit: row.user_id === currentUserId,
    shared,
    shareStatus,
    shareRequestedAt: row.share_requested_at ?? "",
    shareReviewedAt: row.share_reviewed_at ?? "",
    shareRejectReason: row.share_reject_reason ?? "",
    categoryIds: categories.map((category) => category.id),
    categoryNames: categories.map((category) => category.name)
  };
}

function assetShareStateFromUploadMode(uploadMode: ReturnType<typeof normalizeAssetUploadMode>, timestamp: string) {
  if (uploadMode === "private") {
    return {
      shared: 0,
      shareStatus: "none" as const,
      shareRequestedAt: null,
      shareReviewedAt: null,
      shareReviewedBy: ""
    };
  }
  const approved = !globalSwitchEnabled("asset_review");
  return {
    shared: approved ? 1 : 0,
    shareStatus: approved ? ("approved" as const) : ("pending" as const),
    shareRequestedAt: timestamp,
    shareReviewedAt: approved ? timestamp : null,
    shareReviewedBy: approved ? "global_switch" : ""
  };
}

function replaceAssetCategories(assetId: string, categoryIds: string[]) {
  run(appDb, "delete from asset_categories where asset_id = ?", assetId);
  const timestamp = now();
  for (const categoryId of categoryIds) {
    run(
      appDb,
      "insert or ignore into asset_categories (asset_id, category_id, created_at) values (?, ?, ?)",
      assetId,
      categoryId,
      timestamp
    );
  }
}

function publicAssetById(assetId: string, userId: string) {
  const asset = getOne<AssetRow>(
    appDb,
    `select assets.*, users.username as source_username
     from assets
     left join users on users.id = assets.user_id
     where assets.id = ?`,
    assetId
  );
  const categories = assetCategoryMap(asset ? [asset.id] : []);
  return asset ? publicAsset(asset, categories, userId) : null;
}

function applyDuplicateUploadOptions({
  asset,
  categoryIds,
  hasCategoryIds,
  uploadMode,
  userId
}: {
  asset: AssetRow;
  categoryIds: string[];
  hasCategoryIds: boolean;
  uploadMode: ReturnType<typeof normalizeAssetUploadMode>;
  userId: string;
}) {
  if (asset.user_id === userId && uploadMode !== "private") {
    const timestamp = now();
    const shareState = assetShareStateFromUploadMode(uploadMode, timestamp);
    run(
      appDb,
      `update assets
       set space = 'private', shared = ?, share_status = ?, share_requested_at = ?,
           share_reviewed_at = ?, share_reviewed_by = ?, share_reject_reason = ''
       where id = ? and user_id = ?`,
      shareState.shared,
      shareState.shareStatus,
      shareState.shareRequestedAt,
      shareState.shareReviewedAt,
      shareState.shareReviewedBy,
      asset.id,
      userId
    );
  }
  if (asset.user_id === userId && hasCategoryIds) replaceAssetCategories(asset.id, categoryIds);
}

type AssetCreationSource = {
  path: string;
  mimeType: string;
  fileSize: number;
  imageWidth: number;
  imageHeight: number;
  prompt: string;
  suggestedName: string;
};

async function createAssetFromSource({
  source,
  userId,
  body,
  uploadMode,
  hasSpaceMode,
  hasCategoryIds,
  categoryIds,
  skipDuplicates,
  allowAiName
}: {
  source: AssetCreationSource;
  userId: string;
  body: Record<string, unknown>;
  uploadMode: ReturnType<typeof normalizeAssetUploadMode>;
  hasSpaceMode: boolean;
  hasCategoryIds: boolean;
  categoryIds: string[];
  skipDuplicates: boolean;
  allowAiName: boolean;
}) {
  const sharedExisting =
    uploadMode !== "private"
      ? getOne<AssetRow>(
          appDb,
          `select assets.*, users.username as source_username
           from assets
           left join users on users.id = assets.user_id
           where assets.path = ?
             and ${approvedSharedAssetSql("assets")}`,
          source.path
        )
      : null;
  if (sharedExisting) {
    const categories = assetCategoryMap([sharedExisting.id]);
    return { asset: publicAsset(sharedExisting, categories, userId), created: false, duplicateScope: "shared" as const };
  }

  const existing = getOne<AssetRow>(
    appDb,
    `select assets.*, users.username as source_username
     from assets
     left join users on users.id = assets.user_id
     where assets.user_id = ? and assets.path = ?`,
    userId,
    source.path
  );
  if (existing) {
    if (!skipDuplicates) {
      if (!existing.content_hash) {
        const contentHash = await assetContentHashFromPath(existing.path);
        if (contentHash) run(appDb, "update assets set content_hash = ? where id = ? and user_id = ?", contentHash, existing.id, userId);
      }
      const nextName = Object.prototype.hasOwnProperty.call(body, "name") ? normalizeAssetNameInput(body.name, existing) : "";
      if (hasSpaceMode) {
        const timestamp = now();
        const shareState = assetShareStateFromUploadMode(uploadMode, timestamp);
        run(
          appDb,
          `update assets
           set space = 'private', shared = ?, share_status = ?, share_requested_at = ?,
               share_reviewed_at = ?, share_reviewed_by = ?, share_reject_reason = ''
           where id = ? and user_id = ?`,
          shareState.shared,
          shareState.shareStatus,
          shareState.shareRequestedAt,
          shareState.shareReviewedAt,
          shareState.shareReviewedBy,
          existing.id,
          userId
        );
      }
      if (nextName) run(appDb, "update assets set name = ? where id = ? and user_id = ?", nextName, existing.id, userId);
      if (hasCategoryIds) replaceAssetCategories(existing.id, categoryIds);
    }
    return { asset: publicAssetById(existing.id, userId), created: false, duplicateScope: "own" as const };
  }

  const id = makeId("asset");
  const extension = `.${imageExtensionFromMime(source.mimeType)}`;
  const generatedName = allowAiName ? await generateAssetNameFromPrompt(source.prompt) : defaultAssetNameFromPrompt(source.prompt);
  const nameSeed = String(body.name ?? "").trim() || source.suggestedName.trim() || generatedName;
  const name = `${nameSeed.replace(/[\\/]/g, " ").replace(/\s+/g, " ").trim() || "素材图片"}${extension}`;
  const contentHash = await assetContentHashFromPath(source.path);
  const createdAt = now();
  const shareState = assetShareStateFromUploadMode(uploadMode, createdAt);
  run(
    appDb,
    `insert into assets (
      id, user_id, space, shared, share_status, share_requested_at, share_reviewed_at, share_reviewed_by, name, path, mime_type,
      size, content_hash, image_width, image_height, created_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    userId,
    "private",
    shareState.shared,
    shareState.shareStatus,
    shareState.shareRequestedAt,
    shareState.shareReviewedAt,
    shareState.shareReviewedBy,
    name,
    source.path,
    source.mimeType,
    source.fileSize,
    contentHash,
    source.imageWidth,
    source.imageHeight,
    createdAt
  );
  void warmImageDerivatives("asset", id, source.path);
  replaceAssetCategories(id, categoryIds);
  return { asset: publicAssetById(id, userId), created: true };
}

type AssetListFilters = {
  categoryIds: string[];
  keyword: string;
  spaceFilter: "all" | AssetSpace;
};

function assetListWhere(userId: string, filters: AssetListFilters, options: { includeSpace?: boolean; includeCategories?: boolean } = {}) {
  const clauses: string[] = [visibleAssetSql("assets")];
  const params: Array<string | number> = [userId];
  const includeSpace = options.includeSpace ?? true;
  const includeCategories = options.includeCategories ?? true;

  if (includeSpace && filters.spaceFilter === "shared") {
    clauses.push(approvedSharedAssetSql("assets"));
  } else if (includeSpace && filters.spaceFilter === "private") {
    clauses.push("(assets.user_id = ? and assets.space = 'private')");
    params.push(userId);
  }

  if (includeCategories && filters.categoryIds.length > 0) {
    clauses.push(
      `exists (
        select 1 from asset_categories ac_filter
        where ac_filter.asset_id = assets.id
          and ac_filter.category_id in (${filters.categoryIds.map(() => "?").join(", ")})
      )`
    );
    params.push(...filters.categoryIds);
  }

  if (filters.keyword) {
    const like = `%${filters.keyword}%`;
    const labelClauses: string[] = [];
    if ("共享".includes(filters.keyword) || filters.keyword.includes("共享")) labelClauses.push(approvedSharedAssetSql("assets"));
    if ("我的".includes(filters.keyword) || filters.keyword.includes("我的")) labelClauses.push("(assets.user_id = ? and assets.space = 'private')");
    if ("待审核".includes(filters.keyword) || filters.keyword.includes("待审核")) labelClauses.push("(assets.user_id = ? and assets.share_status = 'pending')");
    if ("审核未通过".includes(filters.keyword) || filters.keyword.includes("未通过")) labelClauses.push("(assets.user_id = ? and assets.share_status = 'rejected')");
    clauses.push(
      `(
        lower(assets.name) like ?
        or lower(coalesce(users.username, '')) like ?
        or lower(assets.space) like ?
        or lower(coalesce(assets.share_status, '')) like ?
        or exists (
          select 1
          from asset_categories ac_keyword
          join case_categories cc_keyword on cc_keyword.id = ac_keyword.category_id
          where ac_keyword.asset_id = assets.id
            and cc_keyword.type = 'asset'
            and lower(cc_keyword.name) like ?
        )
        ${labelClauses.length > 0 ? `or ${labelClauses.join(" or ")}` : ""}
      )`
    );
    params.push(like, like, like, like, like);
    const userIdPlaceholderCount = labelClauses.reduce((count, clause) => count + (clause.match(/assets\.user_id = \?/g)?.length ?? 0), 0);
    for (let index = 0; index < userIdPlaceholderCount; index += 1) params.push(userId);
  }

  return { sql: clauses.join(" and "), params };
}

function countAssets(userId: string, filters: AssetListFilters, options: { includeSpace?: boolean; includeCategories?: boolean } = {}) {
  const where = assetListWhere(userId, filters, options);
  return (
    getOne<{ count: number }>(
      appDb,
      `select count(*) as count
       from assets
       left join users on users.id = assets.user_id
       where ${where.sql}`,
      ...where.params
    )?.count ?? 0
  );
}

async function listAssets(c: Context) {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const pagination = paginationFromQuery(c);
  const filters: AssetListFilters = {
    categoryIds: normalizeIdList(c.req.query("categoryIds") ?? c.req.query("categoryId")),
    keyword: String(c.req.query("keyword") ?? "").trim().toLowerCase(),
    spaceFilter: String(c.req.query("space") ?? "all").trim() === "shared"
      ? "shared"
      : String(c.req.query("space") ?? "all").trim() === "private"
        ? "private"
        : "all"
  };
  const where = assetListWhere(user.id, filters);
  const total = countAssets(user.id, filters);
  const limitSql = pagination.enabled ? " limit ? offset ?" : "";
  const limitParams = pagination.enabled ? [pagination.limit, pagination.offset] : [];
  const assets = getAll<AssetRow>(
    appDb,
    `select assets.*, users.username as source_username
     from assets
     left join users on users.id = assets.user_id
     where ${where.sql}
     order by assets.created_at desc, assets.rowid desc${limitSql}`,
    ...where.params,
    ...limitParams
  );
  const categoryRows = getAll<{ id: string; name: string }>(
    appDb,
    "select id, name from case_categories where type = 'asset' order by sort_order asc"
  );
  const tagBaseFilters = { ...filters, categoryIds: [] };
  const spaceBaseFilters = { ...filters, spaceFilter: "all" as const };
  const categories = assetCategoryMap(assets.map((asset) => asset.id));
  return c.json({
    assets: assets.map((asset) => publicAsset(asset, categories, user.id)),
    pageInfo: pageInfo(total, pagination),
    counts: {
      tags: {
        all: countAssets(user.id, tagBaseFilters),
        byCategory: Object.fromEntries(
          categoryRows.map((category) => [
            category.id,
            countAssets(user.id, { ...tagBaseFilters, categoryIds: [category.id] })
          ])
        )
      },
      spaces: {
        all: countAssets(user.id, spaceBaseFilters),
        shared: countAssets(user.id, { ...spaceBaseFilters, spaceFilter: "shared" }),
        private: countAssets(user.id, { ...spaceBaseFilters, spaceFilter: "private" })
      }
    }
  });
}

api.get("/assets", listAssets);

api.get("/assets/categories", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const categories = getAll<{ id: string; name: string; slug: string }>(
    appDb,
    "select id, name, slug from case_categories where type = 'asset' order by sort_order asc"
  );
  return c.json({ categories: categories.map((category) => ({ ...category, items: [] })) });
});

api.post("/assets/categories", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  if (!name) return c.json({ error: "请填写素材标签名称" }, 400);
  const existing = getOne<{ id: string }>(
    appDb,
    "select id from case_categories where type = 'asset' and lower(name) = lower(?)",
    name
  );
  if (existing) return c.json({ error: "素材标签已存在" }, 400);

  const id = makeId("assetcat");
  const slug = makeCategorySlug(name, "asset");
  const sortOrder =
    (getOne<{ max_sort: number | null }>(appDb, "select max(sort_order) as max_sort from case_categories where type = 'asset'")
      ?.max_sort ?? 0) + 10;
  run(
    appDb,
    "insert into case_categories (id, type, name, slug, sort_order) values (?, ?, ?, ?, ?)",
    id,
    "asset",
    name,
    slug,
    sortOrder
  );
  return c.json({ category: { id, name, slug, items: [] } });
});

api.get("/assets/:assetId", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const asset = getOne<AssetRow>(
    appDb,
    `select assets.*, users.username as source_username
     from assets
     left join users on users.id = assets.user_id
     where assets.id = ? and ${visibleAssetSql("assets")}`,
    c.req.param("assetId"),
    user.id
  );
  if (!asset) return c.json({ error: "素材不存在" }, 404);
  return c.json({ asset: publicAsset(asset, assetCategoryMap([asset.id]), user.id) });
});

api.post("/assets/upload", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const form = await c.req.formData();
  const file = form.get("file");
  const uploadMode = normalizeAssetUploadMode(form.get("spaceMode"), form.get("space"));
  const space: AssetSpace = "private";
  const rawCategoryValues = form.getAll("categoryIds");
  const hasCategoryIds = rawCategoryValues.length > 0 || form.has("categoryIds");
  const categoryIds = normalizeIdList(rawCategoryValues.length > 0 ? rawCategoryValues : form.get("categoryIds"));
  if (!(file instanceof File)) return c.json({ error: "请选择素材图片" }, 400);
  if (!file.type.startsWith("image/")) return c.json({ error: "只能上传图片素材" }, 400);
  if (!ensureCategoryIds(categoryIds, "asset")) return c.json({ error: "素材标签不存在" }, 400);

  const buffer = Buffer.from(await file.arrayBuffer());
  const contentHash = assetContentHash(buffer);
  const ownExisting = getOne<AssetRow>(
    appDb,
    `select assets.*, users.username as source_username
     from assets
     left join users on users.id = assets.user_id
     where assets.user_id = ? and assets.content_hash = ?
     order by assets.created_at desc, assets.rowid desc
     limit 1`,
    user.id,
    contentHash
  );
  if (ownExisting) {
    applyDuplicateUploadOptions({ asset: ownExisting, categoryIds, hasCategoryIds, uploadMode, userId: user.id });
    return c.json({ asset: publicAssetById(ownExisting.id, user.id), created: false, duplicateScope: "own" });
  }

  const sharedExisting =
    uploadMode !== "private"
      ? getOne<AssetRow>(
          appDb,
          `select assets.*, users.username as source_username
           from assets
           left join users on users.id = assets.user_id
           where assets.content_hash = ?
             and ${approvedSharedAssetSql("assets")}
           order by assets.created_at desc, assets.rowid desc
           limit 1`,
          contentHash
        )
      : null;
  if (sharedExisting) {
    const categories = assetCategoryMap([sharedExisting.id]);
    return c.json({ asset: publicAsset(sharedExisting, categories, user.id), created: false, duplicateScope: "shared" });
  }

  const id = makeId("asset");
  const relativePath = secureAssetPath(user.id, id);
  const dimensions = readImageDimensions(buffer);
  await writeEncryptedFile(relativePath, buffer);
  void warmImageDerivatives("asset", id, relativePath);
  const createdAt = now();
  const shareState = assetShareStateFromUploadMode(uploadMode, createdAt);
  run(
    appDb,
    `insert into assets (
      id, user_id, space, shared, share_status, share_requested_at, share_reviewed_at, share_reviewed_by, name, path, mime_type,
      size, content_hash, image_width, image_height, created_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    user.id,
    space,
    shareState.shared,
    shareState.shareStatus,
    shareState.shareRequestedAt,
    shareState.shareReviewedAt,
    shareState.shareReviewedBy,
    file.name || "素材图片",
    relativePath,
    file.type,
    buffer.length,
    contentHash,
    dimensions.width,
    dimensions.height,
    createdAt
  );
  replaceAssetCategories(id, categoryIds);
  const asset = getOne<AssetRow>(
    appDb,
    `select assets.*, users.username as source_username
     from assets
     left join users on users.id = assets.user_id
     where assets.id = ?`,
    id
  );
  const categories = assetCategoryMap([id]);
  return c.json({
    asset: asset ? publicAsset(asset, categories, user.id) : null,
    created: true
  });
});

api.post("/assets/from-image", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const imageId = String(body.imageId ?? "").trim();
  const caseItemId = String(body.caseItemId ?? "").trim();
  const hasSpaceMode = Object.prototype.hasOwnProperty.call(body, "spaceMode") || Object.prototype.hasOwnProperty.call(body, "space");
  const uploadMode = normalizeAssetUploadMode(body.spaceMode, body.space);
  const hasCategoryIds = Object.prototype.hasOwnProperty.call(body, "categoryIds");
  const categoryIds = normalizeIdList(body.categoryIds);
  if ((!imageId && !caseItemId) || (imageId && caseItemId)) return c.json({ error: "请选择要加入素材库的图片" }, 400);
  if (!ensureCategoryIds(categoryIds, "asset")) return c.json({ error: "素材标签不存在" }, 400);

  const image = imageId ? getOne<ImageRow>(appDb, "select * from images where id = ? and user_id = ?", imageId, user.id) : null;
  if (imageId && !image) return c.json({ error: "图片不存在" }, 404);
  const imageOriginPrompt = image ? imageOriginPromptsByImageIds([image.id]).get(image.id) ?? image.prompt : "";
  const caseSource = caseItemId ? caseMaterialSourceById(caseItemId, user.id) : null;
  if (caseItemId && !caseSource) return c.json({ error: "灵感不存在或来源不可用" }, 404);
  const source = image
    ? {
        path: image.path,
        mimeType: image.mime_type,
        fileSize: image.image_file_size,
        imageWidth: image.image_width,
        imageHeight: image.image_height,
        prompt: imageOriginPrompt,
        suggestedName: image.suggested_case_title
      }
    : caseSource
      ? {
          path: caseSource.path,
          mimeType: caseSource.mimeType,
          fileSize: caseSource.fileSize,
          imageWidth: caseSource.imageWidth,
          imageHeight: caseSource.imageHeight,
          prompt: caseSource.prompt || caseSource.title,
          suggestedName: caseSource.title
        }
      : null;
  if (!source) return c.json({ error: "图片不存在" }, 404);

  return c.json(
    await createAssetFromSource({
      source,
      userId: user.id,
      body,
      uploadMode,
      hasSpaceMode,
      hasCategoryIds,
      categoryIds,
      skipDuplicates: false,
      allowAiName: true
    })
  );
});

api.post("/assets/from-images", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const parsed = parseImageBatchIds(body.imageIds, 100);
  if (parsed.error) return c.json({ error: parsed.error }, 400);
  const commonCategoryIds = normalizeIdList(body.categoryIds);
  if (!ensureCategoryIds(commonCategoryIds, "asset")) return c.json({ error: "素材标签不存在" }, 400);
  const autoCategory = body.autoCategory !== false;
  const uploadMode = normalizeAssetUploadMode(body.spaceMode, body.space);
  const placeholders = parsed.imageIds.map(() => "?").join(", ");
  const images = getAll<ImageRow>(
    appDb,
    `select * from images where user_id = ? and id in (${placeholders})`,
    user.id,
    ...parsed.imageIds
  );
  const imageById = new Map(images.map((image) => [image.id, image]));
  const originPrompts = imageOriginPromptsByImageIds(images.map((image) => image.id));
  const items = [];
  for (const imageId of parsed.imageIds) {
    const image = imageById.get(imageId);
    if (!image) {
      items.push({ imageId, status: "not_found" as const, reason: "图片不存在" });
      continue;
    }
    try {
      const ownDuplicate = getOne<{ id: string }>(appDb, "select id from assets where user_id = ? and path = ?", user.id, image.path);
      const sharedDuplicate = uploadMode !== "private"
        ? getOne<{ id: string }>(appDb, `select id from assets where path = ? and ${approvedSharedAssetSql("assets")} limit 1`, image.path)
        : null;
      const duplicate = sharedDuplicate ?? ownDuplicate;
      if (duplicate) {
        items.push({ imageId, status: "duplicate" as const, targetId: duplicate.id, reason: "素材已存在" });
        continue;
      }
      const prompt = originPrompts.get(image.id) ?? image.prompt;
      const categoryIds = autoCategory ? await suggestAssetCategoryIds(prompt) : commonCategoryIds;
      if (!ensureCategoryIds(categoryIds, "asset")) throw new Error("自动生成的素材标签不存在");
      if (autoCategory) {
        run(
          appDb,
          "update images set suggested_asset_category_ids_json = ? where id = ? and user_id = ?",
          JSON.stringify(categoryIds),
          image.id,
          user.id
        );
      }
      const result = await createAssetFromSource({
        source: {
          path: image.path,
          mimeType: image.mime_type,
          fileSize: image.image_file_size,
          imageWidth: image.image_width,
          imageHeight: image.image_height,
          prompt,
          suggestedName: image.suggested_case_title
        },
        userId: user.id,
        body,
        uploadMode,
        hasSpaceMode: true,
        hasCategoryIds: true,
        categoryIds,
        skipDuplicates: true,
        allowAiName: false
      });
      items.push({
        imageId,
        status: result.created ? ("created" as const) : ("duplicate" as const),
        targetId: result.asset?.id,
        reason: result.created ? undefined : "素材已存在"
      });
    } catch (error) {
      items.push({ imageId, status: "failed" as const, reason: error instanceof Error ? error.message : "创建素材失败" });
    }
  }
  return c.json(imageBatchResult(items));
});

api.patch("/assets/:assetId", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const assetId = c.req.param("assetId");
  const body = await c.req.json().catch(() => ({}));
  const asset = getOne<AssetRow>(
    appDb,
    `select * from assets where id = ? and ${visibleAssetSql("assets")}`,
    assetId,
    user.id
  );
  if (!asset) return c.json({ error: "素材不存在" }, 404);

  if (Object.prototype.hasOwnProperty.call(body, "space")) {
    if (asset.user_id !== user.id) return c.json({ error: "只能移动自己的素材空间" }, 403);
    const nextSpace = normalizeAssetSpace(body.space);
    if (nextSpace === "shared") {
      const timestamp = now();
      const shareState = assetShareStateFromUploadMode("shared", timestamp);
      run(
        appDb,
        `update assets
         set space = 'private', shared = ?, share_status = ?,
             share_requested_at = ?, share_reviewed_at = ?, share_reviewed_by = ?, share_reject_reason = ''
         where id = ? and user_id = ?`,
        shareState.shared,
        shareState.shareStatus,
        shareState.shareRequestedAt,
        shareState.shareReviewedAt,
        shareState.shareReviewedBy,
        assetId,
        user.id
      );
    } else {
      run(appDb, "update assets set space = 'private' where id = ? and user_id = ?", assetId, user.id);
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "name")) {
    if (asset.user_id !== user.id) return c.json({ error: "只能编辑自己的素材" }, 403);
    const nextName = normalizeAssetNameInput(body.name, asset);
    if (!nextName) return c.json({ error: "请填写素材名称" }, 400);
    run(appDb, "update assets set name = ? where id = ? and user_id = ?", nextName, assetId, user.id);
  }

  if (Object.prototype.hasOwnProperty.call(body, "shared")) {
    if (asset.user_id !== user.id) return c.json({ error: "只能分享自己的素材" }, 403);
    if (normalizeAssetSpace(asset.space) !== "private") return c.json({ error: "共享空间素材无需分享操作" }, 400);
    const requestShare = body.shared === true;
    const timestamp = now();
    if (requestShare) {
      const shareState = assetShareStateFromUploadMode("shared", timestamp);
      run(
        appDb,
        `update assets
         set shared = ?, share_status = ?, share_requested_at = ?,
             share_reviewed_at = ?, share_reviewed_by = ?, share_reject_reason = ''
         where id = ? and user_id = ?`,
        shareState.shared,
        shareState.shareStatus,
        shareState.shareRequestedAt,
        shareState.shareReviewedAt,
        shareState.shareReviewedBy,
        assetId,
        user.id
      );
    } else {
      run(
        appDb,
        `update assets
         set shared = 0, share_status = 'none', share_requested_at = null,
             share_reviewed_at = null, share_reviewed_by = '', share_reject_reason = ''
         where id = ? and user_id = ?`,
        assetId,
        user.id
      );
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, "categoryIds")) {
    if (asset.user_id !== user.id) return c.json({ error: "只能编辑自己的素材标签" }, 403);
    const categoryIds = normalizeIdList(body.categoryIds);
    if (!ensureCategoryIds(categoryIds, "asset")) return c.json({ error: "素材标签不存在" }, 400);
    replaceAssetCategories(assetId, categoryIds);
  }

  const updated = getOne<AssetRow>(
    appDb,
    `select assets.*, users.username as source_username
     from assets
     left join users on users.id = assets.user_id
     where assets.id = ?`,
    assetId
  );
  const categories = assetCategoryMap([assetId]);
  return c.json({ asset: updated ? publicAsset(updated, categories, user.id) : null });
});

api.delete("/assets/:assetId", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const assetId = c.req.param("assetId");
  const asset = getOne<AssetRow>(appDb, "select * from assets where id = ?", assetId);
  if (!asset) return c.json({ error: "素材不存在" }, 404);
  if (asset.user_id !== user.id) return c.json({ error: "只能删除自己的素材" }, 403);

  const derivativeSources = [{ sourceType: "asset" as const, sourceIds: [asset.id] }];
  const pathsToDelete = [asset.path, ...imageDerivativePathsForSources(derivativeSources).map((row) => row.path)];
  const source = { sourceUserId: asset.user_id, sourceType: "asset", sourceId: asset.id };
  run(appDb, "update image_asset_references set source_asset_id = null where source_asset_id = ?", assetId);
  run(
    appDb,
    "delete from case_prompt_usage_events where source_user_id = ? and source_type = ? and source_id = ?",
    source.sourceUserId,
    source.sourceType,
    source.sourceId
  );
  run(
    appDb,
    "delete from case_favorites where source_user_id = ? and source_type = ? and source_id = ?",
    source.sourceUserId,
    source.sourceType,
    source.sourceId
  );
  run(appDb, "delete from case_prompt_usage_events where source_type = 'case_group' and source_id in (select group_id from case_group_images where asset_id = ?)", assetId);
  run(appDb, "delete from case_favorites where source_type = 'case_group' and source_id in (select group_id from case_group_images where asset_id = ?)", assetId);
  run(appDb, "delete from case_items where group_id in (select group_id from case_group_images where asset_id = ?)", assetId);
  run(appDb, "delete from case_group_images where group_id in (select group_id from case_group_images where asset_id = ?)", assetId);
  run(appDb, "delete from case_items where asset_id = ?", assetId);
  run(appDb, "delete from asset_categories where asset_id = ?", assetId);
  deleteImageDerivativesForSources(derivativeSources);
  run(appDb, "delete from assets where id = ? and user_id = ?", assetId, user.id);
  await deleteStoredFilesIfUnreferenced(pathsToDelete);

  return c.json({ ok: true });
});
}
