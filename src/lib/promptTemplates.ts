import type {
  PromptTemplate,
  PromptTemplateColorOption,
  PromptTemplateColorValue,
  PromptTemplateComponent,
  PromptTemplateFormValue,
  PromptTemplateGradientOption,
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

export const defaultPromptTemplateColorOptions: PromptTemplateColorOption[] = [
  { id: "commercial-ink-black", name: "品牌墨黑", role: "主色", hex: "#16181D" },
  { id: "commercial-action-blue", name: "操作蓝", role: "主色", hex: "#2563EB" },
  { id: "commercial-warm-orange", name: "暖橙", role: "辅助色", hex: "#F97316" },
  { id: "commercial-cream-white", name: "奶油白", role: "背景色", hex: "#FFF7ED" },
  { id: "commercial-mint-green", name: "松石绿", role: "点缀色", hex: "#14B8A6" },
  { id: "commercial-rose-pink", name: "玫瑰粉", role: "点缀色", hex: "#F472B6" },
  { id: "commercial-steel-gray", name: "银灰", role: "辅助色", hex: "#94A3B8" },
  { id: "commercial-soft-gold", name: "柔金", role: "点缀色", hex: "#D4AF37" }
];

export const defaultPromptTemplateGradientOptions: PromptTemplateGradientOption[] = [
  { id: "commercial-blue-purple", name: "科技蓝紫", role: "光效", colors: ["#2563EB", "#8B5CF6"] },
  { id: "commercial-sunset-orange", name: "日落粉橙", role: "背景色", colors: ["#FB7185", "#F97316", "#FACC15"] },
  { id: "commercial-black-gold", name: "黑金质感", role: "主视觉", colors: ["#151517", "#B8860B"] },
  { id: "commercial-fresh-green", name: "清新青绿", role: "背景色", colors: ["#E0F2FE", "#14B8A6"] },
  { id: "commercial-candy-pink-blue", name: "糖果粉蓝", role: "背景色", colors: ["#F9A8D4", "#93C5FD"] }
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

export function normalizePromptTemplateHex(value: unknown) {
  const normalized = String(value ?? "").trim().toUpperCase();
  const shortMatch = normalized.match(/^#?([0-9A-F]{3})$/);
  if (shortMatch) {
    return `#${shortMatch[1].split("").map((char) => `${char}${char}`).join("")}`;
  }
  const longMatch = normalized.match(/^#?([0-9A-F]{6})$/);
  return longMatch ? `#${longMatch[1]}` : "";
}

function fallbackOptionId(prefix: string, index: number, name: string, hex = "") {
  const source = `${name || prefix}-${hex || index}`;
  const slug = source
    .toLowerCase()
    .replace(/#[0-9a-f]+/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefix}-${slug || index + 1}`;
}

export function promptTemplateColorOptions(component: PromptTemplateComponent) {
  const source = Array.isArray(component.colorOptions)
    ? component.colorOptions
    : component.type === "color"
      ? defaultPromptTemplateColorOptions
      : [];
  return source
    .map((option, index) => {
      const hex = normalizePromptTemplateHex(option.hex);
      if (!hex) return null;
      const name = String(option.name ?? "").trim() || hex;
      return {
        id: String(option.id ?? "").trim() || fallbackOptionId("color", index, name, hex),
        name,
        role: String(option.role ?? "").trim() || "颜色",
        hex
      };
    })
    .filter((option): option is PromptTemplateColorOption => Boolean(option));
}

export function promptTemplateGradientOptions(component: PromptTemplateComponent) {
  const source = Array.isArray(component.gradientOptions)
    ? component.gradientOptions
    : component.type === "color"
      ? defaultPromptTemplateGradientOptions
      : [];
  return source
    .map((option, index) => {
      const colors = Array.isArray(option.colors)
        ? option.colors.map(normalizePromptTemplateHex).filter(Boolean)
        : [];
      if (colors.length === 0) return null;
      const name = String(option.name ?? "").trim() || colors.join(" -> ");
      return {
        id: String(option.id ?? "").trim() || fallbackOptionId("gradient", index, name, colors.join("-")),
        name,
        role: String(option.role ?? "").trim() || "背景色系",
        colors
      };
    })
    .filter((option): option is PromptTemplateGradientOption => Boolean(option));
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)));
}

function promptTemplateColorTokens(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  return String(value ?? "")
    .split(/[\n,，、;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizePromptTemplateColorValue(value: unknown, component: PromptTemplateComponent): PromptTemplateColorValue {
  const colorOptions = promptTemplateColorOptions(component);
  const gradientOptions = promptTemplateGradientOptions(component);
  const colorLookup = new Map<string, string>();
  const gradientLookup = new Map<string, string>();

  for (const option of colorOptions) {
    colorLookup.set(option.id, option.id);
    colorLookup.set(option.name, option.id);
    colorLookup.set(option.hex, option.id);
  }
  for (const option of gradientOptions) {
    gradientLookup.set(option.id, option.id);
    gradientLookup.set(option.name, option.id);
  }

  const colorIds: string[] = [];
  const gradientIds: string[] = [];
  const customColors: string[] = [];

  function addToken(token: string, preferred: "color" | "gradient" | "custom" = "color") {
    const text = String(token ?? "").trim();
    if (!text) return;
    const hex = normalizePromptTemplateHex(text);
    if (preferred === "custom" && hex) {
      customColors.push(hex);
      return;
    }
    const colorId = colorLookup.get(hex || text);
    if (colorId) {
      colorIds.push(colorId);
      return;
    }
    const gradientId = gradientLookup.get(text);
    if (gradientId) {
      gradientIds.push(gradientId);
      return;
    }
    if (hex) customColors.push(hex);
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as PromptTemplateColorValue;
    promptTemplateColorTokens(record.colors).forEach((token) => addToken(token, "color"));
    promptTemplateColorTokens(record.gradients).forEach((token) => addToken(token, "gradient"));
    promptTemplateColorTokens(record.customColors).forEach((token) => addToken(token, "custom"));
  } else {
    promptTemplateColorTokens(value).forEach((token) => addToken(token));
  }

  return {
    colors: uniqueValues(colorIds),
    gradients: uniqueValues(gradientIds),
    customColors: uniqueValues(customColors)
  };
}

export function promptTemplateColorValueText(component: PromptTemplateComponent, value: unknown) {
  const normalized = normalizePromptTemplateColorValue(value, component);
  const colorById = new Map(promptTemplateColorOptions(component).map((option) => [option.id, option]));
  const gradientById = new Map(promptTemplateGradientOptions(component).map((option) => [option.id, option]));
  const parts: string[] = [];

  for (const id of normalized.colors ?? []) {
    const option = colorById.get(id);
    if (!option) continue;
    parts.push(`${option.role || "颜色"}：${option.name} ${option.hex}`);
  }
  for (const id of normalized.gradients ?? []) {
    const option = gradientById.get(id);
    if (!option) continue;
    parts.push(`${option.role || "背景色系"}：${option.name} ${option.colors.join(" -> ")}`);
  }
  for (const hex of normalized.customColors ?? []) {
    parts.push(`自定义色：${hex}`);
  }

  return parts.join("；");
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
  if (component.type === "color") {
    return promptTemplateColorValueText(component, value);
  }
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
          : component.type === "color"
            ? normalizePromptTemplateColorValue(component.defaultValue, component)
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
