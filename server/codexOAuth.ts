import { createHash, randomUUID } from "node:crypto";
import { CodexAuthError, codexOAuthProtocol, newCodexAuthorization, parseCodexCallback, type CodexGrant } from "./codexOAuthProtocol";

const callbackStyle = `:root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}body{margin:0;text-align:center;background:light-dark(#f8f9fa,#171918);color:light-dark(#202522,#f0f2ef)}main{box-sizing:border-box;width:100%;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:40px 24px}h1{max-width:520px;font-size:24px;line-height:1.5;font-weight:600;margin:0 0 14px}p{max-width:520px;font-size:14px;line-height:1.8;margin:0;color:light-dark(#68736c,#b2bcb5)}`;
const callbackStyleHash = createHash("sha256").update(callbackStyle).digest("base64");

export type CodexSessionStatus = "waiting" | "exchanging" | "saving" | "save_failed" | "succeeded" | "failed" | "expired" | "cancelled";
type SavedAccount = { accountId: string; updated: boolean; appendedToProvider: boolean };
type Session = { id: string; owner: string; targetAccountId: string; channelId: string; state: string; nonce: string; verifier: string;
  authUrl: string; redirectUri: string; expiresAt: number; status: CodexSessionStatus; message: string; autoCallback: boolean;
  result?: SavedAccount; grant?: CodexGrant; processing?: Promise<void> };
type Options = { save: (grant: CodexGrant, targetAccountId: string, channelId: string) => SavedAccount;
  exchange?: typeof codexOAuthProtocol.exchange; listen?: boolean; ttlMs?: number; ports?: number[]; isOwnerActive?: (owner: string) => boolean };
export class CodexOAuthSessions {
  private sessions = new Map<string, Session>();
  private listener: ReturnType<typeof Bun.serve> | null = null;
  private listenerPort = 0;
  private exchange: NonNullable<Options["exchange"]>;
  constructor(private options: Options) { this.exchange = options.exchange || codexOAuthProtocol.exchange.bind(codexOAuthProtocol); }
  private prepareListener() {
    if (this.listener) return;
    if (this.options.listen === false) return;
    for (const port of this.options.ports || [1455, 1457]) {
      try {
        this.listener = Bun.serve({ hostname: "127.0.0.1", port, idleTimeout: 40,
          fetch: request => this.callback(request) });
        this.listener.unref(); this.listenerPort = this.listener.port!; return;
      } catch { /* never interrupt another application's login listener */ }
    }
  }
  private expire(session: Session) {
    if (Date.now() >= session.expiresAt && ["waiting", "save_failed"].includes(session.status)) {
      session.status = "expired"; session.message = "授权会话已过期，请重新发起"; this.clearSecrets(session);
    }
  }
  private clearSecrets(session: Session) { session.verifier = ""; session.nonce = ""; session.authUrl = ""; session.grant = undefined; }
  private view(session: Session) {
    this.expire(session);
    return { id: session.id, status: session.status, message: session.message, authUrl: session.authUrl,
      redirectUri: session.redirectUri, autoCallback: session.autoCallback, expiresAt: new Date(session.expiresAt).toISOString(),
      targetAccountId: session.targetAccountId, result: session.result || null };
  }
  sweep() {
    for (const [id, session] of this.sessions) { this.expire(session); if (!session.processing && Date.now() > session.expiresAt + 300000) this.sessions.delete(id); }
    if (this.listener && ![...this.sessions.values()].some(session => ["waiting", "exchanging", "saving"].includes(session.status))) {
      this.listener.stop(); this.listener = null; this.listenerPort = 0;
    }
  }
  create(owner: string, targetAccountId = "", channelId = "") {
    this.sweep();
    const existing = [...this.sessions.values()].find(session => session.owner === owner && ["waiting", "exchanging", "saving", "save_failed"].includes(session.status));
    if (existing) {
      if (existing.targetAccountId !== targetAccountId || existing.channelId !== channelId) throw new CodexAuthError("已有账号授权正在进行，请先完成或结束该授权");
      return this.view(existing);
    }
    if (this.sessions.size >= 100) throw new CodexAuthError("授权会话过多，请稍后重试");
    this.prepareListener();
    const redirectUri = `http://127.0.0.1:${this.listenerPort || 1455}/auth/callback`;
    const auth = newCodexAuthorization(redirectUri);
    const session: Session = { id: randomUUID(), owner, targetAccountId, channelId, state: auth.state, nonce: auth.nonce,
      verifier: auth.verifier, authUrl: auth.url, redirectUri, expiresAt: Date.now() + (this.options.ttlMs ?? 600000),
      status: "waiting", message: "等待完成授权", autoCallback: Boolean(this.listener) };
    this.sessions.set(session.id, session); return this.view(session);
  }
  private owned(owner: string, id: string) {
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner) throw new CodexAuthError("授权会话不存在或已结束，请重新发起");
    if (this.options.isOwnerActive && !this.options.isOwnerActive(owner)) {
      session.status = "cancelled"; session.message = "配置登录已失效，请重新登录后发起授权"; this.clearSecrets(session);
      throw new CodexAuthError(session.message);
    }
    this.expire(session); return session;
  }
  get(owner: string, id: string) { return this.view(this.owned(owner, id)); }
  cancel(owner: string, id: string) {
    const session = this.owned(owner, id);
    if (session.processing) throw new CodexAuthError("正在处理授权，请等待保存结果");
    if (["waiting", "save_failed"].includes(session.status)) {
      session.status = "cancelled"; session.message = "本次授权已结束"; this.clearSecrets(session);
    }
    return this.view(session);
  }
  async submit(owner: string, id: string, callbackUrl: string) {
    const session = this.owned(owner, id);
    // Validate even a duplicate submission before allowing it to join an in-flight exchange.
    const callback = session.grant ? null : parseCodexCallback(callbackUrl, session.redirectUri, session.state);
    if (session.processing) { await session.processing; return this.view(session); }
    if (session.status === "succeeded") return this.view(session);
    if (!["waiting", "save_failed"].includes(session.status)) throw new CodexAuthError(session.message || "该授权会话已结束");
    if (callback?.error) { session.status = "failed"; session.message = "授权未完成或已被拒绝，请重新发起"; this.clearSecrets(session); return this.view(session); }
    session.status = session.grant ? "saving" : "exchanging";
    const operation = (async () => {
      try {
        if (!session.grant) session.grant = await this.exchange(callback!.code, session.verifier, session.redirectUri, session.nonce);
        this.owned(owner, id);
        session.status = "saving"; session.message = "正在保存账号";
        session.result = this.options.save(session.grant, session.targetAccountId, session.channelId);
        session.status = "succeeded"; session.message = session.result.updated ? "账号授权已更新" : "ChatGPT 账号已绑定"; this.clearSecrets(session);
      } catch (error) {
        session.status = session.grant ? "save_failed" : "failed";
        session.message = error instanceof CodexAuthError ? error.message : (session.grant ? "授权成功，但凭据保存失败，请重试保存" : "授权处理失败，请重新发起");
        if (!session.grant) this.clearSecrets(session);
      }
    })();
    session.processing = operation;
    try { await operation; } finally { session.processing = undefined; }
    return this.view(session);
  }
  private async callback(request: Request) {
    const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": `default-src 'none'; style-src 'sha256-${callbackStyleHash}'; frame-ancestors 'none'; base-uri 'none'`, "X-Content-Type-Options": "nosniff" };
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/auth/callback") return new Response("Not found", { status: 404, headers });
    const state = url.searchParams.get("state");
    const session = [...this.sessions.values()].find(session => session.state === state);
    let success = false;
    if (session) { try { success = (await this.submit(session.owner, session.id, url.href)).status === "succeeded"; } catch { /* response never echoes callback or credentials */ } }
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ChatGPT 账号授权</title><style>${callbackStyle}</style></head><body><main role="status"><h1>${success ? "ChatGPT 账号已绑定" : "请返回账号管理查看授权结果"}</h1><p>${success ? "授权已完成，可以关闭此页面并返回账号管理。" : "请返回原页面查看详细状态，必要时重新发起授权。"}</p></main></body></html>`;
    return new Response(html, { status: success ? 200 : 400, headers });
  }
  stop() { this.listener?.stop(true); this.listener = null; this.listenerPort = 0; for (const session of this.sessions.values()) this.clearSecrets(session); this.sessions.clear(); }
}
