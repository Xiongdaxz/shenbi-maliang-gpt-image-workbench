const PROMPT_TEMPLATE_FORM_DRAFT_PREFIX = "prompt-template-form-draft:";

export function clearPromptTemplateFormDraftCache() {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(PROMPT_TEMPLATE_FORM_DRAFT_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // 清理旧本地草稿失败不影响数据库草稿继续工作。
  }
}
