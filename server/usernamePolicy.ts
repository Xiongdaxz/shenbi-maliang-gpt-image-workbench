export const USERNAME_RULE_MESSAGE =
  "用户名支持中文、英文、数字、单个空格、下划线和短横线，长度 2-20 个字符，不支持首尾空格或连续空格";

export function normalizeUsername(value: unknown) {
  return String(value ?? "").trim();
}

export function validateUsername(value: unknown): { ok: true; username: string } | { ok: false; error: string } {
  const raw = String(value ?? "");
  const username = normalizeUsername(value);
  if (!username) return { ok: false, error: "请填写用户名" };
  if (raw !== username) return { ok: false, error: USERNAME_RULE_MESSAGE };
  if (/ {2,}/.test(username)) return { ok: false, error: USERNAME_RULE_MESSAGE };
  if (/[^\S ]/.test(username)) return { ok: false, error: USERNAME_RULE_MESSAGE };
  if (!/^[\u4e00-\u9fffA-Za-z0-9_ -]+$/.test(username)) return { ok: false, error: USERNAME_RULE_MESSAGE };
  if (!/[\u4e00-\u9fffA-Za-z]/.test(username)) return { ok: false, error: "用户名至少包含一个中文或英文字母" };
  const length = Array.from(username).length;
  return length >= 2 && length <= 20 ? { ok: true, username } : { ok: false, error: USERNAME_RULE_MESSAGE };
}
