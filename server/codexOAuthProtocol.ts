import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { proxySettings } from "./settingsStore";

// Codex's public native client protocol; deliberately separate from SIWC tokens.
// https://github.com/openai/codex/tree/main/codex-rs/login/src
export const CODEX_ISSUER = "https://auth.openai.com";
export const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_SCOPE = "openid profile email offline_access";
export type CodexIdentity = { issuer: string; subject: string; accountId: string; email: string; planType: string };
export type CodexTokens = { accessToken: string; refreshToken: string; idToken: string; expiresAt: string };
export type CodexGrant = { identity: CodexIdentity; tokens: CodexTokens; clientId?: string; protocol?: "codex_native" };
export class CodexAuthError extends Error {
  constructor(message: string, public permanent = false) { super(message); this.name = "CodexAuthError"; }
}

export function newCodexAuthorization(redirectUri: string) {
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const url = new URL(`${CODEX_ISSUER}/oauth/authorize`);
  url.search = new URLSearchParams({ client_id: CODEX_CLIENT_ID, response_type: "code", redirect_uri: redirectUri,
    scope: CODEX_SCOPE, state, nonce, code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256", id_token_add_organizations: "true", codex_cli_simplified_flow: "true",
    originator: "codex_cli_rs" }).toString();
  return { verifier, state, nonce, url: url.href };
}

export function parseCodexCallback(value: string, redirectUri: string, expectedState: string) {
  if (value.length > 16384) throw new CodexAuthError("回调地址过长");
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new CodexAuthError("请输入完整的回调 URL"); }
  const expected = new URL(redirectUri);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.username || url.password || url.hash) {
    throw new CodexAuthError("回调地址与本次授权不一致，请复制登录后返回的完整地址");
  }
  for (const key of ["state", "code", "error"]) {
    if (url.searchParams.getAll(key).length > 1) throw new CodexAuthError("回调地址包含重复的授权参数");
  }
  if (url.searchParams.get("state") !== expectedState) throw new CodexAuthError("该回调不属于当前授权会话");
  if (url.searchParams.has("error")) return { error: true as const, code: "" };
  const code = url.searchParams.get("code");
  if (!code || code.length > 8192) throw new CodexAuthError("回调地址缺少有效的授权码");
  return { error: false as const, code };
}

type AuthFetch = (url: string, init: RequestInit) => Promise<Response>;
export async function codexAuthFetch(url: string, init: RequestInit) {
  const proxy = proxySettings();
  try {
    // Never automatically replay token POSTs: a timed out response may already have rotated the grant.
    return await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(25000),
      ...(proxy.enabled && proxy.url ? { proxy: proxy.url } : {}) } as RequestInit);
  } catch { throw new CodexAuthError("无法连接 ChatGPT 授权服务，请检查网络或代理后重新尝试"); }
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function decodePart(value: string) { return object(JSON.parse(Buffer.from(value, "base64url").toString("utf8"))); }

export class CodexOAuthProtocol {
  private keys: Array<JsonWebKey & { kid?: string; alg?: string; use?: string }> = [];
  private keysUntil = 0;
  private keysRequest: Promise<void> | null = null;
  constructor(private request: AuthFetch = codexAuthFetch) {}

  private async loadKeys() {
    if (this.keysRequest) return this.keysRequest;
    this.keysRequest = (async () => {
      const response = await this.request(`${CODEX_ISSUER}/.well-known/jwks.json`, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new CodexAuthError("无法验证 ChatGPT 身份，请稍后重试");
      const text = await response.text();
      if (text.length > 131072) throw new CodexAuthError("授权服务返回的签名信息无效");
      const body = object(JSON.parse(text));
      if (!Array.isArray(body.keys)) throw new CodexAuthError("授权服务返回的签名信息无效");
      this.keys = body.keys as typeof this.keys; this.keysUntil = Date.now() + 3600000;
    })();
    try { await this.keysRequest; } finally { this.keysRequest = null; }
  }

  async validateIdentity(token: string, nonce?: string, clientId = CODEX_CLIENT_ID): Promise<CodexIdentity> {
    try {
      if (token.length > 65536) throw new Error();
      const parts = token.split("."); if (parts.length !== 3) throw new Error();
      const header = decodePart(parts[0]);
      if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error();
      if (this.keysUntil <= Date.now()) await this.loadKeys();
      let key = this.keys.find(key => key.kid === header.kid && key.kty === "RSA" && (!key.use || key.use === "sig") && (!key.alg || key.alg === "RS256"));
      if (!key) { await this.loadKeys(); key = this.keys.find(key => key.kid === header.kid && key.kty === "RSA" && (!key.use || key.use === "sig") && (!key.alg || key.alg === "RS256")); }
      if (!key || !verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key, format: "jwk" }), Buffer.from(parts[2], "base64url"))) throw new Error();
      const claims = decodePart(parts[1]); const seconds = Date.now() / 1000;
      if (claims.iss !== CODEX_ISSUER || !(Array.isArray(claims.aud) ? claims.aud.includes(clientId) : claims.aud === clientId) ||
        (claims.azp !== undefined && claims.azp !== clientId) ||
        typeof claims.exp !== "number" || claims.exp <= seconds || (typeof claims.nbf === "number" && claims.nbf > seconds + 60) ||
        typeof claims.sub !== "string" || !claims.sub || (nonce !== undefined && claims.nonce !== nonce)) throw new Error();
      const auth = object(claims["https://api.openai.com/auth"]);
      if (typeof auth.chatgpt_account_id !== "string" || !auth.chatgpt_account_id) throw new Error();
      return { issuer: CODEX_ISSUER, subject: claims.sub, accountId: auth.chatgpt_account_id,
        email: typeof claims.email === "string" ? claims.email : "",
        planType: typeof auth.chatgpt_plan_type === "string" ? auth.chatgpt_plan_type : "" };
    } catch (error) {
      if (error instanceof CodexAuthError) throw error;
      throw new CodexAuthError("ChatGPT 身份校验失败，请重新授权", true);
    }
  }

  private async token(body: Record<string, string>, json = false) {
    const response = await this.request(`${CODEX_ISSUER}/oauth/token`, { method: "POST",
      headers: { "Content-Type": json ? "application/json" : "application/x-www-form-urlencoded", Accept: "application/json" },
      body: json ? JSON.stringify(body) : new URLSearchParams(body) });
    const text = await response.text();
    if (text.length > 131072) throw new CodexAuthError("授权服务返回的数据无效");
    let data: Record<string, unknown>;
    try { data = object(JSON.parse(text)); } catch { throw new CodexAuthError(`授权服务暂不可用（${response.status}）`); }
    if (!response.ok) {
      const code = typeof data.error === "string" ? data.error : object(data.error).code;
      const permanent = response.status === 401 || ["invalid_grant", "refresh_token_expired", "refresh_token_reused", "refresh_token_invalidated"].includes(String(code));
      throw new CodexAuthError(permanent ? "授权已失效，请重新绑定 ChatGPT 账号" : `授权服务暂不可用（${response.status}）`, permanent);
    }
    if (typeof data.access_token !== "string" || !data.access_token) throw new CodexAuthError("授权服务未返回有效凭据");
    return data;
  }
  private tokens(data: Record<string, unknown>, previous?: CodexTokens): CodexTokens {
    const accessToken = String(data.access_token);
    let expiration = Number(data.expires_in) > 0 ? Date.now() + Number(data.expires_in) * 1000 : 0;
    if (!expiration) { try { expiration = Number(decodePart(accessToken.split(".")[1]).exp) * 1000; } catch { /* require explicit expiry for opaque tokens */ } }
    if (!Number.isFinite(expiration) || expiration <= Date.now()) throw new CodexAuthError("授权服务返回的凭据已过期");
    return { accessToken, refreshToken: typeof data.refresh_token === "string" && data.refresh_token ? data.refresh_token : previous?.refreshToken || "",
      idToken: typeof data.id_token === "string" && data.id_token ? data.id_token : previous?.idToken || "", expiresAt: new Date(expiration).toISOString() };
  }
  async exchange(code: string, verifier: string, redirectUri: string, nonce: string): Promise<CodexGrant> {
    const data = await this.token({ grant_type: "authorization_code", client_id: CODEX_CLIENT_ID, code, code_verifier: verifier, redirect_uri: redirectUri });
    const tokens = this.tokens(data);
    if (!tokens.idToken || !tokens.refreshToken) throw new CodexAuthError("授权未包含完整的登录与续期凭据，请重新授权");
    return { tokens, identity: await this.validateIdentity(tokens.idToken, nonce), clientId: CODEX_CLIENT_ID, protocol: "codex_native" };
  }
  async refresh(grant: CodexGrant): Promise<CodexGrant> {
    const clientId = grant.clientId || CODEX_CLIENT_ID;
    const data = await this.token({ grant_type: "refresh_token", client_id: clientId, refresh_token: grant.tokens.refreshToken }, true);
    const tokens = this.tokens(data, grant.tokens);
    const identity = typeof data.id_token === "string" && data.id_token ? await this.validateIdentity(tokens.idToken, undefined, clientId) : grant.identity;
    if (identity.subject !== grant.identity.subject || identity.accountId !== grant.identity.accountId) throw new CodexAuthError("续期返回了不同账号，请重新授权", true);
    return { identity, tokens, clientId, protocol: "codex_native" };
  }
}
export const codexOAuthProtocol = new CodexOAuthProtocol();
