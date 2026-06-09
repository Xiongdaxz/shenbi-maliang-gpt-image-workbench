import { createHash, createHmac } from "node:crypto";
import { configDb, getOne, run } from "./db";
import { globalSwitchEnabled, saveGlobalSwitch } from "./globalSwitches";
import type { SmsSettings } from "./types";
import { maskSecret, now } from "./utils";

type SmsSettingsRow = {
  enabled: number;
  provider: string;
  secret_id: string;
  secret_key_secret: string;
  region: string;
  sms_sdk_app_id: string;
  sign_name: string;
  register_template_id: string;
  password_reset_template_id: string;
  template_param_order: string;
  test_phone: string;
  updated_at: string;
};

type VerificationPurpose = "register" | "password_reset";

type TencentSmsStatus = {
  Code?: string;
  Message?: string;
  PhoneNumber?: string;
};

type TencentSmsResponse = {
  Response?: {
    Error?: {
      Code?: string;
      Message?: string;
    };
    SendStatusSet?: TencentSmsStatus[];
    RequestId?: string;
  };
};

const TENCENT_SMS_HOST = "sms.tencentcloudapi.com";
const TENCENT_SMS_ENDPOINT = `https://${TENCENT_SMS_HOST}`;
const TENCENT_SMS_SERVICE = "sms";
const TENCENT_SMS_ACTION = "SendSms";
const TENCENT_SMS_VERSION = "2021-01-11";
const DEFAULT_REGION = "ap-guangzhou";
const DEFAULT_TEMPLATE_PARAM_ORDER = "code";

function normalizeProvider(value: unknown): "tencent" {
  return String(value ?? "tencent").trim() === "tencent" ? "tencent" : "tencent";
}

export function normalizePhone(value: unknown) {
  let phone = String(value ?? "").replace(/[\s-]/g, "").trim();
  if (phone.startsWith("+86")) phone = phone.slice(3);
  if (phone.startsWith("0086")) phone = phone.slice(4);
  if (phone.startsWith("86") && phone.length === 13) phone = phone.slice(2);
  return phone;
}

export function validMainlandPhone(value: string) {
  return /^1[3-9]\d{9}$/.test(value);
}

function e164MainlandPhone(phone: string) {
  return `+86${phone}`;
}

function normalizeTemplateParamOrder(value: unknown) {
  const order = String(value ?? DEFAULT_TEMPLATE_PARAM_ORDER)
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return (order.length > 0 ? order : [DEFAULT_TEMPLATE_PARAM_ORDER]).join(",");
}

export function smsSettings(includeSecret = false): SmsSettings {
  const row = getOne<SmsSettingsRow>(
    configDb,
    "select * from sms_settings where id = ? limit 1",
    "default"
  );
  if (!row) {
    return {
      enabled: globalSwitchEnabled("sms_service"),
      provider: "tencent",
      secretId: "",
      secretKeySecret: "",
      region: DEFAULT_REGION,
      smsSdkAppId: "",
      signName: "",
      registerTemplateId: "",
      passwordResetTemplateId: "",
      templateParamOrder: DEFAULT_TEMPLATE_PARAM_ORDER,
      testPhone: "",
      updatedAt: ""
    };
  }
  return {
    enabled: globalSwitchEnabled("sms_service"),
    provider: normalizeProvider(row.provider),
    secretId: row.secret_id,
    secretKeySecret: includeSecret ? row.secret_key_secret : maskSecret(row.secret_key_secret),
    region: row.region || DEFAULT_REGION,
    smsSdkAppId: row.sms_sdk_app_id,
    signName: row.sign_name,
    registerTemplateId: row.register_template_id,
    passwordResetTemplateId: row.password_reset_template_id,
    templateParamOrder: normalizeTemplateParamOrder(row.template_param_order),
    testPhone: row.test_phone,
    updatedAt: row.updated_at
  };
}

export function saveSmsSettings(raw: Record<string, unknown>) {
  const existing = smsSettings(true);
  const enabled = Boolean(raw.enabled);
  const provider = normalizeProvider(raw.provider);
  const secretId = String(raw.secretId ?? "").trim();
  const secretKeySecret = String(raw.secretKeySecret ?? "");
  const region = String(raw.region ?? DEFAULT_REGION).trim() || DEFAULT_REGION;
  const smsSdkAppId = String(raw.smsSdkAppId ?? "").trim();
  const signName = String(raw.signName ?? "").trim();
  const registerTemplateId = String(raw.registerTemplateId ?? "").trim();
  const passwordResetTemplateId = String(raw.passwordResetTemplateId ?? "").trim();
  const templateParamOrder = normalizeTemplateParamOrder(raw.templateParamOrder);
  const testPhone = normalizePhone(raw.testPhone);
  if (enabled && !secretId) throw new Error("启用短信服务必须填写 SecretId");
  if (enabled && !secretKeySecret.trim() && !existing.secretKeySecret) throw new Error("启用短信服务必须填写 SecretKey");
  if (enabled && !smsSdkAppId) throw new Error("启用短信服务必须填写短信应用 ID");
  if (enabled && !signName) throw new Error("启用短信服务必须填写短信签名");
  if (enabled && !registerTemplateId) throw new Error("启用短信服务必须填写注册验证码模板 ID");
  if (testPhone && !validMainlandPhone(testPhone)) throw new Error("测试手机号请输入中国大陆 11 位手机号");
  const savedSecretKey = secretKeySecret.includes("****") ? existing.secretKeySecret : secretKeySecret;
  const timestamp = now();
  run(
    configDb,
    `insert into sms_settings (
      id, enabled, provider, secret_id, secret_key_secret, region, sms_sdk_app_id, sign_name,
      register_template_id, password_reset_template_id, template_param_order, test_phone, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(id) do update set
      enabled = excluded.enabled,
      provider = excluded.provider,
      secret_id = excluded.secret_id,
      secret_key_secret = excluded.secret_key_secret,
      region = excluded.region,
      sms_sdk_app_id = excluded.sms_sdk_app_id,
      sign_name = excluded.sign_name,
      register_template_id = excluded.register_template_id,
      password_reset_template_id = excluded.password_reset_template_id,
      template_param_order = excluded.template_param_order,
      test_phone = excluded.test_phone,
      updated_at = excluded.updated_at`,
    "default",
    enabled ? 1 : 0,
    provider,
    secretId,
    savedSecretKey,
    region,
    smsSdkAppId,
    signName,
    registerTemplateId,
    passwordResetTemplateId,
    templateParamOrder,
    testPhone,
    timestamp
  );
  saveGlobalSwitch("sms_service", enabled);
  return smsSettings(false);
}

function smsTemplateId(settings: SmsSettings, purpose: VerificationPurpose) {
  return purpose === "register" ? settings.registerTemplateId : settings.passwordResetTemplateId || settings.registerTemplateId;
}

function templateParams(settings: SmsSettings, code: string) {
  return settings.templateParamOrder
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => {
      if (item === "minutes" || item === "minute" || item === "ttl") return "10";
      return code;
    });
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmacSha256(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function tencentAuthorization(settings: SmsSettings, timestamp: number, payload: string) {
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const contentType = "application/json; charset=utf-8";
  const canonicalHeaders = `content-type:${contentType}\nhost:${TENCENT_SMS_HOST}\nx-tc-action:${TENCENT_SMS_ACTION.toLowerCase()}\n`;
  const signedHeaders = "content-type;host;x-tc-action";
  const canonicalRequest = [
    "POST",
    "/",
    "",
    canonicalHeaders,
    signedHeaders,
    sha256Hex(payload)
  ].join("\n");
  const credentialScope = `${date}/${TENCENT_SMS_SERVICE}/tc3_request`;
  const stringToSign = [
    "TC3-HMAC-SHA256",
    String(timestamp),
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const secretDate = hmacSha256(`TC3${settings.secretKeySecret}`, date);
  const secretService = hmacSha256(secretDate, TENCENT_SMS_SERVICE);
  const secretSigning = hmacSha256(secretService, "tc3_request");
  const signature = createHmac("sha256", secretSigning).update(stringToSign).digest("hex");
  return `TC3-HMAC-SHA256 Credential=${settings.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

function assertReady(settings: SmsSettings, purpose: VerificationPurpose) {
  if (!settings.enabled) throw new Error("短信服务未启用，请先在配置中心完成短信设置");
  if (!settings.secretId.trim()) throw new Error("短信 SecretId 未配置");
  if (!settings.secretKeySecret.trim()) throw new Error("短信 SecretKey 未配置");
  if (!settings.smsSdkAppId.trim()) throw new Error("短信应用 ID 未配置");
  if (!settings.signName.trim()) throw new Error("短信签名未配置");
  if (!smsTemplateId(settings, purpose).trim()) throw new Error("短信验证码模板 ID 未配置");
}

async function sendTencentSms(settings: SmsSettings, phone: string, code: string, purpose: VerificationPurpose) {
  const payload = JSON.stringify({
    PhoneNumberSet: [e164MainlandPhone(phone)],
    SmsSdkAppId: settings.smsSdkAppId,
    SignName: settings.signName,
    TemplateId: smsTemplateId(settings, purpose),
    TemplateParamSet: templateParams(settings, code)
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const response = await fetch(TENCENT_SMS_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: tencentAuthorization(settings, timestamp, payload),
      "Content-Type": "application/json; charset=utf-8",
      "X-TC-Action": TENCENT_SMS_ACTION,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Version": TENCENT_SMS_VERSION,
      "X-TC-Region": settings.region || DEFAULT_REGION
    },
    body: payload
  });
  const data = (await response.json().catch(() => null)) as TencentSmsResponse | null;
  if (!response.ok) {
    const message = data?.Response?.Error?.Message || `HTTP ${response.status}`;
    throw new Error(`腾讯云短信发送失败：${message}`);
  }
  const apiError = data?.Response?.Error;
  if (apiError) {
    throw new Error(`腾讯云短信发送失败：${apiError.Message || apiError.Code || "接口返回错误"}`);
  }
  const failed = data?.Response?.SendStatusSet?.find((item) => item.Code && item.Code !== "Ok");
  if (failed) {
    throw new Error(`腾讯云短信发送失败：${failed.Message || failed.Code || "短信状态异常"}`);
  }
}

export async function sendVerificationSms(phone: string, code: string, purpose: VerificationPurpose) {
  const settings = smsSettings(true);
  assertReady(settings, purpose);
  if (!validMainlandPhone(phone)) throw new Error("请输入中国大陆 11 位手机号");
  await sendTencentSms(settings, phone, code, purpose);
}

export async function sendSmsTest(phone: string) {
  await sendVerificationSms(phone, "123456", "register");
}
