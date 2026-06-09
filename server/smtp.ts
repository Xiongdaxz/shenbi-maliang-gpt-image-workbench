import { existsSync } from "node:fs";
import nodemailer from "nodemailer";
import type Mail from "nodemailer/lib/mailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { configDb, getOne, run } from "./db";
import { globalSwitchEnabled, saveGlobalSwitch } from "./globalSwitches";
import { DIST_LOGIN_DIR, PUBLIC_LOGIN_DIR } from "./paths";
import { proxySettings } from "./settingsStore";
import type { SmtpSettings } from "./types";
import { maskSecret, now } from "./utils";

type SmtpSettingsRow = {
  enabled: number;
  use_proxy: number;
  host: string;
  port: number;
  secure: number;
  username: string;
  password_secret: string;
  from_name: string;
  from_email: string;
  test_recipient_email: string;
  updated_at: string;
};

const MAIL_BACKGROUND_CID = "verification-mail-background";
const MAIL_BACKGROUND_FILE = "mail_background.png";
const MAIL_LOGO_CID = "verification-mail-logo";
const MAIL_LOGO_FILE = "mail_logo.png";

function normalizeSmtpPort(value: unknown) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 465;
}

export function smtpSettings(includeSecret = false): SmtpSettings {
  const row = getOne<SmtpSettingsRow>(
    configDb,
    "select * from smtp_settings where id = ? limit 1",
    "default"
  );
  if (!row) {
    return {
      enabled: globalSwitchEnabled("smtp_service"),
      useProxy: false,
      host: "",
      port: 465,
      secure: true,
      username: "",
      passwordSecret: "",
      fromName: "神笔马良",
      fromEmail: "",
      testRecipientEmail: "",
      updatedAt: ""
    };
  }
  return {
    enabled: globalSwitchEnabled("smtp_service"),
    useProxy: Boolean(row.use_proxy),
    host: row.host,
    port: row.port,
    secure: Boolean(row.secure),
    username: row.username,
    passwordSecret: includeSecret ? row.password_secret : maskSecret(row.password_secret),
    fromName: row.from_name,
    fromEmail: row.from_email,
    testRecipientEmail: row.test_recipient_email,
    updatedAt: row.updated_at
  };
}

export function saveSmtpSettings(raw: Record<string, unknown>) {
  const existing = smtpSettings(true);
  const enabled = Boolean(raw.enabled);
  const useProxy = Boolean(raw.useProxy);
  const host = String(raw.host ?? "").trim();
  const port = normalizeSmtpPort(raw.port);
  const secure = Boolean(raw.secure);
  const username = String(raw.username ?? "").trim();
  const passwordSecret = String(raw.passwordSecret ?? "");
  const fromName = String(raw.fromName ?? "神笔马良").trim() || "神笔马良";
  const fromEmail = String(raw.fromEmail ?? "").trim().toLowerCase();
  const testRecipientEmail = String(raw.testRecipientEmail ?? "").trim().toLowerCase();
  if (enabled && !host) throw new Error("启用 SMTP 必须填写服务器地址");
  if (enabled && !fromEmail) throw new Error("启用 SMTP 必须填写发件邮箱");
  if (enabled && username && !passwordSecret.trim() && !existing.passwordSecret) {
    throw new Error("启用 SMTP 账号登录必须填写邮箱密码或授权码");
  }
  const savedPassword = passwordSecret.includes("****") ? existing.passwordSecret : passwordSecret;
  const timestamp = now();
  run(
    configDb,
    `insert into smtp_settings (
      id, enabled, use_proxy, host, port, secure, username, password_secret, from_name, from_email, test_recipient_email, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      enabled = excluded.enabled,
      use_proxy = excluded.use_proxy,
      host = excluded.host,
      port = excluded.port,
      secure = excluded.secure,
      username = excluded.username,
      password_secret = excluded.password_secret,
      from_name = excluded.from_name,
      from_email = excluded.from_email,
      test_recipient_email = excluded.test_recipient_email,
      updated_at = excluded.updated_at`,
    "default",
    enabled ? 1 : 0,
    useProxy ? 1 : 0,
    host,
    port,
    secure ? 1 : 0,
    username,
    savedPassword,
    fromName,
    fromEmail,
    testRecipientEmail,
    timestamp
  );
  saveGlobalSwitch("smtp_service", enabled);
  return smtpSettings(false);
}

function mailLoginAssetPath(file: string) {
  const candidates = [
    `${DIST_LOGIN_DIR}/${file}`,
    `${PUBLIC_LOGIN_DIR}/${file}`
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? "";
}

function mailBackgroundPath() {
  return mailLoginAssetPath(MAIL_BACKGROUND_FILE);
}

function mailLogoPath() {
  return mailLoginAssetPath(MAIL_LOGO_FILE);
}

function smtpTransportOptions(settings: SmtpSettings): SMTPTransport.Options & { proxy?: string } {
  const options: SMTPTransport.Options & { proxy?: string } = {
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth: settings.username
      ? {
          user: settings.username,
          pass: settings.passwordSecret
        }
      : undefined
  };
  if (settings.useProxy) {
    const proxy = proxySettings();
    if (!proxy.enabled || !proxy.url.trim()) {
      throw new Error("邮件代理已开启，请先在代理配置中启用并填写代理地址");
    }
    options.proxy = proxy.url.trim();
  }
  return options;
}

function senderAddress(settings: SmtpSettings) {
  const fromEmail = settings.fromEmail.trim();
  if (!settings.fromName.trim()) return fromEmail;
  return `"${settings.fromName.replaceAll('"', '\\"')}" <${fromEmail}>`;
}

function verificationSubject(purpose: "register" | "password_reset") {
  return purpose === "register" ? "注册验证码" : "找回密码验证码";
}

function verificationMailSubject(settings: SmtpSettings, purpose: "register" | "password_reset", test = false) {
  const prefix = settings.fromName.trim() || "神笔马良";
  return `${prefix}${verificationSubject(purpose)}${test ? "测试" : ""}`;
}

function verificationText(code: string, purpose: "register" | "password_reset") {
  const action = purpose === "register" ? "注册账号" : "重置密码";
  return `您好，您的${action}验证码是：${code}。验证码 10 分钟内有效，请勿转发给他人。如非本人操作，可以忽略这封邮件。`;
}

function assertReady(settings: SmtpSettings) {
  if (!settings.enabled) throw new Error("SMTP 邮件服务未启用，请先在配置中心完成 SMTP 设置");
  if (!settings.host.trim()) throw new Error("SMTP 服务器地址未配置");
  if (!settings.fromEmail.trim()) throw new Error("SMTP 发件邮箱未配置");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function verificationHtml(
  settings: SmtpSettings,
  code: string,
  purpose: "register" | "password_reset",
  hasBackground: boolean,
  hasLogo: boolean
) {
  const brand = settings.fromName.trim() || "神笔马良";
  const safeBrand = escapeHtml(brand);
  const safeCode = escapeHtml(code);
  const title = purpose === "register" ? `欢迎使用 ${brand}` : `${brand} 密码重置`;
  const intro =
    purpose === "register"
      ? `我们很高兴见到你。请在注册页面输入下面的验证码，完成邮箱验证并开启你的 ${brand} 账号。`
      : "我们收到了一次密码重置请求。请在页面中输入下面的验证码，完成身份验证后设置新密码。";
  const backgroundImageLayer = hasBackground
    ? `<div style="position:absolute; left:0; top:0; right:0; bottom:0; z-index:0; line-height:0; font-size:0;">
              <img class="mail-bg-image" src="cid:${MAIL_BACKGROUND_CID}" width="1600" height="900" alt="" style="display:block; width:100%; height:100%; min-height:720px; object-fit:cover; border:0; outline:none; text-decoration:none;">
            </div>`
    : "";
  const logoMarkup = hasLogo
    ? `<img src="cid:${MAIL_LOGO_CID}" width="52" height="52" alt="${safeBrand}" style="display:block; width:52px; height:52px; border:0; outline:none; text-decoration:none;">`
    : `<div style="width:52px; height:52px; border-radius:15px; background:#fff8ed; color:#9c7b3a; font-size:24px; line-height:52px; text-align:center; font-weight:900;">${safeBrand.slice(0, 1)}</div>`;

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(verificationMailSubject(settings, purpose))}</title>
    <style>
      @media only screen and (max-width: 600px) {
        .mail-bg-cell {
          height: auto !important;
          min-height: 0 !important;
          padding: 18px 12px 34px !important;
        }
        .mail-bg-image {
          min-height: 100% !important;
        }
        .mail-card {
          max-width: 100% !important;
          border-radius: 18px !important;
        }
        .mail-card-body {
          padding: 26px 20px 24px !important;
        }
        .mail-code {
          font-size: 34px !important;
        }
      }
    </style>
  </head>
  <body style="margin:0; padding:0; background:#f5f0e6; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', Arial, sans-serif; color:#172033;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%; margin:0; padding:0; background:#f5f0e6;">
      <tr>
        <td class="mail-bg-cell" align="center" height="720" style="height:720px; min-height:720px; padding:56px 16px; position:relative; overflow:hidden; background:#f5efe4;">
          ${backgroundImageLayer}
          <div style="position:relative; z-index:1;">
            <table class="mail-card" role="presentation" width="580" cellspacing="0" cellpadding="0" style="width:100%; max-width:580px; margin:0 auto; border-radius:24px; background:#ffffff; box-shadow:0 26px 68px rgba(23,32,51,0.22);">
            <tr>
              <td class="mail-card-body" style="padding:42px 40px 38px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 22px;">
                  <tr>
                    <td width="66" valign="middle" style="width:66px; padding:0 14px 0 0;">${logoMarkup}</td>
                    <td valign="middle" style="padding:0;">
                      <div style="font-size:15px; line-height:1.4; color:#9c7b3a; font-weight:700; letter-spacing:0;">${safeBrand}</div>
                      <div style="margin-top:3px; font-size:13px; line-height:1.4; color:#8b949e;">邮箱安全验证</div>
                    </td>
                  </tr>
                </table>
                <h1 style="margin:0; font-size:27px; line-height:1.35; color:#172033; font-weight:800; letter-spacing:0;">${escapeHtml(title)}</h1>
                <p style="margin:16px 0 0; font-size:16px; line-height:1.85; color:#4b5563;">${escapeHtml(intro)}</p>
                <div style="margin:30px 0 22px; padding:24px 22px; border-radius:18px; background:#fff8ed; border:1px solid rgba(156,123,58,0.18); text-align:center;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                    <tr>
                      <td align="left" style="font-size:12px; line-height:1; color:#9c7b3a; font-weight:700;">验证码</td>
                      <td align="right" style="font-size:12px; line-height:1; color:#9c7b3a; font-weight:700;">点击选中后复制</td>
                    </tr>
                  </table>
                  <div id="verification-code" class="mail-code" style="margin-top:12px; font-size:42px; line-height:1.1; color:#172033; font-weight:900; letter-spacing:0; word-spacing:0; font-family:Consolas, 'SFMono-Regular', Menlo, Monaco, 'Courier New', monospace; user-select:all; -webkit-user-select:all;">${safeCode}</div>
                </div>
                <p style="margin:0; font-size:14px; line-height:1.7; color:#6b7280;">验证码 10 分钟内有效。为了账号安全，请不要将验证码转发给他人。</p>
                <p style="margin:12px 0 0; font-size:13px; line-height:1.7; color:#8b949e;">如果这不是你本人操作，可以放心忽略这封邮件。</p>
              </td>
            </tr>
            </table>
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendVerificationMail(settings: SmtpSettings, email: string, code: string, purpose: "register" | "password_reset", test = false) {
  const transporter = nodemailer.createTransport(smtpTransportOptions(settings));
  const backgroundPath = mailBackgroundPath();
  const logoPath = mailLogoPath();
  const text = verificationText(code, purpose);
  const attachments: Mail.Attachment[] = [];
  if (backgroundPath) {
    attachments.push({
      filename: MAIL_BACKGROUND_FILE,
      path: backgroundPath,
      cid: MAIL_BACKGROUND_CID,
      contentType: "image/png",
      contentDisposition: "inline"
    });
  }
  if (logoPath) {
    attachments.push({
      filename: MAIL_LOGO_FILE,
      path: logoPath,
      cid: MAIL_LOGO_CID,
      contentType: "image/png",
      contentDisposition: "inline"
    });
  }
  await transporter.sendMail({
    from: senderAddress(settings),
    to: email,
    subject: verificationMailSubject(settings, purpose, test),
    text,
    html: verificationHtml(settings, code, purpose, Boolean(backgroundPath), Boolean(logoPath)),
    attachments: attachments.length > 0 ? attachments : undefined
  });
}

export async function sendVerificationEmail(email: string, code: string, purpose: "register" | "password_reset") {
  const settings = smtpSettings(true);
  assertReady(settings);
  await sendVerificationMail(settings, email, code, purpose);
}

export async function sendSmtpTestEmail(email: string) {
  const settings = smtpSettings(true);
  assertReady(settings);
  await sendVerificationMail(settings, email, "123456", "register", true);
}
