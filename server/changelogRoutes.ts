import type { Hono } from "hono";
import { audit } from "./auditLog";
import { requireConfig, requireUser } from "./auth";
import { configDb, getAll, getOne, run } from "./db";
import type { ChangelogEntryRow } from "./types";
import { makeId, now } from "./utils";

export type ChangelogEntry = {
  id: string;
  version: string;
  date: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

function todayDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function toChangelogEntry(row: ChangelogEntryRow): ChangelogEntry {
  return {
    id: row.id,
    version: row.version,
    date: row.release_date,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function readChangelogEntries() {
  return getAll<ChangelogEntryRow>(
    configDb,
    `select * from changelog_entries
     order by release_date desc, created_at desc`
  ).map(toChangelogEntry);
}

function normalizeVersion(value: unknown) {
  const version = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!version) return "";
  if (version.length > 80) return "";
  if (/[\\/#\r\n]/.test(version)) return "";
  return version;
}

function normalizeDate(value: unknown) {
  const date = String(value ?? "").trim();
  if (!date) return todayDate();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function normalizeContent(value: unknown) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim().slice(0, 50000);
}

function entryPayload(body: Record<string, unknown>) {
  const version = normalizeVersion(body.version);
  const date = normalizeDate(body.date);
  const content = normalizeContent(body.content);
  if (!version) return { error: "请输入有效版本号" as const };
  if (!date) return { error: "日期格式应为 YYYY-MM-DD" as const };
  if (!content) return { error: "请输入更新记录" as const };
  return { entry: { version, date, content } };
}

export function registerChangelogRoutes(api: Hono) {
  api.get("/changelog", async (c) => {
    const user = await requireUser(c);
    if (!user) return c.json({ error: "未登录" }, 401);
    return c.json({ entries: readChangelogEntries() });
  });

  api.get("/config/changelog", async (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    return c.json({ entries: readChangelogEntries() });
  });

  api.post("/config/changelog", async (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    const body = await c.req.json().catch(() => ({}));
    const payload = entryPayload(body);
    if ("error" in payload) return c.json({ error: payload.error }, 400);
    const timestamp = now();
    const id = makeId("changelog");
    try {
      run(
        configDb,
        `insert into changelog_entries (
          id, version, release_date, content, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?)`,
        id,
        payload.entry.version,
        payload.entry.date,
        payload.entry.content,
        timestamp,
        timestamp
      );
    } catch {
      return c.json({ error: "版本号已存在" }, 409);
    }
    audit("changelog.create", { version: payload.entry.version });
    return c.json({ entries: readChangelogEntries() });
  });

  api.patch("/config/changelog/:id", async (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    const id = c.req.param("id");
    const existing = getOne<ChangelogEntryRow>(configDb, "select * from changelog_entries where id = ?", id);
    if (!existing) return c.json({ error: "更新日志不存在" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const payload = entryPayload(body);
    if ("error" in payload) return c.json({ error: payload.error }, 400);
    try {
      run(
        configDb,
        `update changelog_entries
         set version = ?, release_date = ?, content = ?, updated_at = ?
         where id = ?`,
        payload.entry.version,
        payload.entry.date,
        payload.entry.content,
        now(),
        id
      );
    } catch {
      return c.json({ error: "版本号已存在" }, 409);
    }
    audit("changelog.update", { changelogId: id, version: payload.entry.version, originalVersion: existing.version });
    return c.json({ entries: readChangelogEntries() });
  });

  api.delete("/config/changelog/:id", async (c) => {
    const blocked = requireConfig(c);
    if (blocked) return blocked;
    const id = c.req.param("id");
    const existing = getOne<ChangelogEntryRow>(configDb, "select * from changelog_entries where id = ?", id);
    if (!existing) return c.json({ error: "更新日志不存在" }, 404);
    run(configDb, "delete from changelog_entries where id = ?", id);
    audit("changelog.delete", { changelogId: id, version: existing.version });
    return c.json({ entries: readChangelogEntries() });
  });
}
