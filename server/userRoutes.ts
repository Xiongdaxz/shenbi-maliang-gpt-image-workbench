import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { normalizeAppearanceMode } from "./appearanceMode";
import { APP_COOKIE, AUTO_PROVIDER_ID, CONFIG_COOKIE, SESSION_MAX_AGE } from "./constants";
import { appDb, configDb, getAll, getOne, run } from "./db";
import { audit } from "./auditLog";
import { defaultTeamId } from "./categories";
import { publicBranding } from "./branding";
import { enabledProvidersForCurrentMode } from "./providerRuntime";
import { imageOriginPromptsByImageIds, imageReferencesByImageIds, publicUser, toProvider } from "./serializers";
import { imageGenerationSettings } from "./settingsStore";
import { streamImageJobEvents } from "./imageJobEvents";
import { saveUserPreferences } from "./userPreferences";
import { deleteStoredFilesIfUnreferenced, secureUserAvatarPath, writeEncryptedFile } from "./secureFiles";
import type { UserRow } from "./types";
import { makeId, now, safeJson, utcNow } from "./utils";
import { currentUser, futureDate, requireUser } from "./auth";
import { pageInfo, paginationFromQuery } from "./pagination";
import { fallbackChineseUsername, fallbackChineseUsernameCount, generateChineseUsername, generateChineseUsernameCandidates } from "./promptTitle";
import { REGISTRATION_DISABLED_MESSAGE, selfRegistrationEnabled, registrationSettings } from "./registrationSettings";
import { sendVerificationEmail } from "./smtp";
import { normalizePhone as normalizeSmsPhone, sendVerificationSms, validMainlandPhone } from "./sms";
import { validateUsername } from "./usernamePolicy";
import { deleteAccountConfirmationText, deleteUserAccount } from "./userDeletion";
import {
  archiveAllSessions,
  archiveSession,
  deleteAllSessionRecords,
  deleteSessionRecords,
  expireStaleImageJobs,
  immediateChatTitleFromPrompt,
  ownedSession,
  pinSession,
  refreshChatTitleInBackground,
  renameSession,
  serializeJob,
  serializeMessage,
  serializeSession,
  unarchiveAllSessions
} from "./chatStore";

type VerificationPurpose = "register" | "password_reset";
type VerificationTargetType = "email" | "phone";

type VerificationCodeRow = {
  id: string;
  purpose: VerificationPurpose;
  target_type: string;
  target: string;
  code_hash: string;
  expires_at: string;
  cooldown_until: string;
  attempts: number;
  send_count: number;
  consumed_at: string | null;
  created_at: string;
  updated_at: string;
};

type SendVerificationCodeResult =
  | { ok: true; expiresInSeconds: number; cooldownSeconds: number }
  | { error: string; status: 429 };

type ConsumeVerificationCodeResult =
  | { ok: true }
  | { error: string; status: 400 };

const VERIFICATION_CODE_TTL_SECONDS = 10 * 60;
const VERIFICATION_CODE_COOLDOWN_SECONDS = 60;
const VERIFICATION_CODE_MAX_ATTEMPTS = 5;

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizePhone(value: unknown) {
  return normalizeSmsPhone(value);
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function randomVerificationCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function findUserByLogin(login: string) {
  const email = normalizeEmail(login);
  const phone = normalizePhone(login);
  return getOne<UserRow>(
    appDb,
    `select * from users
     where account = ?
        or (? <> '' and lower(email) = ?)
        or (? <> '' and phone = ?)
     limit 1`,
    login,
    validEmail(email) ? email : "",
    email,
    phone,
    phone
  );
}

function findUserByEmailIdentity(email: string) {
  return getOne<UserRow>(
    appDb,
    "select * from users where lower(email) = ? or lower(account) = ? limit 1",
    email,
    email
  );
}

function findUserByPhoneIdentity(phone: string) {
  return getOne<UserRow>(
    appDb,
    "select * from users where phone = ? or account = ? limit 1",
    phone,
    phone
  );
}

function latestVerificationCode(purpose: VerificationPurpose, targetType: VerificationTargetType, target: string) {
  return getOne<VerificationCodeRow>(
    appDb,
    `select * from auth_verification_codes
     where purpose = ? and target_type = ? and target = ? and consumed_at is null
     order by created_at desc limit 1`,
    purpose,
    targetType,
    target
  );
}

async function sendEmailVerificationCode(purpose: VerificationPurpose, email: string): Promise<SendVerificationCodeResult> {
  const latest = latestVerificationCode(purpose, "email", email);
  const current = utcNow();
  if (latest?.cooldown_until && latest.cooldown_until > current) {
    return { error: "验证码发送过于频繁，请稍后再试", status: 429 };
  }
  const code = randomVerificationCode();
  await sendVerificationEmail(email, code, purpose);
  const timestamp = now();
  run(
    appDb,
    `insert into auth_verification_codes (
      id, purpose, target_type, target, code_hash, expires_at, cooldown_until,
      attempts, send_count, consumed_at, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    makeId("verify"),
    purpose,
    "email",
    email,
    await Bun.password.hash(code),
    futureDate(VERIFICATION_CODE_TTL_SECONDS),
    futureDate(VERIFICATION_CODE_COOLDOWN_SECONDS),
    0,
    (latest?.send_count ?? 0) + 1,
    null,
    timestamp,
    timestamp
  );
  return { ok: true, expiresInSeconds: VERIFICATION_CODE_TTL_SECONDS, cooldownSeconds: VERIFICATION_CODE_COOLDOWN_SECONDS };
}

async function sendPhoneVerificationCode(purpose: VerificationPurpose, phone: string): Promise<SendVerificationCodeResult> {
  const latest = latestVerificationCode(purpose, "phone", phone);
  const current = utcNow();
  if (latest?.cooldown_until && latest.cooldown_until > current) {
    return { error: "验证码发送过于频繁，请稍后再试", status: 429 };
  }
  const code = randomVerificationCode();
  await sendVerificationSms(phone, code, purpose);
  const timestamp = now();
  run(
    appDb,
    `insert into auth_verification_codes (
      id, purpose, target_type, target, code_hash, expires_at, cooldown_until,
      attempts, send_count, consumed_at, created_at, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    makeId("verify"),
    purpose,
    "phone",
    phone,
    await Bun.password.hash(code),
    futureDate(VERIFICATION_CODE_TTL_SECONDS),
    futureDate(VERIFICATION_CODE_COOLDOWN_SECONDS),
    0,
    (latest?.send_count ?? 0) + 1,
    null,
    timestamp,
    timestamp
  );
  return { ok: true, expiresInSeconds: VERIFICATION_CODE_TTL_SECONDS, cooldownSeconds: VERIFICATION_CODE_COOLDOWN_SECONDS };
}

async function consumeVerificationCode(purpose: VerificationPurpose, targetType: VerificationTargetType, target: string, code: string): Promise<ConsumeVerificationCodeResult> {
  const row = latestVerificationCode(purpose, targetType, target);
  if (!row) return { error: "请先获取验证码", status: 400 };
  if (row.expires_at <= utcNow()) return { error: "验证码已过期，请重新获取", status: 400 };
  if (row.attempts >= VERIFICATION_CODE_MAX_ATTEMPTS) return { error: "验证码错误次数过多，请重新获取", status: 400 };
  const matched = await Bun.password.verify(code, row.code_hash);
  if (!matched) {
    run(appDb, "update auth_verification_codes set attempts = attempts + 1, updated_at = ? where id = ?", now(), row.id);
    return { error: "验证码不正确", status: 400 };
  }
  run(appDb, "update auth_verification_codes set consumed_at = ?, updated_at = ? where id = ?", now(), now(), row.id);
  return { ok: true };
}

async function consumeEmailVerificationCode(purpose: VerificationPurpose, email: string, code: string): Promise<ConsumeVerificationCodeResult> {
  return consumeVerificationCode(purpose, "email", email, code);
}

async function consumePhoneVerificationCode(purpose: VerificationPurpose, phone: string, code: string): Promise<ConsumeVerificationCodeResult> {
  return consumeVerificationCode(purpose, "phone", phone, code);
}

function usernameExists(username: string) {
  return Boolean(getOne<Pick<UserRow, "id">>(appDb, "select id from users where lower(username) = lower(?)", username));
}

const USERNAME_SUFFIX_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const PROFILE_USERNAME_SUGGESTION_COUNT = 6;

function usernameChineseSuffix(value: number) {
  return String(value)
    .split("")
    .map((digit) => USERNAME_SUFFIX_DIGITS[Number(digit)] ?? "")
    .join("");
}

async function uniqueGeneratedUsername(seed: string) {
  const aiUsername = await generateChineseUsername(seed);
  if (aiUsername && !usernameExists(aiUsername)) return aiUsername;
  for (let offset = 1; offset <= fallbackChineseUsernameCount(); offset += 1) {
    const username = fallbackChineseUsername(seed, offset);
    if (!usernameExists(username)) return username;
  }
  const base = fallbackChineseUsername(seed);
  for (let index = 2; index < 1000; index += 1) {
    const username = `${base}${usernameChineseSuffix(index)}`;
    if (!usernameExists(username)) return username;
  }
  return `${base}${usernameChineseSuffix(Number(Date.now().toString().slice(-4)))}`;
}

async function uniqueGeneratedUsernames(seed: string, count: number) {
  const targetCount = Math.max(1, Math.min(12, Math.floor(count)));
  const usernames: string[] = [];
  const seen = new Set<string>();
  const addUsername = (value: string) => {
    const username = value.trim();
    const key = username.toLowerCase();
    if (!username || seen.has(key) || usernameExists(username)) return false;
    seen.add(key);
    usernames.push(username);
    return true;
  };

  const generatedCandidates = await generateChineseUsernameCandidates(seed, targetCount);
  for (const username of generatedCandidates) {
    if (usernames.length >= targetCount) break;
    addUsername(username);
  }

  for (let offset = 0; offset < fallbackChineseUsernameCount() && usernames.length < targetCount; offset += 1) {
    addUsername(fallbackChineseUsername(seed, offset));
  }

  const base = fallbackChineseUsername(seed);
  for (let index = 2; index < 1000 && usernames.length < targetCount; index += 1) {
    addUsername(`${base}${usernameChineseSuffix(index)}`);
  }

  let serial = Number(Date.now().toString().slice(-4));
  while (usernames.length < targetCount) {
    addUsername(`${base}${usernameChineseSuffix(serial)}`);
    serial += 1;
  }

  return usernames;
}

async function uniqueUsernameFromEmail(email: string) {
  return uniqueGeneratedUsername(`email:${email}`);
}

async function uniqueUsernameFromPhone(phone: string) {
  return uniqueGeneratedUsername(`phone:${phone}`);
}

function createUserSession(c: Context, user: UserRow) {
  const sessionId = makeId("appsess");
  const loginAt = now();
  run(
    appDb,
    "insert into user_auth_sessions (id, user_id, expires_at, created_at) values (?, ?, ?, ?)",
    sessionId,
    user.id,
    futureDate(SESSION_MAX_AGE),
    loginAt
  );
  run(
    appDb,
    "update users set last_login_at = ?, updated_at = ? where id = ?",
    loginAt,
    loginAt,
    user.id
  );
  setCookie(c, APP_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_MAX_AGE
  });
}

function requireSelfRegistration(c: Context) {
  if (selfRegistrationEnabled()) return null;
  return c.json({ error: REGISTRATION_DISABLED_MESSAGE }, 403);
}

export function registerUserRoutes(api: Hono) {
api.get("/login-assets", async (c) => {
  const branding = await publicBranding();
  return c.json(branding.loginAssets);
});

api.get("/auth/registration-status", (c) => {
  return c.json({ enabled: registrationSettings().enabled });
});

api.post("/auth/register/code", async (c) => {
  const registrationBlocked = requireSelfRegistration(c);
  if (registrationBlocked) return registrationBlocked;
  const body = await c.req.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  if (!validEmail(email)) return c.json({ error: "请输入正确的邮箱地址" }, 400);
  if (findUserByEmailIdentity(email)) return c.json({ error: "邮箱已注册" }, 409);
  const result = await sendEmailVerificationCode("register", email);
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

api.post("/auth/register", async (c) => {
  const registrationBlocked = requireSelfRegistration(c);
  if (registrationBlocked) return registrationBlocked;
  const body = await c.req.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const code = String(body.code ?? "").trim();
  const password = String(body.password ?? "");
  if (!validEmail(email)) return c.json({ error: "请输入正确的邮箱地址" }, 400);
  if (!code) return c.json({ error: "请输入邮箱验证码" }, 400);
  if (password.length < 6) return c.json({ error: "密码至少 6 位" }, 400);
  if (findUserByEmailIdentity(email)) return c.json({ error: "邮箱已注册" }, 409);
  const verified = await consumeEmailVerificationCode("register", email, code);
  if ("error" in verified) return c.json({ error: verified.error }, verified.status);

  const timestamp = now();
  const userId = makeId("user");
  const username = await uniqueUsernameFromEmail(email);
  try {
    run(
      appDb,
      `insert into users (
        id, team_id, account, username, email, phone, password_hash,
        disabled, has_config_access, email_verified_at, phone_verified_at, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      userId,
      defaultTeamId(),
      email,
      username,
      email,
      "",
      await Bun.password.hash(password),
      0,
      0,
      timestamp,
      null,
      timestamp,
      timestamp
    );
  } catch {
    return c.json({ error: "邮箱已注册" }, 409);
  }
  const user = getOne<UserRow>(appDb, "select * from users where id = ?", userId);
  if (!user) return c.json({ error: "注册失败，请稍后重试" }, 500);
  createUserSession(c, user);
  audit("user.self_register", { userId, email });
  return c.json({ user: publicUser(user) });
});

api.post("/auth/register/sms-code", async (c) => {
  const registrationBlocked = requireSelfRegistration(c);
  if (registrationBlocked) return registrationBlocked;
  const body = await c.req.json().catch(() => ({}));
  const phone = normalizePhone(body.phone);
  if (!validMainlandPhone(phone)) return c.json({ error: "请输入中国大陆 11 位手机号" }, 400);
  if (findUserByPhoneIdentity(phone)) return c.json({ error: "手机号已注册" }, 409);
  const result = await sendPhoneVerificationCode("register", phone);
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

api.post("/auth/register/phone", async (c) => {
  const registrationBlocked = requireSelfRegistration(c);
  if (registrationBlocked) return registrationBlocked;
  const body = await c.req.json().catch(() => ({}));
  const phone = normalizePhone(body.phone);
  const code = String(body.code ?? "").trim();
  const password = String(body.password ?? "");
  if (!validMainlandPhone(phone)) return c.json({ error: "请输入中国大陆 11 位手机号" }, 400);
  if (!code) return c.json({ error: "请输入短信验证码" }, 400);
  if (password.length < 6) return c.json({ error: "密码至少 6 位" }, 400);
  if (findUserByPhoneIdentity(phone)) return c.json({ error: "手机号已注册" }, 409);
  const verified = await consumePhoneVerificationCode("register", phone, code);
  if ("error" in verified) return c.json({ error: verified.error }, verified.status);

  const timestamp = now();
  const userId = makeId("user");
  const username = await uniqueUsernameFromPhone(phone);
  try {
    run(
      appDb,
      `insert into users (
        id, team_id, account, username, email, phone, password_hash,
        disabled, has_config_access, email_verified_at, phone_verified_at, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      userId,
      defaultTeamId(),
      phone,
      username,
      "",
      phone,
      await Bun.password.hash(password),
      0,
      0,
      null,
      timestamp,
      timestamp,
      timestamp
    );
  } catch {
    return c.json({ error: "手机号已注册" }, 409);
  }
  const user = getOne<UserRow>(appDb, "select * from users where id = ?", userId);
  if (!user) return c.json({ error: "注册失败，请稍后重试" }, 500);
  createUserSession(c, user);
  audit("user.self_register", { userId, phone });
  return c.json({ user: publicUser(user) });
});

api.post("/auth/password-reset/code", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  if (!validEmail(email)) return c.json({ error: "请输入正确的邮箱地址" }, 400);
  if (!findUserByEmailIdentity(email)) return c.json({ error: "邮箱未注册" }, 404);
  const result = await sendEmailVerificationCode("password_reset", email);
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

api.post("/auth/password-reset", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = normalizeEmail(body.email);
  const code = String(body.code ?? "").trim();
  const password = String(body.password ?? "");
  if (!validEmail(email)) return c.json({ error: "请输入正确的邮箱地址" }, 400);
  if (!code) return c.json({ error: "请输入邮箱验证码" }, 400);
  if (password.length < 6) return c.json({ error: "密码至少 6 位" }, 400);
  const user = findUserByEmailIdentity(email);
  if (!user) return c.json({ error: "邮箱未注册" }, 404);
  const verified = await consumeEmailVerificationCode("password_reset", email, code);
  if ("error" in verified) return c.json({ error: verified.error }, verified.status);
  const timestamp = now();
  run(
    appDb,
    `update users
     set password_hash = ?,
         email = case when email is null or email = '' then ? else email end,
         email_verified_at = coalesce(email_verified_at, ?),
         updated_at = ?
     where id = ?`,
    await Bun.password.hash(password),
    email,
    timestamp,
    timestamp,
    user.id
  );
  run(appDb, "delete from user_auth_sessions where user_id = ?", user.id);
  audit("user.password_reset", { userId: user.id, email });
  return c.json({ ok: true });
});

api.post("/auth/password-reset/sms-code", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const phone = normalizePhone(body.phone);
  if (!validMainlandPhone(phone)) return c.json({ error: "请输入中国大陆 11 位手机号" }, 400);
  if (!findUserByPhoneIdentity(phone)) return c.json({ error: "手机号未注册" }, 404);
  const result = await sendPhoneVerificationCode("password_reset", phone);
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

api.post("/auth/password-reset/phone", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const phone = normalizePhone(body.phone);
  const code = String(body.code ?? "").trim();
  const password = String(body.password ?? "");
  if (!validMainlandPhone(phone)) return c.json({ error: "请输入中国大陆 11 位手机号" }, 400);
  if (!code) return c.json({ error: "请输入短信验证码" }, 400);
  if (password.length < 6) return c.json({ error: "密码至少 6 位" }, 400);
  const user = findUserByPhoneIdentity(phone);
  if (!user) return c.json({ error: "手机号未注册" }, 404);
  const verified = await consumePhoneVerificationCode("password_reset", phone, code);
  if ("error" in verified) return c.json({ error: verified.error }, verified.status);
  const timestamp = now();
  run(
    appDb,
    `update users
     set password_hash = ?,
         phone = case when phone is null or phone = '' then ? else phone end,
         phone_verified_at = coalesce(phone_verified_at, ?),
         updated_at = ?
     where id = ?`,
    await Bun.password.hash(password),
    phone,
    timestamp,
    timestamp,
    user.id
  );
  run(appDb, "delete from user_auth_sessions where user_id = ?", user.id);
  audit("user.password_reset", { userId: user.id, phone });
  return c.json({ ok: true });
});

api.post("/auth/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const account = String(body.account ?? body.username ?? "").trim();
  const password = String(body.password ?? "");
  if (!account || !password) return c.json({ error: "请输入账号和密码" }, 400);

  const user = findUserByLogin(account);
  if (!user) return c.json({ error: "账号不存在" }, 401);
  if (user.disabled) return c.json({ error: "账号已被禁用" }, 403);
  const ok = await Bun.password.verify(password, user.password_hash);
  if (!ok) return c.json({ error: "密码不正确" }, 401);

  createUserSession(c, user);
  return c.json({ user: publicUser(user) });
});

api.post("/auth/logout", (c) => {
  const sessionId = getCookie(c, APP_COOKIE);
  if (sessionId) run(appDb, "delete from user_auth_sessions where id = ?", sessionId);
  deleteCookie(c, APP_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

api.delete("/auth/account", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const expected = deleteAccountConfirmationText(user);
  const confirmationText = String(body.confirmationText ?? "").trim();
  if (confirmationText !== expected) return c.json({ error: `请输入“${expected}”后再删除账户` }, 400);
  const deleted = await deleteUserAccount(user.id);
  if (!deleted) return c.json({ error: "账号不存在" }, 404);
  deleteCookie(c, APP_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

api.get("/auth/me", async (c) => {
  const user = await currentUser(c);
  return c.json({
    user: user ? publicUser(user) : null
  });
});

api.post("/auth/change-password", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");
  if (!currentPassword || !newPassword) return c.json({ error: "请填写当前密码和新密码" }, 400);
  const ok = await Bun.password.verify(currentPassword, user.password_hash);
  if (!ok) return c.json({ error: "当前密码不正确" }, 401);
  run(
    appDb,
    "update users set password_hash = ?, updated_at = ? where id = ?",
    await Bun.password.hash(newPassword),
    now(),
    user.id
  );
  const sessionId = getCookie(c, APP_COOKIE);
  if (sessionId) run(appDb, "delete from user_auth_sessions where id = ?", sessionId);
  deleteCookie(c, APP_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

api.post("/auth/username-suggestion", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const usernames = await uniqueGeneratedUsernames(`profile:${user.id}:${Date.now()}:${Math.random()}`, PROFILE_USERNAME_SUGGESTION_COUNT);
  return c.json({ username: usernames[0], usernames });
});

api.post("/auth/change-username", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const validated = validateUsername(body.username);
  if (!validated.ok) return c.json({ error: validated.error }, 400);
  const username = validated.username;
  const existing = getOne<Pick<UserRow, "id">>(appDb, "select id from users where lower(username) = lower(?) and id <> ?", username, user.id);
  if (existing) return c.json({ error: "用户名已存在" }, 409);
  run(appDb, "update users set username = ?, updated_at = ? where id = ?", username, now(), user.id);
  const updated = getOne<UserRow>(appDb, "select * from users where id = ?", user.id);
  return c.json({ user: publicUser(updated ?? { ...user, username }) });
});

api.post("/auth/appearance-mode", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const appearanceMode = normalizeAppearanceMode(body.appearanceMode);
  run(appDb, "update users set appearance_mode = ?, updated_at = ? where id = ?", appearanceMode, now(), user.id);
  const updated = getOne<UserRow>(appDb, "select * from users where id = ?", user.id);
  return c.json({ user: updated ? publicUser(updated) : publicUser({ ...user, appearance_mode: appearanceMode }) });
});

api.post("/auth/preferences", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const body = await c.req.json().catch(() => ({}));
  saveUserPreferences(user.id, body as Record<string, unknown>);
  return c.json({ user: publicUser(user) });
});

api.post("/auth/avatar", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ error: "请选择头像图片" }, 400);
  const mimeType = String(file.type || "").toLowerCase();
  if (!["image/png", "image/jpeg", "image/webp", "image/avif"].includes(mimeType)) {
    return c.json({ error: "头像仅支持 PNG、JPG、WebP 或 AVIF 图片" }, 400);
  }
  if (file.size > 5 * 1024 * 1024) return c.json({ error: "头像图片不能超过 5MB" }, 400);

  const previousPath = user.avatar_path || "";
  const avatarPath = secureUserAvatarPath(user.id);
  await writeEncryptedFile(avatarPath, Buffer.from(await file.arrayBuffer()));
  run(appDb, "update users set avatar_path = ?, avatar_mime_type = ?, updated_at = ? where id = ?", avatarPath, mimeType, now(), user.id);
  if (previousPath && previousPath !== avatarPath) void deleteStoredFilesIfUnreferenced([previousPath]);
  const updated = getOne<UserRow>(appDb, "select * from users where id = ?", user.id);
  return c.json({ user: updated ? publicUser(updated) : publicUser({ ...user, avatar_path: avatarPath, avatar_mime_type: mimeType }) });
});

api.post("/auth/config-access", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  if (!user.has_config_access) return c.json({ error: "当前账号没有管理权限" }, 403);
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
  audit("config.user_access", { userId: user.id, account: user.account, username: user.username });
  return c.json({ ok: true });
});

api.get("/providers", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const settings = imageGenerationSettings();
  const rows = enabledProvidersForCurrentMode();
  const providers = rows.map((row) => toProvider(row, false));
  const autoProvider =
    settings.mode === "auto" && providers.length > 0
      ? {
          ...providers[0],
          id: AUTO_PROVIDER_ID,
          name: "自动选择",
          virtual: true
        }
      : null;
  return c.json({ providers: autoProvider ? [autoProvider, ...providers] : providers, imageMode: settings });
});

api.get("/sessions", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const archived = String(c.req.query("archived") ?? "").trim() === "1";
  const keyword = String(c.req.query("keyword") ?? "").trim().toLowerCase();
  const pagination = paginationFromQuery(c);
  const archiveClause = archived ? "archived_at is not null" : "archived_at is null";
  const keywordClause = keyword ? " and lower(title) like ?" : "";
  const whereSql = `user_id = ? and ${archiveClause} and deleted_at is null${keywordClause}`;
  const baseParams = keyword ? [user.id, `%${keyword}%`] : [user.id];
  const total = getOne<{ total: number }>(appDb, `select count(*) as total from sessions where ${whereSql}`, ...baseParams)?.total ?? 0;
  const limitSql = pagination.enabled ? " limit ? offset ?" : "";
  const limitParams = pagination.enabled ? [pagination.limit, pagination.offset] : [];
  const sessions = getAll<{
    id: string;
    title: string;
    title_status: string | null;
    pinned_at: string | null;
    archived_at: string | null;
    running_job_count: number;
    created_at: string;
    updated_at: string;
  }>(
    appDb,
    archived
      ? `select id, title, title_status, pinned_at, archived_at, created_at, updated_at,
          (select count(*) from image_jobs where image_jobs.session_id = sessions.id and image_jobs.user_id = ? and image_jobs.status = 'running') as running_job_count
         from sessions
         where ${whereSql}
         order by archived_at desc, updated_at desc, rowid desc${limitSql}`
      : `select id, title, title_status, pinned_at, archived_at, created_at, updated_at,
          (select count(*) from image_jobs where image_jobs.session_id = sessions.id and image_jobs.user_id = ? and image_jobs.status = 'running') as running_job_count
         from sessions
         where ${whereSql}
          order by pinned_at asc nulls last, updated_at desc, rowid desc${limitSql}`,
    user.id,
    ...baseParams,
    ...limitParams
  );
  return c.json({
    sessions: sessions.map(serializeSession),
    pageInfo: pageInfo(total, pagination)
  });
});

api.post("/sessions", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const prompt = String(body.prompt ?? "").trim();
  const fallbackTitle = String(body.title ?? "新的图像对话").trim() || "新的图像对话";
  const title = prompt ? immediateChatTitleFromPrompt(prompt, fallbackTitle) : fallbackTitle;
  const titleStatus = prompt ? "pending" : "ready";
  const id = makeId("chat");
  const timestamp = now();
  run(
    appDb,
    "insert into sessions (id, user_id, title, title_status, created_at, updated_at) values (?, ?, ?, ?, ?, ?)",
    id,
    user.id,
    title,
    titleStatus,
    timestamp,
    timestamp
  );
  refreshChatTitleInBackground(user.id, id, prompt, title);
  return c.json({ session: { id, title, titleStatus, pinnedAt: null, archivedAt: null, runningImageJobCount: 0, createdAt: timestamp, updatedAt: timestamp } });
});

api.post("/sessions/archive-all", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const archived = archiveAllSessions(user.id);
  return c.json({ ok: true, archived });
});

api.post("/sessions/unarchive-all", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const restored = unarchiveAllSessions(user.id);
  return c.json({ ok: true, restored });
});

api.delete("/sessions", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const deleted = await deleteAllSessionRecords(user.id);
  return c.json({ ok: true, deleted });
});

api.patch("/sessions/:id/archive", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const session = archiveSession(user.id, c.req.param("id"), Boolean(body.archived));
  if (!session) return c.json({ error: "对话不存在" }, 404);
  return c.json({ session: serializeSession(session) });
});

api.patch("/sessions/:id/pin", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const session = pinSession(user.id, c.req.param("id"), Boolean(body.pinned));
  if (!session) return c.json({ error: "对话不存在" }, 404);
  return c.json({ session: serializeSession(session) });
});

api.patch("/sessions/:id/title", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const title = String((body as Record<string, unknown>).title ?? "").trim();
  if (!title) return c.json({ error: "标题不能为空" }, 400);
  const session = renameSession(user.id, c.req.param("id"), title);
  if (!session) return c.json({ error: "对话不存在" }, 404);
  return c.json({ session: serializeSession(session) });
});

api.delete("/sessions/:id", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const deleted = await deleteSessionRecords(user.id, c.req.param("id"));
  if (!deleted) return c.json({ error: "对话不存在" }, 404);
  return c.json({ ok: true });
});

api.get("/sessions/:id/messages", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const sessionId = c.req.param("id");
  if (!ownedSession(user.id, sessionId)) return c.json({ error: "对话不存在" }, 404);
  const rows = getAll<{
    id: string;
    user_id: string;
    role: string;
    content: string;
    image_id: string | null;
    metadata: string | null;
    created_at: string;
    image_path: string | null;
    image_prompt: string | null;
    image_kind: string | null;
    image_size: string | null;
    image_width: number | null;
    image_height: number | null;
    image_file_size: number | null;
    image_quality: string | null;
    image_provider_id: string | null;
    parent_image_id: string | null;
    image_suggested_case_title: string | null;
    image_suggested_case_category_ids_json: string | null;
    image_suggested_asset_category_ids_json: string | null;
  }>(
    appDb,
    `select m.id, m.user_id, m.role, m.content, m.image_id, m.metadata, m.created_at,
      i.path as image_path, i.prompt as image_prompt, i.kind as image_kind,
      i.size as image_size, i.image_width as image_width, i.image_height as image_height,
      i.image_file_size as image_file_size,
      i.quality as image_quality, i.provider_id as image_provider_id,
      i.parent_image_id as parent_image_id,
      i.suggested_case_title as image_suggested_case_title,
      i.suggested_case_category_ids_json as image_suggested_case_category_ids_json,
      i.suggested_asset_category_ids_json as image_suggested_asset_category_ids_json
     from messages m
     left join images i on i.id = m.image_id
     where m.session_id = ? and m.user_id = ?
     order by m.created_at asc, m.rowid asc`,
    sessionId,
    user.id
  );
  const referenceMap = imageReferencesByImageIds(rows.map((row) => row.image_id ?? ""));
  const originPromptMap = imageOriginPromptsByImageIds(rows.map((row) => row.image_id ?? ""));
  return c.json({
    messages: rows.map((row) => ({
      ...serializeMessage({
        ...row,
        image_origin_prompt: row.image_id ? originPromptMap.get(row.image_id) ?? row.image_prompt : null
      }),
      referenceImages: row.image_id ? referenceMap.get(row.image_id) ?? [] : []
    }))
  });
});

api.get("/sessions/:id/image-jobs", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  const sessionId = c.req.param("id");
  if (!ownedSession(user.id, sessionId)) return c.json({ error: "对话不存在" }, 404);
  expireStaleImageJobs(user.id, sessionId);
  const status = String(c.req.query("status") ?? "running").trim();
  const rows = getAll<{
    id: string;
    type: string;
    status: string;
    prompt: string;
    provider_id: string;
    error: string | null;
    result_image_id: string | null;
    created_at: string;
    updated_at: string;
  }>(
    appDb,
    `select id, type, status, prompt, provider_id, error, result_image_id, created_at, updated_at
     from image_jobs
     where session_id = ? and user_id = ? ${status === "all" ? "" : "and status = ?"}
     order by created_at asc`,
    ...(status === "all" ? [sessionId, user.id] : [sessionId, user.id, status])
  );
  const messageRows = getAll<{ metadata: string | null }>(
    appDb,
    "select metadata from messages where session_id = ? and user_id = ? and role = 'user' and metadata is not null",
    sessionId,
    user.id
  );
  const branchMetadataByJobId = new Map<
    string,
    {
      branchId?: string;
      parentBranchId?: string;
      branchForkMessageId?: string;
      branchRootMessageId?: string;
    }
  >();
  for (const messageRow of messageRows) {
    const metadata = safeJson<Record<string, unknown>>(messageRow.metadata, {});
    const jobId = String(metadata.jobId ?? "").trim();
    if (!jobId) continue;
    const branchId = String(metadata.branchId ?? "").trim();
    if (!branchId) continue;
    const parentBranchId = String(metadata.parentBranchId ?? "").trim();
    const branchForkMessageId = String(metadata.branchForkMessageId ?? "").trim();
    const branchRootMessageId = String(metadata.branchRootMessageId ?? "").trim();
    branchMetadataByJobId.set(jobId, {
      branchId,
      ...(parentBranchId ? { parentBranchId } : {}),
      ...(branchForkMessageId ? { branchForkMessageId } : {}),
      ...(branchRootMessageId ? { branchRootMessageId } : {})
    });
  }
  return c.json({ jobs: rows.map((row) => serializeJob({ ...row, ...(branchMetadataByJobId.get(row.id) ?? {}) })) });
});

api.get("/image-jobs/events", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "未登录" }, 401);
  return streamImageJobEvents(user.id);
});
}
