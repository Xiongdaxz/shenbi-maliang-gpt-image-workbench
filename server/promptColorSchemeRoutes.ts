import type { Hono } from "hono";
import { requireUser } from "./auth";
import { appDb, getAll, getOne, run } from "./db";
import type { PromptColorSchemeRow } from "./types";
import { makeId, now, safeJson } from "./utils";
import {
  defaultPromptColorSchemes,
  sanitizePromptColorSchemeColors,
  sanitizePromptColorSchemeGradients
} from "../src/lib/promptColorSchemes";

type PromptColorSchemePayload = {
  name: string;
  description: string;
  category: string;
  colorsJson: string;
  gradientsJson: string;
  prompt: string;
  visible: boolean;
  sortOrder: number;
};

function normalizeText(value: unknown, fallback = "", maxLength = 160) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return Array.from(text || fallback).slice(0, maxLength).join("");
}

function normalizePrompt(value: unknown) {
  return Array.from(String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()).slice(0, 500).join("");
}

function normalizeSortOrder(value: unknown, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(9999, Math.floor(number)));
}

function normalizePromptColorSchemePayload(body: Record<string, unknown>, fallback?: PromptColorSchemeRow): PromptColorSchemePayload | { error: string } {
  const name = normalizeText(body.name ?? fallback?.name, "", 40);
  if (!name) return { error: "请填写色系名称" };
  const colors = sanitizePromptColorSchemeColors(body.colors ?? safeJson(fallback?.colors_json, []));
  const gradients = sanitizePromptColorSchemeGradients(body.gradients ?? safeJson(fallback?.gradients_json, []));
  return {
    name,
    description: normalizeText(body.description ?? fallback?.description, "自定义色彩方案", 160),
    category: normalizeText(body.category ?? fallback?.category, "自定义", 40),
    colorsJson: JSON.stringify(colors),
    gradientsJson: JSON.stringify(gradients),
    prompt: normalizePrompt(body.prompt ?? fallback?.prompt),
    visible: typeof body.visible === "boolean" ? body.visible : fallback ? fallback.visible !== 0 : true,
    sortOrder: normalizeSortOrder(body.sortOrder, fallback?.sort_order ?? 0)
  };
}

function publicPromptColorScheme(row: PromptColorSchemeRow) {
  return {
    id: row.id,
    builtinKey: row.builtin_key,
    name: row.name,
    description: row.description,
    category: row.category,
    colors: sanitizePromptColorSchemeColors(safeJson(row.colors_json, [])),
    gradients: sanitizePromptColorSchemeGradients(safeJson(row.gradients_json, [])),
    prompt: row.prompt,
    visible: row.visible !== 0,
    sortOrder: row.sort_order,
    isBuiltin: row.is_builtin !== 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? ""
  };
}

function promptColorSchemeRows(userId: string, includeDeleted = false) {
  return getAll<PromptColorSchemeRow>(
    appDb,
    `select * from prompt_color_schemes
     where user_id = ?
       ${includeDeleted ? "" : "and coalesce(deleted_at, '') = ''"}
     order by sort_order asc, created_at asc, rowid asc`,
    userId
  );
}

function insertBuiltinPromptColorScheme(userId: string, scheme: typeof defaultPromptColorSchemes[number], timestamp: string) {
  const existing = getOne<{ id: string }>(
    appDb,
    "select id from prompt_color_schemes where user_id = ? and builtin_key = ? limit 1",
    userId,
    scheme.builtinKey
  );
  if (existing) return;
  const payload = normalizePromptColorSchemePayload(scheme as Record<string, unknown>);
  if ("error" in payload) return;
  run(
    appDb,
    `insert into prompt_color_schemes (
      id, user_id, builtin_key, name, description, category, colors_json,
      gradients_json, prompt, visible, sort_order, is_builtin, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    makeId("promptcolor"),
    userId,
    scheme.builtinKey,
    payload.name,
    payload.description,
    payload.category,
    payload.colorsJson,
    payload.gradientsJson,
    payload.prompt,
    payload.visible ? 1 : 0,
    payload.sortOrder,
    1,
    timestamp,
    timestamp
  );
}

function resetBuiltinPromptColorSchemesForUser(userId: string, timestamp: string) {
  run(appDb, "delete from prompt_color_schemes where user_id = ? and is_builtin = 1", userId);
  for (const scheme of defaultPromptColorSchemes) {
    insertBuiltinPromptColorScheme(userId, scheme, timestamp);
  }
}

function ensureDefaultPromptColorSchemesForUser(userId: string) {
  const timestamp = now();
  const existingBuiltinKeys = new Set(getAll<{ builtin_key: string }>(
    appDb,
    "select builtin_key from prompt_color_schemes where user_id = ? and is_builtin = 1",
    userId
  ).map((row) => row.builtin_key).filter(Boolean));
  for (const scheme of defaultPromptColorSchemes) {
    if (existingBuiltinKeys.has(scheme.builtinKey)) continue;
    insertBuiltinPromptColorScheme(userId, scheme, timestamp);
  }
}

function restoreDefaultPromptColorSchemesForUser(userId: string) {
  resetBuiltinPromptColorSchemesForUser(userId, now());
}

export function registerPromptColorSchemeRoutes(api: Hono) {
  api.get("/prompt-color-schemes", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    ensureDefaultPromptColorSchemesForUser(user.id);
    const includeDeleted = c.req.query("includeDeleted") === "1" || c.req.query("includeDeleted") === "true";
    return c.json({ schemes: promptColorSchemeRows(user.id, includeDeleted).map(publicPromptColorScheme) });
  });

  api.post("/prompt-color-schemes", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const body = await c.req.json().catch(() => ({}));
    const payload = normalizePromptColorSchemePayload(body as Record<string, unknown>);
    if ("error" in payload) return c.json({ error: payload.error }, 400);
    const timestamp = now();
    const id = makeId("promptcolor");
    run(
      appDb,
      `insert into prompt_color_schemes (
        id, user_id, builtin_key, name, description, category, colors_json,
        gradients_json, prompt, visible, sort_order, is_builtin, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      user.id,
      "",
      payload.name,
      payload.description,
      payload.category,
      payload.colorsJson,
      payload.gradientsJson,
      payload.prompt,
      payload.visible ? 1 : 0,
      payload.sortOrder,
      0,
      timestamp,
      timestamp
    );
    const row = getOne<PromptColorSchemeRow>(appDb, "select * from prompt_color_schemes where id = ? and user_id = ?", id, user.id);
    return c.json({ scheme: row ? publicPromptColorScheme(row) : null });
  });

  api.patch("/prompt-color-schemes/:id", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const id = c.req.param("id");
    const existing = getOne<PromptColorSchemeRow>(appDb, "select * from prompt_color_schemes where id = ? and user_id = ?", id, user.id);
    if (!existing) return c.json({ error: "色系不存在" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const payload = normalizePromptColorSchemePayload(body as Record<string, unknown>, existing);
    if ("error" in payload) return c.json({ error: payload.error }, 400);
    run(
      appDb,
      `update prompt_color_schemes
       set name = ?, description = ?, category = ?, colors_json = ?, gradients_json = ?,
           prompt = ?, visible = ?, sort_order = ?, deleted_at = '', updated_at = ?
       where id = ? and user_id = ?`,
      payload.name,
      payload.description,
      payload.category,
      payload.colorsJson,
      payload.gradientsJson,
      payload.prompt,
      payload.visible ? 1 : 0,
      payload.sortOrder,
      now(),
      id,
      user.id
    );
    const row = getOne<PromptColorSchemeRow>(appDb, "select * from prompt_color_schemes where id = ? and user_id = ? and coalesce(deleted_at, '') = ''", id, user.id);
    return c.json({ scheme: row ? publicPromptColorScheme(row) : null });
  });

  api.delete("/prompt-color-schemes/:id", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    const id = c.req.param("id");
    const existing = getOne<PromptColorSchemeRow>(
      appDb,
      "select * from prompt_color_schemes where id = ? and user_id = ? and coalesce(deleted_at, '') = ''",
      id,
      user.id
    );
    if (!existing) return c.json({ error: "色系不存在" }, 404);
    if (existing.is_builtin !== 0) {
      const timestamp = now();
      run(
        appDb,
        "update prompt_color_schemes set visible = 0, deleted_at = ?, updated_at = ? where id = ? and user_id = ?",
        timestamp,
        timestamp,
        id,
        user.id
      );
    } else {
      run(appDb, "delete from prompt_color_schemes where id = ? and user_id = ?", id, user.id);
    }
    return c.json({ ok: true });
  });

  api.post("/prompt-color-schemes/defaults/restore", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    restoreDefaultPromptColorSchemesForUser(user.id);
    return c.json({ schemes: promptColorSchemeRows(user.id).map(publicPromptColorScheme) });
  });
}
