import type { Hono, Context } from "hono";
import { getCookie } from "hono/cookie";
import { requireConfig } from "./auth";
import { CONFIG_COOKIE } from "./constants";
import { configDb, getOne, run } from "./db";
import { codexCredentials } from "./codexCredentials";
import { CodexOAuthSessions } from "./codexOAuth";
import { CodexAuthError } from "./codexOAuthProtocol";
import { toImageAccount } from "./serializers";
import type { ImageAccountRow, ProviderRow } from "./types";
import { normalizeIdList, now, utcNow } from "./utils";
import { audit } from "./auditLog";

export const codexOAuthSessions = new CodexOAuthSessions({
  isOwnerActive: owner => Boolean(getOne(configDb, "select id from config_auth_sessions where id = ? and expires_at > ?", owner, utcNow())),
  save(grant, target, channel) {
  const result = codexCredentials.save(grant, target, channel);
  audit("image_account.codex_bound", { accountId: result.accountId, updated: result.updated }); return result;
} });
export function registerCodexOAuthRoutes(api: Hono, sessions = codexOAuthSessions) {
  const handle = (operation: (c: Context) => Response | Promise<Response>) => async (c: Context) => {
    try { return await operation(c); }
    catch (error) { return c.json({ error: error instanceof CodexAuthError ? error.message : "ChatGPT 授权处理失败，请稍后重试" }, 400); }
  };
  api.use("/config/codex-oauth/*", async (c, next) => {
    const blocked = requireConfig(c); if (blocked) return blocked;
    c.header("Cache-Control", "no-store");
    if (c.req.method !== "GET") {
      const origin = c.req.header("Origin");
      if (origin) {
        try { if (new URL(origin).host !== new URL(c.req.url).host) return c.json({ error: "授权请求来源不一致，请刷新页面后重试" }, 403); }
        catch { return c.json({ error: "授权请求来源无效" }, 403); }
      }
      if (c.req.header("Sec-Fetch-Site") === "cross-site") return c.json({ error: "不允许跨站授权请求" }, 403);
      const length = Number(c.req.header("Content-Length"));
      if (length > 20000) return c.json({ error: "授权请求过大" }, 413);
    }
    await next();
  });
  api.post("/config/codex-oauth/sessions", handle(async c => {
    const body = await c.req.json().catch(() => ({}));
    const target = typeof body.targetAccountId === "string" ? body.targetAccountId : "";
    const channel = typeof body.channelId === "string" ? body.channelId : "";
    if (target && !getOne(configDb, "select id from image_accounts where id = ?", target)) return c.json({ error: "账号不存在" }, 404);
    if (channel && !getOne(configDb, "select id from provider_configs where id = ? and channel = 'chatgpt_web' and quota_mode <> 'official_only'", channel)) return c.json({ error: "请选择支持 Codex 的生成渠道" }, 400);
    return c.json({ session: sessions.create(getCookie(c, CONFIG_COOKIE)!, target, channel) });
  }));
  api.get("/config/codex-oauth/sessions/:id", handle(c => {
    const session = sessions.get(getCookie(c, CONFIG_COOKIE)!, c.req.param("id")!);
    const row = session.result ? getOne<ImageAccountRow>(configDb, "select * from image_accounts where id = ?", session.result.accountId) : null;
    return c.json({ session, account: row ? toImageAccount(row) : null });
  }));
  api.post("/config/codex-oauth/sessions/:id/callback", handle(async c => {
    const body = await c.req.json().catch(() => ({}));
    return c.json({ session: await sessions.submit(getCookie(c, CONFIG_COOKIE)!, c.req.param("id")!, typeof body.callbackUrl === "string" ? body.callbackUrl : "") });
  }));
  api.delete("/config/codex-oauth/sessions/:id", handle(c => c.json({ session: sessions.cancel(getCookie(c, CONFIG_COOKIE)!, c.req.param("id")!) })));
  api.post("/config/codex-oauth/sessions/:id/channel", handle(async c => {
    const session = sessions.get(getCookie(c, CONFIG_COOKIE)!, c.req.param("id")!);
    if (!session.result) return c.json({ error: "请先完成账号绑定" }, 400);
    const body = await c.req.json().catch(() => ({}));
    const channelId = typeof body.channelId === "string" ? body.channelId : "";
    const provider = getOne<ProviderRow>(configDb, "select * from provider_configs where id = ? and channel = 'chatgpt_web' and quota_mode <> 'official_only'", channelId);
    const account = getOne<ImageAccountRow>(configDb, "select * from image_accounts where id = ? and auth_source = 'codex_oauth'", session.result.accountId);
    if (!provider || !account) return c.json({ error: "账号或所选生成渠道不可用" }, 400);
    configDb.transaction(() => {
      run(configDb, "update provider_configs set web_account_ids = ?, updated_at = ? where id = ?", JSON.stringify([...new Set([...normalizeIdList(provider.web_account_ids), account.id])]), now(), channelId);
      run(configDb, "update image_accounts set channel_id = ?, updated_at = ? where id = ?", channelId, now(), account.id);
    })();
    audit("image_account.codex_channel", { accountId: account.id, channelId });
    return c.json({ ok: true });
  }));
}
