import type { Hono } from "hono";
import { requireUser } from "./auth";
import { appDb, getAll, getOne, run } from "./db";
import type { SearchHistoryRow } from "./types";
import { makeId, now } from "./utils";

const SEARCH_HISTORY_SCOPES = new Set(["chat", "cases", "assets", "images", "promptTemplates"]);
const MAX_SEARCH_KEYWORD_LENGTH = 120;

function normalizeScope(value: unknown) {
  const scope = String(value ?? "").trim();
  return SEARCH_HISTORY_SCOPES.has(scope) ? scope : "";
}

function normalizeSearchKeyword(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEARCH_KEYWORD_LENGTH);
}

function normalizeSearchKey(keyword: string) {
  return keyword.toLocaleLowerCase();
}

function toSearchHistory(row: SearchHistoryRow) {
  return {
    id: row.id,
    scope: row.scope,
    keyword: row.keyword,
    searchedAt: row.searched_at,
    createdAt: row.created_at
  };
}

export function registerSearchHistoryRoutes(api: Hono) {
  api.get("/search-history", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const scope = normalizeScope(c.req.query("scope"));
    if (!scope) return c.json({ error: "搜索来源不正确" }, 400);
    const rawLimit = Number(c.req.query("limit"));
    const limit = Math.min(30, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 12));
    const rows = getAll<SearchHistoryRow>(
      appDb,
      `select * from search_history
       where user_id = ? and scope = ?
       order by searched_at desc, rowid desc
       limit ?`,
      user.id,
      scope,
      limit
    );
    return c.json({ history: rows.map(toSearchHistory) });
  });

  api.post("/search-history", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const body = await c.req.json().catch(() => ({}));
    const scope = normalizeScope(body.scope);
    const keyword = normalizeSearchKeyword(body.keyword);
    if (!scope) return c.json({ error: "搜索来源不正确" }, 400);
    if (!keyword) return c.json({ error: "请输入搜索内容" }, 400);

    const timestamp = now();
    const normalizedKeyword = normalizeSearchKey(keyword);
    run(
      appDb,
      `insert into search_history (
        id, user_id, scope, keyword, normalized_keyword, searched_at, created_at
      ) values (?, ?, ?, ?, ?, ?, ?)
      on conflict(user_id, scope, normalized_keyword) do update set
        keyword = excluded.keyword,
        searched_at = excluded.searched_at`,
      makeId("search"),
      user.id,
      scope,
      keyword,
      normalizedKeyword,
      timestamp,
      timestamp
    );
    const row = getOne<SearchHistoryRow>(
      appDb,
      "select * from search_history where user_id = ? and scope = ? and normalized_keyword = ?",
      user.id,
      scope,
      normalizedKeyword
    );
    return c.json({ history: row ? toSearchHistory(row) : null });
  });

  api.delete("/search-history", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const scope = normalizeScope(c.req.query("scope"));
    if (!scope) return c.json({ error: "搜索来源不正确" }, 400);
    run(appDb, "delete from search_history where user_id = ? and scope = ?", user.id, scope);
    return c.json({ ok: true });
  });

  api.delete("/search-history/:id", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    run(appDb, "delete from search_history where id = ? and user_id = ?", c.req.param("id"), user.id);
    return c.json({ ok: true });
  });
}
