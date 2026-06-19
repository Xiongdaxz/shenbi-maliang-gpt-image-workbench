import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { serveStatic } from "hono/bun";
import {
  CONFIG_COOKIE,
  DEFAULT_IMAGE_SIZES,
  DEFAULT_RESPONSES_MODEL,
  IMAGE_JOB_RUNNING_TIMEOUT_MS,
  SESSION_MAX_AGE,
  requestImageResultRetryCount,
  requestImageSize
} from "./constants";
import { audit } from "./auditLog";
import { defaultTeamId } from "./categories";
import { appDb, configDb, getAll, getOne, run } from "./db";
import { globalSwitches, saveGlobalSwitch, type GlobalSwitchType } from "./globalSwitches";
import { mimeTypeFromPath } from "./imageFiles";
import { loginAssetFile } from "./loginAssets";
import {
  ROOT
} from "./paths";
import type {
  AssetRow,
  ImageAccountRow,
  ModelRequestLogRow,
  ProviderRequestLogRow,
  ProviderRow,
  TeamRow,
  UserRow
} from "./types";
import {
  assetUrlFromAssetId,
  imageUrlFromImageId,
  toImageAccount,
  toProvider
} from "./serializers";
import { cpaAccount, debugSettings, imageGenerationSettings, proxySettings } from "./settingsStore";
import {
  extractAuthJsonMeta,
  inferChannelFromType,
  makeId,
  makeProviderConfigId,
  normalizeCategoryType,
  normalizeAssetShareStatus,
  normalizeIdList,
  normalizeReviewStatus,
  normalizeImageAccountStatus,
  normalizeImageGenerationMode,
  normalizeProviderChannel,
  normalizeQuotaMode,
  normalizeRouteMode,
  normalizeWebAccountMode,
  localTimestamp,
  now,
  safeJson
} from "./utils";
import { initAppDb, initConfigDb, seedCases, seedPromptTemplates, seedProvider } from "./schema";
import { pullCpaImageAccounts, refreshImageAccountUsages } from "./providerRuntime";
import {
  futureDate,
  isConfigAuthed,
  isConfigReady,
  requireConfig
} from "./auth";
import { registerAssetRoutes } from "./assetRoutes";
import { registerBackupRoutes, startBackupScheduler } from "./backupRoutes";
import { registerBrandingRoutes } from "./branding";
import { registerCaseRoutes } from "./caseRoutes";
import { registerChangelogRoutes } from "./changelogRoutes";
import { registerFileRoutes } from "./fileRoutes";
import { registerImageRoutes } from "./imageRoutes";
import { registerPromptOptimizerRoutes } from "./promptOptimizerRoutes";
import { registerPromptReferenceLinkRoutes } from "./promptReferenceLinkRoutes";
import { registerPromptTemplateRoutes } from "./promptTemplateRoutes";
import { registerSearchHistoryRoutes } from "./searchHistoryRoutes";
import { registerSafetyReviewRoutes } from "./safetyReview";
import { registerStarterCopyRoutes, startStarterCopyScheduler } from "./starterCopyRoutes";
import { registerUserRoutes } from "./userRoutes";
import { migrateExistingFilesToSecureStorage } from "./secureFiles";
import { saveSmtpSettings, sendSmtpTestEmail, smtpSettings } from "./smtp";
import { normalizePhone as normalizeSmsPhone, saveSmsSettings, sendSmsTest, smsSettings, validMainlandPhone } from "./sms";
import { validateUsername } from "./usernamePolicy";
import { registrationSettings, saveRegistrationSettings } from "./registrationSettings";
import { deleteUserAccount } from "./userDeletion";

initAppDb();
initConfigDb();
seedCases();
seedPromptTemplates();
seedProvider();
await migrateExistingFilesToSecureStorage();

const api = new Hono();

function apiErrorMessage(error: unknown, fallback = "服务异常") {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    const nested = record.error;
    if (typeof nested === "string" && nested.trim()) return nested;
    if (nested && typeof nested === "object") {
      const message = (nested as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim()) return message;
    }
  }
  const text = String(error ?? "").trim();
  return text || fallback;
}

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizePhone(value: unknown) {
  return normalizeSmsPhone(value);
}

function isValidEmail(value: string) {
  return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

const CPA_SYNC_MIN_FREQUENCY_MINUTES = 5;
const CPA_SYNC_FALLBACK_FREQUENCY_MINUTES = 60;
let cpaSyncTimer: ReturnType<typeof setTimeout> | null = null;
let cpaSyncNextRunAt = "";
let cpaSyncInFlight: Promise<CpaSyncResult> | null = null;

type CpaSyncResult = {
  status: string;
  message: string;
  startedAt: string;
  finishedAt: string;
  created?: number;
  updated?: number;
  skipped?: number;
};

function normalizeCpaFrequencyMinutes(value: unknown) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes)) return CPA_SYNC_FALLBACK_FREQUENCY_MINUTES;
  return Math.max(CPA_SYNC_MIN_FREQUENCY_MINUTES, Math.trunc(minutes));
}

function latestCpaSyncFinishedAt() {
  const row = getOne<{ finished_at: string }>(
    configDb,
    "select finished_at from cpa_sync_runs order by finished_at desc limit 1"
  );
  return row?.finished_at ?? "";
}

async function executeCpaSync(source: "manual" | "scheduled" = "manual"): Promise<CpaSyncResult> {
  if (cpaSyncInFlight) return cpaSyncInFlight;
  cpaSyncInFlight = (async () => {
    const started = now();
    const account = cpaAccount(true);
    let status = "skipped";
    let message = "CPA 同步未启用，或未配置管理地址/访问密码";
    let detail: Record<string, number> = {};

    if (account.enabled && account.syncUrl && account.passwordSecret) {
      try {
        const result = await pullCpaImageAccounts(account);
        status = result.ok ? "succeeded" : "failed";
        message = result.message;
        detail = {
          created: result.created,
          updated: result.updated,
          skipped: result.skipped
        };
      } catch (error) {
        status = "failed";
        message = error instanceof Error ? error.message : "CPA 同步失败";
      }
    }

    const finished = now();
    run(
      configDb,
      "insert into cpa_sync_runs (id, status, message, started_at, finished_at) values (?, ?, ?, ?, ?)",
      makeId("cparun"),
      status,
      message,
      started,
      finished
    );
    run(
      configDb,
      "update cpa_accounts set last_status = ?, updated_at = ? where id = ?",
      `${status}: ${message}`,
      finished,
      "cpa_default"
    );
    audit("cpa.sync", { source, status, message, ...detail });
    return { status, message, startedAt: started, finishedAt: finished, ...detail };
  })();
  try {
    return await cpaSyncInFlight;
  } finally {
    cpaSyncInFlight = null;
  }
}

function scheduleCpaSync() {
  if (cpaSyncTimer) clearTimeout(cpaSyncTimer);
  cpaSyncTimer = null;
  cpaSyncNextRunAt = "";

  const account = cpaAccount(true);
  if (!account.enabled || !account.syncUrl || !account.passwordSecret) return;

  const frequencyMs = normalizeCpaFrequencyMinutes(account.frequencyMinutes) * 60_000;
  const lastFinishedAt = latestCpaSyncFinishedAt();
  const lastFinishedMs = lastFinishedAt ? Date.parse(lastFinishedAt) : Number.NaN;
  const dueAt = Number.isFinite(lastFinishedMs) ? lastFinishedMs + frequencyMs : Date.now() + 1000;
  const delayMs = Math.max(1000, dueAt - Date.now());
  cpaSyncNextRunAt = localTimestamp(new Date(Date.now() + delayMs));

  cpaSyncTimer = setTimeout(async () => {
    try {
      await executeCpaSync("scheduled");
    } catch (error) {
      console.error("CPA scheduled sync failed", error);
    } finally {
      scheduleCpaSync();
    }
  }, delayMs);
}

function assertGlobalSwitchCanEnable(type: GlobalSwitchType, enabled: boolean) {
  if (!enabled) return;
  if (type === "smtp_service") {
    const settings = smtpSettings(true);
    if (!settings.host) throw new Error("启用 SMTP 必须填写服务器地址");
    if (!settings.fromEmail) throw new Error("启用 SMTP 必须填写发件邮箱");
    if (settings.username && !settings.passwordSecret) throw new Error("启用 SMTP 账号登录必须填写邮箱密码或授权码");
  }
  if (type === "sms_service") {
    const settings = smsSettings(true);
    if (!settings.secretId) throw new Error("启用短信服务必须填写 SecretId");
    if (!settings.secretKeySecret) throw new Error("启用短信服务必须填写 SecretKey");
    if (!settings.smsSdkAppId) throw new Error("启用短信服务必须填写短信应用 ID");
    if (!settings.signName) throw new Error("启用短信服务必须填写短信签名");
    if (!settings.registerTemplateId) throw new Error("启用短信服务必须填写注册验证码模板 ID");
  }
  if (type === "proxy_service") {
    const settings = proxySettings();
    if (!settings.url.trim()) throw new Error("启用代理必须填写代理地址");
  }
  if (type === "cpa_sync") {
    const account = cpaAccount(true);
    if (!account.syncUrl) throw new Error("启用 CPA 同步必须填写管理地址");
    if (!account.passwordSecret) throw new Error("启用 CPA 同步必须填写访问密码");
  }
}

api.onError((error, c) => {
  console.error("API 请求失败", error);
  return c.json({ error: apiErrorMessage(error) }, 500);
});

api.get("/health", (c) => c.json({ ok: true }));

registerUserRoutes(api);

registerBrandingRoutes(api);

registerFileRoutes(api);

registerCaseRoutes(api);

registerPromptReferenceLinkRoutes(api);

registerPromptTemplateRoutes(api);

registerImageRoutes(api);

registerAssetRoutes(api);

registerSearchHistoryRoutes(api);

registerChangelogRoutes(api);

registerPromptOptimizerRoutes(api);

registerSafetyReviewRoutes(api);

registerStarterCopyRoutes(api);

registerBackupRoutes(api);

api.get("/config/auth/status", (c) => {
  return c.json({
    setupRequired: !isConfigReady(),
    authenticated: isConfigAuthed(c)
  });
});

api.post("/config/auth/setup", async (c) => {
  if (isConfigReady()) return c.json({ error: "配置密码已经初始化" }, 409);
  const body = await c.req.json().catch(() => ({}));
  const password = String(body.password ?? "");
  if (password.length < 4) return c.json({ error: "配置密码至少 4 位" }, 400);
  const timestamp = now();
  run(
    configDb,
    "insert into config_admin (id, password_hash, created_at, updated_at) values (?, ?, ?, ?)",
    "admin",
    await Bun.password.hash(password),
    timestamp,
    timestamp
  );
  audit("config.setup");
  return c.json({ ok: true });
});

api.post("/config/auth/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const password = String(body.password ?? "");
  const admin = getOne<{ password_hash: string }>(configDb, "select password_hash from config_admin limit 1");
  if (!admin) return c.json({ error: "请先初始化配置密码" }, 400);
  const ok = await Bun.password.verify(password, admin.password_hash);
  if (!ok) return c.json({ error: "配置密码不正确" }, 401);
  const sessionId = makeId("cfgsess");
  run(
    configDb,
    "insert into config_auth_sessions (id, expires_at, created_at) values (?, ?, ?)",
    sessionId,
    futureDate(SESSION_MAX_AGE),
    now()
  );
  setCookie(c, CONFIG_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_MAX_AGE
  });
  audit("config.login");
  return c.json({ ok: true });
});

api.post("/config/auth/logout", (c) => {
  const sessionId = getCookie(c, CONFIG_COOKIE);
  if (sessionId) run(configDb, "delete from config_auth_sessions where id = ?", sessionId);
  deleteCookie(c, CONFIG_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

api.get("/config/registration-settings", (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  return c.json({ settings: registrationSettings() });
});

api.put("/config/registration-settings", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const body = await c.req.json().catch(() => ({}));
  const settings = saveRegistrationSettings(body as Record<string, unknown>);
  audit("registration_settings.save", { enabled: settings.enabled });
  return c.json({ settings });
});

api.get("/config/global-switches", (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  return c.json({ switches: globalSwitches() });
});

api.put("/config/global-switches/:type", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const type = c.req.param("type") as GlobalSwitchType;
  const body = await c.req.json().catch(() => ({}));
  const enabled = Boolean((body as Record<string, unknown>).enabled);
  assertGlobalSwitchCanEnable(type, enabled);
  const setting = saveGlobalSwitch(type, enabled);
  audit("global_switch.save", { type: setting.type, enabled: setting.enabled });
  return c.json({ switch: setting, switches: globalSwitches() });
});

api.get("/config/smtp-settings", (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  return c.json({ settings: smtpSettings(false) });
});

api.put("/config/smtp-settings", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const body = await c.req.json().catch(() => ({}));
  const settings = saveSmtpSettings(body);
  audit("smtp_settings.save", {
    enabled: settings.enabled,
    useProxy: settings.useProxy,
    host: settings.host,
    fromEmail: settings.fromEmail,
    testRecipientEmail: settings.testRecipientEmail
  });
  return c.json({ settings });
});

api.post("/config/smtp-settings/test", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const body = await c.req.json().catch(() => ({}));
  const settings = smtpSettings(true);
  const requestedEmail = String(body.email ?? "").trim();
  const email = (requestedEmail || settings.testRecipientEmail || settings.fromEmail || "").trim().toLowerCase();
  if (!email) return c.json({ error: "请输入测试收件邮箱" }, 400);
  await sendSmtpTestEmail(email);
  audit("smtp_settings.test", { email });
  return c.json({ ok: true });
});

api.get("/config/sms-settings", (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  return c.json({ settings: smsSettings(false) });
});

api.put("/config/sms-settings", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const body = await c.req.json().catch(() => ({}));
  const settings = saveSmsSettings(body);
  audit("sms_settings.save", {
    enabled: settings.enabled,
    provider: settings.provider,
    region: settings.region,
    smsSdkAppId: settings.smsSdkAppId,
    signName: settings.signName,
    registerTemplateId: settings.registerTemplateId,
    passwordResetTemplateId: settings.passwordResetTemplateId,
    testPhone: settings.testPhone
  });
  return c.json({ settings });
});

api.post("/config/sms-settings/test", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const body = await c.req.json().catch(() => ({}));
  const settings = smsSettings(true);
  const phone = normalizeSmsPhone(body.phone || settings.testPhone);
  if (!phone) return c.json({ error: "请输入测试手机号" }, 400);
  if (!validMainlandPhone(phone)) return c.json({ error: "请输入中国大陆 11 位手机号" }, 400);
  await sendSmsTest(phone);
  audit("sms_settings.test", { phone });
  return c.json({ ok: true });
});

api.get("/config/teams", (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const teams = getAll<TeamRow & { user_count: number; image_count: number; session_count: number }>(
    appDb,
    `select t.*,
      (select count(*) from users u where u.team_id = t.id) as user_count,
      (select count(*) from images i join users u on u.id = i.user_id where u.team_id = t.id) as image_count,
      (select count(*) from sessions s join users u on u.id = s.user_id where u.team_id = t.id and s.deleted_at is null) as session_count
     from teams t
     order by t.created_at asc`
  );
  return c.json({
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      description: team.description,
      userCount: team.user_count,
      imageCount: team.image_count,
      sessionCount: team.session_count,
      createdAt: team.created_at,
      updatedAt: team.updated_at
    }))
  });
});

api.post("/config/teams", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const description = String(body.description ?? "").trim();
  if (!name) return c.json({ error: "请输入团队名称" }, 400);
  const id = makeId("team");
  const timestamp = now();
  run(
    appDb,
    "insert into teams (id, name, description, created_at, updated_at) values (?, ?, ?, ?, ?)",
    id,
    name,
    description,
    timestamp,
    timestamp
  );
  audit("team.create", { teamId: id, name });
  return c.json({ team: { id, name, description, userCount: 0, imageCount: 0, sessionCount: 0, createdAt: timestamp, updatedAt: timestamp } });
});

api.patch("/config/teams/:id", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name ?? "").trim();
  const description = String(body.description ?? "").trim();
  if (!name) return c.json({ error: "请输入团队名称" }, 400);
  run(
    appDb,
    "update teams set name = ?, description = ?, updated_at = ? where id = ?",
    name,
    description,
    now(),
    c.req.param("id")
  );
  audit("team.update", { teamId: c.req.param("id"), name });
  return c.json({ ok: true });
});

api.delete("/config/teams/:id", (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const teamId = c.req.param("id");
  if (teamId === defaultTeamId()) return c.json({ error: "默认团队不能删除" }, 400);
  const userCount = getOne<{ total: number }>(
    appDb,
    "select count(*) as total from users where team_id = ?",
    teamId
  )?.total ?? 0;
  if (userCount > 0) return c.json({ error: "团队下还有账号，不能删除" }, 400);
  run(appDb, "delete from teams where id = ?", teamId);
  audit("team.delete", { teamId });
  return c.json({ ok: true });
});

api.get("/config/users", (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const teamId = c.req.query("teamId");
  const keyword = String(c.req.query("keyword") ?? "").trim();
  const status = String(c.req.query("status") ?? "").trim();
  const disabledFilter = status === "enabled" ? 0 : status === "disabled" ? 1 : null;
  const keywordLike = `%${keyword}%`;
  const users = getAll<{
    id: string;
    team_id: string | null;
    team_name: string | null;
    account: string | null;
    username: string;
    email: string;
    phone: string;
    disabled: number;
    has_config_access: number;
    last_login_at: string | null;
    created_at: string;
    updated_at: string;
    session_count: number;
    image_count: number;
  }>(
    appDb,
    `select u.id, u.team_id, t.name as team_name, u.account, u.username, u.email, u.phone, u.disabled, u.has_config_access, u.last_login_at, u.created_at, u.updated_at,
      (select count(*) from sessions s where s.user_id = u.id and s.deleted_at is null) as session_count,
      (select count(*) from images i where i.user_id = u.id) as image_count
     from users u
     left join teams t on t.id = u.team_id
     where (? is null or ? = '' or u.team_id = ?)
       and (? = '' or u.account like ? or u.username like ? or u.email like ? or u.phone like ?)
       and (? is null or u.disabled = ?)
     order by t.created_at asc, u.created_at desc`,
    teamId ?? null,
    teamId ?? "",
    teamId ?? "",
    keyword,
    keywordLike,
    keywordLike,
    keywordLike,
    keywordLike,
    disabledFilter,
    disabledFilter
  );
  return c.json({
    users: users.map((user) => ({
      id: user.id,
      teamId: user.team_id ?? defaultTeamId(),
      teamName: user.team_name ?? "默认团队",
      account: user.account?.trim() || user.username,
      username: user.username,
      email: user.email ?? "",
      phone: user.phone ?? "",
      disabled: Boolean(user.disabled),
      hasConfigAccess: Boolean(user.has_config_access),
      lastLoginAt: user.last_login_at ?? "",
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      sessionCount: user.session_count,
      imageCount: user.image_count
    }))
  });
});

api.post("/config/users", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const body = await c.req.json().catch(() => ({}));
  const account = String(body.account ?? body.username ?? "").trim();
  const username = String(body.username ?? "").trim() || account;
  const email = normalizeEmail(body.email);
  const phone = normalizePhone(body.phone);
  const password = String(body.password ?? "");
  const teamId = String(body.teamId ?? defaultTeamId()).trim() || defaultTeamId();
  const disabled = Boolean(body.disabled) ? 1 : 0;
  const hasConfigAccess = Boolean(body.hasConfigAccess) ? 1 : 0;
  if (!account || !password) return c.json({ error: "请输入账号和密码" }, 400);
  const validatedUsername = validateUsername(username);
  if (!validatedUsername.ok) return c.json({ error: validatedUsername.error }, 400);
  if (!isValidEmail(email)) return c.json({ error: "邮箱格式不正确" }, 400);
  const team = getOne<TeamRow>(appDb, "select * from teams where id = ?", teamId);
  if (!team) return c.json({ error: "团队不存在" }, 400);
  const usernameConflict = getOne<Pick<UserRow, "id">>(appDb, "select id from users where lower(username) = lower(?)", validatedUsername.username);
  if (usernameConflict) return c.json({ error: "用户名已存在" }, 409);
  const timestamp = now();
  try {
    const userId = makeId("user");
    run(
      appDb,
      `insert into users (
        id, team_id, account, username, email, phone, password_hash,
        disabled, has_config_access, email_verified_at, phone_verified_at, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      userId,
      teamId,
      account,
      validatedUsername.username,
      email,
      phone,
      await Bun.password.hash(password),
      disabled,
      hasConfigAccess,
      email ? timestamp : null,
      null,
      timestamp,
      timestamp
    );
    audit("user.create", { userId, account, username: validatedUsername.username, email, phone, teamId, hasConfigAccess: Boolean(hasConfigAccess) });
    return c.json({
      user: { id: userId, teamId, account, username: validatedUsername.username, email, phone, disabled: Boolean(disabled), hasConfigAccess: Boolean(hasConfigAccess), createdAt: timestamp, updatedAt: timestamp }
    });
  } catch (error) {
    return c.json({ error: "账号、邮箱或手机号已存在" }, 409);
  }
});

api.patch("/config/users/:id", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const body = await c.req.json().catch(() => ({}));
  const existing = getOne<UserRow>(appDb, "select * from users where id = ?", c.req.param("id"));
  if (!existing) return c.json({ error: "账号不存在" }, 404);
  const account = String(body.account ?? existing.account ?? existing.username).trim();
  const username = String(body.username ?? existing.username).trim() || account;
  const email = normalizeEmail(body.email ?? existing.email);
  const phone = normalizePhone(body.phone ?? existing.phone);
  const teamId = String(body.teamId ?? existing.team_id ?? defaultTeamId()).trim() || defaultTeamId();
  const disabled = typeof body.disabled === "boolean" ? (body.disabled ? 1 : 0) : existing.disabled;
  const hasConfigAccess =
    typeof body.hasConfigAccess === "boolean" ? (body.hasConfigAccess ? 1 : 0) : existing.has_config_access;
  if (!account) return c.json({ error: "请输入账号" }, 400);
  const validatedUsername = validateUsername(username);
  if (!validatedUsername.ok) return c.json({ error: validatedUsername.error }, 400);
  if (!isValidEmail(email)) return c.json({ error: "邮箱格式不正确" }, 400);
  const team = getOne<TeamRow>(appDb, "select * from teams where id = ?", teamId);
  if (!team) return c.json({ error: "团队不存在" }, 400);
  const usernameConflict = getOne<Pick<UserRow, "id">>(
    appDb,
    "select id from users where lower(username) = lower(?) and id <> ?",
    validatedUsername.username,
    c.req.param("id")
  );
  if (usernameConflict) return c.json({ error: "用户名已存在" }, 409);
  try {
    run(
      appDb,
      `update users
       set account = ?, username = ?, email = ?, phone = ?, team_id = ?,
           disabled = ?, has_config_access = ?, updated_at = ?
       where id = ?`,
      account,
      validatedUsername.username,
      email,
      phone,
      teamId,
      disabled,
      hasConfigAccess,
      now(),
      c.req.param("id")
    );
  } catch {
    return c.json({ error: "账号、邮箱或手机号已存在" }, 409);
  }
  audit("user.update", { userId: c.req.param("id"), account, username: validatedUsername.username, email, phone, teamId, disabled: Boolean(disabled), hasConfigAccess: Boolean(hasConfigAccess) });
  return c.json({ ok: true });
});

api.post("/config/users/:id/reset-password", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const body = await c.req.json().catch(() => ({}));
  const password = String(body.password ?? "");
  if (password.length < 1) return c.json({ error: "请输入新密码" }, 400);
  run(
    appDb,
    "update users set password_hash = ?, updated_at = ? where id = ?",
    await Bun.password.hash(password),
    now(),
    c.req.param("id")
  );
  audit("user.reset_password", { userId: c.req.param("id") });
  return c.json({ ok: true });
});

api.delete("/config/users/:id", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const userId = c.req.param("id");
  const deleted = await deleteUserAccount(userId);
  if (!deleted) return c.json({ error: "账号不存在" }, 404);
  return c.json({ ok: true });
});

type ConfigAssetReviewRow = AssetRow & {
  source_username: string | null;
  source_account: string | null;
  team_name: string | null;
};

function assetReviewCategoryMap(assetIds: string[]) {
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

function publicConfigAssetReview(row: ConfigAssetReviewRow, categoryMap: Map<string, Array<{ id: string; name: string }>>) {
  const categories = categoryMap.get(row.id) ?? [];
  return {
    id: row.id,
    name: row.name,
    url: assetUrlFromAssetId(row.id),
    previewUrl: assetUrlFromAssetId(row.id, "preview"),
    thumbnailUrl: assetUrlFromAssetId(row.id, "thumb"),
    mimeType: row.mime_type,
    size: row.size,
    imageWidth: row.image_width,
    imageHeight: row.image_height,
    space: row.space,
    shared: Boolean(row.shared),
    shareStatus: normalizeAssetShareStatus(row.share_status),
    shareRequestedAt: row.share_requested_at ?? "",
    shareReviewedAt: row.share_reviewed_at ?? "",
    shareRejectReason: row.share_reject_reason ?? "",
    sourceUsername: row.source_username ?? "未知用户",
    sourceAccount: row.source_account ?? "",
    teamName: row.team_name ?? "默认团队",
    createdAt: row.created_at,
    categoryIds: categories.map((category) => category.id),
    categoryNames: categories.map((category) => category.name)
  };
}

api.get("/config/assets/reviews", (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const rawStatus = String(c.req.query("status") ?? "pending").trim();
  const status = rawStatus === "all" ? "all" : normalizeAssetShareStatus(rawStatus);
  const keyword = String(c.req.query("keyword") ?? "").trim();
  const clauses = ["coalesce(assets.share_status, 'none') in ('pending', 'approved', 'rejected')"];
  const params: Array<string | number> = [];
  if (status !== "all") {
    clauses.push("coalesce(assets.share_status, 'none') = ?");
    params.push(status === "none" ? "pending" : status);
  }
  if (keyword) {
    const like = `%${keyword}%`;
    clauses.push(`(
      assets.name like ?
      or coalesce(users.username, '') like ?
      or coalesce(users.account, '') like ?
      or coalesce(teams.name, '') like ?
      or exists (
        select 1
        from asset_categories
        join case_categories on case_categories.id = asset_categories.category_id
        where asset_categories.asset_id = assets.id
          and case_categories.type = 'asset'
          and case_categories.name like ?
      )
    )`);
    params.push(like, like, like, like, like);
  }
  const rows = getAll<ConfigAssetReviewRow>(
    appDb,
    `select assets.*, users.username as source_username, users.account as source_account, teams.name as team_name
     from assets
     left join users on users.id = assets.user_id
     left join teams on teams.id = users.team_id
     where ${clauses.join(" and ")}
     order by
       case coalesce(assets.share_status, 'none')
         when 'pending' then 0
         when 'rejected' then 1
         when 'approved' then 2
         else 3
       end,
       coalesce(assets.share_requested_at, assets.created_at) desc,
       assets.rowid desc`,
    ...params
  );
  const counts = getAll<{ status: string; count: number }>(
    appDb,
    `select coalesce(share_status, 'none') as status, count(*) as count
     from assets
     where coalesce(share_status, 'none') in ('pending', 'approved', 'rejected')
     group by coalesce(share_status, 'none')`
  );
  const categoryMap = assetReviewCategoryMap(rows.map((row) => row.id));
  return c.json({
    assets: rows.map((row) => publicConfigAssetReview(row, categoryMap)),
    counts: {
      pending: counts.find((item) => item.status === "pending")?.count ?? 0,
      approved: counts.find((item) => item.status === "approved")?.count ?? 0,
      rejected: counts.find((item) => item.status === "rejected")?.count ?? 0
    }
  });
});

api.post("/config/assets/reviews/:assetId/approve", (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const assetId = c.req.param("assetId");
  const asset = getOne<AssetRow>(appDb, "select * from assets where id = ?", assetId);
  if (!asset) return c.json({ error: "素材不存在" }, 404);
  if (normalizeAssetShareStatus(asset.share_status) === "approved") return c.json({ error: "素材已经是已通过" }, 400);
  const timestamp = now();
  run(
    appDb,
    `update assets
     set shared = case when space = 'private' then 1 else 0 end,
         share_status = 'approved',
         share_reviewed_at = ?,
         share_reviewed_by = 'config',
         share_reject_reason = ''
     where id = ?`,
    timestamp,
    assetId
  );
  audit("asset.share.approve", { assetId, userId: asset.user_id });
  return c.json({ ok: true });
});

api.post("/config/assets/reviews/:assetId/reject", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const assetId = c.req.param("assetId");
  const body = await c.req.json().catch(() => ({}));
  const reason = String(body.reason ?? "").trim().slice(0, 300);
  const asset = getOne<AssetRow>(appDb, "select * from assets where id = ?", assetId);
  if (!asset) return c.json({ error: "素材不存在" }, 404);
  if (normalizeAssetShareStatus(asset.share_status) === "rejected") return c.json({ error: "素材已经是未通过" }, 400);
  const timestamp = now();
  run(
    appDb,
    `update assets
     set shared = 0,
         share_status = 'rejected',
         share_reviewed_at = ?,
         share_reviewed_by = 'config',
         share_reject_reason = ?
     where id = ?`,
    timestamp,
    reason,
    assetId
  );
  audit("asset.share.reject", { assetId, userId: asset.user_id, reason });
  return c.json({ ok: true });
});

type ConfigCaseReviewRow = {
  id: string;
  group_id: string;
  user_id: string;
  image_id: string | null;
  asset_id: string | null;
  include_references: number;
  review_status: string;
  review_requested_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  reject_reason: string | null;
  title: string;
  prompt: string;
  image_url: string;
  created_at: string;
  source_username: string | null;
  source_account: string | null;
  team_name: string | null;
  image_width: number;
  image_height: number;
  image_file_size: number;
};

function caseReviewCategoryMap(groupIds: string[]) {
  const ids = Array.from(new Set(groupIds.map((id) => id.trim()).filter(Boolean)));
  const map = new Map<string, Array<{ id: string; name: string }>>();
  if (ids.length === 0) return map;
  const rows = getAll<{ group_id: string; id: string; name: string }>(
    appDb,
    `select coalesce(nullif(case_items.group_id, ''), case_items.id) as group_id, case_categories.id, case_categories.name
     from case_items
     join case_categories on case_categories.id = case_items.category_id
     where coalesce(nullif(case_items.group_id, ''), case_items.id) in (${ids.map(() => "?").join(", ")})
       and case_categories.type = 'case'
     order by case_categories.sort_order asc`,
    ...ids
  );
  for (const row of rows) {
    const items = map.get(row.group_id) ?? [];
    if (!items.some((item) => item.id === row.id)) items.push({ id: row.id, name: row.name });
    map.set(row.group_id, items);
  }
  return map;
}

function publicConfigCaseReview(row: ConfigCaseReviewRow, categoryMap: Map<string, Array<{ id: string; name: string }>>) {
  const groupId = row.group_id || row.id;
  const categories = categoryMap.get(groupId) ?? [];
  const imageUrl = row.image_id
    ? imageUrlFromImageId(row.image_id)
    : row.asset_id
      ? assetUrlFromAssetId(row.asset_id)
      : row.image_url;
  const previewUrl = row.image_id
    ? imageUrlFromImageId(row.image_id, "preview")
    : row.asset_id
      ? assetUrlFromAssetId(row.asset_id, "preview")
      : imageUrl;
  const thumbnailUrl = row.image_id
    ? imageUrlFromImageId(row.image_id, "thumb")
    : row.asset_id
      ? assetUrlFromAssetId(row.asset_id, "thumb")
      : previewUrl;
  return {
    id: row.id,
    groupId,
    title: row.title,
    prompt: row.prompt,
    url: imageUrl,
    previewUrl,
    thumbnailUrl,
    imageWidth: row.image_width ?? 0,
    imageHeight: row.image_height ?? 0,
    imageFileSize: row.image_file_size ?? 0,
    reviewStatus: normalizeReviewStatus(row.review_status),
    reviewRequestedAt: row.review_requested_at ?? "",
    reviewedAt: row.reviewed_at ?? "",
    rejectReason: row.reject_reason ?? "",
    sourceUsername: row.source_username ?? "未知用户",
    sourceAccount: row.source_account ?? "",
    teamName: row.team_name ?? "默认团队",
    createdAt: row.created_at,
    categoryIds: categories.map((category) => category.id),
    categoryNames: categories.map((category) => category.name)
  };
}

function configCaseReviewBaseRowsWhere() {
  return `case_items.rowid in (
    select min(ci.rowid)
    from case_items ci
    group by coalesce(nullif(ci.group_id, ''), ci.id)
  )`;
}

api.get("/config/cases/reviews", (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const rawStatus = String(c.req.query("status") ?? "pending").trim();
  const status = rawStatus === "all" ? "all" : normalizeReviewStatus(rawStatus);
  const keyword = String(c.req.query("keyword") ?? "").trim();
  const clauses = ["coalesce(case_items.review_status, 'approved') in ('pending', 'approved', 'rejected')", configCaseReviewBaseRowsWhere()];
  const params: Array<string | number> = [];
  if (status !== "all") {
    clauses.push("coalesce(case_items.review_status, 'approved') = ?");
    params.push(status);
  }
  if (keyword) {
    const like = `%${keyword}%`;
    clauses.push(`(
      case_items.title like ?
      or case_items.prompt like ?
      or coalesce(users.username, '') like ?
      or coalesce(users.account, '') like ?
      or coalesce(teams.name, '') like ?
      or exists (
        select 1
        from case_items category_items
        join case_categories on case_categories.id = category_items.category_id
        where category_items.group_id = case_items.group_id
          and case_categories.type = 'case'
          and case_categories.name like ?
      )
    )`);
    params.push(like, like, like, like, like, like);
  }
  const rows = getAll<ConfigCaseReviewRow>(
    appDb,
    `select case_items.id, case_items.group_id, case_items.user_id, case_items.image_id, case_items.asset_id,
            coalesce(case_items.include_references, 1) as include_references,
            coalesce(case_items.review_status, 'approved') as review_status,
            case_items.review_requested_at, case_items.reviewed_at, case_items.reviewed_by, case_items.reject_reason,
            case_items.title, case_items.prompt, case_items.image_url, case_items.created_at,
            users.username as source_username, users.account as source_account, teams.name as team_name,
            coalesce(images.image_width, assets.image_width, 0) as image_width,
            coalesce(images.image_height, assets.image_height, 0) as image_height,
            coalesce(images.image_file_size, assets.size, 0) as image_file_size
     from case_items
     left join users on users.id = case_items.user_id
     left join teams on teams.id = users.team_id
     left join images on images.id = case_items.image_id
     left join assets on assets.id = case_items.asset_id
     where ${clauses.join(" and ")}
     order by
       case coalesce(case_items.review_status, 'approved')
         when 'pending' then 0
         when 'rejected' then 1
         when 'approved' then 2
         else 3
       end,
       coalesce(case_items.review_requested_at, case_items.created_at) desc,
       case_items.rowid desc`,
    ...params
  );
  const counts = getAll<{ status: string; count: number }>(
    appDb,
    `select status, count(*) as count
     from (
       select coalesce(case_items.review_status, 'approved') as status
       from case_items
       where ${configCaseReviewBaseRowsWhere()}
     )
     where status in ('pending', 'approved', 'rejected')
     group by status`
  );
  const categoryMap = caseReviewCategoryMap(rows.map((row) => row.group_id || row.id));
  return c.json({
    cases: rows.map((row) => publicConfigCaseReview(row, categoryMap)),
    counts: {
      pending: counts.find((item) => item.status === "pending")?.count ?? 0,
      approved: counts.find((item) => item.status === "approved")?.count ?? 0,
      rejected: counts.find((item) => item.status === "rejected")?.count ?? 0
    }
  });
});

function configCaseReviewTarget(caseId: string) {
  return getOne<{ id: string; group_id: string; user_id: string; review_status: string }>(
    appDb,
    "select id, group_id, user_id, coalesce(review_status, 'approved') as review_status from case_items where id = ? or group_id = ? order by rowid asc limit 1",
    caseId,
    caseId
  );
}

api.post("/config/cases/reviews/:caseId/approve", (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const target = configCaseReviewTarget(c.req.param("caseId"));
  if (!target) return c.json({ error: "灵感不存在" }, 404);
  if (normalizeReviewStatus(target.review_status) === "approved") return c.json({ error: "灵感已经是已通过" }, 400);
  const groupId = target.group_id || target.id;
  const timestamp = now();
  run(
    appDb,
    `update case_items
     set review_status = 'approved',
         reviewed_at = ?,
         reviewed_by = 'config',
         reject_reason = ''
     where group_id = ? or id = ?`,
    timestamp,
    groupId,
    target.id
  );
  audit("case.review.approve", { caseId: target.id, groupId, userId: target.user_id });
  return c.json({ ok: true });
});

api.post("/config/cases/reviews/:caseId/reject", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const target = configCaseReviewTarget(c.req.param("caseId"));
  if (!target) return c.json({ error: "灵感不存在" }, 404);
  if (normalizeReviewStatus(target.review_status) === "rejected") return c.json({ error: "灵感已经是未通过" }, 400);
  const body = await c.req.json().catch(() => ({}));
  const reason = String(body.reason ?? "").trim().slice(0, 300);
  const groupId = target.group_id || target.id;
  const timestamp = now();
  run(
    appDb,
    `update case_items
     set review_status = 'rejected',
         reviewed_at = ?,
         reviewed_by = 'config',
         reject_reason = ?
     where group_id = ? or id = ?`,
    timestamp,
    reason,
    groupId,
    target.id
  );
  audit("case.review.reject", { caseId: target.id, groupId, userId: target.user_id, reason });
  return c.json({ ok: true });
});

api.get("/config/image-accounts", (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const rows = getAll<ImageAccountRow>(
    configDb,
    "select * from image_accounts order by status asc, priority desc, updated_at desc"
  );
  const localSuccessRows = getAll<{ source_account_id: string; success_count: number; last_request_at: string | null }>(
    appDb,
    `select provider_source_account_id as source_account_id,
      count(distinct coalesce(nullif(job_id, ''), id)) as success_count,
      max(created_at) as last_request_at
     from images
     where provider_source_account_id <> ''
     group by provider_source_account_id`
  );
  const localFailureRows = getAll<{ source_account_id: string; failure_count: number; last_request_at: string | null }>(
    configDb,
    `select source_account_id,
      count(*) as failure_count,
      max(created_at) as last_request_at
     from provider_request_logs
     where source_account_id <> ''
       and success = 0
     group by source_account_id`
  );
  const successByAccount = new Map(localSuccessRows.map((row) => [row.source_account_id, row]));
  const failureByAccount = new Map(localFailureRows.map((row) => [row.source_account_id, row]));
  const accounts = rows.map((row) => {
    const success = successByAccount.get(row.id);
    const failure = failureByAccount.get(row.id);
    const lastRequestAt = [success?.last_request_at ?? "", failure?.last_request_at ?? ""].sort().at(-1) ?? "";
    return toImageAccount(
      {
        ...row,
        local_success_count: success?.success_count ?? 0,
        local_failure_count: failure?.failure_count ?? 0,
        local_last_request_at: lastRequestAt
      },
      false
    );
  });
  const trackedFiveHourAccounts = accounts.filter((account) => account.codex5hUsedPercent !== null);
  const trackedWeekAccounts = accounts.filter((account) => account.codexWeekUsedPercent !== null);
  return c.json({
    summary: {
      total: accounts.length,
      available: accounts.filter((account) => account.status === "normal").length,
      totalQuota: accounts.reduce((sum, account) => sum + Math.max(0, Number(account.quota) || 0), 0),
      remainingQuota: accounts.reduce((sum, account) => sum + Math.max(0, Number(account.remainingQuota) || 0), 0),
      usageTracked: accounts.filter((account) => account.codexUsageUpdatedAt).length,
      averageCodex5hUsedPercent: trackedFiveHourAccounts.length
        ? Math.round(
            trackedFiveHourAccounts.reduce((sum, account) => sum + Number(account.codex5hUsedPercent ?? 0), 0) /
              trackedFiveHourAccounts.length *
              10
          ) / 10
        : null,
      averageCodexWeekUsedPercent: trackedWeekAccounts.length
        ? Math.round(
            trackedWeekAccounts.reduce((sum, account) => sum + Number(account.codexWeekUsedPercent ?? 0), 0) /
              trackedWeekAccounts.length *
              10
          ) / 10
        : null
    },
    accounts
  });
});

api.post("/config/image-accounts/refresh-usage", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const result = await refreshImageAccountUsages();
  audit("image_account.refresh_usage", result);
  return c.json(result);
});

api.post("/config/image-accounts/:id/refresh-usage", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const accountId = c.req.param("id");
  const existing = getOne<ImageAccountRow>(configDb, "select * from image_accounts where id = ?", accountId);
  if (!existing) return c.json({ error: "图片账号不存在" }, 404);
  const result = await refreshImageAccountUsages(accountId);
  audit("image_account.refresh_usage", { accountId, ...result });
  return c.json(result);
});

api.get("/config/image-accounts/:id", (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const accountId = c.req.param("id");
  const existing = getOne<ImageAccountRow>(configDb, "select * from image_accounts where id = ?", accountId);
  if (!existing) return c.json({ error: "图片账号不存在" }, 404);
  return c.json({ account: toImageAccount(existing, true) });
});

type ImageAccountImportSource = {
  id?: string;
  name?: string;
  content?: string;
  value?: unknown;
};

type ParsedImageAccountImport = {
  rowId: string;
  sourceName: string;
  rawValue: unknown;
  authJson: string;
  authInfoJson: string;
  accessToken: string;
  email: string;
  accountType: string;
  accountId: string;
  remoteName: string;
  displayName: string;
  error: string;
};

type ImageAccountImportPreviewItem = {
  rowId: string;
  sourceName: string;
  name: string;
  email: string;
  accountType: string;
  accountId: string;
  remoteName: string;
  hasAccessToken: boolean;
  tokenPreview: string;
  duplicateAccountId: string;
  duplicateName: string;
  duplicateReason: string;
  action: "create" | "update" | "skip";
  status: "ready" | "error";
  error: string;
};

function importRecordValue(source: unknown, key: string) {
  if (!source || typeof source !== "object") return undefined;
  return (source as Record<string, unknown>)[key];
}

function parseEmbeddedJson(value: unknown) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return null;
  return safeJson(trimmed, null);
}

function firstImportString(source: unknown, keys: string[], depth = 0): string {
  if (!source || depth > 8) return "";
  if (typeof source === "string") {
    const parsed = parseEmbeddedJson(source);
    return parsed ? firstImportString(parsed, keys, depth + 1) : "";
  }
  if (Array.isArray(source)) {
    for (const item of source) {
      const found = firstImportString(item, keys, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof source !== "object") return "";
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === "object") {
      const found = firstImportString(value, keys, depth + 1);
      if (found) return found;
    }
    if (typeof value === "string") {
      const parsed = parseEmbeddedJson(value);
      if (parsed) {
        const found = firstImportString(parsed, keys, depth + 1);
        if (found) return found;
      }
    }
  }
  return "";
}

function importJsonString(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const parsed = parseEmbeddedJson(trimmed);
    return parsed ? JSON.stringify(parsed) : trimmed;
  }
  if (value && typeof value === "object") return JSON.stringify(value);
  return "";
}

function importFileName(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const name = text.split(/[\\/]/).pop() ?? text;
  return name.trim();
}

function imageAccountImportAuthInfo(source: unknown, meta: { email: string; accountType: string; accountId: string }) {
  if (!source || typeof source !== "object") return "";
  const idToken = importRecordValue(source, "id_token") ?? importRecordValue(source, "idToken");
  const provider = firstImportString(source, ["provider"]);
  const authIndex = firstImportString(source, ["auth_index", "authIndex"]);
  const info: Record<string, unknown> = {
    account: firstImportString(source, ["account"]) || meta.email,
    email: meta.email,
    account_type: meta.accountType,
    account_id: meta.accountId,
    provider: provider || undefined,
    auth_index: authIndex || undefined,
    id_token: idToken || undefined
  };
  const compact = Object.fromEntries(Object.entries(info).filter(([, value]) => value !== "" && value !== undefined));
  return Object.keys(compact).length > 0 ? JSON.stringify(compact) : "";
}

function imageAccountImportMeta(source: unknown) {
  const authJsonValue =
    importRecordValue(source, "auth_json") ??
    importRecordValue(source, "authJson") ??
    importRecordValue(source, "authorization_json") ??
    importRecordValue(source, "authorizationJson");
  const authInfoJsonValue =
    importRecordValue(source, "auth_info_json") ??
    importRecordValue(source, "authInfoJson") ??
    importRecordValue(source, "auth_info") ??
    importRecordValue(source, "authInfo");
  const sources = [source, parseEmbeddedJson(authJsonValue), parseEmbeddedJson(authInfoJsonValue)].filter(Boolean);
  const accessToken = firstImportString(sources, ["access_token", "accessToken", "token"]);
  const email = firstImportString(sources, ["email", "account_email", "accountEmail", "username", "account"]);
  const accountType = firstImportString(sources, ["account_type", "accountType", "type", "plan_type", "planType", "chatgpt_plan_type", "chatgptPlanType"]);
  const accountId = firstImportString(sources, ["account_id", "accountId", "chatgpt_account_id", "chatgptAccountId"]);
  const rawRemoteName =
    firstImportString(source, ["remote_name", "remoteName", "name", "file_name", "fileName"]) ||
    importFileName(firstImportString(source, ["path"]));
  const authJson = importJsonString(authJsonValue) || importJsonString(source);
  const authInfoJson = importJsonString(authInfoJsonValue) || imageAccountImportAuthInfo(source, { email, accountType, accountId });
  const displayName = firstImportString(source, ["label", "display_name", "displayName"]) || email || rawRemoteName || accountId;
  return {
    accessToken,
    email,
    accountType,
    accountId,
    remoteName: importFileName(rawRemoteName),
    authJson,
    authInfoJson,
    displayName
  };
}

function collectImageAccountImportValues(value: unknown, sourceName: string, output: Array<{ sourceName: string; value: unknown }>) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectImageAccountImportValues(item, `${sourceName} #${index + 1}`, output));
    return;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["files", "accounts", "items", "data"]) {
      if (Array.isArray(record[key])) {
        collectImageAccountImportValues(record[key], sourceName, output);
        return;
      }
    }
  }
  output.push({ sourceName, value });
}

function parseImageAccountImportText(text: string, sourceName: string, output: Array<{ sourceName: string; value: unknown }>, errors: string[]) {
  const trimmed = text.trim();
  if (!trimmed) return;
  try {
    collectImageAccountImportValues(JSON.parse(trimmed), sourceName, output);
    return;
  } catch {
    // Try JSONL / newline-delimited JSON below.
  }
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let parsedLines = 0;
  for (const [index, line] of lines.entries()) {
    try {
      collectImageAccountImportValues(JSON.parse(line), `${sourceName} 行 ${index + 1}`, output);
      parsedLines += 1;
    } catch {
      errors.push(`${sourceName} 行 ${index + 1} 不是有效 JSON`);
    }
  }
  if (parsedLines === 0 && errors.length === lines.length) {
    errors.splice(errors.length - lines.length, lines.length, `${sourceName} 不是有效 JSON`);
  }
}

function normalizeImageAccountImportSources(value: unknown): ImageAccountImportSource[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (item && typeof item === "object" && ("content" in item || "value" in item || "name" in item)) {
        return item as ImageAccountImportSource;
      }
      return { name: `输入 ${index + 1}`, value: item };
    });
  }
  if (typeof value === "string") return [{ name: "粘贴内容", content: value }];
  if (value && typeof value === "object") return [{ name: "输入 1", value }];
  return [];
}

function parseImageAccountImportSources(rawItems: unknown): ParsedImageAccountImport[] {
  const sources = normalizeImageAccountImportSources(rawItems);
  const values: Array<{ sourceName: string; value: unknown }> = [];
  const parseErrors: string[] = [];
  for (const [index, source] of sources.entries()) {
    const sourceName = String(source.name ?? source.id ?? `输入 ${index + 1}`).trim() || `输入 ${index + 1}`;
    if (typeof source.content === "string") {
      parseImageAccountImportText(source.content, sourceName, values, parseErrors);
    } else if (source.value !== undefined) {
      collectImageAccountImportValues(source.value, sourceName, values);
    } else {
      collectImageAccountImportValues(source, sourceName, values);
    }
  }
  const parsed = values.map(({ sourceName, value }, index) => {
    const meta = imageAccountImportMeta(value);
    const sourceRemoteName =
      sourceName !== "粘贴内容" && !/^输入 \d+/.test(sourceName) ? sourceName : "";
    const remoteName = meta.remoteName || sourceRemoteName;
    return {
      rowId: `row-${index + 1}`,
      sourceName,
      rawValue: value,
      authJson: meta.authJson,
      authInfoJson: meta.authInfoJson,
      accessToken: meta.accessToken,
      email: meta.email,
      accountType: meta.accountType,
      accountId: meta.accountId,
      remoteName,
      displayName: meta.displayName || remoteName,
      error: meta.accessToken ? "" : "缺少 Access Token"
    };
  });
  for (const [index, error] of parseErrors.entries()) {
    parsed.push({
      rowId: `error-${index + 1}`,
      sourceName: "解析错误",
      rawValue: null,
      authJson: "",
      authInfoJson: "",
      accessToken: "",
      email: "",
      accountType: "",
      accountId: "",
      remoteName: "",
      displayName: "",
      error
    });
  }
  return parsed;
}

function importAccountDescriptor(row: ImageAccountRow) {
  const authMeta = row.auth_json ? extractAuthJsonMeta(row.auth_json) : { accountId: "" };
  const infoMeta = row.auth_info_json ? extractAuthJsonMeta(row.auth_info_json) : { accountId: "" };
  return {
    id: row.id,
    name: row.name ?? "",
    remoteName: row.remote_name ?? "",
    email: row.email ?? "",
    accountId: authMeta.accountId || infoMeta.accountId || ""
  };
}

function lowerKey(value: string) {
  return value.trim().toLowerCase();
}

function findImportDuplicate(
  item: ParsedImageAccountImport,
  descriptors: ReturnType<typeof importAccountDescriptor>[]
) {
  if (item.accountId) {
    const match = descriptors.find((row) => lowerKey(row.accountId) === lowerKey(item.accountId));
    if (match) return { account: match, reason: "账号 ID 相同" };
  }
  if (item.email) {
    const match = descriptors.find((row) => lowerKey(row.email) === lowerKey(item.email));
    if (match) return { account: match, reason: "邮箱相同" };
  }
  const remoteKey = lowerKey(item.remoteName || item.displayName);
  if (remoteKey) {
    const match = descriptors.find((row) => lowerKey(row.remoteName) === remoteKey || lowerKey(row.name) === remoteKey);
    if (match) return { account: match, reason: "名称相同" };
  }
  return null;
}

function tokenPreview(token: string) {
  const trimmed = token.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 12) return `${trimmed.slice(0, 2)}****${trimmed.slice(-2)}`;
  return `${trimmed.slice(0, 6)}****${trimmed.slice(-4)}`;
}

function buildImageAccountImportPreview(items: ParsedImageAccountImport[]) {
  const descriptors = getAll<ImageAccountRow>(configDb, "select * from image_accounts").map(importAccountDescriptor);
  const seen = new Map<string, string>();
  return items.map((item): ImageAccountImportPreviewItem => {
    const duplicateKey =
      item.accountId ? `account:${lowerKey(item.accountId)}` :
      item.email ? `email:${lowerKey(item.email)}` :
      item.remoteName || item.displayName ? `name:${lowerKey(item.remoteName || item.displayName)}` :
      "";
    const batchDuplicate = !item.error && duplicateKey ? seen.get(duplicateKey) : "";
    if (!item.error && duplicateKey && !batchDuplicate) seen.set(duplicateKey, item.rowId);
    const duplicate = item.error ? null : findImportDuplicate(item, descriptors);
    const error = item.error || (batchDuplicate ? "批量内容中存在重复账号" : "");
    return {
      rowId: item.rowId,
      sourceName: item.sourceName,
      name: item.displayName || item.email || item.remoteName || "图片账号",
      email: item.email,
      accountType: item.accountType,
      accountId: item.accountId,
      remoteName: item.remoteName,
      hasAccessToken: Boolean(item.accessToken),
      tokenPreview: tokenPreview(item.accessToken),
      duplicateAccountId: duplicate?.account.id ?? "",
      duplicateName: duplicate?.account.name ?? "",
      duplicateReason: duplicate?.reason ?? "",
      action: error ? "skip" : duplicate ? "update" : "create",
      status: error ? "error" : "ready",
      error
    };
  });
}

function compactImportSummary(items: ImageAccountImportPreviewItem[]) {
  return {
    total: items.length,
    ready: items.filter((item) => item.status === "ready").length,
    create: items.filter((item) => item.action === "create").length,
    update: items.filter((item) => item.action === "update").length,
    skipped: items.filter((item) => item.status === "error").length
  };
}

function appendImportedAccountsToChatGptProvider(channelId: string, accountIds: string[], timestamp: string) {
  if (accountIds.length === 0) return false;
  const provider = channelId
    ? getOne<ProviderRow>(configDb, "select * from provider_configs where id = ?", channelId)
    : null;
  if (!provider || normalizeProviderChannel(provider.channel || inferChannelFromType(provider.type)) !== "chatgpt_web") {
    return false;
  }
  const nextIds = Array.from(new Set([...normalizeIdList(provider.web_account_ids), ...accountIds]));
  run(configDb, "update provider_configs set web_account_ids = ?, updated_at = ? where id = ?", JSON.stringify(nextIds), timestamp, provider.id);
  return true;
}

function upsertImportedImageAccount(item: ParsedImageAccountImport, channelId: string, timestamp: string) {
  const descriptors = getAll<ImageAccountRow>(configDb, "select * from image_accounts").map(importAccountDescriptor);
  const duplicate = findImportDuplicate(item, descriptors);
  const existing = duplicate
    ? getOne<ImageAccountRow>(configDb, "select * from image_accounts where id = ?", duplicate.account.id)
    : null;
  const name = item.displayName || item.email || item.remoteName || existing?.name || "图片账号";
  const remoteName = item.remoteName || existing?.remote_name || null;
  const email = item.email || existing?.email || "";
  const accountType = item.accountType || existing?.account_type || "";
  const nextChannelId = channelId || existing?.channel_id || null;
  if (existing) {
    run(
      configDb,
      `update image_accounts set
        name = ?, remote_name = ?, channel_id = ?, email = ?, account_type = ?,
        access_token = ?, auth_json = ?, auth_info_json = ?, sync_status = ?, updated_at = ?
       where id = ?`,
      name,
      remoteName,
      nextChannelId,
      email,
      accountType,
      item.accessToken,
      item.authJson,
      item.authInfoJson || existing.auth_info_json || "",
      "local",
      timestamp,
      existing.id
    );
    return { action: "updated" as const, accountId: existing.id };
  }
  const id = makeId("acct");
  run(
    configDb,
    `insert into image_accounts (
      id, name, remote_name, channel_id, email, account_type, status, quota, used_quota,
      priority, access_token, auth_json, auth_info_json, note, sync_status, last_refreshed_at,
      created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    name,
    remoteName,
    nextChannelId,
    email,
    accountType,
    "normal",
    0,
    0,
    0,
    item.accessToken,
    item.authJson,
    item.authInfoJson,
    "",
    "local",
    "",
    timestamp,
    timestamp
  );
  return { action: "created" as const, accountId: id };
}

function imageAccountFormAuthMeta(authJson: string, authInfoJson: string) {
  const authMeta = authJson ? extractAuthJsonMeta(authJson) : { accessToken: "", email: "", accountType: "", accountId: "", cookies: "" };
  const infoMeta = authInfoJson ? extractAuthJsonMeta(authInfoJson) : { accessToken: "", email: "", accountType: "", accountId: "", cookies: "" };
  return {
    accessToken: authMeta.accessToken || infoMeta.accessToken || "",
    email: authMeta.email || infoMeta.email || "",
    accountType: authMeta.accountType || infoMeta.accountType || "",
    accountId: authMeta.accountId || infoMeta.accountId || "",
    cookies: authMeta.cookies || infoMeta.cookies || ""
  };
}

api.post("/config/image-accounts/import-preview", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const body = await c.req.json().catch(() => ({}));
  const parsed = parseImageAccountImportSources((body as Record<string, unknown>).items);
  const items = buildImageAccountImportPreview(parsed);
  return c.json({ items, summary: compactImportSummary(items) });
});

api.post("/config/image-accounts/import", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const channelId = String(body.channelId ?? "").trim();
  const confirmedRowIds = new Set(
    Array.isArray(body.rowIds) ? body.rowIds.map((value) => String(value)) : []
  );
  const parsed = parseImageAccountImportSources(body.items);
  const preview = buildImageAccountImportPreview(parsed);
  const readyRowIds = new Set(
    preview
      .filter((item) => item.status === "ready" && (confirmedRowIds.size === 0 || confirmedRowIds.has(item.rowId)))
      .map((item) => item.rowId)
  );
  const timestamp = now();
  let created = 0;
  let updated = 0;
  let skipped = preview.filter((item) => item.status === "error").length;
  let failed = 0;
  const importedAccountIds: string[] = [];
  for (const item of parsed) {
    if (!readyRowIds.has(item.rowId)) continue;
    try {
      const result = upsertImportedImageAccount(item, channelId, timestamp);
      importedAccountIds.push(result.accountId);
      if (result.action === "created") created += 1;
      else updated += 1;
    } catch {
      failed += 1;
    }
  }
  if (confirmedRowIds.size > 0) {
    skipped += preview.filter((item) => item.status === "ready" && !confirmedRowIds.has(item.rowId)).length;
  }
  const appendedToProvider = appendImportedAccountsToChatGptProvider(channelId, importedAccountIds, timestamp);
  const result = {
    ok: failed === 0,
    created,
    updated,
    skipped,
    failed,
    appendedToProvider,
    message: `导入完成：新增 ${created} 个，更新 ${updated} 个，跳过 ${skipped} 个，失败 ${failed} 个`
  };
  audit("image_account.import", { created, updated, skipped, failed, channelId, appendedToProvider });
  return c.json(result);
});

api.post("/config/image-accounts", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const body = await c.req.json().catch(() => ({}));
  const authJson = String(body.authJson ?? "").trim();
  const authInfoJson = String(body.authInfoJson ?? "").trim();
  const meta = imageAccountFormAuthMeta(authJson, authInfoJson);
  const accessToken = String(body.accessToken ?? meta.accessToken ?? "").trim();
  const email = String(body.email ?? meta.email ?? "").trim();
  const accountType = String(body.accountType ?? meta.accountType ?? "").trim();
  const name = String(body.name ?? email ?? "").trim() || "图片账号";
  const timestamp = now();
  const id = makeId("acct");
  run(
    configDb,
    `insert into image_accounts (
      id, name, remote_name, channel_id, email, account_type, status, quota, used_quota,
      priority, access_token, auth_json, auth_info_json, note, sync_status, last_refreshed_at,
      created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    name,
    String(body.remoteName ?? "").trim() || null,
    String(body.channelId ?? "").trim() || null,
    email,
    accountType,
    normalizeImageAccountStatus(String(body.status ?? "normal")),
    Math.max(0, Number(body.quota) || 0),
    Math.max(0, Number(body.usedQuota) || 0),
    Number(body.priority) || 0,
    accessToken,
    authJson,
    authInfoJson,
    String(body.note ?? ""),
    "local",
    "",
    timestamp,
    timestamp
  );
  audit("image_account.create", { accountId: id, name, email });
  const row = getOne<ImageAccountRow>(configDb, "select * from image_accounts where id = ?", id);
  return c.json({ account: row ? toImageAccount(row, false) : null });
});

api.patch("/config/image-accounts/:id", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const accountId = c.req.param("id");
  const existing = getOne<ImageAccountRow>(configDb, "select * from image_accounts where id = ?", accountId);
  if (!existing) return c.json({ error: "图片账号不存在" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const rawAuthJson = typeof body.authJson === "string" ? body.authJson : existing.auth_json ?? "";
  const authJson = rawAuthJson.includes("****") ? existing.auth_json ?? "" : rawAuthJson.trim();
  const rawAuthInfoJson = typeof body.authInfoJson === "string" ? body.authInfoJson : existing.auth_info_json ?? "";
  const authInfoJson = rawAuthInfoJson.includes("****") ? existing.auth_info_json ?? "" : rawAuthInfoJson.trim();
  const meta = imageAccountFormAuthMeta(authJson, authInfoJson);
  const rawToken = typeof body.accessToken === "string" ? body.accessToken : existing.access_token ?? "";
  const accessToken = rawToken.includes("****") ? existing.access_token ?? "" : rawToken.trim() || meta.accessToken;
  const email = String(body.email ?? existing.email ?? meta.email ?? "").trim() || meta.email;
  const accountType = String(body.accountType ?? existing.account_type ?? meta.accountType ?? "").trim() || meta.accountType;
  run(
    configDb,
    `update image_accounts set
      name = ?, remote_name = ?, channel_id = ?, email = ?, account_type = ?, status = ?,
      quota = ?, used_quota = ?, priority = ?, access_token = ?, auth_json = ?, auth_info_json = ?,
      note = ?, updated_at = ?
     where id = ?`,
    String(body.name ?? existing.name ?? "").trim() || "图片账号",
    String(body.remoteName ?? existing.remote_name ?? "").trim() || null,
    String(body.channelId ?? existing.channel_id ?? "").trim() || null,
    email,
    accountType,
    normalizeImageAccountStatus(String(body.status ?? existing.status)),
    Math.max(0, Number(body.quota ?? existing.quota) || 0),
    Math.max(0, Number(body.usedQuota ?? existing.used_quota) || 0),
    Number(body.priority ?? existing.priority) || 0,
    accessToken,
    authJson,
    authInfoJson,
    String(body.note ?? existing.note ?? ""),
    now(),
    accountId
  );
  audit("image_account.update", { accountId });
  const row = getOne<ImageAccountRow>(configDb, "select * from image_accounts where id = ?", accountId);
  return c.json({ account: row ? toImageAccount(row, false) : null });
});

api.delete("/config/image-accounts/:id", (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const accountId = c.req.param("id");
  const existing = getOne<ImageAccountRow>(configDb, "select * from image_accounts where id = ?", accountId);
  if (!existing) return c.json({ error: "图片账号不存在" }, 404);
  run(configDb, "delete from image_accounts where id = ?", accountId);
  audit("image_account.delete", { accountId, name: existing.name, email: existing.email });
  return c.json({ ok: true });
});

api.get("/config/image-mode", (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  return c.json({ imageMode: imageGenerationSettings() });
});

api.put("/config/image-mode", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const body = await c.req.json().catch(() => ({}));
  const current = imageGenerationSettings();
  const mode = normalizeImageGenerationMode(String(body.mode ?? "auto"));
  const hasResultRetryCount = Object.prototype.hasOwnProperty.call(body, "resultRetryCount");
  const resultRetryCount = hasResultRetryCount ? requestImageResultRetryCount(body.resultRetryCount) : current.resultRetryCount;
  const timestamp = now();
  run(
    configDb,
    `insert into image_generation_settings (id, mode, result_retry_count, updated_at) values (?, ?, ?, ?)
    on conflict(id) do update set
      mode = excluded.mode,
      result_retry_count = excluded.result_retry_count,
      updated_at = excluded.updated_at`,
    "default",
    mode,
    resultRetryCount,
    timestamp
  );
  audit("image_mode.save", { mode, resultRetryCount });
  return c.json({ imageMode: imageGenerationSettings() });
});

api.get("/config/providers", (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const rows = getAll<ProviderRow>(
    configDb,
    "select * from provider_configs order by created_at asc"
  );
  return c.json({ providers: rows.map((row) => toProvider(row, false)) });
});

function normalizeProviderConfigPath(channel: string, value: unknown, kind: "generation" | "edit" | "responses") {
  const path = String(value ?? "").trim();
  if (channel === "chatgpt_web") {
    if (kind === "responses") {
      if (!path || path === "/v1/responses" || path === "/f/conversation" || /\/codex\/images\/generations$/i.test(path)) {
        return "/codex/responses";
      }
      return path;
    }
    if (kind === "generation") {
      if (!path || path === "/v1/images/generations" || /\/images\/generations$/i.test(path)) {
        return "/f/conversation";
      }
      return path;
    }
    if (!path || path === "/v1/images/edits" || /\/images\/edits$/i.test(path)) {
      return "/f/conversation";
    }
    return path;
  }
  if (kind === "responses") return path || "/v1/responses";
  if (kind === "edit") return path || "/v1/images/edits";
  return path || "/v1/images/generations";
}

api.put("/config/providers", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const body = await c.req.json().catch(() => ({}));
  const providers = Array.isArray(body.providers) ? body.providers : [];
  if (providers.length === 0) return c.json({ error: "至少保留一个接口配置" }, 400);

  const timestamp = now();
  const savedProviderIds: string[] = [];
  for (const raw of providers) {
    const channel = normalizeProviderChannel(String(raw.channel ?? inferChannelFromType(raw.type)));
    let id = String(raw.id ?? "").trim();
    if (!id) {
      const fallbackDate = new Date();
      for (let index = 0; index < 1440; index += 1) {
        const candidate = makeProviderConfigId(channel, fallbackDate);
        if (!savedProviderIds.includes(candidate) && !getOne<ProviderRow>(configDb, "select * from provider_configs where id = ?", candidate)) {
          id = candidate;
          break;
        }
        fallbackDate.setMinutes(fallbackDate.getMinutes() + 1);
      }
    }
    id ||= makeId("provider");
    savedProviderIds.push(id);
    const existing = getOne<ProviderRow>(configDb, "select * from provider_configs where id = ?", id);
    const apiKeyValue = String(raw.apiKeyValue ?? "");
    const preservedApiKey =
      apiKeyValue.includes("****") && existing ? existing.api_key_value ?? "" : apiKeyValue;
    const webCookies = String(raw.webCookies ?? "");
    const preservedWebCookies =
      webCookies.includes("****") && existing ? existing.web_cookies ?? "" : webCookies;
    run(
      configDb,
      `insert into provider_configs (
        id, name, type, channel, enabled, base_url, api_key_env, api_key_value,
        route_mode, generation_path, edit_path, responses_path, model, responses_model,
        sizes, qualities, default_size, default_quality, response_image_path,
        proxy_enabled, quota_mode, fallback_to_conversation, web_account_id, web_account_ids, web_account_mode, web_cookies,
        created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(id) do update set
        name = excluded.name,
        type = excluded.type,
        channel = excluded.channel,
        enabled = excluded.enabled,
        base_url = excluded.base_url,
        api_key_env = excluded.api_key_env,
        api_key_value = excluded.api_key_value,
        route_mode = excluded.route_mode,
        generation_path = excluded.generation_path,
        edit_path = excluded.edit_path,
        responses_path = excluded.responses_path,
        model = excluded.model,
        responses_model = excluded.responses_model,
        sizes = excluded.sizes,
        qualities = excluded.qualities,
        default_size = excluded.default_size,
        default_quality = excluded.default_quality,
        response_image_path = excluded.response_image_path,
        proxy_enabled = excluded.proxy_enabled,
        quota_mode = excluded.quota_mode,
        fallback_to_conversation = excluded.fallback_to_conversation,
        web_account_id = excluded.web_account_id,
        web_account_ids = excluded.web_account_ids,
        web_account_mode = excluded.web_account_mode,
        web_cookies = excluded.web_cookies,
        updated_at = excluded.updated_at`,
      id,
      String(raw.name ?? "图片接口"),
      String(raw.type ?? "openai-compatible"),
      channel,
      Boolean(raw.enabled) ? 1 : 0,
      String(raw.baseUrl ?? "http://127.0.0.1:8317"),
      String(raw.apiKeyEnv ?? ""),
      preservedApiKey,
      normalizeRouteMode(String(raw.routeMode ?? "images_api")),
      normalizeProviderConfigPath(channel, raw.generationPath, "generation"),
      normalizeProviderConfigPath(channel, raw.editPath, "edit"),
      normalizeProviderConfigPath(channel, raw.responsesPath, "responses"),
      String(raw.model ?? "gpt-image-2"),
      String(raw.responsesModel ?? "").trim() || DEFAULT_RESPONSES_MODEL,
      JSON.stringify(Array.isArray(raw.sizes) ? raw.sizes.map(String) : DEFAULT_IMAGE_SIZES),
      JSON.stringify(Array.isArray(raw.qualities) ? raw.qualities.map(String) : ["high"]),
      requestImageSize(raw.defaultSize),
      String(raw.defaultQuality ?? "high"),
      String(raw.responseImagePath ?? "data[0].b64_json"),
      Boolean(raw.proxyEnabled) ? 1 : 0,
      normalizeQuotaMode(String(raw.quotaMode ?? "codex_first")),
      0,
      String(raw.webAccountId ?? ""),
      JSON.stringify(normalizeIdList(raw.webAccountIds)),
      normalizeWebAccountMode(String(raw.webAccountMode ?? "priority")),
      preservedWebCookies,
      existing?.created_at ?? timestamp,
      timestamp
    );
  }
  if (savedProviderIds.length > 0) {
    const placeholders = savedProviderIds.map(() => "?").join(",");
    run(configDb, `delete from provider_configs where id not in (${placeholders})`, ...savedProviderIds);
  }
  audit("provider.save", { count: providers.length });
  return c.json({ ok: true });
});

api.get("/config/proxy", (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  return c.json({ proxy: proxySettings() });
});

type StatisticsPreset = "today" | "yesterday" | "7d" | "30d" | "365d" | "month" | "year" | "lastYear";

type StatisticsRange = {
  preset: StatisticsPreset | "custom";
  startDate: string;
  endDate: string;
  startAt: string;
  endAt: string;
  days: string[];
};

type StatisticsUser = Pick<UserRow, "id" | "account" | "username" | "team_id" | "disabled" | "has_config_access" | "last_login_at"> & {
  team_name: string | null;
};

type StatisticsImageRow = {
  user_id: string;
  kind: string;
  provider_id: string;
  generated_by_retry: number;
  created_at: string;
};

type StatisticsSessionRow = {
  user_id: string;
  created_at: string;
};

type StatisticsJobRetryRow = {
  auto_retry_count: number;
  manual_retry_count: number;
  max_auto_retries: number;
  succeeded_on_retry: number;
  updated_at: string;
};

type RequestUserJobRow = {
  id: string;
  user_id: string;
  session_id: string | null;
  type: string;
  provider_id: string;
  created_at: string;
  updated_at: string;
};

type RequestUserMessageRow = {
  user_id: string;
  session_id: string | null;
  metadata: string | null;
  created_at: string;
};

type RequestUserImageRow = {
  id: string;
  user_id: string;
  job_id: string | null;
  provider_id: string;
  kind: string;
  provider_source_account_id: string;
  created_at: string;
};

type RequestUserCandidate = {
  id: string;
  userId: string;
  type: string;
  providerIds: Set<string>;
  sourceAccountIds: Set<string>;
  startMs: number;
  endMs: number;
  anchorTimes: number[];
  hasMessage: boolean;
};

const REQUEST_USER_INFER_WINDOW_MS = Math.max(IMAGE_JOB_RUNNING_TIMEOUT_MS, 35 * 60 * 1000);
const REQUEST_USER_INFER_AFTER_MS = 3 * 60 * 1000;

function compactText(value: unknown) {
  return String(value ?? "").trim();
}

function timestampMs(value: string | null | undefined) {
  const time = Date.parse(String(value ?? ""));
  return Number.isFinite(time) ? time : 0;
}

function timestampAt(ms: number) {
  return localTimestamp(new Date(ms));
}

function distanceToInterval(value: number, start: number, end: number) {
  if (!start || !end) return Number.POSITIVE_INFINITY;
  if (value < start) return start - value;
  if (value > end) return value - end;
  return 0;
}

function timeScore(distanceMs: number) {
  if (distanceMs <= 5 * 1000) return 60;
  if (distanceMs <= 30 * 1000) return 52;
  if (distanceMs <= 2 * 60 * 1000) return 42;
  if (distanceMs <= 10 * 60 * 1000) return 28;
  if (distanceMs <= REQUEST_USER_INFER_WINDOW_MS) return 14;
  return 0;
}

function normalizeRequestOperation(value: unknown) {
  const text = compactText(value);
  if (text === "generation" || text === "edit") return text;
  return "";
}

function addSetValue(values: Set<string>, value: unknown) {
  const text = compactText(value);
  if (text) values.add(text);
}

function requestUserCandidatesForLogs(logs: ProviderRequestLogRow[]) {
  const missingTimes = logs
    .filter((log) => !compactText(log.user_id))
    .map((log) => timestampMs(log.created_at))
    .filter(Boolean);
  if (missingTimes.length === 0) return [];

  const lowerAt = timestampAt(Math.min(...missingTimes) - REQUEST_USER_INFER_WINDOW_MS);
  const upperAt = timestampAt(Math.max(...missingTimes) + REQUEST_USER_INFER_AFTER_MS);
  const jobs = getAll<RequestUserJobRow>(
    appDb,
    `select id, user_id, session_id, type, provider_id, created_at, updated_at
     from image_jobs
     where created_at < ? and updated_at >= ?`,
    upperAt,
    lowerAt
  );
  const messages = getAll<RequestUserMessageRow>(
    appDb,
    `select user_id, session_id, metadata, created_at
     from messages
     where role = 'user' and metadata is not null and created_at >= ? and created_at < ?`,
    lowerAt,
    upperAt
  );
  const images = getAll<RequestUserImageRow>(
    appDb,
    `select id, user_id, job_id, provider_id, kind, provider_source_account_id, created_at
     from images
     where created_at >= ? and created_at < ?`,
    lowerAt,
    upperAt
  );

  const messagesByJobId = new Map<string, Array<RequestUserMessageRow & { jobId: string; mode: string; providerId: string }>>();
  for (const message of messages) {
    const metadata = safeJson<Record<string, unknown>>(message.metadata, {});
    const jobId = compactText(metadata.jobId);
    if (!jobId) continue;
    const item = {
      ...message,
      jobId,
      mode: normalizeRequestOperation(metadata.mode),
      providerId: compactText(metadata.providerId)
    };
    messagesByJobId.set(jobId, [...(messagesByJobId.get(jobId) ?? []), item]);
  }

  const imagesByJobId = new Map<string, RequestUserImageRow[]>();
  for (const image of images) {
    const jobId = compactText(image.job_id);
    if (!jobId) continue;
    imagesByJobId.set(jobId, [...(imagesByJobId.get(jobId) ?? []), image]);
  }

  const candidates: RequestUserCandidate[] = [];
  const jobIds = new Set<string>();
  for (const job of jobs) {
    const userId = compactText(job.user_id);
    const startMs = timestampMs(job.created_at);
    const updatedMs = timestampMs(job.updated_at);
    if (!userId || !startMs) continue;
    jobIds.add(job.id);

    const jobMessages = messagesByJobId.get(job.id) ?? [];
    const jobImages = imagesByJobId.get(job.id) ?? [];
    const providerIds = new Set<string>();
    const sourceAccountIds = new Set<string>();
    const anchorTimes = [updatedMs || startMs];
    addSetValue(providerIds, job.provider_id);
    for (const message of jobMessages) {
      addSetValue(providerIds, message.providerId);
      const messageMs = timestampMs(message.created_at);
      if (messageMs) anchorTimes.push(messageMs);
    }
    for (const image of jobImages) {
      addSetValue(providerIds, image.provider_id);
      addSetValue(sourceAccountIds, image.provider_source_account_id);
      const imageMs = timestampMs(image.created_at);
      if (imageMs) anchorTimes.push(imageMs);
    }
    candidates.push({
      id: job.id,
      userId,
      type: normalizeRequestOperation(job.type) || jobMessages.find((message) => message.mode)?.mode || jobImages.find((image) => normalizeRequestOperation(image.kind))?.kind || "",
      providerIds,
      sourceAccountIds,
      startMs,
      endMs: Math.max(startMs, updatedMs, ...anchorTimes),
      anchorTimes,
      hasMessage: jobMessages.length > 0
    });
  }

  for (const image of images) {
    const jobId = compactText(image.job_id);
    if (jobId && jobIds.has(jobId)) continue;
    const userId = compactText(image.user_id);
    const imageMs = timestampMs(image.created_at);
    if (!userId || !imageMs) continue;
    const providerIds = new Set<string>();
    const sourceAccountIds = new Set<string>();
    addSetValue(providerIds, image.provider_id);
    addSetValue(sourceAccountIds, image.provider_source_account_id);
    candidates.push({
      id: image.id,
      userId,
      type: normalizeRequestOperation(image.kind),
      providerIds,
      sourceAccountIds,
      startMs: imageMs - REQUEST_USER_INFER_AFTER_MS,
      endMs: imageMs + REQUEST_USER_INFER_AFTER_MS,
      anchorTimes: [imageMs],
      hasMessage: false
    });
  }

  for (const [jobId, jobMessages] of messagesByJobId) {
    if (jobIds.has(jobId)) continue;
    for (const message of jobMessages) {
      const userId = compactText(message.user_id);
      const messageMs = timestampMs(message.created_at);
      if (!userId || !messageMs) continue;
      const providerIds = new Set<string>();
      addSetValue(providerIds, message.providerId);
      candidates.push({
        id: jobId,
        userId,
        type: message.mode,
        providerIds,
        sourceAccountIds: new Set(),
        startMs: messageMs,
        endMs: messageMs + REQUEST_USER_INFER_WINDOW_MS,
        anchorTimes: [messageMs],
        hasMessage: true
      });
    }
  }

  return candidates;
}

function scoreRequestUserCandidate(log: ProviderRequestLogRow, candidate: RequestUserCandidate) {
  const requestMs = timestampMs(log.created_at);
  if (!requestMs) return null;
  const operation = normalizeRequestOperation(log.operation);
  if (operation && candidate.type && operation !== candidate.type) return null;

  const providerId = compactText(log.provider_id);
  const sourceAccountId = compactText(log.source_account_id);
  const providerMatch = Boolean(providerId && candidate.providerIds.has(providerId));
  const sourceAccountMatch = Boolean(sourceAccountId && candidate.sourceAccountIds.has(sourceAccountId));
  const intervalDistance = distanceToInterval(
    requestMs,
    candidate.startMs - 15 * 1000,
    candidate.endMs + REQUEST_USER_INFER_AFTER_MS
  );
  const anchorDistance = Math.min(intervalDistance, ...candidate.anchorTimes.map((time) => Math.abs(requestMs - time)));
  if (anchorDistance > REQUEST_USER_INFER_WINDOW_MS) return null;
  if (!providerMatch && !sourceAccountMatch && intervalDistance > 0 && anchorDistance > 2 * 60 * 1000) return null;

  let score = 0;
  if (operation && candidate.type === operation) score += 40;
  if (sourceAccountMatch) score += 80;
  if (providerMatch) score += 55;
  if (intervalDistance === 0) score += 25;
  if (candidate.hasMessage) score += 8;
  score += timeScore(anchorDistance);
  return { score, distance: anchorDistance, userId: candidate.userId };
}

function inferRequestUserId(log: ProviderRequestLogRow, candidates: RequestUserCandidate[]) {
  const ranked = candidates
    .map((candidate) => scoreRequestUserCandidate(log, candidate))
    .filter((item): item is { score: number; distance: number; userId: string } => Boolean(item))
    .sort((a, b) => b.score - a.score || a.distance - b.distance);
  const best = ranked[0];
  if (!best || best.score < 60) return "";
  const competingUser = ranked.find((item) => item.userId !== best.userId);
  if (competingUser && best.score - competingUser.score < 12) return "";
  return best.userId;
}

function resolvedProviderRequestLogs(logs: ProviderRequestLogRow[]) {
  const candidates = requestUserCandidatesForLogs(logs);
  if (candidates.length === 0) return logs;
  return logs.map((log) => {
    if (compactText(log.user_id)) return log;
    const userId = inferRequestUserId(log, candidates);
    return userId ? { ...log, user_id: userId } : log;
  });
}

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function localDateInput(date: Date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}`;
}

function parseDateInput(value: unknown) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function addLocalDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function dateStartAt(dateInput: string) {
  return `${dateInput}T00:00:00.000`;
}

function resolveStatisticsRange(presetValue: unknown, startValue: unknown, endValue: unknown): StatisticsRange {
  const customStart = parseDateInput(startValue);
  const customEnd = parseDateInput(endValue);
  let preset: StatisticsRange["preset"] = "7d";
  let start = addLocalDays(new Date(), -6);
  let end = new Date();
  if (customStart && customEnd) {
    preset = "custom";
    start = customStart <= customEnd ? customStart : customEnd;
    end = customStart <= customEnd ? customEnd : customStart;
  } else {
    const requested = String(presetValue ?? "7d").trim() as StatisticsPreset;
    preset = ["today", "yesterday", "7d", "30d", "365d", "month", "year", "lastYear"].includes(requested)
      ? requested
      : "7d";
    const today = new Date();
    if (preset === "today") {
      start = today;
      end = today;
    } else if (preset === "yesterday") {
      start = addLocalDays(today, -1);
      end = addLocalDays(today, -1);
    } else if (preset === "30d") {
      start = addLocalDays(today, -29);
      end = today;
    } else if (preset === "365d") {
      start = addLocalDays(today, -364);
      end = today;
    } else if (preset === "month") {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = today;
    } else if (preset === "year") {
      start = new Date(today.getFullYear(), 0, 1);
      end = today;
    } else if (preset === "lastYear") {
      start = new Date(today.getFullYear() - 1, 0, 1);
      end = new Date(today.getFullYear() - 1, 11, 31);
    }
  }
  const startDate = localDateInput(start);
  const endDate = localDateInput(end);
  const days: string[] = [];
  for (let cursor = parseDateInput(startDate)!; localDateInput(cursor) <= endDate; cursor = addLocalDays(cursor, 1)) {
    days.push(localDateInput(cursor));
  }
  return {
    preset,
    startDate,
    endDate,
    startAt: dateStartAt(startDate),
    endAt: dateStartAt(localDateInput(addLocalDays(parseDateInput(endDate)!, 1))),
    days
  };
}

function percentValue(value: number, total: number) {
  return total > 0 ? Number(((value / total) * 100).toFixed(1)) : 0;
}

function averageValue(total: number, count: number) {
  return count > 0 ? Math.round(total / count) : 0;
}

function channelLabel(channel: string) {
  if (channel === "cpa") return "CPA";
  if (channel === "chatgpt_web") return "ChatGPT Web";
  if (channel === "api") return "API";
  return channel || "未记录渠道";
}

function statisticsRouteMode(routeMode: string) {
  const normalized = String(routeMode || "").trim();
  if (!normalized) return "未记录方式";
  return normalized.startsWith("chatgpt_web_") ? "chatgpt_web_*" : normalized;
}

function accountStatusLabel(status: string) {
  if (status === "normal") return "正常";
  if (status === "limited") return "限流";
  if (status === "abnormal") return "异常";
  if (status === "disabled") return "禁用";
  return status || "未知";
}

function errorSummary(value: string | null | undefined) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "未记录错误";
  return text.length > 140 ? `${text.slice(0, 140)}...` : text;
}

function userDisplay(user: StatisticsUser | undefined, userId: string) {
  if (!user && !userId) return { userId: "", username: "未记录用户", account: "", teamId: "", teamName: "未记录团队" };
  const account = user?.account?.trim() || user?.username || userId;
  return {
    userId,
    username: user?.username || account || "未记录用户",
    account,
    teamId: user?.team_id ?? defaultTeamId(),
    teamName: user?.team_name ?? (user ? "默认团队" : "未记录团队")
  };
}

function buildConfigStatistics(range: StatisticsRange) {
  const users = getAll<StatisticsUser>(
    appDb,
    `select u.id, u.account, u.username, u.team_id, u.disabled, u.has_config_access, u.last_login_at, t.name as team_name
     from users u
     left join teams t on t.id = u.team_id`
  );
  const teams = getAll<TeamRow>(appDb, "select * from teams order by created_at asc");
  const images = getAll<StatisticsImageRow>(
    appDb,
    "select user_id, kind, provider_id, generated_by_retry, created_at from images where created_at >= ? and created_at < ?",
    range.startAt,
    range.endAt
  );
  const todayDate = localDateInput(new Date());
  const todayImages = getAll<StatisticsImageRow>(
    appDb,
    "select user_id, kind, provider_id, generated_by_retry, created_at from images where created_at >= ? and created_at < ?",
    dateStartAt(todayDate),
    dateStartAt(localDateInput(addLocalDays(parseDateInput(todayDate)!, 1)))
  );
  const sessions = getAll<StatisticsSessionRow>(
    appDb,
    "select user_id, created_at from sessions where deleted_at is null and created_at >= ? and created_at < ?",
    range.startAt,
    range.endAt
  );
  const retryJobs = getAll<StatisticsJobRetryRow>(
    appDb,
    `select auto_retry_count, manual_retry_count, max_auto_retries, succeeded_on_retry, updated_at
     from image_jobs
     where updated_at >= ? and updated_at < ?`,
    range.startAt,
    range.endAt
  );
  const requests = resolvedProviderRequestLogs(
    getAll<ProviderRequestLogRow>(
      configDb,
      "select * from provider_request_logs where created_at >= ? and created_at < ? order by created_at desc",
      range.startAt,
      range.endAt
    )
  );
  const providers = getAll<ProviderRow>(configDb, "select * from provider_configs");
  const accounts = getAll<ImageAccountRow>(configDb, "select * from image_accounts");
  const latestSyncRun = getOne<{ status: string; message: string; finished_at: string }>(
    configDb,
    "select status, message, finished_at from cpa_sync_runs order by started_at desc limit 1"
  );

  const usersById = new Map(users.map((user) => [user.id, user]));
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const trendByDate = new Map(
    range.days.map((day) => [
      day,
      {
        date: day,
        label: day.slice(5),
        generationImages: 0,
        editImages: 0,
        requestSuccess: 0,
        requestFailure: 0,
        retryRequests: 0,
        averageDurationMs: 0,
        durationTotal: 0,
        durationCount: 0
      }
    ])
  );
  const userStats = new Map<string, { userId: string; username: string; account: string; teamName: string; imageCount: number; requestCount: number; failureCount: number; lastActiveAt: string }>();
  const teamStats = new Map<string, { teamId: string; teamName: string; userCount: number; sessionCount: number; imageCount: number; requestCount: number; successCount: number; failureCount: number }>();
  const providerStats = new Map<string, { providerId: string; providerName: string; channel: string; requestCount: number; successCount: number; failureCount: number; retryRequestCount: number; retrySuccessCount: number; retryFailureCount: number; durationTotal: number; lastError: string }>();
  const channelStats = new Map<string, { channel: string; label: string; requestCount: number; successCount: number; failureCount: number; retryRequestCount: number; retrySuccessCount: number; retryFailureCount: number; durationTotal: number }>();
  const routeStats = new Map<string, { channel: string; channelLabel: string; routeMode: string; label: string; requestCount: number; successCount: number; failureCount: number; retryRequestCount: number; retrySuccessCount: number; retryFailureCount: number }>();
  const imageProviderStats = new Map<string, { providerId: string; providerName: string; imageCount: number; retryImageCount: number }>();
  const accountStats = new Map<string, { accountId: string; name: string; status: string; requestCount: number; successCount: number; failureCount: number; lastRequestAt: string }>();
  const failureGroups = new Map<string, { error: string; count: number; lastAt: string; providerName: string; channel: string; routeMode: string }>();
  const failureByAccount = new Map<string, { accountId: string; name: string; count: number; lastAt: string }>();
  const failureByProvider = new Map<string, { providerId: string; providerName: string; count: number; lastAt: string }>();

  for (const channel of ["cpa", "chatgpt_web", "api"]) {
    channelStats.set(channel, { channel, label: channelLabel(channel), requestCount: 0, successCount: 0, failureCount: 0, retryRequestCount: 0, retrySuccessCount: 0, retryFailureCount: 0, durationTotal: 0 });
  }
  const ensureUserStat = (userId: string) => {
    const display = userDisplay(usersById.get(userId), userId);
    const key = userId || "unknown";
    if (!userStats.has(key)) {
      userStats.set(key, { ...display, imageCount: 0, requestCount: 0, failureCount: 0, lastActiveAt: "" });
    }
    return userStats.get(key)!;
  };
  const ensureTeamStat = (teamId: string, teamName: string) => {
    const key = teamId || "unknown";
    if (!teamStats.has(key)) {
      teamStats.set(key, { teamId: key, teamName, userCount: 0, sessionCount: 0, imageCount: 0, requestCount: 0, successCount: 0, failureCount: 0 });
    }
    return teamStats.get(key)!;
  };
  for (const user of users) {
    const teamId = user.team_id ?? defaultTeamId();
    const team = teamById.get(teamId);
    ensureTeamStat(teamId, team?.name ?? "默认团队").userCount += 1;
  }

  for (const image of images) {
    const day = image.created_at.slice(0, 10);
    const trend = trendByDate.get(day);
    if (trend) {
      if (image.kind === "edit") trend.editImages += 1;
      else trend.generationImages += 1;
    }
    const user = ensureUserStat(image.user_id);
    user.imageCount += 1;
    user.lastActiveAt = user.lastActiveAt > image.created_at ? user.lastActiveAt : image.created_at;
    const display = userDisplay(usersById.get(image.user_id), image.user_id);
    ensureTeamStat(display.teamId, display.teamName).imageCount += 1;
    const provider = providerById.get(image.provider_id);
    const providerName = provider?.name || image.provider_id || "未记录渠道";
    const providerKey = image.provider_id || providerName;
    const item = imageProviderStats.get(providerKey) ?? { providerId: image.provider_id, providerName, imageCount: 0, retryImageCount: 0 };
    item.imageCount += 1;
    if (image.generated_by_retry) item.retryImageCount += 1;
    imageProviderStats.set(providerKey, item);
  }

  for (const session of sessions) {
    const display = userDisplay(usersById.get(session.user_id), session.user_id);
    ensureTeamStat(display.teamId, display.teamName).sessionCount += 1;
  }

  for (const request of requests) {
    const day = request.created_at.slice(0, 10);
    const isRetryRequest = Boolean(request.is_retry);
    const trend = trendByDate.get(day);
    if (trend) {
      if (request.success) trend.requestSuccess += 1;
      else trend.requestFailure += 1;
      if (isRetryRequest) trend.retryRequests += 1;
      trend.durationTotal += request.duration_ms;
      trend.durationCount += 1;
    }
    const user = ensureUserStat(request.user_id ?? "");
    user.requestCount += 1;
    if (!request.success) user.failureCount += 1;
    user.lastActiveAt = user.lastActiveAt > request.created_at ? user.lastActiveAt : request.created_at;

    const display = userDisplay(usersById.get(request.user_id ?? ""), request.user_id ?? "");
    const team = ensureTeamStat(display.teamId, display.teamName);
    team.requestCount += 1;
    if (request.success) team.successCount += 1;
    else team.failureCount += 1;

    const providerKey = request.provider_id || request.provider_name || "unknown";
    const provider = providerStats.get(providerKey) ?? {
      providerId: request.provider_id,
      providerName: request.provider_name || request.provider_id || "未记录渠道",
      channel: request.channel || "",
      requestCount: 0,
      successCount: 0,
      failureCount: 0,
      retryRequestCount: 0,
      retrySuccessCount: 0,
      retryFailureCount: 0,
      durationTotal: 0,
      lastError: ""
    };
    provider.requestCount += 1;
    provider.durationTotal += request.duration_ms;
    if (isRetryRequest) provider.retryRequestCount += 1;
    if (request.success) {
      provider.successCount += 1;
      if (isRetryRequest) provider.retrySuccessCount += 1;
    }
    else {
      provider.failureCount += 1;
      if (isRetryRequest) provider.retryFailureCount += 1;
      provider.lastError ||= errorSummary(request.error);
    }
    providerStats.set(providerKey, provider);

    const channelKey = request.channel || "unknown";
    const channel = channelStats.get(channelKey) ?? { channel: channelKey, label: channelLabel(channelKey), requestCount: 0, successCount: 0, failureCount: 0, retryRequestCount: 0, retrySuccessCount: 0, retryFailureCount: 0, durationTotal: 0 };
    channel.requestCount += 1;
    channel.durationTotal += request.duration_ms;
    if (isRetryRequest) channel.retryRequestCount += 1;
    if (request.success) {
      channel.successCount += 1;
      if (isRetryRequest) channel.retrySuccessCount += 1;
    } else {
      channel.failureCount += 1;
      if (isRetryRequest) channel.retryFailureCount += 1;
    }
    channelStats.set(channelKey, channel);

    const routeMode = statisticsRouteMode(request.route_mode);
    const routeKey = `${channelKey}:${routeMode}`;
    const routeLabel = channelLabel(channelKey);
    const route = routeStats.get(routeKey) ?? {
      channel: channelKey,
      channelLabel: routeLabel,
      routeMode,
      label: `${routeLabel} / ${routeMode}`,
      requestCount: 0,
      successCount: 0,
      failureCount: 0,
      retryRequestCount: 0,
      retrySuccessCount: 0,
      retryFailureCount: 0
    };
    route.requestCount += 1;
    if (isRetryRequest) route.retryRequestCount += 1;
    if (request.success) {
      route.successCount += 1;
      if (isRetryRequest) route.retrySuccessCount += 1;
    } else {
      route.failureCount += 1;
      if (isRetryRequest) route.retryFailureCount += 1;
    }
    routeStats.set(routeKey, route);

    const sourceAccountId = String(request.source_account_id ?? "").trim();
    if (sourceAccountId) {
      const account = accountById.get(sourceAccountId);
      const stat = accountStats.get(sourceAccountId) ?? {
        accountId: sourceAccountId,
        name: account?.name || account?.email || sourceAccountId,
        status: account?.status || "",
        requestCount: 0,
        successCount: 0,
        failureCount: 0,
        lastRequestAt: ""
      };
      stat.requestCount += 1;
      if (request.success) stat.successCount += 1;
      else stat.failureCount += 1;
      stat.lastRequestAt = stat.lastRequestAt > request.created_at ? stat.lastRequestAt : request.created_at;
      accountStats.set(sourceAccountId, stat);
    }

    if (!request.success) {
      const summary = errorSummary(request.error);
      const failure = failureGroups.get(summary) ?? { error: summary, count: 0, lastAt: "", providerName: request.provider_name, channel: request.channel, routeMode: request.route_mode };
      failure.count += 1;
      failure.lastAt = failure.lastAt > request.created_at ? failure.lastAt : request.created_at;
      failureGroups.set(summary, failure);

      const providerFailure = failureByProvider.get(providerKey) ?? { providerId: request.provider_id, providerName: request.provider_name || request.provider_id || "未记录渠道", count: 0, lastAt: "" };
      providerFailure.count += 1;
      providerFailure.lastAt = providerFailure.lastAt > request.created_at ? providerFailure.lastAt : request.created_at;
      failureByProvider.set(providerKey, providerFailure);

      const accountKey = sourceAccountId || "unknown";
      const account = accountById.get(accountKey);
      const accountFailure = failureByAccount.get(accountKey) ?? { accountId: accountKey === "unknown" ? "" : accountKey, name: account?.name || account?.email || (accountKey === "unknown" ? "未记录账号" : accountKey), count: 0, lastAt: "" };
      accountFailure.count += 1;
      accountFailure.lastAt = accountFailure.lastAt > request.created_at ? accountFailure.lastAt : request.created_at;
      failureByAccount.set(accountKey, accountFailure);
    }
  }

  const trendRows = [...trendByDate.values()].map(({ durationTotal, durationCount, ...item }) => ({
    ...item,
    averageDurationMs: averageValue(durationTotal, durationCount)
  }));
  const requestSuccess = requests.filter((request) => Boolean(request.success)).length;
  const requestFailure = requests.length - requestSuccess;
  const retryRequests = requests.filter((request) => Boolean(request.is_retry)).length;
  const retrySuccessRequests = requests.filter((request) => Boolean(request.is_retry) && Boolean(request.success)).length;
  const retryFailureRequests = retryRequests - retrySuccessRequests;
  const durationTotal = requests.reduce((sum, request) => sum + request.duration_ms, 0);
  const generationImages = images.filter((image) => image.kind !== "edit").length;
  const editImages = images.length - generationImages;
  const retryGeneratedImages = images.filter((image) => Boolean(image.generated_by_retry)).length;
  const todayGenerationImages = todayImages.filter((image) => image.kind !== "edit").length;
  const todayEditImages = todayImages.length - todayGenerationImages;
  const todayRetryGeneratedImages = todayImages.filter((image) => Boolean(image.generated_by_retry)).length;
  const autoRetryCount = retryJobs.reduce((sum, job) => sum + Math.max(0, Number(job.auto_retry_count ?? 0)), 0);
  const manualRetryCount = retryJobs.reduce((sum, job) => sum + Math.max(0, Number(job.manual_retry_count ?? 0)), 0);
  const retrySucceededJobs = retryJobs.filter((job) => Boolean(job.succeeded_on_retry)).length;
  const statusCounts = ["normal", "limited", "abnormal", "disabled"].map((status) => ({
    status,
    label: accountStatusLabel(status),
    count: accounts.filter((account) => account.status === status).length
  }));
  const sortDesc = <T,>(items: T[], selector: (item: T) => number) => items.sort((a, b) => selector(b) - selector(a));
  const userRankingItems = [...userStats.values()];

  return {
    range: {
      preset: range.preset,
      startDate: range.startDate,
      endDate: range.endDate,
      startAt: range.startAt,
      endAt: range.endAt,
      dayCount: range.days.length
    },
    summary: {
      totalUsers: users.length,
      enabledUsers: users.filter((user) => !user.disabled).length,
      managerUsers: users.filter((user) => Boolean(user.has_config_access)).length,
      totalImages: images.length,
      generationImages,
      editImages,
      retryGeneratedImages,
      todayImages: todayImages.length,
      todayGenerationImages,
      todayEditImages,
      todayRetryGeneratedImages,
      totalRequests: requests.length,
      successfulRequests: requestSuccess,
      failedRequests: requestFailure,
      retryRequests,
      successRate: percentValue(requestSuccess, requests.length),
      averageDurationMs: averageValue(durationTotal, requests.length),
      totalProviders: providers.length,
      enabledProviders: providers.filter((provider) => Boolean(provider.enabled)).length,
      availableAccounts: accounts.filter((account) => account.status === "normal").length,
      limitedOrAbnormalAccounts: accounts.filter((account) => account.status === "limited" || account.status === "abnormal").length
    },
    trends: trendRows,
    users: {
      totals: {
        total: users.length,
        enabled: users.filter((user) => !user.disabled).length,
        disabled: users.filter((user) => Boolean(user.disabled)).length,
        managers: users.filter((user) => Boolean(user.has_config_access)).length
      },
      rankings: sortDesc([...userRankingItems], (item) => item.imageCount + item.requestCount).slice(0, 20),
      imageRankings: sortDesc([...userRankingItems], (item) => item.imageCount).filter((item) => item.imageCount > 0).slice(0, 10),
      requestRankings: sortDesc([...userRankingItems], (item) => item.requestCount).filter((item) => item.requestCount > 0).slice(0, 10),
      failureRankings: sortDesc([...userRankingItems], (item) => item.failureCount).filter((item) => item.failureCount > 0).slice(0, 10)
    },
    teams: sortDesc(
      [...teamStats.values()].map((item) => ({
        ...item,
        successRate: percentValue(item.successCount, item.requestCount)
      })),
      (item) => item.imageCount + item.requestCount + item.sessionCount
    ),
    images: {
      totals: { total: images.length, generation: generationImages, edit: editImages, retryGenerated: retryGeneratedImages },
      byUser: sortDesc([...userRankingItems], (item) => item.imageCount).filter((item) => item.imageCount > 0).slice(0, 10),
      byTeam: sortDesc([...teamStats.values()], (item) => item.imageCount).filter((item) => item.imageCount > 0).slice(0, 10),
      byProvider: sortDesc([...imageProviderStats.values()], (item) => item.imageCount).slice(0, 10)
    },
    providers: {
      totals: {
        totalRequests: requests.length,
        successRate: percentValue(requestSuccess, requests.length),
        averageDurationMs: averageValue(durationTotal, requests.length),
        failedRequests: requestFailure,
        retryRequests,
        retrySuccessRequests,
        retryFailureRequests,
        retrySuccessRate: percentValue(retrySuccessRequests, retryRequests),
        autoRetryCount,
        manualRetryCount,
        retrySucceededJobs
      },
      byChannel: sortDesc(
        [...channelStats.values()].map((item) => ({ ...item, successRate: percentValue(item.successCount, item.requestCount), averageDurationMs: averageValue(item.durationTotal, item.requestCount) })),
        (item) => item.requestCount
      ),
      byRoute: sortDesc(
        [...routeStats.values()].map((item) => ({ ...item, successRate: percentValue(item.successCount, item.requestCount) })),
        (item) => item.requestCount
      ),
      byProvider: sortDesc(
        [...providerStats.values()].map((item) => ({ ...item, successRate: percentValue(item.successCount, item.requestCount), averageDurationMs: averageValue(item.durationTotal, item.requestCount) })),
        (item) => item.requestCount
      ).slice(0, 12)
    },
    accounts: {
      totals: { total: accounts.length, normal: statusCounts[0].count, limited: statusCounts[1].count, abnormal: statusCounts[2].count, disabled: statusCounts[3].count },
      statusCounts,
      rankings: sortDesc([...accountStats.values()], (item) => item.requestCount).slice(0, 12),
      latestSyncRun: latestSyncRun
        ? { status: latestSyncRun.status, message: latestSyncRun.message, finishedAt: latestSyncRun.finished_at }
        : null
    },
    failures: {
      total: requestFailure,
      failureRate: percentValue(requestFailure, requests.length),
      groups: sortDesc([...failureGroups.values()], (item) => item.count).slice(0, 12),
      recent: requests
        .filter((request) => !request.success)
        .slice(0, 20)
        .map((request) => {
          const display = userDisplay(usersById.get(request.user_id ?? ""), request.user_id ?? "");
          const account = accountById.get(String(request.source_account_id ?? ""));
          return {
            id: request.id,
            createdAt: request.created_at,
            username: display.username,
            account: display.account,
            providerName: request.provider_name,
            channel: request.channel,
            routeMode: request.route_mode,
            sourceAccountName: account?.name || account?.email || String(request.source_account_id ?? ""),
            error: String(request.error ?? "").trim() || "未记录错误",
            fullError: String(request.error ?? "").trim() || "未记录错误"
          };
        }),
      byProvider: sortDesc([...failureByProvider.values()], (item) => item.count).slice(0, 10),
      byAccount: sortDesc([...failureByAccount.values()], (item) => item.count).slice(0, 10)
    }
  };
}

api.get("/config/statistics", (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const range = resolveStatisticsRange(c.req.query("preset"), c.req.query("startDate"), c.req.query("endDate"));
  return c.json({ statistics: buildConfigStatistics(range) });
});

api.get("/config/request-logs", (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(c.req.query("limit") ?? 40) || 40)));
  const offset = Math.max(0, Math.trunc(Number(c.req.query("offset") ?? 0) || 0));
  const total = getOne<{ total: number }>(configDb, "select count(*) as total from provider_request_logs")?.total ?? 0;
  const logs = resolvedProviderRequestLogs(
    getAll<ProviderRequestLogRow>(
      configDb,
      "select * from provider_request_logs order by created_at desc limit ? offset ?",
      limit,
      offset
    )
  );
  const userIds = [...new Set(logs.map((log) => String(log.user_id ?? "").trim()).filter(Boolean))];
  const users =
    userIds.length > 0
      ? getAll<Pick<UserRow, "id" | "account" | "username">>(
          appDb,
          `select id, account, username from users where id in (${userIds.map(() => "?").join(",")})`,
          ...userIds
        )
      : [];
  const usersById = new Map(users.map((user) => [user.id, user]));
  const sourceAccountIds = [...new Set(logs.map((log) => String(log.source_account_id ?? "").trim()).filter(Boolean))];
  const sourceAccounts =
    sourceAccountIds.length > 0
      ? getAll<Pick<ImageAccountRow, "id" | "name" | "email">>(
          configDb,
          `select id, name, email from image_accounts where id in (${sourceAccountIds.map(() => "?").join(",")})`,
          ...sourceAccountIds
        )
      : [];
  const sourceAccountsById = new Map(sourceAccounts.map((account) => [account.id, account]));
  return c.json({
    logs: logs.map((log) => {
      const userId = String(log.user_id ?? "").trim();
      const user = usersById.get(userId);
      const sourceAccountId = String(log.source_account_id ?? "").trim();
      const sourceAccount = sourceAccountsById.get(sourceAccountId);
      return {
        id: log.id,
        providerId: log.provider_id,
        providerName: log.provider_name,
        channel: log.channel,
        routeMode: log.route_mode,
        operation: log.operation,
        jobId: log.job_id ?? "",
        attemptNo: Math.max(1, Number(log.attempt_no ?? 1)),
        maxAttempts: Math.max(1, Number(log.max_attempts ?? 1)),
        isRetry: Boolean(log.is_retry),
        sourceAccountId,
        sourceAccountName: sourceAccount?.name || sourceAccount?.email || sourceAccountId,
        sourceAccountEmail: sourceAccount?.email ?? "",
        userId,
        username: user?.username ?? "",
        account: user?.account ?? "",
        endpoint: log.endpoint,
        statusCode: log.status_code,
        durationMs: log.duration_ms,
        success: Boolean(log.success),
        error: log.error ?? "",
        responseSnapshot: log.response_snapshot ?? "",
        createdAt: log.created_at
      };
    }),
    pageInfo: {
      limit,
      offset,
      total,
      hasMore: offset + logs.length < total
    }
  });
});

api.get("/config/model-request-logs", (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const limit = Math.max(1, Math.min(500, Math.trunc(Number(c.req.query("limit") ?? 100) || 100)));
  const where: string[] = [];
  const params: unknown[] = [];
  const success = String(c.req.query("success") ?? "").trim().toLowerCase();
  if (success === "true" || success === "1") {
    where.push("success = 1");
  } else if (success === "false" || success === "0") {
    where.push("success = 0");
  }
  const purpose = String(c.req.query("purpose") ?? "").trim();
  if (purpose) {
    where.push("purpose = ?");
    params.push(purpose);
  }
  const providerId = String(c.req.query("providerId") ?? "").trim();
  if (providerId) {
    where.push("provider_id = ?");
    params.push(providerId);
  }
  const logs = getAll<ModelRequestLogRow>(
    configDb,
    `select * from model_request_logs
     ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
     order by created_at desc
     limit ?`,
    ...params,
    limit
  );
  const userIds = [...new Set(logs.map((log) => String(log.user_id ?? "").trim()).filter(Boolean))];
  const users =
    userIds.length > 0
      ? getAll<Pick<UserRow, "id" | "account" | "username">>(
          appDb,
          `select id, account, username from users where id in (${userIds.map(() => "?").join(",")})`,
          ...userIds
        )
      : [];
  const usersById = new Map(users.map((user) => [user.id, user]));
  return c.json({
    logs: logs.map((log) => {
      const userId = String(log.user_id ?? "").trim();
      const user = usersById.get(userId);
      return {
        id: log.id,
        purpose: log.purpose,
        providerId: log.provider_id,
        providerName: log.provider_name,
        model: log.model,
        endpoint: log.endpoint,
        method: log.method,
        streamEnabled: Boolean(log.stream_enabled),
        retryCount: Math.max(0, Number(log.retry_count ?? 0)),
        attemptCount: Math.max(0, Number(log.attempt_count ?? 0)),
        statusCode: log.status_code,
        durationMs: Math.max(0, Number(log.duration_ms ?? 0)),
        success: Boolean(log.success),
        error: log.error ?? "",
        userId,
        username: user?.username ?? "",
        account: user?.account ?? "",
        jobId: log.job_id ?? "",
        source: log.source ?? "",
        createdAt: log.created_at
      };
    })
  });
});

api.put("/config/proxy", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const body = await c.req.json().catch(() => ({}));
  const enabled = Boolean(body.enabled);
  const url = String(body.url ?? "").trim();
  if (enabled && !url) {
    return c.json({ error: "启用代理必须填写代理地址" }, 400);
  }
  const rawRetryCount = Number(body.retryCount ?? 2);
  const retryCount = Number.isFinite(rawRetryCount) ? Math.max(0, Math.min(10, Math.trunc(rawRetryCount))) : 2;
  const timestamp = now();
  run(
    configDb,
    `insert into proxy_settings (
      id, enabled, url, retry_count, apply_chatgpt_web, apply_cpa, apply_api, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      enabled = excluded.enabled,
      url = excluded.url,
      retry_count = excluded.retry_count,
      apply_chatgpt_web = excluded.apply_chatgpt_web,
      apply_cpa = excluded.apply_cpa,
      apply_api = excluded.apply_api,
      updated_at = excluded.updated_at`,
    "default",
    enabled ? 1 : 0,
    url,
    retryCount,
    1,
    1,
    1,
    timestamp
  );
  saveGlobalSwitch("proxy_service", enabled);
  audit("proxy.save", {
    enabled,
    retryCount
  });
  return c.json({ proxy: proxySettings() });
});

api.get("/config/debug", (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  return c.json({ debug: debugSettings() });
});

api.put("/config/debug", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const body = await c.req.json().catch(() => ({}));
  const timestamp = now();
  run(
    configDb,
    `insert into debug_settings (
      id, image_edit_mask, image_edit_response, updated_at
    ) values (?, ?, ?, ?)
    on conflict(id) do update set
      image_edit_mask = excluded.image_edit_mask,
      updated_at = excluded.updated_at`,
    "default",
    Boolean(body.imageEditMask) ? 1 : 0,
    0,
    timestamp
  );
  saveGlobalSwitch("debug_image_edit_mask", Boolean(body.imageEditMask));
  audit("debug.save", {
    imageEditMask: Boolean(body.imageEditMask)
  });
  return c.json({ debug: debugSettings() });
});

api.get("/config/cpa", (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const runs = getAll<{
    id: string;
    status: string;
    message: string;
    started_at: string;
    finished_at: string;
  }>(
    configDb,
    "select * from cpa_sync_runs order by started_at desc limit 10"
  );
  return c.json({
    account: cpaAccount(false),
    nextAutoSyncAt: cpaSyncNextRunAt,
    runs: runs.map((runItem) => ({
      id: runItem.id,
      status: runItem.status,
      message: runItem.message,
      startedAt: runItem.started_at,
      finishedAt: runItem.finished_at
    }))
  });
});

api.put("/config/cpa", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const raw = await c.req.json().catch(() => ({}));
  const existing = cpaAccount(true);
  const passwordSecret = String(raw.passwordSecret ?? "");
  const enabled = Boolean(raw.enabled);
  const syncUrl = String(raw.syncUrl ?? "").trim();
  if (enabled && !syncUrl) return c.json({ error: "启用 CPA 同步必须填写管理地址" }, 400);
  if (enabled && !passwordSecret.trim() && !existing.passwordSecret) {
    return c.json({ error: "启用 CPA 同步必须填写访问密码" }, 400);
  }
  const id = "cpa_default";
  run(
    configDb,
    `insert into cpa_accounts (
      id, enabled, account_name, sync_url, username, password_secret,
      token_secret, frequency_minutes, last_status, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      enabled = excluded.enabled,
      account_name = excluded.account_name,
      sync_url = excluded.sync_url,
      username = excluded.username,
      password_secret = excluded.password_secret,
      token_secret = excluded.token_secret,
      frequency_minutes = excluded.frequency_minutes,
      updated_at = excluded.updated_at`,
    id,
    enabled ? 1 : 0,
    "CPA 同步",
    syncUrl,
    "",
    passwordSecret.includes("****") ? existing.passwordSecret : passwordSecret,
    "",
    normalizeCpaFrequencyMinutes(raw.frequencyMinutes),
    existing.lastStatus || "",
    now()
  );
  saveGlobalSwitch("cpa_sync", enabled);
  audit("cpa.save", { enabled, syncUrl });
  scheduleCpaSync();
  return c.json({ ok: true });
});

api.post("/config/cpa/sync", async (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const result = await executeCpaSync("manual");
  scheduleCpaSync();
  return c.json(result);
});

api.get("/config/audit", (c) => {
  const blocked = requireConfig(c);
  if (blocked) return blocked;
  const logs = getAll<{ id: string; action: string; detail: string; created_at: string }>(
    configDb,
    "select * from config_audit_logs order by created_at desc limit 50"
  );
  return c.json({
    logs: logs.map((log) => ({
      id: log.id,
      action: log.action,
      detail: safeJson(log.detail, {}),
      createdAt: log.created_at
    }))
  });
});

const app = new Hono();
app.route("/api", api);
app.use("/api/*", async (c) => c.json({ error: "接口不存在" }, 404));
app.get("/login/:file", async (c) => {
  const asset = await loginAssetFile(c.req.param("file"));
  if (!asset) return c.text("Not Found", 404);
  return new Response(asset.file, {
    headers: {
      "Content-Type": asset.file.type || mimeTypeFromPath(asset.fileName),
      "Cache-Control": "no-cache"
    }
  });
});
app.use("*", serveStatic({ root: "./dist" }));
app.get("*", async (c) => {
  const indexPath = path.join(ROOT, "dist", "index.html");
  if (!existsSync(indexPath)) {
    return c.text("API server is running. Run `bun run build` before using the single-service UI.", 200);
  }
  return c.html(await readFile(indexPath, "utf8"));
});

const port = Number(Bun.env.PORT ?? 8787);
const hostname = String(Bun.env.HOST ?? "0.0.0.0").trim() || "0.0.0.0";
const displayHost = hostname === "0.0.0.0" ? "127.0.0.1" : hostname;
console.log(`GPT Image Workbench listening on http://${displayHost}:${port}`);
if (hostname === "0.0.0.0") {
  console.log(`LAN access enabled. Use this Windows machine's LAN IP with port ${port}.`);
}

const server = Bun.serve({
  port,
  hostname,
  idleTimeout: Math.min(255, Math.ceil(IMAGE_JOB_RUNNING_TIMEOUT_MS / 1000) + 30),
  fetch: app.fetch
});
(globalThis as typeof globalThis & { __gptImageServer?: typeof server }).__gptImageServer = server;

startStarterCopyScheduler();
scheduleCpaSync();
startBackupScheduler();
