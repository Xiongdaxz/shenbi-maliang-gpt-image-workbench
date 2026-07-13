import type { Hono } from "hono";
import { requireUser } from "./auth";
import { UNCATEGORIZED_CASE_CATEGORY_ID } from "./categories";
import { appDb, getAll, getOne } from "./db";
import { assetUrlFromAssetId, imageUrlFromImageId } from "./serializers";
import type { AssetRow, ImageRow } from "./types";
import { normalizeAssetSpace, visibleAssetSql } from "./utils";

const GLOBAL_SEARCH_SCOPES = ["chat", "images", "assets", "cases", "promptTemplates"] as const;
type GlobalSearchResultScope = (typeof GLOBAL_SEARCH_SCOPES)[number];
type GlobalSearchScope = "all" | GlobalSearchResultScope;

const MAX_SEARCH_KEYWORD_LENGTH = 120;
const DEFAULT_GROUP_LIMIT = 5;
const MAX_GROUP_LIMIT = 8;
const DEFAULT_SCOPED_LIMIT = 30;
const MAX_SCOPED_LIMIT = 80;

function normalizeKeyword(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEARCH_KEYWORD_LENGTH)
    .toLocaleLowerCase();
}

function normalizeScope(value: unknown): GlobalSearchScope | "" {
  const scope = String(value ?? "all").trim();
  return scope === "all" || GLOBAL_SEARCH_SCOPES.includes(scope as GlobalSearchResultScope)
    ? (scope as GlobalSearchScope)
    : "";
}

function boundedInteger(value: unknown, fallback: number, maximum: number) {
  const parsed = Number(value);
  return Math.min(maximum, Math.max(1, Number.isFinite(parsed) ? Math.floor(parsed) : fallback));
}

function normalizedOffset(value: unknown) {
  const parsed = Number(value);
  return Math.max(0, Number.isFinite(parsed) ? Math.floor(parsed) : 0);
}

function searchPageInfo(total: number, limit: number, offset: number) {
  return { limit, offset, total, hasMore: offset + limit < total };
}

function searchGroup(scope: GlobalSearchResultScope, items: unknown[], total: number, limit: number, offset: number) {
  return { scope, total, items, pageInfo: searchPageInfo(total, limit, offset) };
}

function primaryRankSql(expression: string) {
  return `case
    when lower(${expression}) = ? then 0
    when lower(${expression}) like ? then 1
    when lower(${expression}) like ? then 2
    else 3
  end`;
}

function rankParams(keyword: string) {
  return [keyword, `${keyword}%`, `%${keyword}%`];
}

function searchChats(userId: string, keyword: string, limit: number, offset: number) {
  const like = `%${keyword}%`;
  const total = getOne<{ total: number }>(
    appDb,
    `select count(*) as total
     from sessions
     where sessions.user_id = ?
       and sessions.archived_at is null
       and sessions.deleted_at is null
       and (
         lower(sessions.title) like ?
         or exists (
           select 1
           from messages
           where messages.session_id = sessions.id
             and messages.user_id = ?
             and messages.role = 'user'
             and lower(messages.content) like ?
         )
       )`,
    userId,
    like,
    userId,
    like
  )?.total ?? 0;
  const rows = getAll<{ id: string; title: string; matched_prompt: string | null; created_at: string; updated_at: string }>(
    appDb,
    `select sessions.id, sessions.title, sessions.created_at, sessions.updated_at,
            (
              select messages.content
              from messages
              where messages.session_id = sessions.id
                and messages.user_id = ?
                and messages.role = 'user'
                and lower(messages.content) like ?
              order by ${primaryRankSql("messages.content")} asc,
                       messages.created_at desc,
                       messages.rowid desc
              limit 1
            ) as matched_prompt
     from sessions
     where sessions.user_id = ?
       and sessions.archived_at is null
       and sessions.deleted_at is null
       and (
         lower(sessions.title) like ?
         or exists (
           select 1
           from messages
           where messages.session_id = sessions.id
             and messages.user_id = ?
             and messages.role = 'user'
             and lower(messages.content) like ?
         )
       )
     order by case
                when lower(sessions.title) = ? then 0
                when lower(sessions.title) like ? then 1
                when lower(sessions.title) like ? then 2
                when matched_prompt is not null then 3
                else 4
              end asc,
              sessions.updated_at desc,
              sessions.rowid desc
     limit ? offset ?`,
    userId,
    like,
    ...rankParams(keyword),
    userId,
    like,
    userId,
    like,
    ...rankParams(keyword),
    limit,
    offset
  );
  return searchGroup(
    "chat",
    rows.map((row) => ({
      scope: "chat",
      id: row.id,
      title: row.title,
      matchedPrompt: row.matched_prompt ?? "",
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })),
    total,
    limit,
    offset
  );
}

function imageMatch(keyword: string) {
  const like = `%${keyword}%`;
  const extraClauses: string[] = [];
  if ("生成".includes(keyword) || keyword.includes("生成")) extraClauses.push("kind = 'generation'");
  if ("编辑".includes(keyword) || keyword.includes("编辑")) extraClauses.push("kind = 'edit'");
  return {
    sql: `(
      lower(prompt) like ?
      or lower(kind) like ?
      or lower(size) like ?
      or lower(quality) like ?
      or lower(provider_id) like ?
      or lower(created_at) like ?
      ${extraClauses.length > 0 ? `or ${extraClauses.join(" or ")}` : ""}
    )`,
    params: [like, like, like, like, like, like]
  };
}

function searchImages(userId: string, keyword: string, limit: number, offset: number) {
  const match = imageMatch(keyword);
  const whereSql = `user_id = ? and ${match.sql}`;
  const whereParams = [userId, ...match.params];
  const total = getOne<{ total: number }>(appDb, `select count(*) as total from images where ${whereSql}`, ...whereParams)?.total ?? 0;
  const rows = getAll<ImageRow>(
    appDb,
    `select * from images
     where ${whereSql}
     order by ${primaryRankSql("prompt")} asc, created_at desc, rowid desc
     limit ? offset ?`,
    ...whereParams,
    ...rankParams(keyword),
    limit,
    offset
  );
  return searchGroup(
    "images",
    rows.map((row) => ({
      scope: "images",
      id: row.id,
      title: row.prompt,
      prompt: row.prompt,
      thumbnailUrl: imageUrlFromImageId(row.id, "thumb"),
      kind: row.kind,
      size: row.size,
      quality: row.quality,
      createdAt: row.created_at
    })),
    total,
    limit,
    offset
  );
}

function assetMatch(userId: string, keyword: string) {
  const like = `%${keyword}%`;
  const labelClauses: string[] = [];
  const labelParams: Array<string | number> = [];
  if ("共享".includes(keyword) || keyword.includes("共享")) {
    labelClauses.push("((assets.space = 'shared' or assets.shared = 1) and coalesce(assets.share_status, 'approved') = 'approved')");
  }
  if ("我的".includes(keyword) || keyword.includes("我的")) {
    labelClauses.push("(assets.user_id = ? and assets.space = 'private')");
    labelParams.push(userId);
  }
  if ("待审核".includes(keyword) || keyword.includes("待审核")) {
    labelClauses.push("(assets.user_id = ? and assets.share_status = 'pending')");
    labelParams.push(userId);
  }
  if ("审核未通过".includes(keyword) || keyword.includes("未通过")) {
    labelClauses.push("(assets.user_id = ? and assets.share_status = 'rejected')");
    labelParams.push(userId);
  }
  return {
    sql: `(
      lower(assets.name) like ?
      or lower(coalesce(users.username, '')) like ?
      or lower(assets.space) like ?
      or lower(coalesce(assets.share_status, '')) like ?
      or exists (
        select 1
        from asset_categories ac_search
        join case_categories cc_search on cc_search.id = ac_search.category_id
        where ac_search.asset_id = assets.id
          and cc_search.type = 'asset'
          and lower(cc_search.name) like ?
      )
      ${labelClauses.length > 0 ? `or ${labelClauses.join(" or ")}` : ""}
    )`,
    params: [like, like, like, like, like, ...labelParams]
  };
}

function assetCategoryNames(assetIds: string[]) {
  const map = new Map<string, string[]>();
  if (assetIds.length === 0) return map;
  const rows = getAll<{ asset_id: string; name: string }>(
    appDb,
    `select asset_categories.asset_id, case_categories.name
     from asset_categories
     join case_categories on case_categories.id = asset_categories.category_id
     where asset_categories.asset_id in (${assetIds.map(() => "?").join(", ")})
       and case_categories.type = 'asset'
     order by case_categories.sort_order asc, case_categories.rowid asc`,
    ...assetIds
  );
  for (const row of rows) {
    const names = map.get(row.asset_id) ?? [];
    if (!names.includes(row.name)) names.push(row.name);
    map.set(row.asset_id, names);
  }
  return map;
}

function searchAssets(userId: string, keyword: string, limit: number, offset: number) {
  const match = assetMatch(userId, keyword);
  const whereSql = `${visibleAssetSql("assets")} and ${match.sql}`;
  const whereParams = [userId, ...match.params];
  const total = getOne<{ total: number }>(
    appDb,
    `select count(distinct assets.id) as total
     from assets left join users on users.id = assets.user_id
     where ${whereSql}`,
    ...whereParams
  )?.total ?? 0;
  const rows = getAll<AssetRow>(
    appDb,
    `select assets.*, users.username as source_username
     from assets
     left join users on users.id = assets.user_id
     where ${whereSql}
     order by ${primaryRankSql("assets.name")} asc,
              case when assets.user_id = ? then 0 else 1 end,
              assets.created_at desc, assets.rowid desc
     limit ? offset ?`,
    ...whereParams,
    ...rankParams(keyword),
    userId,
    limit,
    offset
  );
  const categoryNames = assetCategoryNames(rows.map((row) => row.id));
  return searchGroup(
    "assets",
    rows.map((row) => ({
      scope: "assets",
      id: row.id,
      title: row.name,
      thumbnailUrl: assetUrlFromAssetId(row.id, "thumb"),
      categoryNames: categoryNames.get(row.id) ?? [],
      sourceUsername: row.source_username ?? "未知用户",
      space: normalizeAssetSpace(row.space),
      createdAt: row.created_at
    })),
    total,
    limit,
    offset
  );
}

type SearchCaseRow = {
  id: string;
  case_id: string;
  user_id: string | null;
  image_id: string | null;
  asset_id: string | null;
  image_url: string;
  title: string;
  prompt: string;
  created_at: string;
  source_username: string | null;
};

function caseCategoryNames(caseIds: string[]) {
  const map = new Map<string, string[]>();
  if (caseIds.length === 0) return map;
  const rows = getAll<{ case_id: string; category_id: string; name: string }>(
    appDb,
    `select coalesce(nullif(case_items.group_id, ''), case_items.id) as case_id,
            case_categories.id as category_id, case_categories.name
     from case_items
     join case_categories on case_categories.id = case_items.category_id
     where coalesce(nullif(case_items.group_id, ''), case_items.id) in (${caseIds.map(() => "?").join(", ")})
       and case_categories.type = 'case'
     order by case_categories.sort_order asc, case_categories.rowid asc`,
    ...caseIds
  );
  for (const row of rows) {
    if (row.category_id === UNCATEGORIZED_CASE_CATEGORY_ID) continue;
    const names = map.get(row.case_id) ?? [];
    if (!names.includes(row.name)) names.push(row.name);
    map.set(row.case_id, names);
  }
  return map;
}

function caseCovers(caseIds: string[]) {
  const map = new Map<string, { image_id: string | null; asset_id: string | null; image_url: string }>();
  if (caseIds.length === 0) return map;
  const rows = getAll<{ group_id: string; image_id: string | null; asset_id: string | null; image_url: string }>(
    appDb,
    `select group_id, image_id, asset_id, image_url
     from case_group_images
     where group_id in (${caseIds.map(() => "?").join(", ")})
     order by group_id asc, is_cover desc, sort_order asc, rowid asc`,
    ...caseIds
  );
  for (const row of rows) if (!map.has(row.group_id)) map.set(row.group_id, row);
  return map;
}

function caseImageCounts(caseIds: string[]) {
  const map = new Map<string, number>();
  if (caseIds.length === 0) return map;
  const rows = getAll<{ group_id: string; total: number }>(
    appDb,
    `select group_id, count(*) as total
     from case_group_images
     where group_id in (${caseIds.map(() => "?").join(", ")})
     group by group_id`,
    ...caseIds
  );
  for (const row of rows) map.set(row.group_id, row.total);
  return map;
}

function caseThumbnail(source: { image_id: string | null; asset_id: string | null; image_url: string }) {
  if (source.image_id) return imageUrlFromImageId(source.image_id, "thumb");
  if (source.asset_id) return assetUrlFromAssetId(source.asset_id, "thumb");
  return source.image_url;
}

function searchCases(_userId: string, keyword: string, limit: number, offset: number) {
  const like = `%${keyword}%`;
  const matchSql = `(
    lower(case_items.title) like ?
    or lower(case_items.prompt) like ?
    or lower(coalesce(case_categories.name, '')) like ?
  )`;
  const matchParams = [like, like, like];
  const approvedSql = "coalesce(case_items.review_status, 'approved') = 'approved'";
  const total = getOne<{ total: number }>(
    appDb,
    `select count(distinct coalesce(nullif(case_items.group_id, ''), case_items.id)) as total
     from case_items
     left join case_categories on case_categories.id = case_items.category_id
     where ${approvedSql} and ${matchSql}`,
    ...matchParams
  )?.total ?? 0;
  const rows = getAll<SearchCaseRow>(
    appDb,
    `with matched as (
       select case_items.id,
              coalesce(nullif(case_items.group_id, ''), case_items.id) as case_id,
              case_items.user_id, case_items.image_id, case_items.asset_id, case_items.image_url,
              case_items.title, case_items.prompt, case_items.created_at,
              users.username as source_username,
              ${primaryRankSql("case_items.title")} as match_rank
       from case_items
       left join users on users.id = case_items.user_id
       left join case_categories on case_categories.id = case_items.category_id
       where ${approvedSql} and ${matchSql}
     ), ranked as (
       select matched.*,
              row_number() over (partition by case_id order by match_rank asc, created_at desc, id desc) as result_rank
       from matched
     )
     select id, case_id, user_id, image_id, asset_id, image_url, title, prompt, created_at, source_username
     from ranked
     where result_rank = 1
     order by match_rank asc, created_at desc, id desc
     limit ? offset ?`,
    ...rankParams(keyword),
    ...matchParams,
    limit,
    offset
  );
  const caseIds = rows.map((row) => row.case_id);
  const categoryNames = caseCategoryNames(caseIds);
  const covers = caseCovers(caseIds);
  const imageCounts = caseImageCounts(caseIds);
  return searchGroup(
    "cases",
    rows.map((row) => {
      const cover = covers.get(row.case_id) ?? row;
      return {
        scope: "cases",
        id: row.case_id,
        title: row.title,
        prompt: row.prompt,
        thumbnailUrl: caseThumbnail(cover),
        categoryNames: categoryNames.get(row.case_id) ?? [],
        imageCount: imageCounts.get(row.case_id) ?? 1,
        createdAt: row.created_at
      };
    }),
    total,
    limit,
    offset
  );
}

type SearchPromptTemplateRow = {
  id: string;
  user_id: string | null;
  visibility: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  created_at: string;
  updated_at: string;
  owner_name: string | null;
};

function searchPromptTemplates(userId: string, keyword: string, limit: number, offset: number) {
  const like = `%${keyword}%`;
  const whereSql = "(prompt_templates.visibility = 'shared' or prompt_templates.user_id = ?) and (lower(prompt_templates.name) like ? or lower(prompt_templates.description) like ? or lower(prompt_templates.category) like ?)";
  const whereParams = [userId, like, like, like];
  const total = getOne<{ total: number }>(
    appDb,
    `select count(*) as total from prompt_templates where (visibility = 'shared' or user_id = ?) and (lower(name) like ? or lower(description) like ? or lower(category) like ?)`,
    ...whereParams
  )?.total ?? 0;
  const rows = getAll<SearchPromptTemplateRow>(
    appDb,
    `select prompt_templates.*, users.username as owner_name
     from prompt_templates
     left join users on users.id = prompt_templates.user_id
     where ${whereSql}
     order by ${primaryRankSql("prompt_templates.name")} asc,
              case when prompt_templates.user_id = ? then 0 else 1 end,
              prompt_templates.updated_at desc, prompt_templates.rowid desc
     limit ? offset ?`,
    ...whereParams,
    ...rankParams(keyword),
    userId,
    limit,
    offset
  );
  return searchGroup(
    "promptTemplates",
    rows.map((row) => ({
      scope: "promptTemplates",
      id: row.id,
      title: row.name,
      description: row.description,
      category: row.category,
      icon: row.icon || "Sparkles",
      ownerName: row.owner_name ?? "",
      visibility: row.visibility === "shared" ? "shared" : "private",
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })),
    total,
    limit,
    offset
  );
}

function searchScope(scope: GlobalSearchResultScope, userId: string, keyword: string, limit: number, offset: number) {
  if (scope === "chat") return searchChats(userId, keyword, limit, offset);
  if (scope === "images") return searchImages(userId, keyword, limit, offset);
  if (scope === "assets") return searchAssets(userId, keyword, limit, offset);
  if (scope === "cases") return searchCases(userId, keyword, limit, offset);
  return searchPromptTemplates(userId, keyword, limit, offset);
}

export function registerSearchRoutes(api: Hono) {
  api.get("/search", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const keyword = normalizeKeyword(c.req.query("q"));
    const scope = normalizeScope(c.req.query("scope"));
    if (!scope) return c.json({ error: "搜索范围不正确" }, 400);
    if (!keyword) return c.json({ keyword: "", groups: [] });

    const scoped = scope !== "all";
    const limit = boundedInteger(
      c.req.query("limit"),
      scoped ? DEFAULT_SCOPED_LIMIT : DEFAULT_GROUP_LIMIT,
      scoped ? MAX_SCOPED_LIMIT : MAX_GROUP_LIMIT
    );
    const offset = scoped ? normalizedOffset(c.req.query("offset")) : 0;
    const targetScopes = scoped ? [scope as GlobalSearchResultScope] : [...GLOBAL_SEARCH_SCOPES];
    const groups = targetScopes.map((targetScope) => searchScope(targetScope, user.id, keyword, limit, offset));
    return c.json({ keyword, groups });
  });
}
