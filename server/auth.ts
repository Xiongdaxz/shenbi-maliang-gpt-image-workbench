import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { APP_COOKIE, CONFIG_COOKIE } from "./constants";
import { appDb, configDb, getOne } from "./db";
import type { UserRow } from "./types";
import { now, utcNow } from "./utils";

export async function currentUser(c: Context) {
  const sessionId = getCookie(c, APP_COOKIE);
  if (!sessionId) return null;
  const session = getOne<{ user_id: string }>(
    appDb,
    "select user_id from user_auth_sessions where id = ? and expires_at > ?",
    sessionId,
    utcNow()
  );
  if (!session) return null;
  return getOne<UserRow>(
    appDb,
    "select * from users where id = ? and disabled = 0",
    session.user_id
  );
}

export async function requireUser(c: Context) {
  const user = await currentUser(c);
  if (!user) return null;
  return user;
}

export function isConfigReady() {
  return Boolean(getOne<{ id: string }>(configDb, "select id from config_admin limit 1"));
}

export function isConfigAuthed(c: Context) {
  const sessionId = getCookie(c, CONFIG_COOKIE);
  if (!sessionId) return false;
  return Boolean(
    getOne<{ id: string }>(
      configDb,
      "select id from config_auth_sessions where id = ? and expires_at > ?",
      sessionId,
      utcNow()
    )
  );
}

export function requireConfig(c: Context) {
  if (!isConfigAuthed(c)) {
    return c.json({ error: "配置页面未登录" }, 401);
  }
  return null;
}

export function futureDate(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}
