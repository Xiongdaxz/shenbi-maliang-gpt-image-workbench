import type { Database } from "bun:sqlite";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { configDb, getAll, getOne, run, tableColumnExists } from "./db";
import { DATA_DIR } from "./paths";
import { CODEX_CLIENT_ID, CodexAuthError, codexOAuthProtocol, type CodexGrant } from "./codexOAuthProtocol";
import type { ImageAccountRow, ProviderRow } from "./types";
import { extractAuthJsonMeta, makeId, normalizeIdList, now } from "./utils";

export function initCodexCredentialSchema(db: Database) {
  for (const [column, definition] of [
    ["auth_source", "text not null default 'legacy'"], ["auth_status", "text not null default ''"],
    ["token_expires_at", "text not null default ''"], ["auth_refreshed_at", "text not null default ''"],
    ["auth_error", "text not null default ''"]]) {
    if (!tableColumnExists(db, "image_accounts", column)) db.run(`alter table image_accounts add column ${column} ${definition}`);
  }
  db.run(`create table if not exists image_account_credentials (
    account_id text primary key, issuer text not null, subject text not null, upstream_account_id text not null,
    encrypted_tokens text not null, version integer not null default 1,
    refresh_lock text not null default '', refresh_locked_until integer not null default 0,
    next_retry_at integer not null default 0,
    unique(issuer, subject, upstream_account_id)
  )`);
  db.run("create index if not exists image_accounts_oauth_expiry_idx on image_accounts(auth_source, auth_status, token_expires_at)");
}
type CredentialRow = { account_id: string; issuer: string; subject: string; upstream_account_id: string;
  encrypted_tokens: string; version: number; refresh_locked_until: number; next_retry_at: number };

export class CodexCredentialStore {
  private inFlight = new Map<string, Promise<CodexGrant>>();
  constructor(private dbSource: Database | (() => Database), private keyFile: string,
    private refreshGrant: (grant: CodexGrant) => Promise<CodexGrant> = grant => codexOAuthProtocol.refresh(grant)) {}
  private get db() { return typeof this.dbSource === "function" ? this.dbSource() : this.dbSource; }
  private key(create = false): Buffer {
    try { const key = readFileSync(this.keyFile); if (key.length !== 32) throw new Error(); return key; }
    catch (error) {
      if (create && (error as NodeJS.ErrnoException).code === "ENOENT") {
        mkdirSync(path.dirname(this.keyFile), { recursive: true, mode: 0o700 });
        try { writeFileSync(this.keyFile, randomBytes(32), { flag: "wx", mode: 0o600 }); }
        catch (writeError) { if ((writeError as NodeJS.ErrnoException).code !== "EEXIST") throw new CodexAuthError("无法保存 ChatGPT 凭据密钥，请检查服务目录权限"); }
        return this.key();
      }
      throw new CodexAuthError("ChatGPT 凭据密钥不可用，请恢复原密钥后重试");
    }
  }
  private seal(accountId: string, grant: CodexGrant) {
    const hasCredentials = Boolean(getOne(this.db, "select account_id from image_account_credentials limit 1"));
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key(!hasCredentials), iv);
    cipher.setAAD(Buffer.from(accountId));
    const data = Buffer.concat([cipher.update(JSON.stringify({ ...grant, clientId: grant.clientId || CODEX_CLIENT_ID, protocol: "codex_native" }), "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
  }
  private open(row: CredentialRow): CodexGrant {
    try {
      const bytes = Buffer.from(row.encrypted_tokens, "base64");
      const decipher = createDecipheriv("aes-256-gcm", this.key(), bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(row.account_id)); decipher.setAuthTag(bytes.subarray(12, 28));
      const grant = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")) as CodexGrant;
      if (grant.identity.issuer !== row.issuer || grant.identity.subject !== row.subject || grant.identity.accountId !== row.upstream_account_id) throw new Error();
      return grant;
    } catch (error) { if (error instanceof CodexAuthError) throw error; throw new CodexAuthError("ChatGPT 凭据无法解密，请检查密钥与数据库是否配套"); }
  }
  identity(accountId: string) {
    return getOne<{ issuer: string; subject: string; upstream_account_id: string }>(this.db,
      "select issuer, subject, upstream_account_id from image_account_credentials where account_id = ?", accountId);
  }
  private row(accountId: string) { return getOne<CredentialRow>(this.db, "select * from image_account_credentials where account_id = ?", accountId); }

  save(grant: CodexGrant, targetAccountId = "", channelId = "") {
    const { identity } = grant;
    const matching = getOne<{ account_id: string }>(this.db,
      "select account_id from image_account_credentials where issuer = ? and subject = ? and upstream_account_id = ?",
      identity.issuer, identity.subject, identity.accountId);
    if (targetAccountId && matching && matching.account_id !== targetAccountId) throw new CodexAuthError("该 ChatGPT 账号已绑定到其他记录，请在已有账号上重新授权");
    const id = targetAccountId || matching?.account_id || makeId("acct");
    const existing = getOne<ImageAccountRow>(this.db, "select * from image_accounts where id = ?", id);
    if (targetAccountId && !existing) throw new CodexAuthError("需要重新授权的账号已不存在");
    if (existing) {
      const previous = this.identity(id);
      const previousAccountId = previous?.upstream_account_id || extractAuthJsonMeta(existing.auth_json || "").accountId || extractAuthJsonMeta(existing.auth_info_json || "").accountId;
      if (previousAccountId !== identity.accountId || (previous && (previous.subject !== identity.subject || previous.issuer !== identity.issuer))) {
        throw new CodexAuthError("登录账号与原账号身份不一致，原有凭据未被替换，请使用原账号登录");
      }
    }
    const provider = channelId ? getOne<ProviderRow>(this.db, "select * from provider_configs where id = ? and channel = 'chatgpt_web'", channelId) : null;
    if (channelId && !provider) throw new CodexAuthError("请选择有效的 ChatGPT 官网生成渠道");
    if (provider?.quota_mode === "official_only") throw new CodexAuthError("该渠道仅使用官网会话，请选择支持 Codex 额度的渠道");
    const encrypted = this.seal(id, grant), timestamp = now();
    this.db.transaction(() => {
      if (existing) {
        run(this.db, `update image_accounts set email = ?, account_type = case when ? <> '' then ? else account_type end,
          access_token = null, auth_json = null, auth_info_json = null, auth_source = 'codex_oauth', auth_status = 'authorized',
          token_expires_at = ?, auth_refreshed_at = ?, auth_error = '', sync_status = 'local', updated_at = ? where id = ?`,
          identity.email || existing.email, identity.planType, identity.planType, grant.tokens.expiresAt, timestamp, timestamp, id);
      } else {
        run(this.db, `insert into image_accounts(id, name, email, account_type, channel_id, auth_source, auth_status,
          token_expires_at, auth_refreshed_at, created_at, updated_at) values (?, ?, ?, ?, ?, 'codex_oauth', 'authorized', ?, ?, ?, ?)`,
          id, identity.email || "ChatGPT 账号", identity.email, identity.planType, channelId || null, grant.tokens.expiresAt, timestamp, timestamp, timestamp);
      }
      run(this.db, `insert into image_account_credentials(account_id, issuer, subject, upstream_account_id, encrypted_tokens)
        values (?, ?, ?, ?, ?) on conflict(account_id) do update set encrypted_tokens = excluded.encrypted_tokens,
        version = image_account_credentials.version + 1, refresh_lock = '', refresh_locked_until = 0, next_retry_at = 0`,
        id, identity.issuer, identity.subject, identity.accountId, encrypted);
      if (provider) {
        run(this.db, "update provider_configs set web_account_ids = ?, updated_at = ? where id = ?",
          JSON.stringify([...new Set([...normalizeIdList(provider.web_account_ids), id])]), timestamp, provider.id);
        run(this.db, "update image_accounts set channel_id = ? where id = ?", provider.id, id);
      }
    })();
    return { accountId: id, updated: Boolean(existing), appendedToProvider: Boolean(provider) };
  }

  async fresh(accountId: string, force = false): Promise<CodexGrant> {
    const running = this.inFlight.get(accountId); if (running) return running;
    const promise = this.refresh(accountId, force); this.inFlight.set(accountId, promise);
    try { return await promise; } finally { if (this.inFlight.get(accountId) === promise) this.inFlight.delete(accountId); }
  }
  private async refresh(accountId: string, force: boolean): Promise<CodexGrant> {
    let row = this.row(accountId);
    const account = getOne<ImageAccountRow>(this.db, "select * from image_accounts where id = ?", accountId);
    if (!row || !account || account.auth_source !== "codex_oauth") throw new CodexAuthError("ChatGPT 账号凭据不存在");
    if (account.auth_status === "reauth_required") throw new CodexAuthError("该账号需要重新授权", true);
    let current = this.open(row);
    if (!force && Date.parse(current.tokens.expiresAt) > Date.now() + 180000) return current;
    if (row.next_retry_at > Date.now()) {
      if (Date.parse(current.tokens.expiresAt) > Date.now() + 10000) return current;
      throw new CodexAuthError("ChatGPT 凭据续期暂不可用，请稍后重试");
    }
    const lock = randomUUID();
    const claimed = run(this.db, `update image_account_credentials set refresh_lock = ?, refresh_locked_until = ?
      where account_id = ? and version = ? and refresh_locked_until < ?`, lock, Date.now() + 60000, accountId, row.version, Date.now());
    if (!claimed.changes) {
      // Another process may be refreshing a rotating refresh token. Never race its POST.
      for (let attempt = 0; attempt < 120; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 250));
        const latest = this.row(accountId);
        if (!latest) throw new CodexAuthError("ChatGPT 账号已移除");
        if (latest.version !== row.version) return this.open(latest);
        if (latest.refresh_locked_until < Date.now()) break;
      }
      throw new CodexAuthError("ChatGPT 凭据正在续期，请稍后重试");
    }
    try {
      const refreshed = await this.refreshGrant(current);
      const encrypted = this.seal(accountId, refreshed), timestamp = now();
      const saved = this.db.transaction(() => {
        const result = run(this.db, `update image_account_credentials set encrypted_tokens = ?, version = version + 1,
          refresh_lock = '', refresh_locked_until = 0, next_retry_at = 0 where account_id = ? and version = ? and refresh_lock = ?`,
          encrypted, accountId, row!.version, lock);
        if (result.changes) run(this.db, `update image_accounts set auth_status = 'authorized', token_expires_at = ?,
          auth_refreshed_at = ?, auth_error = '' where id = ? and auth_source = 'codex_oauth'`, refreshed.tokens.expiresAt, timestamp, accountId);
        return result.changes;
      })();
      if (!saved) { const latest = this.row(accountId); if (latest) return this.open(latest); throw new CodexAuthError("账号凭据已发生变化，请重新尝试"); }
      return refreshed;
    } catch (error) {
      const permanent = error instanceof CodexAuthError && error.permanent;
      const message = permanent ? "授权已失效，请重新授权" : "自动续期暂不可用，请检查网络后重试";
      this.db.transaction(() => {
        const result = run(this.db, `update image_account_credentials set refresh_lock = '', refresh_locked_until = 0,
          next_retry_at = ? where account_id = ? and version = ? and refresh_lock = ?`, Date.now() + 60000, accountId, row!.version, lock);
        if (result.changes) run(this.db, `update image_accounts set auth_status = ?, auth_error = ? where id = ?`, permanent ? "reauth_required" : "authorized", message, accountId);
      })();
      if (!permanent && !force && Date.parse(current.tokens.expiresAt) > Date.now() + 10000) return current;
      throw new CodexAuthError(message, permanent);
    }
  }
  remove(accountId: string) { run(this.db, "delete from image_account_credentials where account_id = ?", accountId); }
  async refreshDue() {
    const rows = getAll<{ id: string }>(this.db, `select id from image_accounts where auth_source = 'codex_oauth'
      and auth_status = 'authorized' and (local_enabled is null or local_enabled <> 0)
      and (local_enabled = 1 or status <> 'disabled') and token_expires_at <= ? limit 50`, new Date(Date.now() + 180000).toISOString());
    for (const row of rows) { try { await this.fresh(row.id); } catch { /* summary already stored, never log credentials */ } }
  }
}
export const codexCredentials = new CodexCredentialStore(() => configDb,
  Bun.env.GPT_IMAGE_CODEX_KEY_PATH?.trim() || path.join(DATA_DIR, "private", "codex-credentials.key"));
export function startCodexCredentialRefresh() {
  let running = false;
  const tick = async () => { if (running) return; running = true; try { await codexCredentials.refreshDue(); } finally { running = false; } };
  const timer = setInterval(() => void tick().catch(() => undefined), 60000); timer.unref();
  void tick().catch(() => undefined);
  return () => clearInterval(timer);
}
