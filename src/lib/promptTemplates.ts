import type {
  PromptTemplate,
  PromptTemplateComponent,
  PromptTemplateFormValue,
  PromptTemplateImageFile,
  PromptTemplateImageValue,
  PromptTemplateFormValues,
  PromptTemplateLanguage
} from "../types";

export const promptTemplateLanguageOptions: Array<{ value: PromptTemplateLanguage; label: string }> = [
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
  { value: "bilingual", label: "中英双语" }
];

export function sortedPromptTemplateComponents(components: PromptTemplateComponent[]) {
  return [...components].sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
}

export function promptTemplateLanguageLabel(language: PromptTemplateLanguage) {
  return promptTemplateLanguageOptions.find((item) => item.value === language)?.label ?? "中文";
}

export function promptTemplateDefaultValues(value: string | undefined, options: string[] | undefined) {
  const values = String(value ?? "")
    .split(/[\n,，、]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (values.length === 0) return [];
  const optionSet = new Set(options ?? []);
  return optionSet.size > 0 ? values.filter((item) => optionSet.has(item)) : values;
}

function formatPromptImageSize(bytes: unknown) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 100 * 1024 ? 1 : 0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function promptImageFileText(file: PromptTemplateImageFile) {
  const name = String(file.fileName ?? "").trim();
  if (!name) return "";
  const dimensions = Number(file.width) > 0 && Number(file.height) > 0 ? `${file.width}x${file.height}` : "";
  const size = formatPromptImageSize(file.size);
  const meta = [dimensions, size].filter(Boolean).join("，");
  return meta ? `${name}（${meta}）` : name;
}

export function promptTemplateValueText(component: PromptTemplateComponent, value: PromptTemplateFormValue | undefined) {
  if (component.type === "image") {
    if (typeof value === "string") return value.trim() || String(component.defaultValue ?? "").trim();
    const imageValue = (value ?? {}) as PromptTemplateImageValue;
    const files = Array.isArray(imageValue.files) ? imageValue.files : [];
    const fileTexts = files.map(promptImageFileText).filter(Boolean);
    const fileName = String(imageValue.fileName ?? "").trim();
    const note = String(imageValue.note ?? "").trim();
    if (fileTexts.length > 0) {
      return [
        `已上传 ${fileTexts.length} 个素材：${fileTexts.join("；")}`,
        note ? `备注：${note}` : ""
      ].filter(Boolean).join("；");
    }
    if (!fileName && !note) return String(component.defaultValue ?? "").trim();
    if (!fileName) return `素材备注：${note}`;
    return [
      `已上传 ${fileName}`,
      note ? `备注：${note}` : ""
    ].filter(Boolean).join("；");
  }
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean).join("、");
  return String(value ?? component.defaultValue ?? "").trim();
}

export function initialPromptTemplateFormValues(template: PromptTemplate): PromptTemplateFormValues {
  return Object.fromEntries(
    sortedPromptTemplateComponents(template.components)
      .filter((component) => component.type !== "section")
      .map((component) => [
        component.id,
        component.type === "image"
          ? { fileName: "", note: String(component.defaultValue ?? ""), uploaded: false, files: [] }
          : component.type === "select" && component.multiple
            ? promptTemplateDefaultValues(component.defaultValue, component.options)
          : String(component.defaultValue ?? "")
      ])
  );
}

export function buildBasePrompt(template: PromptTemplate, formValues: PromptTemplateFormValues, language: PromptTemplateLanguage) {
  const components = sortedPromptTemplateComponents(template.components);
  const rules = template.rules ?? {};
  const parts: string[] = [];
  if (rules.prefix?.trim()) parts.push(rules.prefix.trim());
  for (const component of components) {
    if (component.type === "section") continue;
    const text = promptTemplateValueText(component, formValues[component.id]);
    if (!text) continue;
    const label = component.label || (component.slot ? rules.labels?.[component.slot] : "") || component.id;
    parts.push(`${label}：${text}`);
  }
  parts.push(`输出语言：${promptTemplateLanguageLabel(language)}`);
  if (rules.suffix?.trim()) parts.push(rules.suffix.trim());
  return parts.join(rules.joiner ?? "\n");
}

export function promptTemplateSignature(templateId: string, language: PromptTemplateLanguage, formValues: PromptTemplateFormValues, basePrompt = "") {
  return JSON.stringify({ templateId, language, formValues, basePrompt });
}

export function duplicatePromptTemplateComponent(component: PromptTemplateComponent): PromptTemplateComponent {
  const id = `${component.type}_${Date.now().toString(36)}`;
  return {
    ...component,
    id,
    label: `${component.label || "组件"}副本`,
    slot: component.slot ? `${component.slot}_${Date.now().toString(36)}` : id,
    sortOrder: Number(component.sortOrder ?? 0) + 1
  };
}
