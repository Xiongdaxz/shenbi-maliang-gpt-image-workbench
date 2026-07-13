import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Armchair,
  BadgeCheck,
  BadgePercent,
  Box,
  BookOpen,
  Briefcase,
  Brush,
  Building2,
  Calendar,
  Camera,
  Car,
  ChartBar,
  ChartPie,
  Check,
  Clapperboard,
  ClipboardList,
  Coffee,
  Copy,
  Crown,
  Download,
  Eye,
  FileText,
  Film,
  Flower2,
  Frame,
  Gamepad2,
  Gem,
  Gift,
  Globe,
  GripVertical,
  Handshake,
  Heart,
  History,
  Hotel,
  House,
  Image as ImageIcon,
  Languages,
  Landmark,
  Laptop,
  LayoutTemplate,
  Layers,
  Leaf,
  Lightbulb,
  MapPin,
  Megaphone,
  Mic,
  Monitor,
  Mountain,
  Music,
  Newspaper,
  Package,
  PackageCheck,
  Palette,
  PanelsTopLeft,
  PartyPopper,
  PenTool,
  Pencil,
  Pizza,
  Plane,
  Plus,
  Podcast,
  Radio,
  ReceiptText,
  RotateCw,
  Rocket,
  Save,
  ScanEye,
  Search,
  ScrollText,
  Send,
  Shapes,
  Share2,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Smile,
  Sofa,
  Sparkle,
  Sparkles,
  Sprout,
  Star,
  Store,
  Sun,
  Tag,
  Target,
  Ticket,
  Trash2,
  Trees,
  Trophy,
  Truck,
  Tv,
  Type,
  Umbrella,
  Upload,
  Users,
  Utensils,
  Video,
  WalletCards,
  WandSparkles,
  Waves,
  Workflow,
  Zap,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, type PromptTemplateExportDownload, type PromptTemplateOptimizeStyle, type PromptTemplatePayload } from "../api";
import { PromptOptimizeStyleSelect } from "../components/PromptOptimizeStyleSelect";
import { PromptTemplateColorPicker } from "../components/PromptTemplateColorPicker";
import { SearchHistoryInput } from "../components/SearchHistoryInput";
import { useI18n, type LocaleCode, type Translate } from "../i18n";
import { copyTextToClipboard } from "../lib/clipboard";
import { cx } from "../lib/cx";
import { promptTemplateIconFor, promptTemplateIconMap } from "../lib/promptTemplateIcons";
import {
  normalizePromptOptimizeStyle,
  promptOptimizeStyleOption,
  sanitizePromptOptimizeStyleGroups
} from "../lib/promptOptimizeStyles";
import {
  buildBasePrompt,
  defaultPromptTemplateColorOptions,
  defaultPromptTemplateGradientOptions,
  duplicatePromptTemplateComponent,
  initialPromptTemplateFormValues,
  normalizePromptTemplateColorValue,
  normalizePromptTemplateHex,
  promptTemplateDefaultValues,
  promptTemplateSignature,
  sortedPromptTemplateComponents
} from "../lib/promptTemplates";
import { useWorkbench } from "../store/workbench";
import type {
  AssetItem,
  PromptTemplate,
  PromptTemplateColorOption,
  PromptTemplateComponent,
  PromptTemplateComponentWidth,
  PromptTemplateComponentType,
  PromptTemplateFormValues,
  PromptTemplateGradientOption,
  PromptTemplateImageFile,
  PromptTemplateImageValue,
  PromptTemplateResult,
  PromptTemplateVisibility
} from "../types";
import { ConfirmDialog, CustomSelect, PromptDialog, useToast } from "../ui";

type TemplateScope = "all" | "mine" | "shared";
type PropertyTab = "component" | "template";

type PromptDialogState =
  | { kind: "rename"; template: PromptTemplate }
  | null;
type UsePromptTarget = "base" | "ai";
type PromptDisplayLanguage = "zh" | "en";
type PromptTemplateImageFileWithSource = PromptTemplateImageFile & { sourceFile?: File };
const PROMPT_TEMPLATE_COLOR_OPTION_LIMIT = 12;
const PROMPT_TEMPLATE_GRADIENT_OPTION_LIMIT = 12;
const PROMPT_TEMPLATE_GRADIENT_COLOR_LIMIT = 5;
const PROMPT_TEMPLATE_GRADIENT_COLOR_MIN = 2;
const PROMPT_TEMPLATE_DEFAULT_GRADIENT_COLORS = ["#151517", "#D4AF37", "#FFFFFF", "#F97316", "#7DD3FC"];

const PROMPT_RESULT_WIDTH_STORAGE_KEY = "prompt-template-result-panel-width";
const PROMPT_RESULT_MIN_WIDTH = 330;
const PROMPT_RESULT_MAX_WIDTH = 760;
const PROMPT_RESULT_DEFAULT_WIDTH = PROMPT_RESULT_MAX_WIDTH;
const PROMPT_EDITOR_PROPERTY_WIDTH_STORAGE_KEY = "prompt-template-editor-property-width";
const PROMPT_EDITOR_PROPERTY_MIN_WIDTH = 390;
const PROMPT_EDITOR_PROPERTY_MAX_WIDTH = 720;
const PROMPT_EDITOR_PROPERTY_DEFAULT_WIDTH = PROMPT_EDITOR_PROPERTY_MIN_WIDTH;
const PROMPT_EDITOR_PREVIEW_MIN_WIDTH = 460;
const PROMPT_EDITOR_COLUMN_GAP = 12;
const PROMPT_TEMPLATE_THUMB_MAX_SIZE = 320;
const PROMPT_DIFF_MAX_CELLS = 160000;
const PROMPT_TEMPLATE_HISTORY_PAGE_SIZE = 20;
const PROMPT_TEMPLATE_EXPORT_DOWNLOAD_PAGE_SIZE = 12;

function promptTemplateIconOptions(t: Translate) {
  return Object.entries(promptTemplateIconMap).map(([name, Icon]) => ({
    value: name,
    label: t(`promptTemplates.icons.${name}`),
    description: name,
    icon: <Icon size={15} />
  }));
}

function promptTemplateComponentTypeOptions(t: Translate): Array<{ value: PromptTemplateComponentType; label: string; description: string }> {
  return [
    { value: "text", label: t("promptTemplates.componentTypes.text"), description: t("promptTemplates.componentTypes.textDesc") },
    { value: "textarea", label: t("promptTemplates.componentTypes.textarea"), description: t("promptTemplates.componentTypes.textareaDesc") },
    { value: "select", label: t("promptTemplates.componentTypes.select"), description: t("promptTemplates.componentTypes.selectDesc") },
    { value: "color", label: t("promptTemplates.componentTypes.color"), description: t("promptTemplates.componentTypes.colorDesc") },
    { value: "image", label: t("promptTemplates.componentTypes.image"), description: t("promptTemplates.componentTypes.imageDesc") },
    { value: "section", label: t("promptTemplates.componentTypes.section"), description: t("promptTemplates.componentTypes.sectionDesc") }
  ];
}

function promptTemplateScopeOptions(t: Translate): Array<{ value: TemplateScope; label: string }> {
  return [
    { value: "all", label: t("common.all") },
    { value: "mine", label: t("common.mine") },
    { value: "shared", label: t("common.shared") }
  ];
}

function promptTemplateComponentWidthOptions(t: Translate): Array<{ value: PromptTemplateComponentWidth; label: string }> {
  return [
    { value: "full", label: t("promptTemplates.editor.widthFull") },
    { value: "half", label: t("promptTemplates.editor.widthHalf") }
  ];
}

function formatImageFileSize(bytes: number | undefined) {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 100 * 1024 ? 1 : 0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function looksLikePromptJson(value: string) {
  const text = value.trim();
  if (!text) return false;
  if (text.startsWith("{") || text.startsWith("```json")) return true;
  return /"(promptZh|promptEn|items|negativePromptZh|negativePromptEn)"\s*:/.test(text);
}

function parsePromptJsonText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
  const candidate = fenced || trimmed;
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function stringField(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function nestedStringField(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return stringField(value as Record<string, unknown>, keys);
}

function promptTextFromJsonRecord(record: Record<string, unknown>, language: PromptDisplayLanguage) {
  const keys = language === "en"
    ? ["promptEn", "prompt_en", "enPrompt", "englishPrompt", "optimizedPromptEn", "optimized_prompt_en", "finalPromptEn"]
    : ["promptZh", "prompt_zh", "zhPrompt", "chinesePrompt", "optimizedPromptZh", "optimized_prompt_zh", "finalPromptZh"];
  const nestedKeys = language === "en" ? ["en", "english"] : ["zh", "cn", "chinese"];
  return stringField(record, keys)
    || nestedStringField(record.prompts, nestedKeys)
    || nestedStringField(record.promptVersions, nestedKeys)
    || nestedStringField(record.optimizedPrompts, nestedKeys);
}

function negativePromptTextFromJsonRecord(record: Record<string, unknown>, language: PromptDisplayLanguage) {
  const keys = language === "en"
    ? ["negativePromptEn", "negative_prompt_en", "enNegativePrompt", "negativeEn", "negative_en"]
    : ["negativePromptZh", "negative_prompt_zh", "zhNegativePrompt", "negativeZh", "negative_zh"];
  const nestedKeys = language === "en" ? ["en", "english"] : ["zh", "cn", "chinese"];
  const nestedNegativePrompt = record.negativePrompt && typeof record.negativePrompt === "object" ? record.negativePrompt : null;
  return stringField(record, keys)
    || nestedStringField(record.negativePrompts, nestedKeys)
    || nestedStringField(record.negativePromptVersions, nestedKeys)
    || nestedStringField(nestedNegativePrompt, nestedKeys);
}

function normalizePromptText(value: unknown, language: PromptDisplayLanguage, kind: "prompt" | "negative" = "prompt") {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (!looksLikePromptJson(text)) return text;
  const record = parsePromptJsonText(text);
  if (!record) return "";
  return kind === "negative" ? negativePromptTextFromJsonRecord(record, language) : promptTextFromJsonRecord(record, language);
}

function optimizedPromptForLanguage(result: PromptTemplateResult | null, language: PromptDisplayLanguage, strict = false) {
  if (!result) return "";
  const localized = normalizePromptText(result.optimizedPrompts?.[language], language);
  if (localized) return localized;
  const generic = normalizePromptText(result.optimizedPrompt, language);
  if (!strict) return generic;
  if (result.language === language) return generic;
  return "";
}

function negativePromptForLanguage(result: PromptTemplateResult | null, language: PromptDisplayLanguage, strict = false) {
  if (!result) return "";
  const localized = normalizePromptText(result.negativePrompts?.[language], language, "negative");
  if (localized) return localized;
  const generic = normalizePromptText(result.negativePrompt, language, "negative");
  if (!strict) return generic;
  if (result.language === language) return generic;
  return "";
}

function promptWithNegative(prompt: string, negativePrompt: string, language: PromptDisplayLanguage, t?: Translate) {
  const positive = prompt.trim();
  const negative = negativePrompt.trim();
  if (!positive) return "";
  if (!negative) return positive;
  const title = language === "en" ? "Negative prompt" : t?.("promptTemplates.negativePrompt") ?? "反向提示词";
  return `${positive}\n\n${title}：\n${negative}`;
}

function translatedPromptCoversSource(_source: string, translated: string) {
  return Boolean(translated.trim());
}

function manualNegativePromptFromTemplate(template: PromptTemplate | null | undefined) {
  return String(template?.rules?.negativePrompt ?? "").trim();
}

function manualNegativePromptFromSnapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  const rules = record.rules && typeof record.rules === "object" && !Array.isArray(record.rules)
    ? record.rules as Record<string, unknown>
    : {};
  return String(rules.negativePrompt ?? "").trim();
}

type PromptDiffToken = {
  text: string;
  normalized: string;
  sourceIndex: number;
};

function tokenizePromptDiffText(text: string): PromptDiffToken[] {
  const parts = text.match(/[\u3400-\u9fff\uf900-\ufaff]|[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*|\s+|[^\s]/g) ?? [];
  return parts.map((part, index) => ({
    text: part,
    normalized: /^\s+$/.test(part) ? "" : part.toLowerCase(),
    sourceIndex: index
  }));
}

function matchedPromptDiffTokenIndexes(baseText: string, targetText: string) {
  const baseTokens = tokenizePromptDiffText(baseText).filter((token) => token.normalized);
  const targetTokens = tokenizePromptDiffText(targetText).filter((token) => token.normalized);
  const matched = new Set<number>();
  if (baseTokens.length === 0 || targetTokens.length === 0) return matched;

  if (baseTokens.length * targetTokens.length > PROMPT_DIFF_MAX_CELLS) {
    const baseValues = new Set(baseTokens.map((token) => token.normalized));
    targetTokens.forEach((token) => {
      if (baseValues.has(token.normalized)) matched.add(token.sourceIndex);
    });
    return matched;
  }

  const rows = baseTokens.length + 1;
  const cols = targetTokens.length + 1;
  const lcs = Array.from({ length: rows }, () => new Uint16Array(cols));
  for (let baseIndex = baseTokens.length - 1; baseIndex >= 0; baseIndex -= 1) {
    for (let targetIndex = targetTokens.length - 1; targetIndex >= 0; targetIndex -= 1) {
      if (baseTokens[baseIndex].normalized === targetTokens[targetIndex].normalized) {
        lcs[baseIndex][targetIndex] = lcs[baseIndex + 1][targetIndex + 1] + 1;
      } else {
        lcs[baseIndex][targetIndex] = Math.max(lcs[baseIndex + 1][targetIndex], lcs[baseIndex][targetIndex + 1]);
      }
    }
  }

  let baseIndex = 0;
  let targetIndex = 0;
  while (baseIndex < baseTokens.length && targetIndex < targetTokens.length) {
    if (baseTokens[baseIndex].normalized === targetTokens[targetIndex].normalized) {
      matched.add(targetTokens[targetIndex].sourceIndex);
      baseIndex += 1;
      targetIndex += 1;
    } else if (lcs[baseIndex + 1][targetIndex] >= lcs[baseIndex][targetIndex + 1]) {
      baseIndex += 1;
    } else {
      targetIndex += 1;
    }
  }
  return matched;
}

function renderPromptDiffText(content: string, baseText: string): ReactNode {
  if (!content.trim() || !baseText.trim()) return content;
  const tokens = tokenizePromptDiffText(content);
  const matched = matchedPromptDiffTokenIndexes(baseText, content);
  const segments: Array<{ text: string; changed: boolean }> = [];

  tokens.forEach((token) => {
    const changed = Boolean(token.normalized && !matched.has(token.sourceIndex));
    const last = segments[segments.length - 1];
    if (last && last.changed === changed) {
      last.text += token.text;
    } else {
      segments.push({ text: token.text, changed });
    }
  });

  return segments.map((segment, index) => (
    segment.changed
      ? <mark key={index} className="result-block-diff-mark">{segment.text}</mark>
      : <span key={index}>{segment.text}</span>
  ));
}

function loadImagePreviewSource(previewUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = previewUrl;
  });
}

async function imageFileFromUpload(file: File): Promise<PromptTemplateImageFile> {
  const sourceUrl = URL.createObjectURL(file);
  let width = 0;
  let height = 0;
  let previewUrl = "";
  try {
    const image = await loadImagePreviewSource(sourceUrl);
    width = image.naturalWidth || 0;
    height = image.naturalHeight || 0;
    const scale = width > 0 && height > 0 ? Math.min(1, PROMPT_TEMPLATE_THUMB_MAX_SIZE / Math.max(width, height)) : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round((width || PROMPT_TEMPLATE_THUMB_MAX_SIZE) * scale));
    canvas.height = Math.max(1, Math.round((height || PROMPT_TEMPLATE_THUMB_MAX_SIZE) * scale));
    const context = canvas.getContext("2d");
    if (context) {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      previewUrl = canvas.toDataURL("image/jpeg", 0.78);
    }
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
  const form = new FormData();
  form.set("file", file);
  form.set("spaceMode", "private");
  const result = await api.uploadAsset(form);
  if (!result.asset) throw new Error("素材原图保存失败");
  const assetPreviewUrl = result.asset.thumbnailUrl || result.asset.previewUrl || result.asset.originalUrl || result.asset.url || previewUrl;
  const imageFile: PromptTemplateImageFileWithSource = {
    id: `${file.name}_${file.size}_${file.lastModified}_${Math.random().toString(36).slice(2)}`,
    fileName: file.name,
    size: file.size,
    width,
    height,
    previewUrl: assetPreviewUrl,
    assetId: result.asset.id,
    asset: result.asset,
    uploaded: true
  };
  Object.defineProperty(imageFile, "sourceFile", {
    value: file,
    enumerable: false
  });
  return imageFile;
}

function isPersistentPreviewUrl(value: unknown) {
  const previewUrl = String(value ?? "");
  return previewUrl.startsWith("data:") || previewUrl.startsWith("http://") || previewUrl.startsWith("https://");
}

function normalizePromptTemplateImageValue(value: unknown): PromptTemplateImageValue {
  const imageValue = (typeof value === "object" && value ? value : {}) as PromptTemplateImageValue;
  const files = Array.isArray(imageValue.files)
    ? imageValue.files
        .map((file) => {
          const asset = file.asset && typeof file.asset === "object" && String(file.asset.id ?? "").trim() ? file.asset : null;
          const assetPreviewUrl = asset?.thumbnailUrl || asset?.previewUrl || asset?.originalUrl || asset?.url || "";
          return {
            ...file,
            asset,
            assetId: String(file.assetId ?? asset?.id ?? "").trim(),
            previewUrl: isPersistentPreviewUrl(file.previewUrl) ? file.previewUrl : assetPreviewUrl
          };
        })
        .filter((file) => String(file.fileName ?? "").trim())
    : [];
  return {
    ...imageValue,
    files,
    fileName: files[0]?.fileName ?? String(imageValue.fileName ?? ""),
    uploaded: files.length > 0 || Boolean(imageValue.uploaded),
    previewUrl: files[0]?.previewUrl ?? (isPersistentPreviewUrl(imageValue.previewUrl) ? imageValue.previewUrl : "")
  };
}

function promptTemplateMaterialFiles(template: PromptTemplate | null, formValues: PromptTemplateFormValues) {
  if (!template) return [];
  const files: PromptTemplateImageFile[] = [];
  const seen = new Set<string>();
  for (const component of sortedPromptTemplateComponents(template.components)) {
    if (component.type !== "image") continue;
    const value = formValues[component.id];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const imageValue = value as PromptTemplateImageValue;
    const imageFiles = Array.isArray(imageValue.files) ? imageValue.files : [];
    const candidates = imageFiles.length > 0
      ? imageFiles
      : imageValue.previewUrl && imageValue.fileName
        ? [{ fileName: imageValue.fileName, previewUrl: imageValue.previewUrl, size: 0, width: 0, height: 0 }]
        : [];
    for (const file of candidates) {
      const key = file.id || `${file.fileName}_${file.size ?? 0}_${String(file.previewUrl ?? "").slice(0, 80)}`;
      if (!String(file.fileName ?? "").trim() || seen.has(key)) continue;
      seen.add(key);
      files.push(file);
    }
  }
  return files;
}

function promptTemplateMaterialFileName(file: PromptTemplateImageFile, index: number, mimeType: string) {
  const name = String(file.fileName ?? "").trim();
  if (name) return name;
  const extension = mimeType.includes("png") ? "png" : mimeType.includes("webp") ? "webp" : "jpg";
  return `提示表单素材-${index + 1}.${extension}`;
}

async function promptTemplateMaterialToAsset(file: PromptTemplateImageFile, index: number) {
  if (file.asset?.id) return file.asset;
  const sourceFile = (file as PromptTemplateImageFileWithSource).sourceFile;
  if (!(sourceFile instanceof File)) throw new Error("素材缺少原图，请重新上传");
  const form = new FormData();
  form.set("file", sourceFile, promptTemplateMaterialFileName(file, index, sourceFile.type || "image/jpeg"));
  form.set("spaceMode", "private");
  const result = await api.uploadAsset(form);
  if (!result.asset) throw new Error("素材原图保存失败");
  return result.asset;
}

function mergePromptTemplateFormValues(template: PromptTemplate, value: unknown): PromptTemplateFormValues {
  const defaults = initialPromptTemplateFormValues(template);
  if (!value || typeof value !== "object") return defaults;
  const source = value as PromptTemplateFormValues;
  const next: PromptTemplateFormValues = { ...defaults };
  for (const component of sortedPromptTemplateComponents(template.components)) {
    if (component.type === "section" || !(component.id in source)) continue;
    const currentValue = source[component.id];
    if (component.type === "image") {
      next[component.id] = normalizePromptTemplateImageValue(currentValue);
    } else if (component.type === "color") {
      next[component.id] = normalizePromptTemplateColorValue(currentValue, component);
    } else if (component.type === "select" && component.multiple) {
      next[component.id] = Array.isArray(currentValue) ? currentValue.map((item) => String(item)) : promptTemplateDefaultValues(String(currentValue ?? ""), component.options);
    } else {
      next[component.id] = typeof currentValue === "string" ? currentValue : String(currentValue ?? "");
    }
  }
  return next;
}

function promptTemplateFormValuesForStorage(formValues: PromptTemplateFormValues) {
  return Object.fromEntries(
    Object.entries(formValues).map(([key, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [key, value];
      if ("colors" in value || "gradients" in value || "customColors" in value) return [key, value];
      const imageValue = value as PromptTemplateImageValue;
      return [
        key,
        {
          ...imageValue,
          dataUrl: "",
          downloadUrl: "",
          files: imageValue.files?.map((file) => ({
            ...file,
            dataUrl: "",
            downloadUrl: "",
            previewUrl: file.asset?.thumbnailUrl || file.asset?.previewUrl || file.asset?.originalUrl || file.asset?.url || file.previewUrl || ""
          })) ?? []
        }
      ];
    })
  ) as PromptTemplateFormValues;
}

function filenameFromContentDisposition(value: string | null) {
  const header = value ?? "";
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ""));
    } catch {
      return utf8Match[1].trim().replace(/^"|"$/g, "");
    }
  }
  const plainMatch = header.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1]?.trim() ?? "";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function PromptTemplateMultiSelect({
  values,
  options,
  onChange,
  placeholder
}: {
  values: string[];
  options: Array<{ value: string; label: string }>;
  onChange: (values: string[]) => void;
  placeholder?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const selectedSet = useMemo(() => new Set(values), [values]);
  const selectedLabels = options.filter((option) => selectedSet.has(option.value)).map((option) => option.label);
  const placeholderText = placeholder ?? t("common.selectPlaceholder");

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!wrapRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function toggleValue(value: string) {
    if (selectedSet.has(value)) {
      onChange(values.filter((item) => item !== value));
      return;
    }
    onChange([...values, value]);
  }

  return (
    <div className="template-multi-select" ref={wrapRef}>
      <button type="button" className="custom-select-trigger" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="custom-select-value">
          <span className={selectedLabels.length === 0 ? "custom-select-label placeholder" : "custom-select-label"}>
            {selectedLabels.length > 0 ? selectedLabels.join(t("common.listSeparator")) : placeholderText}
          </span>
        </span>
      </button>
      {open ? (
        <div className="template-multi-select-menu" role="listbox" aria-multiselectable="true">
          {options.map((option) => {
            const active = selectedSet.has(option.value);
            return (
              <button type="button" key={option.value} role="option" aria-selected={active} className={active ? "active" : ""} onClick={() => toggleValue(option.value)}>
                <span>{option.label}</span>
                {active ? <Check size={16} /> : null}
              </button>
            );
          })}
          {options.length === 0 ? <div className="custom-select-empty">{t("promptTemplates.editor.noOptions")}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function editableColorOptions(component: PromptTemplateComponent) {
  const source = Array.isArray(component.colorOptions) ? component.colorOptions : defaultPromptTemplateColorOptions;
  return source.map((option, index) => ({
    id: String(option.id ?? "").trim() || `color-${index + 1}`,
    name: String(option.name ?? "").trim(),
    role: String(option.role ?? "").trim(),
    hex: String(option.hex ?? "").trim()
  }));
}

function editableGradientOptions(component: PromptTemplateComponent) {
  const source = Array.isArray(component.gradientOptions) ? component.gradientOptions : defaultPromptTemplateGradientOptions;
  return source.map((option, index) => ({
    id: String(option.id ?? "").trim() || `gradient-${index + 1}`,
    name: String(option.name ?? "").trim(),
    role: String(option.role ?? "").trim(),
    colors: Array.isArray(option.colors) ? option.colors.map((color) => String(color ?? "").trim()) : []
  }));
}

function newColorOption(): PromptTemplateColorOption {
  const stamp = Date.now().toString(36);
  return { id: `color-${stamp}`, name: "", role: "", hex: "#151517" };
}

function newGradientOption(): PromptTemplateGradientOption {
  const stamp = Date.now().toString(36);
  return { id: `gradient-${stamp}`, name: "", role: "背景色系", colors: PROMPT_TEMPLATE_DEFAULT_GRADIENT_COLORS.slice(0, PROMPT_TEMPLATE_GRADIENT_COLOR_MIN) };
}

function editableGradientColors(colors: string[]) {
  const values = Array.isArray(colors) ? colors.map((color) => String(color ?? "").trim()).filter(Boolean) : [];
  if (values.length >= PROMPT_TEMPLATE_GRADIENT_COLOR_MIN) return values;
  return [
    ...values,
    ...PROMPT_TEMPLATE_DEFAULT_GRADIENT_COLORS.slice(values.length, PROMPT_TEMPLATE_GRADIENT_COLOR_MIN)
  ];
}

function colorPreviewStyle(hex: string): CSSProperties {
  return { background: normalizePromptTemplateHex(hex) || "#f3f4f6" };
}

function gradientPreviewStyle(option: PromptTemplateGradientOption): CSSProperties {
  const colors = option.colors.map(normalizePromptTemplateHex).filter(Boolean);
  return { background: colors.length > 0 ? `linear-gradient(90deg, ${colors.join(", ")})` : "#f3f4f6" };
}

function colorOptionListStyle(count: number): CSSProperties {
  if (count <= 0) return {};
  return { height: Math.min(count * 41 + 1, 206) };
}

function gradientOptionListStyle(count: number): CSSProperties {
  if (count <= 0) return {};
  return { height: Math.min(count * 112 + 1, 334) };
}

function ColorComponentSettings({
  component,
  onPatch
}: {
  component: PromptTemplateComponent;
  onPatch: (patch: Partial<PromptTemplateComponent>) => void;
}) {
  const { t } = useI18n();
  const colorOptions = editableColorOptions(component);
  const gradientOptions = editableGradientOptions(component);
  const canAddColorOption = colorOptions.length < PROMPT_TEMPLATE_COLOR_OPTION_LIMIT;
  const canAddGradientOption = gradientOptions.length < PROMPT_TEMPLATE_GRADIENT_OPTION_LIMIT;

  function patchColorOption(index: number, patch: Partial<PromptTemplateColorOption>) {
    onPatch({
      colorOptions: colorOptions.map((option, optionIndex) => optionIndex === index ? { ...option, ...patch } : option)
    });
  }

  function patchGradientOption(index: number, patch: Partial<PromptTemplateGradientOption>) {
    onPatch({
      gradientOptions: gradientOptions.map((option, optionIndex) => optionIndex === index ? { ...option, ...patch } : option)
    });
  }

  function patchGradientColor(optionIndex: number, colorIndex: number, color: string) {
    const option = gradientOptions[optionIndex];
    if (!option) return;
    const colors = editableGradientColors(option.colors);
    colors[colorIndex] = color;
    patchGradientOption(optionIndex, { colors });
  }

  function addGradientColor(optionIndex: number) {
    const option = gradientOptions[optionIndex];
    if (!option) return;
    const colors = editableGradientColors(option.colors);
    if (colors.length >= PROMPT_TEMPLATE_GRADIENT_COLOR_LIMIT) return;
    patchGradientOption(optionIndex, { colors: [...colors, PROMPT_TEMPLATE_DEFAULT_GRADIENT_COLORS[colors.length % PROMPT_TEMPLATE_DEFAULT_GRADIENT_COLORS.length]] });
  }

  function removeGradientColor(optionIndex: number, colorIndex: number) {
    const option = gradientOptions[optionIndex];
    if (!option) return;
    const colors = editableGradientColors(option.colors);
    if (colors.length <= PROMPT_TEMPLATE_GRADIENT_COLOR_MIN) return;
    patchGradientOption(optionIndex, { colors: colors.filter((_, index) => index !== colorIndex) });
  }

  return (
    <>
      <label className="template-checkbox">
        <input
          type="checkbox"
          checked={component.allowCustomColor !== false}
          onChange={(event) => onPatch({ allowCustomColor: event.target.checked })}
        />
        {t("promptTemplates.editor.allowCustomHex")}
      </label>
      <div className="template-color-settings wide">
        <div className="template-color-settings-head">
          <strong>{t("promptTemplates.editor.solidColorSwatches")} <span>{colorOptions.length}/{PROMPT_TEMPLATE_COLOR_OPTION_LIMIT}</span></strong>
          <button
            type="button"
            onClick={() => {
              if (!canAddColorOption) return;
              onPatch({ colorOptions: [...colorOptions, newColorOption()] });
            }}
            disabled={!canAddColorOption}
            title={canAddColorOption ? t("promptTemplates.editor.addColorSwatch") : t("promptTemplates.editor.maxColorSwatches", { count: PROMPT_TEMPLATE_COLOR_OPTION_LIMIT })}
          >
            <Plus size={14} />
            {t("promptTemplates.editor.addColorSwatch")}
          </button>
        </div>
        <small className="template-color-settings-tip">{t("promptTemplates.editor.colorSwatchTip")}</small>
        <div className="template-color-setting-list color-options" style={colorOptionListStyle(colorOptions.length)}>
          {colorOptions.map((option, index) => (
            <div className="template-color-setting-row" key={option.id}>
              <label className="template-color-swatch-picker" style={colorPreviewStyle(option.hex)} title={t("promptTemplates.editor.pickColor")}>
                <input
                  type="color"
                  value={normalizePromptTemplateHex(option.hex) || "#151517"}
                  aria-label={t("promptTemplates.editor.pickSwatchColor")}
                  onChange={(event) => patchColorOption(index, { hex: event.target.value })}
                />
              </label>
              <input
                aria-label={t("promptTemplates.editor.colorName")}
                placeholder={t("promptTemplates.editor.colorNamePlaceholder")}
                value={option.name}
                onChange={(event) => patchColorOption(index, { name: event.target.value })}
              />
              <input
                aria-label={t("promptTemplates.editor.colorRole")}
                placeholder={t("promptTemplates.editor.colorRolePlaceholder")}
                value={option.role}
                onChange={(event) => patchColorOption(index, { role: event.target.value })}
              />
              <input
                aria-label={t("promptTemplates.editor.colorValue")}
                placeholder="#151517"
                value={option.hex}
                onChange={(event) => patchColorOption(index, { hex: event.target.value })}
              />
              <button type="button" aria-label={t("promptTemplates.editor.deleteColorSwatch")} onClick={() => onPatch({ colorOptions: colorOptions.filter((_, optionIndex) => optionIndex !== index) })}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {colorOptions.length === 0 ? <small>{t("promptTemplates.editor.noSolidColorSwatches")}</small> : null}
        </div>
      </div>
      <div className="template-color-settings wide">
        <div className="template-color-settings-head">
          <strong>{t("promptTemplates.editor.gradientCombinations")} <span>{gradientOptions.length}/{PROMPT_TEMPLATE_GRADIENT_OPTION_LIMIT}</span></strong>
          <button
            type="button"
            onClick={() => {
              if (!canAddGradientOption) return;
              onPatch({ gradientOptions: [...gradientOptions, newGradientOption()] });
            }}
            disabled={!canAddGradientOption}
            title={canAddGradientOption ? t("promptTemplates.editor.addGradient") : t("promptTemplates.editor.maxGradients", { count: PROMPT_TEMPLATE_GRADIENT_OPTION_LIMIT })}
          >
            <Plus size={14} />
            {t("promptTemplates.editor.addGradient")}
          </button>
        </div>
        <small className="template-color-settings-tip">{t("promptTemplates.editor.gradientTip")}</small>
        <div className="template-color-setting-list gradient-options" style={gradientOptionListStyle(gradientOptions.length)}>
          {gradientOptions.map((option, index) => {
            const colors = editableGradientColors(option.colors);
            const canAddGradientColor = colors.length < PROMPT_TEMPLATE_GRADIENT_COLOR_LIMIT;
            const canRemoveGradientColor = colors.length > PROMPT_TEMPLATE_GRADIENT_COLOR_MIN;
            return (
              <div className="template-color-setting-row gradient" key={option.id}>
                <i className="template-gradient-preview" style={gradientPreviewStyle({ ...option, colors })} />
                <input
                  aria-label={t("promptTemplates.editor.gradientName")}
                  placeholder={t("promptTemplates.editor.gradientNamePlaceholder")}
                  value={option.name}
                  onChange={(event) => patchGradientOption(index, { name: event.target.value })}
                />
                <input
                  aria-label={t("promptTemplates.editor.gradientRole")}
                  placeholder={t("promptTemplates.editor.gradientRolePlaceholder")}
                  value={option.role}
                  onChange={(event) => patchGradientOption(index, { role: event.target.value })}
                />
                <button type="button" aria-label={t("promptTemplates.editor.deleteGradient")} onClick={() => onPatch({ gradientOptions: gradientOptions.filter((_, optionIndex) => optionIndex !== index) })}>
                  <Trash2 size={14} />
                </button>
                <div className="template-gradient-stop-list" aria-label={t("promptTemplates.editor.gradientStops")}>
                  {colors.map((color, colorIndex) => (
                    <div className="template-gradient-stop" key={`${option.id}-${colorIndex}`}>
                      <label className="template-color-swatch-picker template-gradient-stop-picker" style={colorPreviewStyle(color)} title={t("promptTemplates.editor.pickGradientColor")}>
                        <input
                          type="color"
                          value={normalizePromptTemplateHex(color) || PROMPT_TEMPLATE_DEFAULT_GRADIENT_COLORS[colorIndex % PROMPT_TEMPLATE_DEFAULT_GRADIENT_COLORS.length]}
                          aria-label={t("promptTemplates.editor.pickGradientColorIndex", { index: colorIndex + 1 })}
                          onChange={(event) => patchGradientColor(index, colorIndex, event.target.value)}
                        />
                      </label>
                      <input
                        aria-label={t("promptTemplates.editor.gradientColorValueIndex", { index: colorIndex + 1 })}
                        placeholder="#151517"
                        value={color}
                        onChange={(event) => patchGradientColor(index, colorIndex, event.target.value)}
                      />
                      <button
                        type="button"
                        className="template-gradient-stop-remove"
                        aria-label={t("promptTemplates.editor.deleteGradientStop")}
                        disabled={!canRemoveGradientColor}
                        title={canRemoveGradientColor ? t("promptTemplates.editor.deleteGradientStop") : t("promptTemplates.editor.minGradientColors", { count: PROMPT_TEMPLATE_GRADIENT_COLOR_MIN })}
                        onClick={() => removeGradientColor(index, colorIndex)}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="template-gradient-stop-add"
                    disabled={!canAddGradientColor}
                    title={canAddGradientColor ? t("promptTemplates.editor.addGradientStop") : t("promptTemplates.editor.maxGradientStops", { count: PROMPT_TEMPLATE_GRADIENT_COLOR_LIMIT })}
                    onClick={() => addGradientColor(index)}
                  >
                    <Plus size={12} />
                    {t("promptTemplates.editor.gradientStop")}
                    <span>{colors.length}/{PROMPT_TEMPLATE_GRADIENT_COLOR_LIMIT}</span>
                  </button>
                </div>
              </div>
            );
          })}
          {gradientOptions.length === 0 ? <small>{t("promptTemplates.editor.noGradients")}</small> : null}
        </div>
      </div>
    </>
  );
}

function defaultComponentWidth(type: PromptTemplateComponentType): PromptTemplateComponentWidth {
  if (type === "text" || type === "select") return "half";
  return "full";
}

function componentWidth(component: PromptTemplateComponent): PromptTemplateComponentWidth {
  if (component.type === "section") return "full";
  if (component.width === "half" || component.width === "full") return component.width;
  return defaultComponentWidth(component.type);
}

function componentWidthLabel(component: PromptTemplateComponent, t: Translate) {
  return componentWidth(component) === "half" ? t("promptTemplates.editor.widthShortHalf") : t("promptTemplates.editor.widthShortFull");
}

function componentLayoutClass(component: PromptTemplateComponent) {
  return componentWidth(component) === "half" ? "layout-half" : "layout-full";
}

function newComponent(type: PromptTemplateComponentType, t: Translate): PromptTemplateComponent {
  const stamp = Date.now().toString(36);
  const option = promptTemplateComponentTypeOptions(t).find((item) => item.value === type);
  return {
    id: `${type}_${stamp}`,
    type,
    label: option?.label ?? t("promptTemplates.editor.component"),
    placeholder: type === "text" || type === "textarea" ? t("promptTemplates.editor.defaultPlaceholder") : "",
    options: type === "select" ? [t("promptTemplates.editor.optionOne"), t("promptTemplates.editor.optionTwo")] : [],
    colorOptions: type === "color" ? defaultPromptTemplateColorOptions : undefined,
    gradientOptions: type === "color" ? defaultPromptTemplateGradientOptions : undefined,
    allowCustomColor: type === "color" ? true : undefined,
    slot: type === "section" ? "" : `${type}_${stamp}`,
    icon: "",
    width: defaultComponentWidth(type),
    defaultValue: "",
    required: false,
    sortOrder: Date.now()
  };
}

function emptyTemplatePayload(): PromptTemplatePayload {
  return {
    name: "我的提示词表单",
    description: "表单描述",
    category: "custom",
    icon: "Sparkles",
    optimizeStyle: "standard",
    components: [],
    rules: {
      prefix: "请根据以下信息创作一张高质量图片。",
      order: [],
      labels: {},
      joiner: "\n",
      suffix: "画面清晰，构图完整，主体明确。",
      negativePrompt: ""
    },
    output: {
      negativeEnabled: false
    }
  };
}

function payloadFromTemplate(template: PromptTemplate): PromptTemplatePayload {
  const manualNegativePrompt = String(template.rules.negativePrompt ?? "").trim();
  return {
    name: template.name,
    description: template.description,
    category: template.category,
    icon: template.icon,
    optimizeStyle: String(template.optimizeStyle ?? "").trim() || "standard",
    components: sortedPromptTemplateComponents(template.components).map((component, index) => ({
      ...component,
      sortOrder: (index + 1) * 10,
      width: componentWidth(component),
      options: component.type === "select" ? component.options ?? [] : component.options,
      colorOptions: component.type === "color" ? component.colorOptions ?? defaultPromptTemplateColorOptions : component.colorOptions,
      gradientOptions: component.type === "color" ? component.gradientOptions ?? defaultPromptTemplateGradientOptions : component.gradientOptions,
      allowCustomColor: component.type === "color" ? component.allowCustomColor !== false : component.allowCustomColor
    })),
    rules: template.rules,
    output: {
      ...template.output,
      negativeEnabled: manualNegativePrompt ? false : Boolean(template.output.negativeEnabled)
    }
  };
}

function withComponentOrder(components: PromptTemplateComponent[]) {
  return components.map((component, index) => ({ ...component, sortOrder: (index + 1) * 10 }));
}

function syncRules(template: PromptTemplate): PromptTemplate {
  const components = withComponentOrder(template.components).map((component) => ({
    ...component,
    slot: component.type === "section" ? "" : component.slot || component.id
  }));
  const slots = components.map((component) => component.slot).filter((slot): slot is string => Boolean(slot));
  const labels = Object.fromEntries(
    components
      .filter((component) => component.slot)
      .map((component) => [component.slot as string, component.label || component.slot])
  );
  return {
    ...template,
    components,
    rules: {
      ...template.rules,
      order: slots,
      labels
    },
    output: {
      ...template.output,
      negativeEnabled: String(template.rules.negativePrompt ?? "").trim() ? false : Boolean(template.output.negativeEnabled)
    }
  };
}

function promptTemplateDraftSignature(template: PromptTemplate | null | undefined) {
  if (!template) return "";
  return JSON.stringify(payloadFromTemplate(syncRules(template)));
}

function sharedOwnerLabel(template: PromptTemplate, t: Translate) {
  if (template.visibility !== "shared" || template.canEdit) return "";
  return template.ownerName.trim() || t("common.shared");
}

function formatTemplateDate(value: string, locale: LocaleCode) {
  if (!value) return "";
  return new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatRelativeTemplateTime(value: string, t: Translate) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const diffMs = Date.now() - time;
  if (diffMs < 60 * 1000) return t("promptTemplates.time.justNow");
  const minutes = Math.floor(diffMs / (60 * 1000));
  if (minutes < 60) return t("promptTemplates.time.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("promptTemplates.time.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t("promptTemplates.time.daysAgo", { count: days });
  const months = Math.floor(days / 30);
  if (months < 12) return t("promptTemplates.time.monthsAgo", { count: months });
  const years = Math.floor(months / 12);
  return t("promptTemplates.time.yearsAgo", { count: years });
}

function formatPromptTemplateExportTime(value: number | null | undefined, locale: LocaleCode) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function promptTemplateExportStatusLabel(download: PromptTemplateExportDownload, t: Translate) {
  if (download.variant !== "ai") return t("promptTemplates.download.noAiShort");
  if (download.status === "active") return t("promptTemplates.download.statusActive");
  if (download.status === "expired") return t("promptTemplates.download.statusExpired");
  if (download.status === "revoked") return t("promptTemplates.download.statusRevoked");
  return t("promptTemplates.download.statusDownloaded");
}

function promptTemplateExportStatusText(download: PromptTemplateExportDownload, t: Translate, locale: LocaleCode) {
  if (download.variant !== "ai") return t("promptTemplates.download.baseVersion");
  if (download.status === "active") {
    return download.expiresAt
      ? t("promptTemplates.download.validUntil", { time: formatPromptTemplateExportTime(download.expiresAt, locale) })
      : t("promptTemplates.download.permanentValid");
  }
  if (download.status === "expired") return t("promptTemplates.download.expiredAt", { time: formatPromptTemplateExportTime(download.expiresAt, locale) });
  if (download.status === "revoked") return t("promptTemplates.download.revokedAt", { time: formatPromptTemplateExportTime(download.revokedAt, locale) });
  return t("promptTemplates.download.statusDownloaded");
}

function normalizeScope(value: string | null): TemplateScope {
  if (value === "all" || value === "mine" || value === "shared") return value;
  return "all";
}

function templateWorkbenchSearch(scope: TemplateScope, keyword: string, templateId: string) {
  const params = new URLSearchParams();
  params.set("scope", scope);
  if (keyword.trim()) params.set("keyword", keyword.trim());
  if (templateId) params.set("template", templateId);
  const value = params.toString();
  return value ? `?${value}` : "";
}

function storedPromptResultWidth() {
  return PROMPT_RESULT_DEFAULT_WIDTH;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function storedPromptEditorPropertyWidth() {
  if (typeof window === "undefined") return PROMPT_EDITOR_PROPERTY_DEFAULT_WIDTH;
  const rawValue = Number(window.localStorage.getItem(PROMPT_EDITOR_PROPERTY_WIDTH_STORAGE_KEY));
  if (!Number.isFinite(rawValue)) return PROMPT_EDITOR_PROPERTY_DEFAULT_WIDTH;
  return clampNumber(rawValue, PROMPT_EDITOR_PROPERTY_MIN_WIDTH, PROMPT_EDITOR_PROPERTY_MAX_WIDTH);
}

export function PromptTemplatesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();
  const { t, resolvedLanguage } = useI18n();
  const setDraftPrompt = useWorkbench((state) => state.setDraftPrompt);
  const resetNewChatComposer = useWorkbench((state) => state.resetNewChatComposer);
  const setSelectedAssets = useWorkbench((state) => state.setSelectedAssets);
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const [scope, setScope] = useState<TemplateScope>(() => normalizeScope(searchParams.get("scope")));
  const [keyword, setKeyword] = useState(() => searchParams.get("keyword") ?? "");
  const [selectedId, setSelectedId] = useState(() => searchParams.get("template") ?? "");
  const [workingTemplate, setWorkingTemplate] = useState<PromptTemplate | null>(null);
  const [formValues, setFormValues] = useState<PromptTemplateFormValues>({});
  const [baseDisplayLanguage, setBaseDisplayLanguage] = useState<PromptDisplayLanguage>("zh");
  const [aiDisplayLanguage, setAiDisplayLanguage] = useState<PromptDisplayLanguage>("zh");
  const [optimizeStyle, setOptimizeStyle] = useState<PromptTemplateOptimizeStyle>("standard");
  const [showPromptDiff, setShowPromptDiff] = useState(true);
  const [activeResult, setActiveResult] = useState<PromptTemplateResult | null>(null);
  const [optimizedSignature, setOptimizedSignature] = useState("");
  const [optimizedStyle, setOptimizedStyle] = useState<PromptTemplateOptimizeStyle>("standard");
  const [typingResultId, setTypingResultId] = useState("");
  const [typedOptimizedPrompt, setTypedOptimizedPrompt] = useState("");
  const [streamingOptimizedPromptZh, setStreamingOptimizedPromptZh] = useState("");
  const [streamingOptimizedPromptEn, setStreamingOptimizedPromptEn] = useState("");
  const [streamingBasePromptEn, setStreamingBasePromptEn] = useState("");
  const [optimizeCustomInstruction, setOptimizeCustomInstruction] = useState("");
  const [promptDialog, setPromptDialog] = useState<PromptDialogState>(null);
  const [deleteTarget, setDeleteTarget] = useState<PromptTemplate | null>(null);
  const [downloadDialogOpen, setDownloadDialogOpen] = useState(false);
  const [downloadAuthDays, setDownloadAuthDays] = useState("");
  const [revokeDownloadLinksOpen, setRevokeDownloadLinksOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [usingPromptTarget, setUsingPromptTarget] = useState<UsePromptTarget | "">("");
  const [resultPanelWidth, setResultPanelWidth] = useState(storedPromptResultWidth);
  const [resultBlockSplit, setResultBlockSplit] = useState(0.5);
  const [resizingResult, setResizingResult] = useState(false);
  const [resizingResultHeight, setResizingResultHeight] = useState(false);
  const pageRef = useRef<HTMLDivElement | null>(null);
  const resultBlocksRef = useRef<HTMLDivElement | null>(null);
  const skipNextFormDraftSaveRef = useRef("");
  const formDraftTouchedRef = useRef(false);
  const formDraftSaveTimerRef = useRef<number | null>(null);
  const promptOptimizeCustomInstructionSaveTimerRef = useRef<number | null>(null);
  const autoBaseTranslationKeyRef = useRef("");
  const autoSwitchAiToEnglishRef = useRef(false);

  const templatesQuery = useQuery({
    queryKey: ["prompt-templates", scope, keyword],
    queryFn: () => api.promptTemplates({ scope, keyword })
  });
  const templates = templatesQuery.data?.templates ?? [];
  const templateCounts = templatesQuery.data?.counts ?? { all: 0, mine: 0, shared: 0 };
  const selectedTemplate = templates.find((template) => template.id === selectedId) ?? templates[0] ?? null;
  const promptOptimizeStyleGroups = useMemo(
    () => sanitizePromptOptimizeStyleGroups(me.data?.user?.preferences?.promptOptimizeStyleGroups),
    [me.data?.user?.preferences?.promptOptimizeStyleGroups]
  );
  const scopeOptions = useMemo(() => promptTemplateScopeOptions(t), [t]);
  const savedPromptOptimizeCustomInstruction = me.data?.user?.preferences?.promptOptimizeCustomInstruction ?? "";
  const savePromptOptimizeCustomInstruction = useMutation({
    mutationFn: (value: string) => api.saveUserPreferences({ promptOptimizeCustomInstruction: value }),
    onSuccess: (data) => {
      queryClient.setQueryData(["me"], { user: data.user });
    }
  });

  function updateOptimizeCustomInstruction(value: string) {
    setOptimizeCustomInstruction(value);
    if (promptOptimizeCustomInstructionSaveTimerRef.current) {
      window.clearTimeout(promptOptimizeCustomInstructionSaveTimerRef.current);
    }
    promptOptimizeCustomInstructionSaveTimerRef.current = window.setTimeout(() => {
      promptOptimizeCustomInstructionSaveTimerRef.current = null;
      savePromptOptimizeCustomInstruction.mutate(value);
    }, 500);
  }

  const formDraftQuery = useQuery({
    queryKey: ["prompt-template-form-draft", selectedTemplate?.id],
    queryFn: () => api.promptTemplateFormDraft(selectedTemplate!.id),
    enabled: Boolean(selectedTemplate)
  });

  useEffect(() => {
    setOptimizeStyle(normalizePromptOptimizeStyle(selectedTemplate?.optimizeStyle ?? "", promptOptimizeStyleGroups));
  }, [promptOptimizeStyleGroups, selectedTemplate?.id, selectedTemplate?.optimizeStyle]);

  useEffect(() => {
    setOptimizeCustomInstruction(savedPromptOptimizeCustomInstruction);
  }, [savedPromptOptimizeCustomInstruction]);

  const historyQuery = useInfiniteQuery({
    queryKey: ["prompt-template-results", selectedTemplate?.id],
    queryFn: ({ pageParam }) => api.promptTemplateResults(selectedTemplate!.id, {
      limit: PROMPT_TEMPLATE_HISTORY_PAGE_SIZE,
      offset: Number(pageParam)
    }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => (
      lastPage.pageInfo.hasMore ? lastPage.pageInfo.offset + lastPage.results.length : undefined
    ),
    enabled: Boolean(selectedTemplate)
  });
  const historyResults = useMemo(
    () => historyQuery.data?.pages.flatMap((page) => page.results) ?? [],
    [historyQuery.data]
  );

  const template = workingTemplate ?? selectedTemplate;
  const basePrompt = useMemo(() => (template ? buildBasePrompt(template, formValues, "zh") : ""), [formValues, template]);
  const templateManualNegativePrompt = manualNegativePromptFromTemplate(template);
  const signature = template ? promptTemplateSignature(template.id, "zh", formValues, basePrompt) : "";
  const baseTranslationQueryKey = [
    "prompt-template-base-translation",
    template?.id,
    signature,
    basePrompt,
    templateManualNegativePrompt
  ];

  const baseTranslationQuery = useQuery({
    queryKey: baseTranslationQueryKey,
    queryFn: () => api.promptTemplateBaseTranslation(template!.id, signature),
    enabled: Boolean(template && signature && baseDisplayLanguage === "en")
  });

  const exportDownloadsQuery = useInfiniteQuery({
    queryKey: ["prompt-template-export-downloads", template?.id],
    queryFn: ({ pageParam }) => api.promptTemplateExportDownloads(template!.id, {
      limit: PROMPT_TEMPLATE_EXPORT_DOWNLOAD_PAGE_SIZE,
      offset: Number(pageParam)
    }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => (
      lastPage.pageInfo.hasMore ? lastPage.pageInfo.offset + lastPage.downloads.length : undefined
    ),
    enabled: Boolean(template && downloadDialogOpen)
  });

  const invalidateTemplates = () => queryClient.invalidateQueries({ queryKey: ["prompt-templates"] });

  function handleFormValuesChange(nextValues: PromptTemplateFormValues) {
    formDraftTouchedRef.current = true;
    setFormValues(nextValues);
  }

  function patchTemplateVisibility(templateId: string, visibility: PromptTemplateVisibility) {
    setWorkingTemplate((current) => current?.id === templateId ? { ...current, visibility } : current);
    queryClient.setQueriesData({ queryKey: ["prompt-templates"] }, (current: unknown) => {
      if (!current || typeof current !== "object") return current;
      const data = current as { templates?: unknown; counts?: Record<TemplateScope, number> };
      if (!Array.isArray(data.templates)) return current;
      const templates = data.templates as PromptTemplate[];
      const previous = templates.find((item) => item.id === templateId);
      const counts = previous && previous.visibility !== visibility && data.counts
        ? {
            ...data.counts,
            shared: Math.max(0, (data.counts.shared ?? 0) + (visibility === "shared" ? 1 : -1))
          }
        : data.counts;
      return {
        ...data,
        counts,
        templates: templates.map((item) => item.id === templateId ? { ...item, visibility } : item)
      };
    });
  }

  const createTemplate = useMutation({
    mutationFn: () => api.createPromptTemplate(emptyTemplatePayload()),
    onSuccess: (data) => {
      invalidateTemplates();
      if (data.template) {
        const params = new URLSearchParams();
        params.set("scope", "mine");
        navigate(`/prompt-templates/${encodeURIComponent(data.template.id)}/edit?${params.toString()}`);
        showToast(t("promptTemplates.toast.created"));
      }
    },
    onError: (error) => showToast(error instanceof Error ? error.message : t("promptTemplates.toast.createFailed"), "error")
  });
  const saveTemplate = useMutation({
    mutationFn: (template: PromptTemplate) => api.updatePromptTemplate(template.id, payloadFromTemplate(syncRules(template))),
    onSuccess: (data) => {
      invalidateTemplates();
      if (data.template) {
        setWorkingTemplate(data.template);
        setSelectedId(data.template.id);
      }
      showToast(t("promptTemplates.toast.saved"));
    },
    onError: (error) => showToast(error instanceof Error ? error.message : t("promptTemplates.toast.saveFailed"), "error")
  });
  const restoreDefaultTemplates = useMutation({
    mutationFn: () => api.restoreDefaultPromptTemplates(),
    onSuccess: (data) => {
      setKeyword("");
      setScope("all");
      invalidateTemplates();
      if (data.templates[0]) setSelectedId(data.templates[0].id);
      showToast(data.created > 0 ? t("promptTemplates.toast.defaultsInitialized") : t("promptTemplates.toast.defaultsAlreadyExist"));
    },
    onError: (error) => showToast(error instanceof Error ? error.message : t("promptTemplates.toast.initializeFailed"), "error")
  });
  const copyTemplate = useMutation({
    mutationFn: (id: string) => api.copyPromptTemplate(id),
    onSuccess: (data) => {
      invalidateTemplates();
      if (data.template) {
        setScope("mine");
        setSelectedId(data.template.id);
        navigate(`/prompt-templates/${encodeURIComponent(data.template.id)}/edit${templateWorkbenchSearch("mine", "", data.template.id)}`);
      }
      showToast(t("promptTemplates.toast.copiedToMine"));
    },
    onError: (error) => showToast(error instanceof Error ? error.message : t("promptTemplates.toast.copyFailed"), "error")
  });
  const shareTemplate = useMutation({
    mutationFn: (template: PromptTemplate) => api.sharePromptTemplate(template.id, template.visibility !== "shared"),
    onMutate: (template) => {
      const nextVisibility: PromptTemplateVisibility = template.visibility === "shared" ? "private" : "shared";
      patchTemplateVisibility(template.id, nextVisibility);
      return { previousVisibility: template.visibility };
    },
    onSuccess: (data) => {
      invalidateTemplates();
      if (data.template) {
        setSelectedId(data.template.id);
        setWorkingTemplate(data.template);
      }
      showToast(data.template?.visibility === "shared" ? t("promptTemplates.toast.shared") : t("promptTemplates.toast.unshared"));
    },
    onError: (error, template, context) => {
      if (context?.previousVisibility) patchTemplateVisibility(template.id, context.previousVisibility);
      showToast(error instanceof Error ? error.message : t("promptTemplates.toast.shareFailed"), "error");
    }
  });
  const removeTemplate = useMutation({
    mutationFn: (id: string) => api.deletePromptTemplate(id),
    onSuccess: () => {
      setDeleteTarget(null);
      setSelectedId("");
      invalidateTemplates();
      showToast(t("promptTemplates.toast.deleted"));
    },
    onError: (error) => showToast(error instanceof Error ? error.message : t("promptTemplates.toast.deleteFailed"), "error")
  });
  const revokeExportDownloads = useMutation({
    mutationFn: (templateId: string) => api.revokePromptTemplateExportDownloads(templateId),
    onSuccess: (data, templateId) => {
      setRevokeDownloadLinksOpen(false);
      queryClient.invalidateQueries({ queryKey: ["prompt-template-export-downloads", templateId] });
      showToast(data.revokedCount > 0
        ? t("promptTemplates.toast.revokedLinks", { count: data.revokedCount })
        : t("promptTemplates.toast.revokedNoActiveLinks"));
    },
    onError: (error) => showToast(error instanceof Error ? error.message : t("promptTemplates.toast.revokeFailed"), "error")
  });
  const saveOptimizeStyle = useMutation({
    mutationFn: ({ templateId, nextOptimizeStyle }: { templateId: string; nextOptimizeStyle: PromptTemplateOptimizeStyle }) =>
      api.updatePromptTemplateOptimizeStyle(templateId, nextOptimizeStyle),
    onSuccess: (data, variables) => {
      const savedStyle = normalizePromptOptimizeStyle(data.template?.optimizeStyle ?? variables.nextOptimizeStyle, promptOptimizeStyleGroups);
      setOptimizeStyle(savedStyle);
      queryClient.setQueriesData({ queryKey: ["prompt-templates"] }, (current: unknown) => {
        if (!current || typeof current !== "object") return current;
        const record = current as { templates?: PromptTemplate[] };
        return {
          ...(current as Record<string, unknown>),
          templates: (record.templates ?? []).map((item) => (
            item.id === variables.templateId ? { ...item, optimizeStyle: savedStyle, updatedAt: data.template?.updatedAt ?? item.updatedAt } : item
          ))
        };
      });
    },
    onError: (error) => showToast(error instanceof Error ? error.message : t("promptTemplates.toast.optimizeStyleSaveFailed"), "error")
  });
  const optimize = useMutation({
    mutationFn: (payload: {
      templateId: string;
      signature: string;
      basePrompt: string;
      optimizeStyle: PromptTemplateOptimizeStyle;
      customInstruction?: string;
    }) =>
      api.optimizePromptTemplateStream(
        payload.templateId,
        {
          language: "zh",
          formValues,
          basePrompt: payload.basePrompt,
          optimizeStyle: payload.optimizeStyle,
          customInstruction: payload.customInstruction
        },
        {
          onDelta: (chunk) => {
            if (chunk.language === "en") {
              autoSwitchAiToEnglishRef.current = true;
              setPromptDisplayLanguage("en");
              setStreamingOptimizedPromptEn((text) => chunk.reset ? chunk.delta : `${text}${chunk.delta}`);
            } else {
              setStreamingOptimizedPromptZh((text) => chunk.reset ? chunk.delta : `${text}${chunk.delta}`);
            }
          }
        }
      ),
    onMutate: () => {
      autoSwitchAiToEnglishRef.current = false;
      setTypingResultId("");
      setTypedOptimizedPrompt("");
      setStreamingOptimizedPromptZh("");
      setStreamingOptimizedPromptEn("");
      setBaseDisplayLanguage("zh");
      setAiDisplayLanguage("zh");
    },
    onSuccess: (data, variables) => {
      if (data.result) {
        const shouldShowEnglish = Boolean(optimizedPromptForLanguage(data.result, "en", true).trim());
        autoSwitchAiToEnglishRef.current = shouldShowEnglish;
        setActiveResult(data.result);
        setOptimizedSignature(variables.signature);
        setOptimizedStyle(variables.optimizeStyle);
        setTypingResultId(data.streamed ? "" : data.result.id);
        setTypedOptimizedPrompt("");
        setStreamingOptimizedPromptZh("");
        setStreamingOptimizedPromptEn("");
        if (shouldShowEnglish) setPromptDisplayLanguage("en");
        queryClient.invalidateQueries({ queryKey: ["prompt-template-results", variables.templateId] });
        showToast(t("promptTemplates.toast.aiOptimizeDone"));
      } else {
        showToast(t("promptTemplates.toast.aiOptimizeNoResult"), "info");
      }
    },
    onError: (error) => {
      setStreamingOptimizedPromptZh("");
      setStreamingOptimizedPromptEn("");
      showToast(error instanceof Error ? error.message : t("promptTemplates.toast.aiOptimizeFailed"), "error");
    }
  });
  const translateBasePrompt = useMutation({
    mutationFn: (payload: { templateId: string; signature: string; prompt: string; negativePrompt: string }) =>
      api.translatePromptTemplateStream(
        payload.templateId,
        { prompt: payload.prompt, negativePrompt: payload.negativePrompt, signature: payload.signature },
        { onDelta: (chunk) => setStreamingBasePromptEn((text) => chunk.reset ? chunk.delta : `${text}${chunk.delta}`) }
      ),
    onMutate: () => {
      setStreamingBasePromptEn("");
    },
    onSuccess: async (data, variables) => {
      const queryKey = [
        "prompt-template-base-translation",
        variables.templateId,
        variables.signature,
        variables.prompt,
        variables.negativePrompt
      ];
      if (data.translation) {
        queryClient.setQueryData(queryKey, { translation: data.translation, staleTranslation: null });
      } else {
        await queryClient.invalidateQueries({ queryKey });
        await queryClient.refetchQueries({ queryKey, type: "active" });
      }
      setStreamingBasePromptEn("");
      showToast(t("promptTemplates.toast.baseTranslated"));
    },
    onError: (error) => {
      setStreamingBasePromptEn("");
      showToast(error instanceof Error ? error.message : t("promptTemplates.toast.baseTranslateFailed"), "error");
    }
  });
  useEffect(() => {
    if (!selectedTemplate) {
      setWorkingTemplate(null);
      setFormValues({});
      formDraftTouchedRef.current = false;
      return;
    }
    if (selectedTemplate.id !== selectedId) setSelectedId(selectedTemplate.id);
    skipNextFormDraftSaveRef.current = selectedTemplate.id;
    formDraftTouchedRef.current = false;
    setWorkingTemplate(selectedTemplate);
    setFormValues(initialPromptTemplateFormValues(selectedTemplate));
    setBaseDisplayLanguage("zh");
    setActiveResult(null);
    setOptimizedSignature("");
    setTypingResultId("");
    setTypedOptimizedPrompt("");
    setStreamingOptimizedPromptZh("");
    setStreamingOptimizedPromptEn("");
    setStreamingBasePromptEn("");
    setAiDisplayLanguage("zh");
  }, [selectedTemplate?.id]);

  useEffect(() => {
    if (!selectedTemplate || !formDraftQuery.isSuccess) return;
    const draftValues = formDraftQuery.data.draft?.formValues;
    if (!draftValues || formDraftTouchedRef.current) return;
    skipNextFormDraftSaveRef.current = selectedTemplate.id;
    setFormValues(mergePromptTemplateFormValues(selectedTemplate, draftValues));
  }, [formDraftQuery.dataUpdatedAt, formDraftQuery.isSuccess, selectedTemplate?.id]);

  useEffect(() => {
    setSearchParams(new URLSearchParams(templateWorkbenchSearch(scope, keyword, selectedId).slice(1)), { replace: true });
  }, [keyword, scope, selectedId, setSearchParams]);

  useEffect(() => {
    if (!workingTemplate) return;
    setFormValues((current) => mergePromptTemplateFormValues(workingTemplate, current));
  }, [workingTemplate?.components]);

  const latestHistoryResult = historyResults[0] ?? null;

  useEffect(() => {
    if (!template || !latestHistoryResult || activeResult || optimize.isPending) return;
    setActiveResult(latestHistoryResult);
    setOptimizedSignature(
      promptTemplateSignature(template.id, "zh", latestHistoryResult.formSnapshot as PromptTemplateFormValues, latestHistoryResult.basePrompt)
    );
    setOptimizedStyle(optimizeStyle);
  }, [activeResult, latestHistoryResult?.id, optimize.isPending, optimizeStyle, template?.id]);

  useEffect(() => {
    setBaseDisplayLanguage("zh");
    if (autoSwitchAiToEnglishRef.current) {
      autoSwitchAiToEnglishRef.current = false;
      setBaseDisplayLanguage("en");
      setAiDisplayLanguage("en");
    } else {
      setAiDisplayLanguage("zh");
    }
  }, [activeResult?.id]);

  function setPromptDisplayLanguage(language: PromptDisplayLanguage) {
    setBaseDisplayLanguage(language);
    setAiDisplayLanguage(language);
  }

  const activeDisplayLanguage = aiDisplayLanguage;
  const canSwitchAiPromptLanguage = Boolean(activeResult || optimize.isPending);
  const activeOptimizedPrompt = optimizedPromptForLanguage(activeResult, activeDisplayLanguage, true);
  const activeNegativePrompt = negativePromptForLanguage(activeResult, activeDisplayLanguage, true);
  const templateNegativeFallback = activeDisplayLanguage === "zh" ? templateManualNegativePrompt : "";
  const displayNegativePrompt = activeNegativePrompt || templateNegativeFallback;
  const activePromptWithNegative = promptWithNegative(activeOptimizedPrompt, displayNegativePrompt, activeDisplayLanguage, t);
  const aiPromptNegativeContent = displayNegativePrompt || (template?.output.negativeEnabled ? t("promptTemplates.aiNegativePending") : "");
  const templateHasNegativeOutput = Boolean(displayNegativePrompt || templateManualNegativePrompt || template?.output.negativeEnabled);
  const streamingPrompt = optimize.isPending
    ? (activeDisplayLanguage === "en" ? streamingOptimizedPromptEn : streamingOptimizedPromptZh)
    : "";
  const baseTranslation = baseTranslationQuery.data?.translation ?? null;
  const baseTranslationMatchesPrompt = Boolean(
    baseTranslation && baseTranslation.basePrompt.trim() === basePrompt.trim()
  );
  const baseTranslationMatchesNegative = Boolean(
    baseTranslation && baseTranslation.negativePrompt.trim() === templateManualNegativePrompt.trim()
  );
  const baseTranslationCoversPrompt = Boolean(
    baseTranslationMatchesPrompt && translatedPromptCoversSource(basePrompt, baseTranslation?.basePromptEn ?? "")
  );
  const savedBasePromptEn = baseTranslationCoversPrompt ? baseTranslation?.basePromptEn ?? "" : "";
  const savedBaseNegativePromptEn = baseTranslationMatchesNegative && baseTranslationCoversPrompt ? baseTranslation?.negativePromptEn ?? "" : "";
  const baseNegativePromptNeedsTranslation = Boolean(templateManualNegativePrompt.trim()) && !savedBaseNegativePromptEn;
  const basePromptTranslating = baseDisplayLanguage === "en" && translateBasePrompt.isPending;
  const baseTranslationLoading = baseDisplayLanguage === "en"
    && baseTranslationQuery.isFetching
    && (!savedBasePromptEn || baseNegativePromptNeedsTranslation);
  const basePromptNeedsTranslation = baseDisplayLanguage === "en"
    && !baseTranslationLoading
    && !translateBasePrompt.isPending
    && (!savedBasePromptEn || baseNegativePromptNeedsTranslation);
  const basePromptContent = baseDisplayLanguage === "en"
    ? (streamingBasePromptEn || (basePromptTranslating ? "" : savedBasePromptEn) || "")
    : basePrompt;
  const basePromptLoading = baseTranslationLoading || (basePromptTranslating && !streamingBasePromptEn);
  const basePromptActionText = basePromptContent || (baseDisplayLanguage === "zh" ? basePrompt : "");
  const baseNegativePrompt = baseDisplayLanguage === "zh" ? templateManualNegativePrompt : (basePromptTranslating ? "" : savedBaseNegativePromptEn);
  const basePromptWithNegative = promptWithNegative(basePromptActionText, baseNegativePrompt, baseDisplayLanguage, t);
  const optimizeStyleOption = promptOptimizeStyleOption(optimizeStyle, promptOptimizeStyleGroups);
  const optimizeActionLabel = optimize.isPending ? t("promptTemplates.actions.optimizing") : activeResult ? t("promptTemplates.actions.reoptimize") : t("promptTemplates.actions.aiOptimize");
  const baseTranslateActionLabel = translateBasePrompt.isPending
    ? t("promptTemplates.actions.translating")
    : baseDisplayLanguage === "en"
      ? t("promptTemplates.actions.retranslate")
      : savedBasePromptEn && !baseNegativePromptNeedsTranslation
        ? t("promptTemplates.actions.viewEnglish")
        : t("promptTemplates.actions.translateEnglish");

  function requestBasePromptTranslation() {
    if (!template || !basePrompt.trim() || translateBasePrompt.isPending) return;
    setPromptDisplayLanguage("en");
    if (baseDisplayLanguage === "en" || !savedBasePromptEn || baseNegativePromptNeedsTranslation) {
      translateBasePrompt.mutate({ templateId: template.id, signature, prompt: basePrompt, negativePrompt: templateManualNegativePrompt });
    }
  }

  useEffect(() => {
    if (baseDisplayLanguage !== "en") {
      autoBaseTranslationKeyRef.current = "";
      return;
    }
    if (!template || optimize.isPending || !basePromptNeedsTranslation || !basePrompt.trim()) return;
    const autoKey = `${template.id}:${signature}:${basePrompt}:${templateManualNegativePrompt}`;
    if (autoBaseTranslationKeyRef.current === autoKey) return;
    autoBaseTranslationKeyRef.current = autoKey;
    translateBasePrompt.mutate({ templateId: template.id, signature, prompt: basePrompt, negativePrompt: templateManualNegativePrompt });
  }, [baseDisplayLanguage, basePrompt, basePromptNeedsTranslation, optimize.isPending, signature, template?.id, templateManualNegativePrompt]);

  useEffect(() => {
    if (!activeResult || typingResultId !== activeResult.id) return;
    const characters = Array.from(activeOptimizedPrompt);
    if (characters.length === 0) {
      setTypingResultId("");
      setTypedOptimizedPrompt("");
      return;
    }
    let index = 0;
    const timer = window.setInterval(() => {
      index = Math.min(characters.length, index + 3);
      setTypedOptimizedPrompt(characters.slice(0, index).join(""));
      if (index >= characters.length) {
        window.clearInterval(timer);
        setTypingResultId("");
      }
    }, 18);
    return () => window.clearInterval(timer);
  }, [activeOptimizedPrompt, activeResult?.id, typingResultId]);

  const resultStale = Boolean(activeResult && optimizedSignature && (optimizedSignature !== signature || optimizedStyle !== optimizeStyle));
  const displayPrompt = streamingPrompt || (activeResult ? activePromptWithNegative : basePromptWithNegative);
  const finalPromptContent = streamingPrompt
    || (typingResultId && activeResult ? typedOptimizedPrompt : activeOptimizedPrompt)
    || (canSwitchAiPromptLanguage && activeResult ? (activeDisplayLanguage === "en" ? t("promptTemplates.result.englishNeedsReoptimize") : t("promptTemplates.result.chineseNeedsReoptimize")) : "")
    || t("promptTemplates.result.aiPlaceholder");
  const aiPromptDiffBase = activeDisplayLanguage === "en"
    ? (activeResult?.basePromptEn || savedBasePromptEn || (baseDisplayLanguage === "en" ? basePromptContent : ""))
    : basePrompt;
  const aiPromptDiffEnabled = showPromptDiff
    && Boolean(aiPromptDiffBase.trim())
    && Boolean((streamingPrompt || typedOptimizedPrompt || activeOptimizedPrompt).trim());
  const basePromptBadge = (
    <>
      <div className="prompt-language-switch" role="tablist" aria-label={t("promptTemplates.result.baseLanguage")}>
        <button type="button" className={baseDisplayLanguage === "zh" ? "active" : ""} onClick={() => setPromptDisplayLanguage("zh")}>
          {t("promptTemplates.language.zh")}
        </button>
        <button type="button" className={baseDisplayLanguage === "en" ? "active" : ""} onClick={() => setPromptDisplayLanguage("en")}>
          EN
        </button>
      </div>
      {basePromptNeedsTranslation ? <strong className="stale-badge">{t("promptTemplates.status.needsRetranslate")}</strong> : null}
    </>
  );
  const aiPromptBadge = canSwitchAiPromptLanguage || activeResult ? (
    <>
      <div className="prompt-language-switch" role="tablist" aria-label={t("promptTemplates.result.aiLanguage")}>
        <button type="button" className={activeDisplayLanguage === "zh" ? "active" : ""} onClick={() => setPromptDisplayLanguage("zh")}>
          {t("promptTemplates.language.zh")}
        </button>
        <button type="button" className={activeDisplayLanguage === "en" ? "active" : ""} onClick={() => setPromptDisplayLanguage("en")}>
          EN
        </button>
      </div>
      <button
        type="button"
        className={cx("prompt-diff-switch", showPromptDiff && "active")}
        aria-pressed={showPromptDiff}
        onClick={() => setShowPromptDiff((current) => !current)}
        title={showPromptDiff ? t("promptTemplates.actions.hideDiff") : t("promptTemplates.actions.showDiff")}
      >
        <span aria-hidden="true" />
        {t("promptTemplates.actions.showDiff")}
      </button>
      {optimize.isPending ? <strong className="fresh-badge">{activeDisplayLanguage === "en" ? t("promptTemplates.actions.translating") : t("promptTemplates.actions.optimizing")}</strong> : null}
      {activeResult && !optimize.isPending ? (resultStale ? <strong className="stale-badge">{t("promptTemplates.status.needsReoptimize")}</strong> : <strong className="fresh-badge">{t("promptTemplates.status.optimized")}</strong>) : null}
    </>
  ) : null;
  const exportDownloads = useMemo(
    () => exportDownloadsQuery.data?.pages.flatMap((page) => page.downloads) ?? [],
    [exportDownloadsQuery.data]
  );
  const exportDownloadCounts = exportDownloadsQuery.data?.pages[0]?.counts ?? {};
  const activeAiExportDownloads = Number(exportDownloadCounts.active ?? 0) || exportDownloads.filter((download) => download.variant === "ai" && download.status === "active").length;

  useEffect(() => {
    if (!template) return;
    if (skipNextFormDraftSaveRef.current === template.id) {
      skipNextFormDraftSaveRef.current = "";
      return;
    }
    if (formDraftSaveTimerRef.current !== null) {
      window.clearTimeout(formDraftSaveTimerRef.current);
      formDraftSaveTimerRef.current = null;
    }
    const hasPersistedDraft = Boolean(formDraftQuery.data?.draft);
    const shouldPersistDraft = formDraftTouchedRef.current || hasPersistedDraft;
    if (!shouldPersistDraft) return;
    const storageValues = promptTemplateFormValuesForStorage(formValues);
    if (!formDraftQuery.isSuccess && !formDraftQuery.isError) return;
    const templateId = template.id;
    formDraftSaveTimerRef.current = window.setTimeout(() => {
      formDraftSaveTimerRef.current = null;
      api.savePromptTemplateFormDraft(templateId, storageValues).catch((error) => {
        console.warn("Prompt form draft save failed", error);
      });
    }, 600);
    return () => {
      if (formDraftSaveTimerRef.current !== null) {
        window.clearTimeout(formDraftSaveTimerRef.current);
        formDraftSaveTimerRef.current = null;
      }
    };
  }, [formDraftQuery.dataUpdatedAt, formDraftQuery.isError, formDraftQuery.isSuccess, formValues, template?.id]);

  async function copyPrompt(text: string) {
    const ok = await copyTextToClipboard(text);
    showToast(ok ? t("promptTemplates.toast.promptCopied") : t("promptTemplates.toast.copyFailed"), ok ? "success" : "error");
  }

  function selectOptimizeStyle(value: string) {
    const nextStyle = normalizePromptOptimizeStyle(value, promptOptimizeStyleGroups);
    const shouldAutoOptimize = nextStyle !== optimizeStyle
      && Boolean(template?.id)
      && Boolean(basePrompt.trim())
      && !optimize.isPending
      && !usingPromptTarget;
    setOptimizeStyle(nextStyle);
    if (template?.canEdit) {
      saveOptimizeStyle.mutate({ templateId: template.id, nextOptimizeStyle: nextStyle });
    }
    if (shouldAutoOptimize && template) {
      optimize.mutate({ templateId: template.id, signature, basePrompt, optimizeStyle: nextStyle });
    }
  }

  async function uploadPromptTemplateMaterials(files: PromptTemplateImageFile[]) {
    const assets: AssetItem[] = [];
    let failedCount = 0;
    for (const [index, material] of files.entries()) {
      try {
        const asset = await promptTemplateMaterialToAsset(material, index);
        assets.push(asset);
      } catch {
        failedCount += 1;
      }
    }
    if (assets.length > 0) queryClient.invalidateQueries({ queryKey: ["assets"] });
    return { assets, failedCount };
  }

  async function sendPromptToChat(promptText: string, target: UsePromptTarget) {
    const prompt = promptText.trim();
    if (!prompt || usingPromptTarget) return;
    setUsingPromptTarget(target);
    const materials = promptTemplateMaterialFiles(template, formValues);
    const { assets, failedCount } = await uploadPromptTemplateMaterials(materials);
    resetNewChatComposer();
    if (assets.length > 0) setSelectedAssets(assets);
    setDraftPrompt(prompt, null);
    setUsingPromptTarget("");
    navigate("/");
    if (failedCount > 0) {
      showToast(t("promptTemplates.toast.promptSentWithMissingAssets", { count: failedCount }), "error");
    } else if (assets.length > 0) {
      showToast(t("promptTemplates.toast.promptSentWithAssets", { count: assets.length }));
    } else {
      showToast(t("promptTemplates.toast.promptSent"));
    }
  }

  async function downloadTemplateHtml(aiOptimize: boolean) {
    if (!template) return;
    setDownloadDialogOpen(false);
    const expiresDays = downloadAuthDays.trim();
    try {
      const response = await fetch(`/api/prompt-templates/${encodeURIComponent(template.id)}/export.html`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ai: aiOptimize,
          expiresDays: aiOptimize ? expiresDays : "",
          formValues,
          resultId: activeResult?.id ?? ""
        })
      });
      if (!response.ok) {
        let message = t("promptTemplates.toast.downloadFailed");
        try {
          const data = await response.json();
          message = String(data.error || data.message || message);
        } catch {
          message = response.statusText || message;
        }
        throw new Error(message);
      }
      const filename = filenameFromContentDisposition(response.headers.get("Content-Disposition")) || `${template.name || "prompt-template"}.html`;
      downloadBlob(await response.blob(), filename);
      queryClient.invalidateQueries({ queryKey: ["prompt-template-export-downloads", template.id] });
      showToast(t("promptTemplates.toast.downloadStarted"));
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("promptTemplates.toast.downloadFailed"), "error");
    }
  }

  function beginResultResize(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = resultPanelWidth;
    const pageWidth = pageRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const maxWidth = Math.min(PROMPT_RESULT_MAX_WIDTH, Math.max(PROMPT_RESULT_MIN_WIDTH, pageWidth - 720));
    setResizingResult(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      const nextWidth = Math.min(maxWidth, Math.max(PROMPT_RESULT_MIN_WIDTH, startWidth + startX - moveEvent.clientX));
      setResultPanelWidth(nextWidth);
    };
    const finish = () => {
      setResizingResult(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  function beginResultHeightResize(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const rect = resultBlocksRef.current?.getBoundingClientRect();
    if (!rect || rect.height <= 0) return;
    setResizingResultHeight(true);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      const nextSplit = (moveEvent.clientY - rect.top) / rect.height;
      setResultBlockSplit(Math.min(0.8, Math.max(0.2, nextSplit)));
    };
    const finish = () => {
      setResizingResultHeight(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  useEffect(() => {
    window.localStorage.setItem(PROMPT_RESULT_WIDTH_STORAGE_KEY, String(Math.round(resultPanelWidth)));
  }, [resultPanelWidth]);

  function renderTemplateLibrary(activeTemplateId = "") {
    const canRestoreDefaultForms = !keyword.trim() && (
      Number(templateCounts.all ?? 0) === 0
      || (scope === "mine" && Number(templateCounts.mine ?? 0) === 0)
    );
    return (
      <aside className="prompt-template-library">
        <div className="prompt-template-library-toolbar">
          <div className="prompt-template-scope-tabs" role="tablist" aria-label={t("promptTemplates.library.scope")}>
            {scopeOptions.map((option) => (
              <button key={option.value} className={scope === option.value ? "active" : ""} type="button" onClick={() => setScope(option.value)}>
                {option.label}
                <span className="scope-count">{templateCounts[option.value] ?? 0}</span>
              </button>
            ))}
          </div>
          <button
            className="primary-btn icon-only-btn"
            type="button"
            onClick={() => createTemplate.mutate()}
            disabled={createTemplate.isPending}
            aria-label={t("promptTemplates.actions.create")}
            title={t("promptTemplates.actions.create")}
          >
            <Plus size={16} />
          </button>
        </div>
        <SearchHistoryInput
          scope="promptTemplates"
          value={keyword}
          onChange={setKeyword}
          placeholder={t("promptTemplates.library.searchPlaceholder")}
          className="case-search prompt-template-search"
          icon={<Search size={17} />}
        />
        <div className="prompt-template-list">
          {templatesQuery.isLoading ? Array.from({ length: 6 }).map((_, index) => <div className="prompt-template-skeleton" key={index} />) : null}
          {templates.map((item) => {
            const Icon = promptTemplateIconFor(item.icon);
            const ownerLabel = sharedOwnerLabel(item, t);
            return (
              <article
                key={item.id}
                className={cx("prompt-template-card", item.id === activeTemplateId && "active")}
                onClick={() => setSelectedId(item.id)}
              >
                <div className="prompt-template-card-icon">
                  <Icon size={18} />
                </div>
                <div className="prompt-template-card-body">
                  <div>
                    <strong>{item.name}</strong>
                    {ownerLabel ? <span className="prompt-template-shared-owner">{ownerLabel}</span> : null}
                  </div>
                  {item.description.trim() ? <p>{item.description}</p> : null}
                </div>
                <div className="prompt-template-card-actions">
                  {item.canEdit ? (
                    <button type="button" aria-label={t("promptTemplates.actions.rename")} title={t("promptTemplates.actions.rename")} onClick={(event) => { event.stopPropagation(); setPromptDialog({ kind: "rename", template: item }); }}>
                      <Pencil size={14} />
                    </button>
                  ) : null}
                  {item.canCopy ? (
                    <button type="button" aria-label={t("promptTemplates.actions.copyForm")} title={t("promptTemplates.actions.copyForm")} onClick={(event) => { event.stopPropagation(); copyTemplate.mutate(item.id); }}>
                      <Copy size={14} />
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
          {!templatesQuery.isLoading && templates.length === 0 ? (
            <div className="prompt-template-list-empty prompt-template-list-empty-action">
              <span>{canRestoreDefaultForms ? t("promptTemplates.library.empty") : t("promptTemplates.library.noMatch")}</span>
              {canRestoreDefaultForms ? (
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={() => restoreDefaultTemplates.mutate()}
                  disabled={restoreDefaultTemplates.isPending}
                >
                  {restoreDefaultTemplates.isPending ? <RotateCw size={15} className="spin" /> : <Sparkles size={15} />}
                  {t("promptTemplates.actions.initializeDefaults")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </aside>
    );
  }

  if (!template) {
    return (
      <div
        className={cx("prompt-template-page", resizingResult && "resizing-result", resizingResultHeight && "resizing-result-height")}
        ref={pageRef}
        style={{ "--prompt-template-result-width": `${resultPanelWidth}px` } as CSSProperties}
      >
        {renderTemplateLibrary(selectedId)}
        <section className="prompt-template-canvas">
          <div className="prompt-template-empty prompt-template-empty-inline">
            <Sparkles size={28} />
            <strong>{t("promptTemplates.empty.title")}</strong>
            <span>{t("promptTemplates.empty.desc")}</span>
          </div>
        </section>
        <aside className="prompt-template-result-panel">
          <ResultBlock title={t("promptTemplates.result.baseTitle")} icon={FileText} content={t("promptTemplates.result.selectFormPlaceholder")} />
        </aside>
      </div>
    );
  }

  const TemplateIcon = promptTemplateIconFor(template.icon);
  const resultBlockRows = `minmax(0, ${resultBlockSplit.toFixed(4)}fr) 12px minmax(0, ${(1 - resultBlockSplit).toFixed(4)}fr)`;
  return (
    <div
      className={cx("prompt-template-page", resizingResult && "resizing-result", resizingResultHeight && "resizing-result-height")}
      ref={pageRef}
      style={{ "--prompt-template-result-width": `${resultPanelWidth}px` } as CSSProperties}
    >
      {renderTemplateLibrary(template.id)}

      <section className="prompt-template-canvas">
        <header className="prompt-template-main-head">
          <div className="prompt-template-title">
            <div className="prompt-template-title-icon">
              <TemplateIcon size={22} />
            </div>
            <div>
              <h1>{template.name}</h1>
              {template.description.trim() ? <p>{template.description}</p> : null}
            </div>
          </div>
          <div className="prompt-template-head-actions">
            {template.canCopy ? (
              <button
                className="secondary-btn icon-only-btn"
                type="button"
                onClick={() => copyTemplate.mutate(template.id)}
                disabled={copyTemplate.isPending}
                aria-label={t("common.copy")}
                title={t("common.copy")}
              >
                <Copy size={16} />
              </button>
            ) : null}
            {template.canEdit ? (
              <button
                className="secondary-btn icon-only-btn"
                type="button"
                onClick={() => navigate(`/prompt-templates/${encodeURIComponent(template.id)}/edit${templateWorkbenchSearch(scope, keyword, template.id)}`)}
                aria-label={t("promptTemplates.actions.editForm")}
                title={t("promptTemplates.actions.editForm")}
              >
                <Pencil size={16} />
              </button>
            ) : null}
            {template.canShare ? (
              <button
                className={cx(template.visibility === "shared" ? "danger-btn" : "secondary-btn", "icon-only-btn")}
                type="button"
                onClick={() => shareTemplate.mutate(template)}
                disabled={shareTemplate.isPending}
                aria-label={template.visibility === "shared" ? t("promptTemplates.actions.unshare") : t("promptTemplates.actions.shareForm")}
                title={template.visibility === "shared" ? t("promptTemplates.actions.unshare") : t("promptTemplates.actions.shareForm")}
              >
                <Share2 size={16} />
              </button>
            ) : null}
            <button className="secondary-btn icon-only-btn" type="button" onClick={() => setDownloadDialogOpen(true)} aria-label={t("promptTemplates.download.title")} title={t("promptTemplates.download.title")}>
              <Download size={16} />
            </button>
            {template.canDelete ? (
              <button className="danger-btn icon-only-btn" type="button" onClick={() => setDeleteTarget(template)} aria-label={t("common.delete")} title={t("common.delete")}>
                <Trash2 size={16} />
              </button>
            ) : null}
          </div>
        </header>

        <TemplatePreview
          template={template}
          formValues={formValues}
          onChange={handleFormValuesChange}
          emptyActionLabel={t("promptTemplates.actions.editNow")}
          onEmptyAction={
            template.canEdit
              ? () => navigate(`/prompt-templates/${encodeURIComponent(template.id)}/edit${templateWorkbenchSearch(scope, keyword, template.id)}`)
              : undefined
          }
        />
      </section>

      <button
        className="prompt-template-resize-handle"
        type="button"
        aria-label={t("promptTemplates.resize.resultWidth")}
        title={t("promptTemplates.resize.resultWidth")}
        onPointerDown={beginResultResize}
      >
        <span />
      </button>

      <aside className="prompt-template-result-panel">
        <div className="prompt-template-result-blocks" ref={resultBlocksRef} style={{ gridTemplateRows: resultBlockRows }}>
          <ResultBlock
            title={t("promptTemplates.result.baseTitle")}
            icon={FileText}
            content={basePromptContent || (baseDisplayLanguage === "en" ? t("promptTemplates.result.englishBaseNeedsTranslation") : t("promptTemplates.result.basePlaceholder"))}
            badge={basePromptBadge}
            negativeContent={baseNegativePrompt}
            negativeLanguage={baseDisplayLanguage}
            loading={basePromptLoading}
            typing={baseDisplayLanguage === "en" && Boolean(streamingBasePromptEn)}
            action={(
              <div className="result-block-action-group">
                <button
                  className="secondary-btn icon-only-btn"
                  type="button"
                  onClick={() => sendPromptToChat(basePromptWithNegative, "base")}
                  disabled={Boolean(usingPromptTarget) || !basePromptWithNegative.trim() || basePromptLoading}
                  aria-label={usingPromptTarget === "base" ? t("promptTemplates.actions.sending") : t("common.use")}
                  title={usingPromptTarget === "base" ? t("promptTemplates.actions.sending") : t("common.use")}
                >
                  <Send size={15} />
                </button>
                <button
                  className="secondary-btn icon-only-btn result-action-btn"
                  type="button"
                  onClick={() => copyPrompt(basePromptWithNegative)}
                  disabled={!basePromptWithNegative.trim() || basePromptLoading}
                  aria-label={t("common.copy")}
                  title={t("common.copy")}
                >
                  <Copy size={15} />
                </button>
                <button
                  className="secondary-btn icon-only-btn"
                  type="button"
                  onClick={() => setHistoryOpen(true)}
                  aria-label={t("promptTemplates.history.title")}
                  title={t("promptTemplates.history.title")}
                >
                  <History size={15} />
                </button>
                <button
                  className="secondary-btn icon-only-btn"
                  type="button"
                  onClick={requestBasePromptTranslation}
                  disabled={Boolean(usingPromptTarget) || translateBasePrompt.isPending || !basePrompt.trim()}
                  aria-label={baseTranslateActionLabel}
                  title={baseTranslateActionLabel}
                >
                  {translateBasePrompt.isPending ? <RotateCw size={15} className="spin" /> : <Languages size={15} />}
                </button>
              </div>
            )}
          />
          <button
            className="prompt-template-result-height-handle"
            type="button"
            aria-label={t("promptTemplates.resize.resultHeight")}
            title={t("promptTemplates.resize.resultHeight")}
            onPointerDown={beginResultHeightResize}
          >
            <span />
          </button>
          <ResultBlock
            title={t("promptTemplates.result.aiTitle")}
            icon={Sparkles}
            content={finalPromptContent}
            badge={aiPromptBadge}
            negativeContent={!streamingPrompt && templateHasNegativeOutput ? aiPromptNegativeContent : ""}
            negativeLanguage={activeDisplayLanguage}
            diffAgainst={aiPromptDiffBase}
            diffEnabled={aiPromptDiffEnabled}
            loading={optimize.isPending && !streamingPrompt}
            typing={Boolean(typingResultId) || Boolean(streamingPrompt)}
            action={(
              <div className="result-block-action-group">
                <button
                  className="secondary-btn icon-only-btn"
                  type="button"
                  onClick={() => sendPromptToChat(activePromptWithNegative, "ai")}
                  disabled={Boolean(usingPromptTarget) || optimize.isPending || !activePromptWithNegative.trim()}
                  aria-label={usingPromptTarget === "ai" ? t("promptTemplates.actions.sending") : t("common.use")}
                  title={usingPromptTarget === "ai" ? t("promptTemplates.actions.sending") : t("common.use")}
                >
                  <Send size={15} />
                </button>
                <button
                  className="secondary-btn icon-only-btn"
                  type="button"
                  onClick={() => copyPrompt(displayPrompt)}
                  disabled={!displayPrompt.trim() || (optimize.isPending && !streamingPrompt)}
                  aria-label={t("common.copy")}
                  title={t("common.copy")}
                >
                  <Copy size={15} />
                </button>
                <div className="prompt-optimize-control">
                  <button
                    className="secondary-btn icon-only-btn prompt-optimize-submit"
                    type="button"
                    onClick={() => optimize.mutate({
                      templateId: template.id,
                      signature,
                      basePrompt,
                      optimizeStyle
                    })}
                    disabled={Boolean(usingPromptTarget) || optimize.isPending || !basePrompt.trim()}
                    aria-label={t("promptTemplates.actions.optimizeWithStyle", { action: optimizeActionLabel, style: optimizeStyleOption.label })}
                    title={t("promptTemplates.actions.optimizeWithStyle", { action: optimizeActionLabel, style: optimizeStyleOption.label })}
                  >
                    {optimize.isPending ? <RotateCw size={15} className="spin" /> : <WandSparkles size={15} />}
                  </button>
                  <PromptOptimizeStyleSelect
                    value={optimizeStyle}
                    onChange={selectOptimizeStyle}
                    groups={promptOptimizeStyleGroups}
                    customInstruction={optimizeCustomInstruction}
                    onCustomInstructionChange={updateOptimizeCustomInstruction}
                    onCustomInstructionSubmit={() => optimize.mutate({
                      templateId: template.id,
                      signature,
                      basePrompt,
                      optimizeStyle,
                      customInstruction: optimizeCustomInstruction
                    })}
                    customInstructionSubmitDisabled={Boolean(usingPromptTarget) || optimize.isPending || !basePrompt.trim()}
                    customInstructionSubmitPending={optimize.isPending}
                    disabled={Boolean(usingPromptTarget) || optimize.isPending || saveOptimizeStyle.isPending}
                    className="prompt-optimize-style-select"
                    menuClassName="prompt-optimize-style-menu"
                    menuWidth={260}
                  />
                </div>
              </div>
            )}
          />
        </div>
      </aside>

      {downloadDialogOpen ? (
        <div className="modal-backdrop prompt-template-download-backdrop" role="presentation">
          <section className="prompt-template-download-dialog" role="dialog" aria-modal="true" aria-label={t("promptTemplates.download.title")}>
            <header>
              <div>
                <span className="prompt-template-download-icon" aria-hidden="true">
                  <Download size={18} />
                </span>
                <div>
                  <strong>{t("promptTemplates.download.title")}</strong>
                  <p>{t("promptTemplates.download.desc")}</p>
                </div>
              </div>
              <button className="icon-only-btn secondary-btn" type="button" onClick={() => setDownloadDialogOpen(false)} aria-label={t("common.close")}>
                <X size={16} />
              </button>
            </header>
            <div className="prompt-template-download-validity">
              <div>
                <strong>{t("promptTemplates.download.validityTitle")}</strong>
                <small>{t("promptTemplates.download.validityDesc")}</small>
              </div>
              <div className="prompt-template-expiry-controls">
                <button
                  type="button"
                  className={downloadAuthDays.trim() === "" ? "active" : ""}
                  onClick={() => setDownloadAuthDays("")}
                >
                  {t("promptTemplates.download.permanent")}
                </button>
                <input
                  value={downloadAuthDays}
                  onChange={(event) => setDownloadAuthDays(event.target.value.replace(/\D/g, "").slice(0, 5))}
                  inputMode="numeric"
                  placeholder={t("promptTemplates.download.customDays")}
                  aria-label={t("promptTemplates.download.daysAria")}
                />
                <button
                  type="button"
                  className="prompt-template-revoke-inline-btn"
                  onClick={() => setRevokeDownloadLinksOpen(true)}
                  disabled={!template || revokeExportDownloads.isPending}
                  title={activeAiExportDownloads > 0 ? t("promptTemplates.download.activeAiLinks", { count: activeAiExportDownloads }) : t("promptTemplates.download.noActiveAiLinks")}
                >
                  {t("promptTemplates.download.revokeAll")}
                </button>
              </div>
            </div>
            <div className="prompt-template-download-options">
              <button type="button" className="prompt-template-download-option" onClick={() => downloadTemplateHtml(true)}>
                <span className="prompt-template-download-option-icon" aria-hidden="true">
                  <WandSparkles size={18} />
                </span>
                <span>
                  <strong>{t("promptTemplates.download.aiVersion")}</strong>
                  <small>{t("promptTemplates.download.aiVersionDesc")}</small>
                </span>
              </button>
              <button type="button" className="prompt-template-download-option" onClick={() => downloadTemplateHtml(false)}>
                <span className="prompt-template-download-option-icon" aria-hidden="true">
                  <FileText size={18} />
                </span>
                <span>
                  <strong>{t("promptTemplates.download.noAiVersion")}</strong>
                  <small>{t("promptTemplates.download.noAiVersionDesc")}</small>
                </span>
              </button>
            </div>
            <div className="prompt-template-download-records">
              <div>
                <strong>{t("promptTemplates.download.records")}</strong>
                <small>{t("promptTemplates.download.recordsDesc")}</small>
              </div>
              {exportDownloadsQuery.isFetching && exportDownloads.length === 0 ? (
                <p className="prompt-template-download-record-empty">{t("common.loadingEllipsis")}</p>
              ) : exportDownloads.length > 0 ? (
                <div
                  className="prompt-template-download-record-list"
                  onScroll={(event) => {
                    const element = event.currentTarget;
                    if (element.scrollHeight - element.scrollTop - element.clientHeight > 36) return;
                    if (exportDownloadsQuery.hasNextPage && !exportDownloadsQuery.isFetchingNextPage) {
                      exportDownloadsQuery.fetchNextPage();
                    }
                  }}
                >
                  {exportDownloads.map((download) => (
                    <div className="prompt-template-download-record" key={download.id}>
                      <span className={`prompt-template-download-record-status ${download.status}`}>
                        {promptTemplateExportStatusLabel(download, t)}
                      </span>
                      <div>
                        <strong>{download.variant === "ai" ? t("promptTemplates.download.aiVersion") : t("promptTemplates.download.noAiVersion")}</strong>
                        <small>
                          {formatPromptTemplateExportTime(download.issuedAt, resolvedLanguage)}
                          {download.variant === "ai"
                            ? t("promptTemplates.download.aiRecordMeta", { status: promptTemplateExportStatusText(download, t, resolvedLanguage), count: download.useCount })
                            : t("promptTemplates.download.baseRecordMeta")}
                        </small>
                      </div>
                    </div>
                  ))}
                  {exportDownloadsQuery.isFetchingNextPage ? (
                    <p className="prompt-template-download-record-empty">{t("promptTemplates.actions.loadingMore")}</p>
                  ) : null}
                  {exportDownloadsQuery.hasNextPage && !exportDownloadsQuery.isFetchingNextPage ? (
                    <button
                      className="prompt-template-download-record-more"
                      type="button"
                      onClick={() => exportDownloadsQuery.fetchNextPage()}
                    >
                      {t("promptTemplates.actions.loadMore")}
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="prompt-template-download-record-empty">{t("promptTemplates.download.noRecords")}</p>
              )}
            </div>
          </section>
        </div>
      ) : null}

      <PromptDialog
        open={Boolean(promptDialog)}
        title={t("promptTemplates.dialog.renameTitle")}
        label={t("promptTemplates.editor.formName")}
        defaultValue={promptDialog?.template.name ?? ""}
        confirmText={t("common.save")}
        onCancel={() => setPromptDialog(null)}
        onSubmit={(value) => {
          if (!promptDialog) return;
          const next = { ...promptDialog.template, name: value.trim() };
          setPromptDialog(null);
          saveTemplate.mutate(next);
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t("promptTemplates.dialog.deleteTitle")}
        description={deleteTarget ? t("promptTemplates.dialog.deleteDescription", { name: deleteTarget.name }) : ""}
        confirmText={t("common.delete")}
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && removeTemplate.mutate(deleteTarget.id)}
      />
      <ConfirmDialog
        open={revokeDownloadLinksOpen}
        title={t("promptTemplates.dialog.revokeTitle")}
        description={template ? t("promptTemplates.dialog.revokeDescription", { name: template.name }) : ""}
        confirmText={t("promptTemplates.dialog.revokeConfirm")}
        destructive
        backdropClassName="modal-backdrop-top"
        onCancel={() => setRevokeDownloadLinksOpen(false)}
        onConfirm={() => template && revokeExportDownloads.mutate(template.id)}
      />
      {historyOpen ? (
        <HistoryDialog
          results={historyResults}
          loading={historyQuery.isLoading}
          loadingMore={historyQuery.isFetchingNextPage}
          hasMore={Boolean(historyQuery.hasNextPage)}
          usingPromptTarget={usingPromptTarget}
          onLoadMore={() => {
            if (historyQuery.hasNextPage && !historyQuery.isFetchingNextPage) historyQuery.fetchNextPage();
          }}
          onClose={() => setHistoryOpen(false)}
          onUse={(result) => {
            setActiveResult(result);
            setOptimizedSignature(signature);
            setHistoryOpen(false);
          }}
          onCopy={(text) => copyPrompt(text)}
          onUsePrompt={(text, target) => sendPromptToChat(text, target)}
        />
      ) : null}
    </div>
  );
}

export function PromptTemplateEditorPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { templateId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();
  const { t } = useI18n();
  const scope = normalizeScope(searchParams.get("scope"));
  const keyword = searchParams.get("keyword") ?? "";
  const [workingTemplate, setWorkingTemplate] = useState<PromptTemplate | null>(null);
  const [savedTemplateSignature, setSavedTemplateSignature] = useState("");
  const [selectedComponentId, setSelectedComponentId] = useState("");
  const [formValues, setFormValues] = useState<PromptTemplateFormValues>({});
  const [backConfirmOpen, setBackConfirmOpen] = useState(false);

  const templatesQuery = useQuery({
    queryKey: ["prompt-templates", "editor", templateId],
    queryFn: () => api.promptTemplates({ scope: "all" })
  });

  const sourceTemplate = templatesQuery.data?.templates.find((item) => item.id === templateId) ?? null;
  const template = workingTemplate ?? sourceTemplate;
  const components = template ? sortedPromptTemplateComponents(template.components) : [];
  const selectedComponent = components.find((component) => component.id === selectedComponentId) ?? components.find((component) => component.type !== "section") ?? components[0] ?? null;
  const workingTemplateSignature = useMemo(() => promptTemplateDraftSignature(workingTemplate), [workingTemplate]);
  const hasUnsavedChanges = Boolean(workingTemplate && savedTemplateSignature && workingTemplateSignature !== savedTemplateSignature);

  const saveTemplate = useMutation({
    mutationFn: (nextTemplate: PromptTemplate) => api.updatePromptTemplate(nextTemplate.id, payloadFromTemplate(syncRules(nextTemplate))),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["prompt-templates"] });
      if (data.template) {
        setWorkingTemplate(data.template);
        setSavedTemplateSignature(promptTemplateDraftSignature(data.template));
        setSelectedComponentId((current) => data.template?.components.some((component) => component.id === current) ? current : data.template?.components[0]?.id ?? "");
      }
      showToast(t("promptTemplates.toast.saved"));
    },
    onError: (error) => showToast(error instanceof Error ? error.message : t("promptTemplates.toast.saveFailed"), "error")
  });

  useEffect(() => {
    if (!sourceTemplate) return;
    setWorkingTemplate(sourceTemplate);
    setSavedTemplateSignature(promptTemplateDraftSignature(sourceTemplate));
    setFormValues(initialPromptTemplateFormValues(sourceTemplate));
    const firstEditable = sortedPromptTemplateComponents(sourceTemplate.components).find((component) => component.type !== "section") ?? sourceTemplate.components[0];
    setSelectedComponentId(firstEditable?.id ?? "");
  }, [sourceTemplate?.id]);

  useEffect(() => {
    if (!workingTemplate) return;
    setFormValues((current) => ({ ...initialPromptTemplateFormValues(workingTemplate), ...current }));
  }, [workingTemplate?.components]);

  function navigateBackToWorkbench() {
    navigate(`/prompt-templates${templateWorkbenchSearch(scope, keyword, templateId)}`);
  }

  function backToWorkbench() {
    if (template && hasUnsavedChanges) {
      setBackConfirmOpen(true);
      return;
    }
    navigateBackToWorkbench();
  }

  async function saveAndBackToWorkbench() {
    if (!template) return;
    try {
      await saveTemplate.mutateAsync(template);
      setBackConfirmOpen(false);
      navigateBackToWorkbench();
    } catch {
      // Stay on the editor when save fails; the mutation shows the error toast.
    }
  }

  function discardAndBackToWorkbench() {
    setBackConfirmOpen(false);
    navigateBackToWorkbench();
  }

  function patchTemplate(patch: Partial<PromptTemplate>) {
    setWorkingTemplate((current) => current ? { ...current, ...patch } : current);
  }

  function patchComponent(id: string, patch: Partial<PromptTemplateComponent>) {
    setWorkingTemplate((current) => {
      if (!current) return current;
      return {
        ...current,
        components: current.components.map((component) => component.id === id ? { ...component, ...patch } : component)
      };
    });
  }

  function addComponent(type: PromptTemplateComponentType) {
    const component = newComponent(type, t);
    setWorkingTemplate((current) => {
      if (!current) return current;
      const maxOrder = Math.max(0, ...current.components.map((item) => Number(item.sortOrder) || 0));
      return {
        ...current,
        components: withComponentOrder([...current.components, { ...component, sortOrder: maxOrder + 10 }])
      };
    });
    setSelectedComponentId(component.id);
  }

  function moveComponent(id: string, direction: -1 | 1) {
    setWorkingTemplate((current) => {
      if (!current) return current;
      const ordered = sortedPromptTemplateComponents(current.components);
      const index = ordered.findIndex((component) => component.id === id);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return current;
      const next = [...ordered];
      const [item] = next.splice(index, 1);
      next.splice(targetIndex, 0, item);
      return { ...current, components: withComponentOrder(next) };
    });
  }

  function duplicateComponent(component: PromptTemplateComponent) {
    const nextComponent = duplicatePromptTemplateComponent(component);
    setWorkingTemplate((current) => current ? { ...current, components: withComponentOrder([...current.components, nextComponent]) } : current);
    setSelectedComponentId(nextComponent.id);
  }

  function removeComponent(id: string) {
    setWorkingTemplate((current) => {
      if (!current) return current;
      const next = withComponentOrder(current.components.filter((component) => component.id !== id));
      if (selectedComponentId === id) {
        setSelectedComponentId(next.find((component) => component.type !== "section")?.id ?? next[0]?.id ?? "");
      }
      return { ...current, components: next };
    });
  }

  if (templatesQuery.isLoading) {
    return (
      <div className="prompt-template-edit-page">
        <div className="prompt-template-edit-topbar">
          <button className="secondary-btn" type="button" onClick={() => { void backToWorkbench(); }} disabled={saveTemplate.isPending}>
            <ArrowLeft size={16} />
            {t("promptTemplates.actions.back")}
          </button>
          <div className="prompt-template-edit-title">
            <div>
              <h1>{t("common.loading")}</h1>
              <span>{t("promptTemplates.editor.subtitle")}</span>
            </div>
          </div>
        </div>
        <div className="prompt-template-list-empty">{t("promptTemplates.editor.loadingForm")}</div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="prompt-template-edit-page">
        <div className="prompt-template-edit-topbar">
          <button className="secondary-btn" type="button" onClick={() => { void backToWorkbench(); }} disabled={saveTemplate.isPending}>
            <ArrowLeft size={16} />
            {t("promptTemplates.actions.back")}
          </button>
          <div className="prompt-template-edit-title">
            <div>
              <h1>{t("promptTemplates.editor.notFoundTitle")}</h1>
              <span>{t("promptTemplates.editor.subtitle")}</span>
            </div>
          </div>
        </div>
        <div className="prompt-template-list-empty">{t("promptTemplates.editor.notFoundDesc")}</div>
      </div>
    );
  }

  const TemplateIcon = promptTemplateIconFor(template.icon);

  return (
    <div className="prompt-template-edit-page">
      <div className="prompt-template-edit-topbar">
        <button className="secondary-btn" type="button" onClick={backToWorkbench} disabled={saveTemplate.isPending}>
          <ArrowLeft size={16} />
          {t("promptTemplates.actions.back")}
        </button>
        <div className="prompt-template-edit-title">
          <div className="prompt-template-title-icon">
            <TemplateIcon size={20} />
          </div>
          <div>
            <div className="prompt-template-edit-title-row">
              <h1>{template.name}</h1>
              {hasUnsavedChanges ? <span className="prompt-template-dirty-badge">{t("promptTemplates.editor.unsavedBadge")}</span> : null}
            </div>
            <span>{t("promptTemplates.editor.subtitle")}</span>
          </div>
        </div>
        <div className="prompt-template-edit-actions">
          <button className="primary-btn" type="button" onClick={() => saveTemplate.mutate(template)} disabled={saveTemplate.isPending}>
            {saveTemplate.isPending ? <RotateCw size={16} className="spin" /> : <Save size={16} />}
            {saveTemplate.isPending ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </div>
      <TemplateEditor
        template={template}
        selectedComponent={selectedComponent}
        selectedComponentId={selectedComponent?.id ?? ""}
        formValues={formValues}
        onSelectComponent={setSelectedComponentId}
        onPatchTemplate={patchTemplate}
        onPatchComponent={patchComponent}
        onAddComponent={addComponent}
        onMoveComponent={moveComponent}
        onFormValuesChange={setFormValues}
        onDuplicateComponent={duplicateComponent}
        onRemoveComponent={removeComponent}
      />
      {backConfirmOpen ? (
        <div className="modal-backdrop">
          <section className="case-modal compact-modal action-modal prompt-template-unsaved-modal">
            <header>
              <h3>{t("promptTemplates.editor.unsavedTitle")}</h3>
              <button type="button" onClick={() => setBackConfirmOpen(false)} aria-label={t("common.close")} disabled={saveTemplate.isPending}>
                <X size={18} />
              </button>
            </header>
            <p>{t("promptTemplates.editor.unsavedDesc")}</p>
            <div className="prompt-template-unsaved-actions">
              <button className="secondary-btn" type="button" onClick={() => setBackConfirmOpen(false)} disabled={saveTemplate.isPending}>
                {t("common.cancel")}
              </button>
              <button className="secondary-btn" type="button" onClick={discardAndBackToWorkbench} disabled={saveTemplate.isPending}>
                {t("promptTemplates.editor.discard")}
              </button>
              <button className="primary-btn" type="button" onClick={() => { void saveAndBackToWorkbench(); }} disabled={saveTemplate.isPending}>
                {saveTemplate.isPending ? <RotateCw size={16} className="spin" /> : <Save size={16} />}
                {saveTemplate.isPending ? t("common.saving") : t("promptTemplates.editor.saveAndBack")}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function TemplatePreview({
  template,
  formValues,
  onChange,
  selectedComponentId = "",
  onSelectComponent,
  emptyActionLabel = "",
  onEmptyAction
}: {
  template: PromptTemplate;
  formValues: PromptTemplateFormValues;
  onChange: (value: PromptTemplateFormValues) => void;
  selectedComponentId?: string;
  onSelectComponent?: (id: string) => void;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { t } = useI18n();
  const components = sortedPromptTemplateComponents(template.components);
  const patchValue = (id: string, value: PromptTemplateFormValues[string]) => onChange({ ...formValues, [id]: value });
  const selectable = Boolean(onSelectComponent);
  const componentClassName = (component: PromptTemplateComponent, baseClass: string) => cx(
    baseClass,
    componentLayoutClass(component),
    selectable && "template-preview-selectable",
    component.id === selectedComponentId && "selected"
  );
  const selectComponent = (id: string) => {
    if (onSelectComponent) onSelectComponent(id);
  };
  if (components.length === 0) {
    return (
      <div className={cx("template-preview-surface", "empty", selectable && "editing")}>
        <div className="template-preview-empty">
          <Sparkles size={28} />
          <strong>{t("promptTemplates.preview.emptyTitle")}</strong>
          <span>{t("promptTemplates.preview.emptyDesc")}</span>
          {onEmptyAction ? (
            <button className="primary-btn" type="button" onClick={onEmptyAction}>
              <Pencil size={16} />
              {emptyActionLabel || t("promptTemplates.actions.editNow")}
            </button>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className={cx("template-preview-surface", selectable && "editing")}>
      {components.map((component) => {
        if (component.type === "section") {
          return (
            <div
              className={componentClassName(component, "template-section-title")}
              key={component.id}
              onClick={() => selectComponent(component.id)}
            >
              {component.label}
            </div>
          );
        }
        const value = formValues[component.id];
        if (component.type === "textarea") {
          return (
            <label className={componentClassName(component, "template-field")} key={component.id} onClick={() => selectComponent(component.id)}>
              <span>{component.label}{component.required ? <b>*</b> : null}</span>
              <textarea value={String(value ?? "")} placeholder={component.placeholder} onChange={(event) => patchValue(component.id, event.target.value)} />
              {component.helpText ? <small>{component.helpText}</small> : null}
            </label>
          );
        }
        if (component.type === "select") {
          const options = (component.options ?? []).map((option) => ({ value: option, label: option }));
          const selectedValues = Array.isArray(value)
            ? value
            : promptTemplateDefaultValues(String(value ?? component.defaultValue ?? ""), component.options);
          return (
            <label className={componentClassName(component, "template-field")} key={component.id} onClick={() => selectComponent(component.id)}>
              <span>{component.label}{component.required ? <b>*</b> : null}</span>
              {component.multiple ? (
                <PromptTemplateMultiSelect
                  values={selectedValues}
                  options={options}
                  onChange={(next) => patchValue(component.id, next)}
                />
              ) : (
                <CustomSelect
                  value={String(value ?? component.defaultValue ?? "")}
                  options={options}
                  onChange={(next) => patchValue(component.id, next)}
                />
              )}
              {component.helpText ? <small>{component.helpText}</small> : null}
            </label>
          );
        }
        if (component.type === "color") {
          return (
            <label className={componentClassName(component, "template-field")} key={component.id} onClick={() => selectComponent(component.id)}>
              <span>{component.label}{component.required ? <b>*</b> : null}</span>
              <PromptTemplateColorPicker
                component={component}
                value={value}
                onChange={(next) => patchValue(component.id, next)}
              />
              {component.helpText ? <small>{component.helpText}</small> : null}
            </label>
          );
        }
        if (component.type === "image") {
          const imageValue = (typeof value === "object" && value ? value : {}) as PromptTemplateImageValue;
          const imageFiles = Array.isArray(imageValue.files) ? imageValue.files : [];
          const removeImageFile = (fileId: string | undefined) => {
            const nextFiles = imageFiles.filter((file) => file.id !== fileId);
            patchValue(component.id, {
              ...imageValue,
              files: nextFiles,
              fileName: nextFiles[0]?.fileName ?? "",
              uploaded: nextFiles.length > 0,
              previewUrl: nextFiles[0]?.previewUrl ?? ""
            });
          };
          return (
            <div className={componentClassName(component, "template-field")} key={component.id} onClick={() => selectComponent(component.id)}>
              <span>{component.label}</span>
              <div className="template-upload">
                <label className="template-upload-pick">
                  <input
                    className="template-upload-input"
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={async (event) => {
                      const input = event.currentTarget;
                      const selectedFiles = Array.from(input.files ?? []);
                      if (selectedFiles.length === 0) return;
                      const settledFiles = await Promise.allSettled(selectedFiles.map(imageFileFromUpload));
                      const uploadedFiles = settledFiles
                        .filter((result): result is PromiseFulfilledResult<PromptTemplateImageFile> => result.status === "fulfilled")
                        .map((result) => result.value);
                      const failedCount = settledFiles.length - uploadedFiles.length;
                      if (uploadedFiles.length > 0) {
                        queryClient.invalidateQueries({ queryKey: ["assets"] });
                      }
                      const nextFiles = [...imageFiles, ...uploadedFiles];
                      if (uploadedFiles.length > 0) {
                        patchValue(component.id, {
                          ...imageValue,
                          files: nextFiles,
                          fileName: nextFiles[0]?.fileName ?? "",
                          uploaded: nextFiles.length > 0,
                          previewUrl: nextFiles[0]?.previewUrl ?? ""
                        });
                      }
                      if (failedCount > 0) {
                        showToast(t("promptTemplates.toast.assetUploadFailedCount", { count: failedCount }), "error");
                      }
                      input.value = "";
                    }}
                  />
                  <span className="template-upload-pick-icon">
                    <Upload size={18} />
                  </span>
                  <span>
                    <strong>{t("promptTemplates.preview.pickAsset")}</strong>
                    <small>{t("promptTemplates.preview.pickAssetDesc")}</small>
                  </span>
                </label>
                <input
                  value={String(imageValue.note ?? "")}
                  placeholder={t("promptTemplates.preview.assetNote")}
                  onChange={(event) => patchValue(component.id, { ...imageValue, note: event.target.value })}
                />
                {imageFiles.length > 0 ? (
                  <div className="template-upload-list">
                    {imageFiles.map((file) => (
                      <div className="template-upload-item" key={file.id ?? file.fileName}>
                        {file.previewUrl ? <img src={file.previewUrl} alt="" /> : <div className="template-upload-thumb"><ImageIcon size={18} /></div>}
                        <div>
                          <strong>{file.fileName}</strong>
                          <span>
                            {Number(file.width) > 0 && Number(file.height) > 0 ? `${file.width} x ${file.height}` : t("promptTemplates.preview.unknownSize")}
                            {formatImageFileSize(file.size) ? ` · ${formatImageFileSize(file.size)}` : ""}
                          </span>
                        </div>
                        <button type="button" aria-label={t("promptTemplates.preview.removeAsset")} onClick={(event) => { event.preventDefault(); removeImageFile(file.id); }}>
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              {component.helpText ? <small>{component.helpText}</small> : null}
            </div>
          );
        }
        return (
          <label className={componentClassName(component, "template-field")} key={component.id} onClick={() => selectComponent(component.id)}>
            <span>{component.label}{component.required ? <b>*</b> : null}</span>
            <input value={String(value ?? "")} placeholder={component.placeholder} onChange={(event) => patchValue(component.id, event.target.value)} />
            {component.helpText ? <small>{component.helpText}</small> : null}
          </label>
        );
      })}
    </div>
  );
}

function TemplateEditor({
  template,
  selectedComponent,
  selectedComponentId,
  formValues,
  onSelectComponent,
  onPatchTemplate,
  onPatchComponent,
  onAddComponent,
  onMoveComponent,
  onFormValuesChange,
  onDuplicateComponent,
  onRemoveComponent
}: {
  template: PromptTemplate;
  selectedComponent: PromptTemplateComponent | null;
  selectedComponentId: string;
  formValues: PromptTemplateFormValues;
  onSelectComponent: (id: string) => void;
  onPatchTemplate: (patch: Partial<PromptTemplate>) => void;
  onPatchComponent: (id: string, patch: Partial<PromptTemplateComponent>) => void;
  onAddComponent: (type: PromptTemplateComponentType) => void;
  onMoveComponent: (id: string, direction: -1 | 1) => void;
  onFormValuesChange: (value: PromptTemplateFormValues) => void;
  onDuplicateComponent: (component: PromptTemplateComponent) => void;
  onRemoveComponent: (id: string) => void;
}) {
  const { t } = useI18n();
  const [draggingComponentId, setDraggingComponentId] = useState("");
  const [dragOverComponentId, setDragOverComponentId] = useState("");
  const [propertyPanelWidth, setPropertyPanelWidth] = useState(storedPromptEditorPropertyWidth);
  const [resizingPropertyPanel, setResizingPropertyPanel] = useState(false);
  const draggingComponentIdRef = useRef("");
  const editorRef = useRef<HTMLDivElement | null>(null);
  const components = sortedPromptTemplateComponents(template.components);
  const componentTypeOptions = useMemo(() => promptTemplateComponentTypeOptions(t), [t]);
  const componentWidthOptions = useMemo(() => promptTemplateComponentWidthOptions(t), [t]);
  const iconOptions = useMemo(() => promptTemplateIconOptions(t), [t]);
  const [propertyTab, setPropertyTab] = useState<PropertyTab>("template");
  const manualNegativePrompt = String(template.rules.negativePrompt ?? "");
  const hasManualNegativePrompt = Boolean(manualNegativePrompt.trim());

  useEffect(() => {
    if (components.length === 0) setPropertyTab("template");
  }, [components.length]);

  useEffect(() => {
    setPropertyTab("template");
  }, [template.id]);

  useEffect(() => {
    window.localStorage.setItem(PROMPT_EDITOR_PROPERTY_WIDTH_STORAGE_KEY, String(Math.round(propertyPanelWidth)));
  }, [propertyPanelWidth]);

  function selectComponentForEdit(id: string) {
    onSelectComponent(id);
    setPropertyTab("component");
  }

  function reorderComponent(sourceId: string, targetId: string) {
    if (!sourceId || sourceId === targetId) return;
    const sourceIndex = components.findIndex((component) => component.id === sourceId);
    const targetIndex = components.findIndex((component) => component.id === targetId);
    if (sourceIndex < 0) return;
    if (targetIndex < 0) return;
    const source = components[sourceIndex];
    const withoutSource = components.filter((component) => component.id !== sourceId);
    const nextTargetIndex = withoutSource.findIndex((component) => component.id === targetId);
    if (nextTargetIndex < 0) return;
    const insertIndex = sourceIndex < targetIndex ? nextTargetIndex + 1 : nextTargetIndex;
    withoutSource.splice(insertIndex, 0, source);
    onPatchTemplate({ components: withComponentOrder(withoutSource) });
  }

  function componentIdFromPoint(event: PointerEvent<HTMLButtonElement>) {
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-component-id]") as HTMLElement | null;
    return target?.dataset.componentId ?? "";
  }

  function dropPositionClass(componentId: string) {
    if (!draggingComponentId || !dragOverComponentId || componentId !== dragOverComponentId || componentId === draggingComponentId) return "";
    const sourceIndex = components.findIndex((component) => component.id === draggingComponentId);
    const targetIndex = components.findIndex((component) => component.id === dragOverComponentId);
    if (sourceIndex < 0 || targetIndex < 0) return "";
    return sourceIndex < targetIndex ? "drop-after" : "drop-before";
  }

  function beginComponentDrag(componentId: string, event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    draggingComponentIdRef.current = componentId;
    setDraggingComponentId(componentId);
    setDragOverComponentId("");
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateComponentDragTarget(event: PointerEvent<HTMLButtonElement>) {
    const sourceId = draggingComponentIdRef.current;
    if (!sourceId) return;
    const targetId = componentIdFromPoint(event);
    setDragOverComponentId(targetId && targetId !== sourceId ? targetId : "");
  }

  function finishComponentDrag(event: PointerEvent<HTMLButtonElement>) {
    const sourceId = draggingComponentIdRef.current;
    const targetId = componentIdFromPoint(event);
    draggingComponentIdRef.current = "";
    setDraggingComponentId("");
    setDragOverComponentId("");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    reorderComponent(sourceId, targetId);
  }

  function cancelComponentDrag(event: PointerEvent<HTMLButtonElement>) {
    draggingComponentIdRef.current = "";
    setDraggingComponentId("");
    setDragOverComponentId("");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function beginPropertyPanelResize(event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const editor = editorRef.current;
    const editorRect = editor?.getBoundingClientRect();
    if (!editor || !editorRect) return;
    const builderWidth = editor.querySelector<HTMLElement>(".template-builder-panel")?.getBoundingClientRect().width ?? 330;
    const availableMaxWidth = editorRect.width
      - builderWidth
      - PROMPT_EDITOR_PREVIEW_MIN_WIDTH
      - PROMPT_EDITOR_COLUMN_GAP * 2;
    const maxWidth = Math.max(
      PROMPT_EDITOR_PROPERTY_MIN_WIDTH,
      Math.min(PROMPT_EDITOR_PROPERTY_MAX_WIDTH, availableMaxWidth)
    );
    const startX = event.clientX;
    const startWidth = clampNumber(propertyPanelWidth, PROMPT_EDITOR_PROPERTY_MIN_WIDTH, maxWidth);
    setResizingPropertyPanel(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMove = (moveEvent: globalThis.PointerEvent) => {
      const nextWidth = clampNumber(startWidth + moveEvent.clientX - startX, PROMPT_EDITOR_PROPERTY_MIN_WIDTH, maxWidth);
      setPropertyPanelWidth(nextWidth);
    };
    const finish = () => {
      setResizingPropertyPanel(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  return (
    <div
      className={cx("template-editor", resizingPropertyPanel && "resizing-property-panel")}
      ref={editorRef}
      style={{ "--template-editor-property-width": `${propertyPanelWidth}px` } as CSSProperties}
    >
      <aside className="template-builder-panel">
        <div className="template-builder-section">
          <div className="template-builder-head">
            <div>
              <strong>{t("promptTemplates.editor.componentMenu")}</strong>
              <span>{t("promptTemplates.editor.dragSortHint")}</span>
            </div>
          </div>
          <div className="component-add-grid">
            {componentTypeOptions.map((option) => (
              <button
                type="button"
                key={option.value}
                onClick={() => {
                  setPropertyTab("component");
                  onAddComponent(option.value);
                }}
              >
                <Plus size={14} />
                {option.label}
              </button>
            ))}
          </div>
          <div className={cx("component-list", components.length === 0 && "empty", draggingComponentId && "dragging")}>
            {components.map((component, index) => {
              const active = component.id === selectedComponentId;
              const typeLabel = componentTypeOptions.find((option) => option.value === component.type)?.label ?? t("promptTemplates.editor.component");
              return (
                <article
                  key={component.id}
                  data-component-id={component.id}
                  className={cx(
                    "component-list-item",
                    active && "active",
                    draggingComponentId === component.id && "dragging",
                    dragOverComponentId === component.id && "drop-target",
                    dropPositionClass(component.id)
                  )}
                >
                  <button
                    className="component-drag-handle"
                    type="button"
                    aria-label={t("promptTemplates.editor.dragComponent")}
                    onPointerDown={(event) => beginComponentDrag(component.id, event)}
                    onPointerMove={updateComponentDragTarget}
                    onPointerUp={finishComponentDrag}
                    onPointerCancel={cancelComponentDrag}
                  >
                    <GripVertical size={15} />
                  </button>
                  <button className="component-select-button" type="button" onClick={() => selectComponentForEdit(component.id)}>
                    <span>{component.label || t("promptTemplates.editor.unnamedComponent")}</span>
                    <small>{typeLabel} · {componentWidthLabel(component, t)}</small>
                  </button>
                  <div className="component-list-actions">
                    <button type="button" onClick={() => onMoveComponent(component.id, -1)} disabled={index === 0} aria-label={t("promptTemplates.editor.moveComponentUp")}>
                      <ArrowUp size={14} />
                    </button>
                    <button type="button" onClick={() => onMoveComponent(component.id, 1)} disabled={index === components.length - 1} aria-label={t("promptTemplates.editor.moveComponentDown")}>
                      <ArrowDown size={14} />
                    </button>
                    <button type="button" onClick={() => onDuplicateComponent(component)} aria-label={t("promptTemplates.editor.duplicateComponent")}>
                      <Copy size={14} />
                    </button>
                    <button type="button" onClick={() => onRemoveComponent(component.id)} aria-label={t("promptTemplates.editor.deleteComponent")}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              );
            })}
            {components.length === 0 ? <div className="component-list-empty">{t("promptTemplates.editor.selectComponent")}</div> : null}
          </div>
        </div>
      </aside>
      <aside className="template-property-panel">
        <div className="template-property-tabs" role="tablist" aria-label={t("promptTemplates.editor.propertyPanel")}>
          <button type="button" className={propertyTab === "template" ? "active" : ""} onClick={() => setPropertyTab("template")}>
            {t("promptTemplates.editor.formProperties")}
          </button>
          <button type="button" className={propertyTab === "component" ? "active" : ""} onClick={() => setPropertyTab("component")}>
            {t("promptTemplates.editor.componentProperties")}
          </button>
        </div>
        {propertyTab === "component" ? (
          selectedComponent ? (
            <div className="template-settings-card component-settings-card">
              <div className="component-detail-head">
                <h3>{t("promptTemplates.editor.componentProperties")}</h3>
                <span>{componentWidthLabel(selectedComponent, t)}</span>
              </div>
              <label className="template-setting-field">
                <span className="template-setting-label">{t("promptTemplates.editor.type")}</span>
                <CustomSelect
                  value={selectedComponent.type}
                  options={componentTypeOptions}
                  onChange={(type) => {
                    const nextType = type as PromptTemplateComponentType;
                    const patch: Partial<PromptTemplateComponent> = {
                      type: nextType,
                      width: nextType === "section" || nextType === "color"
                        ? "full"
                        : selectedComponent.type === "section"
                          ? defaultComponentWidth(nextType)
                          : componentWidth(selectedComponent)
                    };
                    if (nextType === "color") {
                      patch.colorOptions = selectedComponent.colorOptions ?? defaultPromptTemplateColorOptions;
                      patch.gradientOptions = selectedComponent.gradientOptions ?? defaultPromptTemplateGradientOptions;
                      patch.allowCustomColor = selectedComponent.allowCustomColor ?? true;
                    }
                    onPatchComponent(selectedComponent.id, patch);
                  }}
                />
              </label>
              {selectedComponent.type !== "section" ? (
                <label className="template-setting-field">
                  <span className="template-setting-label">{t("promptTemplates.editor.width")}</span>
                  <CustomSelect
                    value={componentWidth(selectedComponent)}
                    options={componentWidthOptions}
                    onChange={(width) => onPatchComponent(selectedComponent.id, { width: width as PromptTemplateComponentWidth })}
                  />
                </label>
              ) : (
                <label className="template-setting-field">
                  <span className="template-setting-label">{t("promptTemplates.editor.width")}</span>
                  <input value={t("promptTemplates.editor.widthFull")} readOnly />
                </label>
              )}
              <label className="template-setting-field">
                <span className="template-setting-label">{t("promptTemplates.editor.label")}</span>
                <input value={selectedComponent.label} onChange={(event) => onPatchComponent(selectedComponent.id, { label: event.target.value })} />
              </label>
              {selectedComponent.type !== "section" ? (
                <label className="template-setting-field">
                  <span className="template-setting-label" title={selectedComponent.type === "select" && selectedComponent.multiple ? t("promptTemplates.editor.defaultValueMulti") : t("promptTemplates.editor.defaultValue")}>
                    {selectedComponent.type === "select" && selectedComponent.multiple ? t("promptTemplates.editor.defaultValueMulti") : t("promptTemplates.editor.defaultValue")}
                  </span>
                  <input value={selectedComponent.defaultValue ?? ""} onChange={(event) => onPatchComponent(selectedComponent.id, { defaultValue: event.target.value })} />
                </label>
              ) : null}
              {selectedComponent.type === "text" || selectedComponent.type === "textarea" ? (
                <label className="template-setting-field wide">
                  <span className="template-setting-label">{t("promptTemplates.editor.placeholder")}</span>
                  <input value={selectedComponent.placeholder ?? ""} onChange={(event) => onPatchComponent(selectedComponent.id, { placeholder: event.target.value })} />
                </label>
              ) : null}
              {selectedComponent.type === "select" ? (
                <>
                  <label className="template-setting-field wide">
                    <span className="template-setting-label">{t("promptTemplates.editor.selectOptions")}</span>
                    <textarea
                      rows={4}
                      value={(selectedComponent.options ?? []).join("\n")}
                      onChange={(event) => onPatchComponent(selectedComponent.id, { options: event.target.value.split(/\n+/).map((item) => item.trim()).filter(Boolean) })}
                    />
                  </label>
                  <label className="template-checkbox">
                    <input
                      type="checkbox"
                      checked={Boolean(selectedComponent.multiple)}
                      onChange={(event) => onPatchComponent(selectedComponent.id, { multiple: event.target.checked })}
                    />
                    {t("promptTemplates.editor.allowMultiple")}
                  </label>
                </>
              ) : null}
              {selectedComponent.type === "color" ? (
                <ColorComponentSettings
                  component={selectedComponent}
                  onPatch={(patch) => onPatchComponent(selectedComponent.id, patch)}
                />
              ) : null}
              <label className="template-setting-field wide">
                <span className="template-setting-label">{t("promptTemplates.editor.helpText")}</span>
                <input value={selectedComponent.helpText ?? ""} onChange={(event) => onPatchComponent(selectedComponent.id, { helpText: event.target.value })} />
              </label>
              <label className="template-checkbox">
                <input
                  type="checkbox"
                  checked={Boolean(selectedComponent.required)}
                  onChange={(event) => onPatchComponent(selectedComponent.id, { required: event.target.checked })}
                  disabled={selectedComponent.type === "section"}
                />
                {t("promptTemplates.editor.required")}
              </label>
            </div>
          ) : (
            <div className="prompt-template-list-empty">{t("promptTemplates.editor.selectComponent")}</div>
          )
        ) : (
          <div className="template-settings-card template-meta-card">
            <h3>{t("promptTemplates.editor.formProperties")}</h3>
            <label className="template-setting-field">
              <span className="template-setting-label">{t("promptTemplates.editor.formName")}</span>
              <input value={template.name} onChange={(event) => onPatchTemplate({ name: event.target.value })} />
            </label>
            <label className="template-setting-field">
              <span className="template-setting-label">{t("promptTemplates.editor.icon")}</span>
              <CustomSelect
                value={template.icon}
                options={iconOptions}
                onChange={(icon) => onPatchTemplate({ icon })}
                className="template-icon-select"
                menuClassName="template-icon-select-menu"
              />
            </label>
            <label className="template-setting-field wide">
              <span className="template-setting-label">{t("promptTemplates.editor.formDescription")}</span>
              <input value={template.description} onChange={(event) => onPatchTemplate({ description: event.target.value })} />
            </label>
            <label className="template-setting-field wide">
              <span className="template-setting-label">{t("promptTemplates.editor.prefix")}</span>
              <textarea rows={2} value={template.rules.prefix ?? ""} onChange={(event) => onPatchTemplate({ rules: { ...template.rules, prefix: event.target.value } })} />
            </label>
            <label className="template-setting-field wide">
              <span className="template-setting-label">{t("promptTemplates.editor.suffix")}</span>
              <textarea rows={2} value={template.rules.suffix ?? ""} onChange={(event) => onPatchTemplate({ rules: { ...template.rules, suffix: event.target.value } })} />
            </label>
            <label className="template-setting-field wide">
              <span className="template-setting-label">{t("promptTemplates.negativePrompt")}</span>
              <textarea
                rows={2}
                value={manualNegativePrompt}
                onChange={(event) => {
                  const negativePrompt = event.target.value;
                  onPatchTemplate({
                    rules: { ...template.rules, negativePrompt },
                    output: {
                      ...template.output,
                      negativeEnabled: negativePrompt.trim() ? false : Boolean(template.output.negativeEnabled)
                    }
                  });
                }}
              />
            </label>
            <label
              className="template-checkbox"
              title={hasManualNegativePrompt ? t("promptTemplates.editor.manualNegativeHint") : t("promptTemplates.editor.aiNegativeHint")}
            >
              <input
                type="checkbox"
                checked={!hasManualNegativePrompt && Boolean(template.output.negativeEnabled)}
                disabled={hasManualNegativePrompt}
                onChange={(event) => onPatchTemplate({ output: { ...template.output, negativeEnabled: event.target.checked } })}
              />
              {t("promptTemplates.editor.aiNegative")}
            </label>
          </div>
        )}
      </aside>
      <button
        className="template-editor-property-resize-handle"
        type="button"
        aria-label={t("promptTemplates.resize.propertyWidth")}
        title={t("promptTemplates.resize.propertyWidth")}
        onPointerDown={beginPropertyPanelResize}
      >
        <span />
      </button>
      <div className="template-editor-preview-panel">
        <div className="template-editor-preview-head">
          <div>
            <strong>{t("promptTemplates.editor.livePreview")}</strong>
            <span>{t("promptTemplates.editor.livePreviewDesc")}</span>
          </div>
        </div>
        <TemplatePreview
          template={template}
          formValues={formValues}
          onChange={onFormValuesChange}
          selectedComponentId={selectedComponentId}
          onSelectComponent={selectComponentForEdit}
        />
      </div>
    </div>
  );
}

function ResultBlock({
  title,
  icon: Icon,
  content,
  badge,
  action,
  negativeContent = "",
  negativeLanguage = "zh",
  diffAgainst = "",
  diffEnabled = false,
  loading = false,
  typing = false
}: {
  title: string;
  icon: LucideIcon;
  content: string;
  badge?: ReactNode;
  action?: ReactNode;
  negativeContent?: string;
  negativeLanguage?: PromptDisplayLanguage;
  diffAgainst?: string;
  diffEnabled?: boolean;
  loading?: boolean;
  typing?: boolean;
}) {
  const { t } = useI18n();
  const negative = negativeContent.trim();
  const contentNode = diffEnabled ? renderPromptDiffText(content, diffAgainst) : content;
  return (
    <div className="result-block">
      <div className="result-block-title">
        <Icon size={16} />
        <strong>{title}</strong>
        {badge ? <div className="result-block-badge">{badge}</div> : null}
        {action ? <div className="result-block-action">{action}</div> : null}
      </div>
      {loading ? (
        <div className="result-skeleton" aria-label={t("promptTemplates.result.generating")}>
          <span />
          <span />
          <span />
          <span />
        </div>
      ) : (
        <div className="result-block-body">
          <pre className={typing ? "typing" : ""}>{contentNode}</pre>
          {negative ? (
            <div className="result-block-negative">
              <span>{negativeLanguage === "en" ? "Negative prompt" : t("promptTemplates.negativePrompt")}</span>
              <pre>{negative}</pre>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function HistoryDialog({
  results,
  loading,
  loadingMore,
  hasMore,
  usingPromptTarget,
  onLoadMore,
  onClose,
  onUse,
  onCopy,
  onUsePrompt
}: {
  results: PromptTemplateResult[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  usingPromptTarget: UsePromptTarget | "";
  onLoadMore: () => void;
  onClose: () => void;
  onUse: (result: PromptTemplateResult) => void;
  onCopy: (text: string) => void;
  onUsePrompt: (text: string, target: UsePromptTarget) => void;
}) {
  const { t, resolvedLanguage } = useI18n();
  const menuRef = useRef<HTMLElement | null>(null);
  const [selectedId, setSelectedId] = useState(() => results[0]?.id ?? "");
  const [displayLanguage, setDisplayLanguage] = useState<PromptDisplayLanguage>("zh");
  const [showDiff, setShowDiff] = useState(true);
  const [loadTarget, setLoadTarget] = useState<PromptTemplateResult | null>(null);

  useEffect(() => {
    if (results.length === 0) {
      setSelectedId("");
      return;
    }
    if (!results.some((result) => result.id === selectedId)) {
      setSelectedId(results[0].id);
    }
  }, [results, selectedId]);

  const selectedResult = results.find((result) => result.id === selectedId) ?? results[0] ?? null;
  const canSwitchEnglish = Boolean(selectedResult?.basePromptEn || selectedResult?.optimizedPrompts?.en || selectedResult?.negativePrompts?.en);
  const basePrompt = selectedResult
    ? (displayLanguage === "en" ? (selectedResult.basePromptEn || "") : selectedResult.basePrompt)
    : "";
  const baseNegativePrompt = displayLanguage === "zh" && selectedResult
    ? manualNegativePromptFromSnapshot(selectedResult.templateSnapshot)
    : "";
  const basePromptWithNegative = promptWithNegative(basePrompt, baseNegativePrompt, displayLanguage, t);
  const optimizedPrompt = selectedResult ? optimizedPromptForLanguage(selectedResult, displayLanguage, true) : "";
  const negativePrompt = selectedResult ? negativePromptForLanguage(selectedResult, displayLanguage, true) : "";
  const aiPromptWithNegative = promptWithNegative(optimizedPrompt, negativePrompt, displayLanguage, t);
  const diffEnabled = showDiff && Boolean(basePrompt.trim()) && Boolean(optimizedPrompt.trim());

  useEffect(() => {
    if (displayLanguage === "en" && selectedResult && !canSwitchEnglish) setDisplayLanguage("zh");
  }, [canSwitchEnglish, displayLanguage, selectedResult?.id]);

  function handleMenuScroll() {
    const element = menuRef.current;
    if (!element || !hasMore || loadingMore) return;
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 72) onLoadMore();
  }

  return (
    <div className="modal-backdrop">
      <section className="case-modal prompt-template-history-modal">
        <header>
          <div>
            <h3>{t("promptTemplates.history.title")}</h3>
            <p>{t("promptTemplates.history.desc")}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t("common.close")}><X size={18} /></button>
        </header>
        <div className="prompt-template-history-layout">
          <aside className="prompt-template-history-menu" aria-label={t("promptTemplates.history.menu")} ref={menuRef} onScroll={handleMenuScroll}>
            {loading ? <div className="prompt-template-list-empty">{t("common.loading")}</div> : null}
            {!loading && results.length === 0 ? <div className="prompt-template-list-empty">{t("promptTemplates.history.empty")}</div> : null}
            {results.map((result) => (
              <button
                type="button"
                key={result.id}
                className={result.id === selectedResult?.id ? "active" : ""}
                onClick={() => setSelectedId(result.id)}
              >
                <strong>{formatRelativeTemplateTime(result.createdAt, t)}</strong>
                <span>{formatTemplateDate(result.createdAt, resolvedLanguage)}</span>
              </button>
            ))}
            {loadingMore ? <div className="prompt-template-history-loading">{t("common.loading")}</div> : null}
            {!loading && !loadingMore && hasMore ? (
              <button type="button" className="prompt-template-history-more" onClick={onLoadMore}>
                {t("promptTemplates.actions.loadMore")}
              </button>
            ) : null}
          </aside>
          <section className="prompt-template-history-detail">
            {selectedResult ? (
              <>
                <div className="prompt-template-history-tools">
                  <div className="prompt-language-switch" role="tablist" aria-label={t("promptTemplates.history.language")}>
                    <button type="button" className={displayLanguage === "zh" ? "active" : ""} onClick={() => setDisplayLanguage("zh")}>
                      {t("promptTemplates.language.zh")}
                    </button>
                    <button
                      type="button"
                      className={displayLanguage === "en" ? "active" : ""}
                      onClick={() => setDisplayLanguage("en")}
                      disabled={!canSwitchEnglish}
                      title={canSwitchEnglish ? t("promptTemplates.actions.switchEnglish") : t("promptTemplates.history.noEnglish")}
                    >
                      EN
                    </button>
                  </div>
                  <button
                    type="button"
                    className={cx("prompt-diff-switch", showDiff && "active")}
                    aria-pressed={showDiff}
                    onClick={() => setShowDiff((current) => !current)}
                    title={showDiff ? t("promptTemplates.actions.hideDiff") : t("promptTemplates.actions.showDiff")}
                  >
                    <span aria-hidden="true" />
                    {t("promptTemplates.actions.showDiff")}
                  </button>
                  <div className="prompt-template-history-actions">
                    <button className="secondary-btn" type="button" onClick={() => setLoadTarget(selectedResult)}>
                      <Check size={15} />
                      {t("promptTemplates.actions.load")}
                    </button>
                  </div>
                </div>
                <div className="prompt-template-history-content">
                  <div className="prompt-template-history-block">
                    <div className="prompt-template-history-block-title">
                      <div className="prompt-template-history-block-title-main">
                        <FileText size={16} />
                        <strong>{t("promptTemplates.result.baseTitle")}</strong>
                      </div>
                      <div className="prompt-template-history-block-actions">
                        <button
                          className="secondary-btn icon-only-btn"
                          type="button"
                          onClick={() => onUsePrompt(basePromptWithNegative, "base")}
                          disabled={Boolean(usingPromptTarget) || !basePromptWithNegative.trim()}
                          aria-label={usingPromptTarget === "base" ? t("promptTemplates.actions.sending") : t("promptTemplates.actions.useBasePrompt")}
                          title={usingPromptTarget === "base" ? t("promptTemplates.actions.sending") : t("common.use")}
                        >
                          <Send size={15} />
                        </button>
                        <button
                          className="secondary-btn icon-only-btn"
                          type="button"
                          onClick={() => onCopy(basePromptWithNegative)}
                          disabled={!basePromptWithNegative.trim()}
                          aria-label={t("promptTemplates.actions.copyBasePrompt")}
                          title={t("common.copy")}
                        >
                          <Copy size={15} />
                        </button>
                      </div>
                    </div>
                    <pre>{basePrompt || (displayLanguage === "en" ? t("promptTemplates.history.noEnglishBase") : t("promptTemplates.history.noBase"))}</pre>
                    {baseNegativePrompt ? (
                      <div className="prompt-template-history-negative">
                        <span>{t("promptTemplates.negativePrompt")}</span>
                        <pre>{baseNegativePrompt}</pre>
                      </div>
                    ) : null}
                  </div>
                  <div className="prompt-template-history-block primary">
                    <div className="prompt-template-history-block-title">
                      <div className="prompt-template-history-block-title-main">
                        <Sparkles size={16} />
                        <strong>{t("promptTemplates.result.aiTitle")}</strong>
                      </div>
                      <div className="prompt-template-history-block-actions">
                        <button
                          className="secondary-btn icon-only-btn"
                          type="button"
                          onClick={() => onUsePrompt(aiPromptWithNegative, "ai")}
                          disabled={Boolean(usingPromptTarget) || !aiPromptWithNegative.trim()}
                          aria-label={usingPromptTarget === "ai" ? t("promptTemplates.actions.sending") : t("promptTemplates.actions.useAiPrompt")}
                          title={usingPromptTarget === "ai" ? t("promptTemplates.actions.sending") : t("common.use")}
                        >
                          <Send size={15} />
                        </button>
                        <button
                          className="secondary-btn icon-only-btn"
                          type="button"
                          onClick={() => onCopy(aiPromptWithNegative)}
                          disabled={!aiPromptWithNegative.trim()}
                          aria-label={t("promptTemplates.actions.copyAiPrompt")}
                          title={t("common.copy")}
                        >
                          <Copy size={15} />
                        </button>
                      </div>
                    </div>
                    <pre>
                      {diffEnabled
                        ? renderPromptDiffText(optimizedPrompt, basePrompt)
                        : (optimizedPrompt || (displayLanguage === "en" ? t("promptTemplates.history.noEnglishAi") : t("promptTemplates.history.noAi")))}
                    </pre>
                    {negativePrompt ? (
                      <div className="prompt-template-history-negative">
                        <span>{displayLanguage === "en" ? "Negative prompt" : t("promptTemplates.negativePrompt")}</span>
                        <pre>{negativePrompt}</pre>
                      </div>
                    ) : null}
                  </div>
                </div>
              </>
            ) : (
              <div className="prompt-template-list-empty">{t("promptTemplates.history.empty")}</div>
            )}
          </section>
        </div>
      </section>
      <ConfirmDialog
        open={Boolean(loadTarget)}
        title={t("promptTemplates.history.loadTitle")}
        description={loadTarget ? t("promptTemplates.history.loadDescription", { time: formatRelativeTemplateTime(loadTarget.createdAt, t) }) : ""}
        confirmText={t("promptTemplates.actions.load")}
        onCancel={() => setLoadTarget(null)}
        onConfirm={() => {
          if (!loadTarget) return;
          const target = loadTarget;
          setLoadTarget(null);
          onUse(target);
        }}
      />
    </div>
  );
}
