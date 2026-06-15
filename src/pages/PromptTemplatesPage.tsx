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
import { SearchHistoryInput } from "../components/SearchHistoryInput";
import { copyTextToClipboard } from "../lib/clipboard";
import { cx } from "../lib/cx";
import {
  normalizePromptOptimizeStyle,
  promptOptimizeStyleOption,
  sanitizePromptOptimizeStyleGroups
} from "../lib/promptOptimizeStyles";
import {
  buildBasePrompt,
  duplicatePromptTemplateComponent,
  initialPromptTemplateFormValues,
  promptTemplateDefaultValues,
  promptTemplateSignature,
  sortedPromptTemplateComponents
} from "../lib/promptTemplates";
import { useWorkbench } from "../store/workbench";
import type {
  AssetItem,
  PromptTemplate,
  PromptTemplateComponent,
  PromptTemplateComponentWidth,
  PromptTemplateComponentType,
  PromptTemplateFormValues,
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

const PROMPT_RESULT_WIDTH_STORAGE_KEY = "prompt-template-result-panel-width";
const PROMPT_RESULT_MIN_WIDTH = 330;
const PROMPT_RESULT_MAX_WIDTH = 760;
const PROMPT_RESULT_DEFAULT_WIDTH = PROMPT_RESULT_MAX_WIDTH;
const PROMPT_TEMPLATE_THUMB_MAX_SIZE = 320;
const PROMPT_DIFF_MAX_CELLS = 160000;
const PROMPT_TEMPLATE_HISTORY_PAGE_SIZE = 20;
const PROMPT_TEMPLATE_EXPORT_DOWNLOAD_PAGE_SIZE = 12;

const iconMap: Record<string, LucideIcon> = {
  Sparkles,
  Sparkle,
  Image: ImageIcon,
  Megaphone,
  Film,
  Camera,
  Clapperboard,
  Video,
  Tv,
  PanelsTopLeft,
  Palette,
  Brush,
  PenTool,
  Shapes,
  Layers,
  Frame,
  LayoutTemplate,
  Type,
  FileText,
  Newspaper,
  ScrollText,
  ClipboardList,
  BookOpen,
  WandSparkles,
  Box,
  Package,
  PackageCheck,
  ShoppingBag,
  ShoppingCart,
  Store,
  Tag,
  BadgePercent,
  ReceiptText,
  WalletCards,
  Shirt,
  Gem,
  Gift,
  Crown,
  BadgeCheck,
  Calendar,
  Ticket,
  PartyPopper,
  Trophy,
  MapPin,
  House,
  Building2,
  Landmark,
  Hotel,
  Car,
  Plane,
  Truck,
  Globe,
  Mountain,
  Waves,
  Sun,
  Trees,
  Leaf,
  Sprout,
  Flower2,
  Umbrella,
  Utensils,
  Coffee,
  Pizza,
  Music,
  Podcast,
  Radio,
  Mic,
  Gamepad2,
  Heart,
  Star,
  Smile,
  Users,
  Smartphone,
  Laptop,
  Monitor,
  Lightbulb,
  Rocket,
  Target,
  Workflow,
  ScanEye,
  Zap,
  Briefcase,
  Handshake,
  Sofa,
  Armchair
};

const iconLabels: Record<string, string> = {
  Sparkles: "星光",
  Sparkle: "闪光",
  Image: "图片",
  Megaphone: "宣传",
  Film: "影片",
  Camera: "摄影",
  Clapperboard: "视频",
  Video: "影像",
  Tv: "电视",
  PanelsTopLeft: "界面布局",
  Palette: "调色板",
  Brush: "绘画",
  PenTool: "设计",
  Shapes: "形状",
  Layers: "层次",
  Frame: "画框",
  LayoutTemplate: "表单布局",
  Type: "文字",
  FileText: "文档",
  Newspaper: "资讯",
  ScrollText: "文案",
  ClipboardList: "清单",
  BookOpen: "书籍",
  WandSparkles: "魔法棒",
  Box: "产品",
  Package: "包裹",
  PackageCheck: "交付",
  ShoppingBag: "购物袋",
  ShoppingCart: "购物车",
  Store: "门店",
  Tag: "标签",
  BadgePercent: "优惠",
  ReceiptText: "票据",
  WalletCards: "钱包",
  Shirt: "服饰",
  Gem: "精品",
  Gift: "礼物",
  Crown: "高级",
  BadgeCheck: "认证",
  Calendar: "活动",
  Ticket: "票券",
  PartyPopper: "庆典",
  Trophy: "奖杯",
  MapPin: "地点",
  House: "家居",
  Building2: "建筑",
  Landmark: "地标",
  Hotel: "酒店",
  Car: "出行",
  Plane: "旅行",
  Truck: "物流",
  Globe: "全球",
  Mountain: "山景",
  Waves: "水景",
  Sun: "阳光",
  Trees: "自然",
  Leaf: "绿植",
  Sprout: "生长",
  Flower2: "花卉",
  Umbrella: "雨伞",
  Utensils: "餐饮",
  Coffee: "咖啡",
  Pizza: "美食",
  Music: "音乐",
  Podcast: "播客",
  Radio: "广播",
  Mic: "麦克风",
  Gamepad2: "游戏",
  Heart: "情感",
  Star: "亮点",
  Smile: "人物",
  Users: "人群",
  Smartphone: "数码",
  Laptop: "电脑",
  Monitor: "屏幕",
  Lightbulb: "灵感",
  Rocket: "启动",
  Target: "目标",
  Workflow: "流程",
  ScanEye: "视觉",
  Zap: "闪电",
  Briefcase: "商务",
  Handshake: "合作",
  Sofa: "沙发",
  Armchair: "座椅"
};

const iconOptions = Object.entries(iconMap).map(([name, Icon]) => ({
  value: name,
  label: iconLabels[name] ?? name,
  description: name,
  icon: <Icon size={15} />
}));

const componentTypeOptions: Array<{ value: PromptTemplateComponentType; label: string; description: string }> = [
  { value: "text", label: "短输入框", description: "单行文本" },
  { value: "textarea", label: "长文本框", description: "多行描述" },
  { value: "select", label: "下拉框", description: "固定选项" },
  { value: "image", label: "素材", description: "上传素材并填写备注，不做识图" },
  { value: "section", label: "分组标题", description: "组织表单结构" }
];

const scopeOptions: Array<{ value: TemplateScope; label: string }> = [
  { value: "all", label: "全部" },
  { value: "mine", label: "我的" },
  { value: "shared", label: "共享" }
];

const componentWidthOptions: Array<{ value: PromptTemplateComponentWidth; label: string }> = [
  { value: "full", label: "占用全部内容" },
  { value: "half", label: "占用半行" }
];

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

function promptWithNegative(prompt: string, negativePrompt: string, language: PromptDisplayLanguage) {
  const positive = prompt.trim();
  const negative = negativePrompt.trim();
  if (!positive) return "";
  if (!negative) return positive;
  const title = language === "en" ? "Negative prompt" : "反向提示词";
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
  placeholder = "请选择"
}: {
  values: string[];
  options: Array<{ value: string; label: string }>;
  onChange: (values: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const selectedSet = useMemo(() => new Set(values), [values]);
  const selectedLabels = options.filter((option) => selectedSet.has(option.value)).map((option) => option.label);

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
            {selectedLabels.length > 0 ? selectedLabels.join("、") : placeholder}
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
          {options.length === 0 ? <div className="custom-select-empty">暂无选项</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function iconFor(name: string) {
  return iconMap[name] ?? Sparkles;
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

function componentWidthLabel(component: PromptTemplateComponent) {
  return componentWidth(component) === "half" ? "半行" : "整行";
}

function componentLayoutClass(component: PromptTemplateComponent) {
  return componentWidth(component) === "half" ? "layout-half" : "layout-full";
}

function newComponent(type: PromptTemplateComponentType): PromptTemplateComponent {
  const stamp = Date.now().toString(36);
  const option = componentTypeOptions.find((item) => item.value === type);
  return {
    id: `${type}_${stamp}`,
    type,
    label: option?.label ?? "组件",
    placeholder: type === "text" || type === "textarea" ? "填写内容" : "",
    options: type === "select" ? ["选项一", "选项二"] : [],
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
      options: component.type === "select" ? component.options ?? [] : component.options
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

function sharedOwnerLabel(template: PromptTemplate) {
  if (template.visibility !== "shared" || template.canEdit) return "";
  return template.ownerName.trim() || "共享";
}

function formatTemplateDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatRelativeTemplateTime(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const diffMs = Date.now() - time;
  if (diffMs < 60 * 1000) return "刚刚";
  const minutes = Math.floor(diffMs / (60 * 1000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  const years = Math.floor(months / 12);
  return `${years} 年前`;
}

function formatPromptTemplateExportTime(value: number | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function promptTemplateExportStatusLabel(download: PromptTemplateExportDownload) {
  if (download.variant !== "ai") return "无 AI";
  if (download.status === "active") return "有效";
  if (download.status === "expired") return "已过期";
  if (download.status === "revoked") return "已失效";
  return "已下载";
}

function promptTemplateExportStatusText(download: PromptTemplateExportDownload) {
  if (download.variant !== "ai") return "基础版";
  if (download.status === "active") {
    return download.expiresAt ? `有效至 ${formatPromptTemplateExportTime(download.expiresAt)}` : "永久有效";
  }
  if (download.status === "expired") return `过期于 ${formatPromptTemplateExportTime(download.expiresAt)}`;
  if (download.status === "revoked") return `失效于 ${formatPromptTemplateExportTime(download.revokedAt)}`;
  return "已下载";
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

export function PromptTemplatesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();
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
        showToast("表单已新建");
      }
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "新建失败", "error")
  });
  const saveTemplate = useMutation({
    mutationFn: (template: PromptTemplate) => api.updatePromptTemplate(template.id, payloadFromTemplate(syncRules(template))),
    onSuccess: (data) => {
      invalidateTemplates();
      if (data.template) {
        setWorkingTemplate(data.template);
        setSelectedId(data.template.id);
      }
      showToast("表单已保存");
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "保存失败", "error")
  });
  const restoreDefaultTemplates = useMutation({
    mutationFn: () => api.restoreDefaultPromptTemplates(),
    onSuccess: (data) => {
      setKeyword("");
      setScope("all");
      invalidateTemplates();
      if (data.templates[0]) setSelectedId(data.templates[0].id);
      showToast(data.created > 0 ? "默认表单已初始化" : "默认表单已存在");
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "初始化失败", "error")
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
      showToast("表单已复制到我的表单");
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "复制失败", "error")
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
      showToast(data.template?.visibility === "shared" ? "表单已共享" : "已取消共享");
    },
    onError: (error, template, context) => {
      if (context?.previousVisibility) patchTemplateVisibility(template.id, context.previousVisibility);
      showToast(error instanceof Error ? error.message : "分享设置失败", "error");
    }
  });
  const removeTemplate = useMutation({
    mutationFn: (id: string) => api.deletePromptTemplate(id),
    onSuccess: () => {
      setDeleteTarget(null);
      setSelectedId("");
      invalidateTemplates();
      showToast("表单已删除");
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "删除失败", "error")
  });
  const revokeExportDownloads = useMutation({
    mutationFn: (templateId: string) => api.revokePromptTemplateExportDownloads(templateId),
    onSuccess: (data, templateId) => {
      setRevokeDownloadLinksOpen(false);
      queryClient.invalidateQueries({ queryKey: ["prompt-template-export-downloads", templateId] });
      showToast(data.revokedCount > 0 ? `已失效 ${data.revokedCount} 个 AI 优化链接` : "已记录失效时间，旧 AI 优化链接将不可用");
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "失效 AI 优化链接失败", "error")
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
    onError: (error) => showToast(error instanceof Error ? error.message : "优化风格保存失败", "error")
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
        showToast("AI 优化完成，已生成中英文提示词");
      } else {
        showToast("AI 优化已结束，但没有返回结果", "info");
      }
    },
    onError: (error) => {
      setStreamingOptimizedPromptZh("");
      setStreamingOptimizedPromptEn("");
      showToast(error instanceof Error ? error.message : "AI 优化失败，基础提示词仍可使用", "error");
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
      showToast("基础提示词已翻译");
    },
    onError: (error) => {
      setStreamingBasePromptEn("");
      showToast(error instanceof Error ? error.message : "基础提示词翻译失败", "error");
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
  const activePromptWithNegative = promptWithNegative(activeOptimizedPrompt, displayNegativePrompt, activeDisplayLanguage);
  const aiPromptNegativeContent = displayNegativePrompt || (template?.output.negativeEnabled ? "AI优化成功后生成反向提示词" : "");
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
  const basePromptWithNegative = promptWithNegative(basePromptActionText, baseNegativePrompt, baseDisplayLanguage);
  const optimizeStyleOption = promptOptimizeStyleOption(optimizeStyle, promptOptimizeStyleGroups);
  const optimizeActionLabel = optimize.isPending ? "优化中" : activeResult ? "重新优化" : "AI 优化";
  const baseTranslateActionLabel = translateBasePrompt.isPending
    ? "翻译中"
    : baseDisplayLanguage === "en"
      ? "重新翻译"
      : savedBasePromptEn && !baseNegativePromptNeedsTranslation
        ? "查看英文"
        : "翻译英文";

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
    || (canSwitchAiPromptLanguage && activeResult ? (activeDisplayLanguage === "en" ? "英文版本生成中或需要重新优化。" : "中文版本需要重新优化后显示。") : "")
    || "AI 优化成功后会显示专业版；当前可使用基础提示词。";
  const aiPromptDiffBase = activeDisplayLanguage === "en"
    ? (activeResult?.basePromptEn || savedBasePromptEn || (baseDisplayLanguage === "en" ? basePromptContent : ""))
    : basePrompt;
  const aiPromptDiffEnabled = showPromptDiff
    && Boolean(aiPromptDiffBase.trim())
    && Boolean((streamingPrompt || typedOptimizedPrompt || activeOptimizedPrompt).trim());
  const basePromptBadge = (
    <>
      <div className="prompt-language-switch" role="tablist" aria-label="基础提示词语言">
        <button type="button" className={baseDisplayLanguage === "zh" ? "active" : ""} onClick={() => setPromptDisplayLanguage("zh")}>
          中
        </button>
        <button type="button" className={baseDisplayLanguage === "en" ? "active" : ""} onClick={() => setPromptDisplayLanguage("en")}>
          EN
        </button>
      </div>
      {basePromptNeedsTranslation ? <strong className="stale-badge">需要重新翻译</strong> : null}
    </>
  );
  const aiPromptBadge = canSwitchAiPromptLanguage || activeResult ? (
    <>
      <div className="prompt-language-switch" role="tablist" aria-label="AI提示词语言">
        <button type="button" className={activeDisplayLanguage === "zh" ? "active" : ""} onClick={() => setPromptDisplayLanguage("zh")}>
          中
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
        title={showPromptDiff ? "隐藏差异" : "显示差异"}
      >
        <span aria-hidden="true" />
        显示差异
      </button>
      {optimize.isPending ? <strong className="fresh-badge">{activeDisplayLanguage === "en" ? "翻译中" : "优化中"}</strong> : null}
      {activeResult && !optimize.isPending ? (resultStale ? <strong className="stale-badge">需要重新优化</strong> : <strong className="fresh-badge">已优化</strong>) : null}
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
        console.warn("表单草稿保存失败", error);
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
    showToast(ok ? "已复制提示词" : "复制失败", ok ? "success" : "error");
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
      showToast(`已带入提示词，${failedCount} 张素材缺少原图，请重新上传`, "error");
    } else if (assets.length > 0) {
      showToast(`已带入新对话和 ${assets.length} 张素材`);
    } else {
      showToast("已带入新对话");
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
        let message = "下载失败";
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
      showToast("网页已开始下载");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "下载失败", "error");
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
          <div className="prompt-template-scope-tabs" role="tablist" aria-label="表单分组">
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
            aria-label="新建提示词表单"
            title="新建提示词表单"
          >
            <Plus size={16} />
          </button>
        </div>
        <SearchHistoryInput
          scope="promptTemplates"
          value={keyword}
          onChange={setKeyword}
          placeholder="搜索表单"
          className="case-search prompt-template-search"
          icon={<Search size={17} />}
        />
        <div className="prompt-template-list">
          {templatesQuery.isLoading ? Array.from({ length: 6 }).map((_, index) => <div className="prompt-template-skeleton" key={index} />) : null}
          {templates.map((item) => {
            const Icon = iconFor(item.icon);
            const ownerLabel = sharedOwnerLabel(item);
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
                    <button type="button" aria-label="重命名" title="重命名" onClick={(event) => { event.stopPropagation(); setPromptDialog({ kind: "rename", template: item }); }}>
                      <Pencil size={14} />
                    </button>
                  ) : null}
                  {item.canCopy ? (
                    <button type="button" aria-label="复制表单" title="复制表单" onClick={(event) => { event.stopPropagation(); copyTemplate.mutate(item.id); }}>
                      <Copy size={14} />
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
          {!templatesQuery.isLoading && templates.length === 0 ? (
            <div className="prompt-template-list-empty prompt-template-list-empty-action">
              <span>{canRestoreDefaultForms ? "还没有表单" : "没有匹配表单"}</span>
              {canRestoreDefaultForms ? (
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={() => restoreDefaultTemplates.mutate()}
                  disabled={restoreDefaultTemplates.isPending}
                >
                  {restoreDefaultTemplates.isPending ? <RotateCw size={15} className="spin" /> : <Sparkles size={15} />}
                  初始化默认表单
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
            <strong>暂无表单</strong>
            <span>当前筛选下没有可用表单</span>
          </div>
        </section>
        <aside className="prompt-template-result-panel">
          <ResultBlock title="基础提示词" icon={FileText} content="选择表单后会在这里生成提示词" />
        </aside>
      </div>
    );
  }

  const TemplateIcon = iconFor(template.icon);
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
                aria-label="复制"
                title="复制"
              >
                <Copy size={16} />
              </button>
            ) : null}
            {template.canEdit ? (
              <button
                className="secondary-btn icon-only-btn"
                type="button"
                onClick={() => navigate(`/prompt-templates/${encodeURIComponent(template.id)}/edit${templateWorkbenchSearch(scope, keyword, template.id)}`)}
                aria-label="编辑表单"
                title="编辑表单"
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
                aria-label={template.visibility === "shared" ? "取消共享" : "共享表单"}
                title={template.visibility === "shared" ? "取消共享" : "共享表单"}
              >
                <Share2 size={16} />
              </button>
            ) : null}
            <button className="secondary-btn icon-only-btn" type="button" onClick={() => setDownloadDialogOpen(true)} aria-label="下载网页" title="下载网页">
              <Download size={16} />
            </button>
            {template.canDelete ? (
              <button className="danger-btn icon-only-btn" type="button" onClick={() => setDeleteTarget(template)} aria-label="删除" title="删除">
                <Trash2 size={16} />
              </button>
            ) : null}
          </div>
        </header>

        <TemplatePreview
          template={template}
          formValues={formValues}
          onChange={handleFormValuesChange}
          emptyActionLabel="去编辑"
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
        aria-label="拖动调整提示词结果宽度"
        title="拖动调整提示词结果宽度"
        onPointerDown={beginResultResize}
      >
        <span />
      </button>

      <aside className="prompt-template-result-panel">
        <div className="prompt-template-result-blocks" ref={resultBlocksRef} style={{ gridTemplateRows: resultBlockRows }}>
          <ResultBlock
            title="基础提示词"
            icon={FileText}
            content={basePromptContent || (baseDisplayLanguage === "en" ? "英文版本需要重新翻译后显示。" : "填写表单后自动生成基础提示词")}
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
                  aria-label={usingPromptTarget === "base" ? "带入中" : "去使用"}
                  title={usingPromptTarget === "base" ? "带入中" : "去使用"}
                >
                  <Send size={15} />
                </button>
                <button
                  className="secondary-btn icon-only-btn result-action-btn"
                  type="button"
                  onClick={() => copyPrompt(basePromptWithNegative)}
                  disabled={!basePromptWithNegative.trim() || basePromptLoading}
                  aria-label="复制"
                  title="复制"
                >
                  <Copy size={15} />
                </button>
                <button
                  className="secondary-btn icon-only-btn"
                  type="button"
                  onClick={() => setHistoryOpen(true)}
                  aria-label="历史结果"
                  title="历史结果"
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
            aria-label="拖动调整基础提示词和AI提示词高度"
            title="拖动调整基础提示词和AI提示词高度"
            onPointerDown={beginResultHeightResize}
          >
            <span />
          </button>
          <ResultBlock
            title="AI提示词"
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
                  aria-label={usingPromptTarget === "ai" ? "带入中" : "去使用"}
                  title={usingPromptTarget === "ai" ? "带入中" : "去使用"}
                >
                  <Send size={15} />
                </button>
                <button
                  className="secondary-btn icon-only-btn"
                  type="button"
                  onClick={() => copyPrompt(displayPrompt)}
                  disabled={!displayPrompt.trim() || (optimize.isPending && !streamingPrompt)}
                  aria-label="复制"
                  title="复制"
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
                    aria-label={`${optimizeActionLabel}，${optimizeStyleOption.label}风格`}
                    title={`${optimizeActionLabel}，${optimizeStyleOption.label}风格`}
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
          <section className="prompt-template-download-dialog" role="dialog" aria-modal="true" aria-label="下载网页">
            <header>
              <div>
                <span className="prompt-template-download-icon" aria-hidden="true">
                  <Download size={18} />
                </span>
                <div>
                  <strong>下载网页</strong>
                  <p>选择导出的 HTML 能力版本，下载后可单独打开使用。</p>
                </div>
              </div>
              <button className="icon-only-btn secondary-btn" type="button" onClick={() => setDownloadDialogOpen(false)} aria-label="关闭">
                <X size={16} />
              </button>
            </header>
            <div className="prompt-template-download-validity">
              <div>
                <strong>AI 优化有效期</strong>
                <small>默认永久有效。填写天数后，超过时间需要重新下载网页。</small>
              </div>
              <div className="prompt-template-expiry-controls">
                <button
                  type="button"
                  className={downloadAuthDays.trim() === "" ? "active" : ""}
                  onClick={() => setDownloadAuthDays("")}
                >
                  永久
                </button>
                <input
                  value={downloadAuthDays}
                  onChange={(event) => setDownloadAuthDays(event.target.value.replace(/\D/g, "").slice(0, 5))}
                  inputMode="numeric"
                  placeholder="自定义天数"
                  aria-label="AI 优化有效天数"
                />
                <button
                  type="button"
                  className="prompt-template-revoke-inline-btn"
                  onClick={() => setRevokeDownloadLinksOpen(true)}
                  disabled={!template || revokeExportDownloads.isPending}
                  title={activeAiExportDownloads > 0 ? `当前有 ${activeAiExportDownloads} 个 AI 优化链接有效` : "当前没有有效的 AI 优化链接"}
                >
                  失效所有 AI 优化链接
                </button>
              </div>
            </div>
            <div className="prompt-template-download-options">
              <button type="button" className="prompt-template-download-option" onClick={() => downloadTemplateHtml(true)}>
                <span className="prompt-template-download-option-icon" aria-hidden="true">
                  <WandSparkles size={18} />
                </span>
                <span>
                  <strong>AI 优化版</strong>
                  <small>包含 AI 优化按钮。使用时需要原应用服务可访问；如果设置了有效期，到期后重新下载即可。</small>
                </span>
              </button>
              <button type="button" className="prompt-template-download-option" onClick={() => downloadTemplateHtml(false)}>
                <span className="prompt-template-download-option-icon" aria-hidden="true">
                  <FileText size={18} />
                </span>
                <span>
                  <strong>无 AI 优化</strong>
                  <small>适合离线填写和复制基础提示词，不需要连接原应用服务。</small>
                </span>
              </button>
            </div>
            <div className="prompt-template-download-records">
              <div>
                <strong>下载记录</strong>
                <small>记录当前账号下载的该表单网页，以及 AI 优化链接状态。</small>
              </div>
              {exportDownloadsQuery.isFetching && exportDownloads.length === 0 ? (
                <p className="prompt-template-download-record-empty">加载中...</p>
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
                        {promptTemplateExportStatusLabel(download)}
                      </span>
                      <div>
                        <strong>{download.variant === "ai" ? "AI 优化版" : "无 AI 优化"}</strong>
                        <small>
                          {formatPromptTemplateExportTime(download.issuedAt)}
                          {download.variant === "ai" ? ` · ${promptTemplateExportStatusText(download)} · 使用 ${download.useCount} 次` : " · 基础提示词表单"}
                        </small>
                      </div>
                    </div>
                  ))}
                  {exportDownloadsQuery.isFetchingNextPage ? (
                    <p className="prompt-template-download-record-empty">加载更多...</p>
                  ) : null}
                  {exportDownloadsQuery.hasNextPage && !exportDownloadsQuery.isFetchingNextPage ? (
                    <button
                      className="prompt-template-download-record-more"
                      type="button"
                      onClick={() => exportDownloadsQuery.fetchNextPage()}
                    >
                      加载更多
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="prompt-template-download-record-empty">暂无下载记录</p>
              )}
            </div>
          </section>
        </div>
      ) : null}

      <PromptDialog
        open={Boolean(promptDialog)}
        title="重命名表单"
        label="表单名称"
        defaultValue={promptDialog?.template.name ?? ""}
        confirmText="保存"
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
        title="删除表单"
        description={deleteTarget ? `确认删除「${deleteTarget.name}」？已保存的优化历史也会删除。` : ""}
        confirmText="删除"
        destructive
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && removeTemplate.mutate(deleteTarget.id)}
      />
      <ConfirmDialog
        open={revokeDownloadLinksOpen}
        title="失效 AI 优化链接"
        description={template ? `确认失效「${template.name}」之前下载的 AI 优化版网页？旧网页仍可打开和复制基础提示词，但 AI 优化和翻译将不可用。` : ""}
        confirmText="确认失效"
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
      showToast("表单已保存");
    },
    onError: (error) => showToast(error instanceof Error ? error.message : "保存失败", "error")
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
      // 保存失败时停留在编辑页，错误提示由 mutation 统一处理。
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
    const component = newComponent(type);
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
            返回
          </button>
          <div className="prompt-template-edit-title">
            <div>
              <h1>加载中</h1>
              <span>提示表单编辑</span>
            </div>
          </div>
        </div>
        <div className="prompt-template-list-empty">正在加载表单</div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="prompt-template-edit-page">
        <div className="prompt-template-edit-topbar">
          <button className="secondary-btn" type="button" onClick={() => { void backToWorkbench(); }} disabled={saveTemplate.isPending}>
            <ArrowLeft size={16} />
            返回
          </button>
          <div className="prompt-template-edit-title">
            <div>
              <h1>表单不存在</h1>
              <span>提示表单编辑</span>
            </div>
          </div>
        </div>
        <div className="prompt-template-list-empty">没有找到这个表单</div>
      </div>
    );
  }

  const TemplateIcon = iconFor(template.icon);

  return (
    <div className="prompt-template-edit-page">
      <div className="prompt-template-edit-topbar">
        <button className="secondary-btn" type="button" onClick={backToWorkbench} disabled={saveTemplate.isPending}>
          <ArrowLeft size={16} />
          返回
        </button>
        <div className="prompt-template-edit-title">
          <div className="prompt-template-title-icon">
            <TemplateIcon size={20} />
          </div>
          <div>
            <div className="prompt-template-edit-title-row">
              <h1>{template.name}</h1>
              {hasUnsavedChanges ? <span className="prompt-template-dirty-badge">有更改</span> : null}
            </div>
            <span>提示表单编辑</span>
          </div>
        </div>
        <div className="prompt-template-edit-actions">
          <button className="primary-btn" type="button" onClick={() => saveTemplate.mutate(template)} disabled={saveTemplate.isPending}>
            {saveTemplate.isPending ? <RotateCw size={16} className="spin" /> : <Save size={16} />}
            {saveTemplate.isPending ? "保存中" : "保存"}
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
              <h3>返回前保存更改？</h3>
              <button type="button" onClick={() => setBackConfirmOpen(false)} aria-label="关闭" disabled={saveTemplate.isPending}>
                <X size={18} />
              </button>
            </header>
            <p>当前表单有未保存的更改，可以保存后返回，也可以不保存直接返回。</p>
            <div className="prompt-template-unsaved-actions">
              <button className="secondary-btn" type="button" onClick={() => setBackConfirmOpen(false)} disabled={saveTemplate.isPending}>
                取消
              </button>
              <button className="secondary-btn" type="button" onClick={discardAndBackToWorkbench} disabled={saveTemplate.isPending}>
                不保存
              </button>
              <button className="primary-btn" type="button" onClick={() => { void saveAndBackToWorkbench(); }} disabled={saveTemplate.isPending}>
                {saveTemplate.isPending ? <RotateCw size={16} className="spin" /> : <Save size={16} />}
                {saveTemplate.isPending ? "保存中" : "保存并返回"}
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
          <strong>还没有表单项</strong>
          <span>添加字段后，这里会显示可填写的表单。</span>
          {onEmptyAction ? (
            <button className="primary-btn" type="button" onClick={onEmptyAction}>
              <Pencil size={16} />
              {emptyActionLabel || "去编辑"}
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
                        showToast(`${failedCount} 张素材原图保存失败`, "error");
                      }
                      input.value = "";
                    }}
                  />
                  <span className="template-upload-pick-icon">
                    <Upload size={18} />
                  </span>
                  <span>
                    <strong>选择素材</strong>
                    <small>支持多张图片，可继续追加</small>
                  </span>
                </label>
                <input
                  value={String(imageValue.note ?? "")}
                  placeholder="素材备注"
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
                            {Number(file.width) > 0 && Number(file.height) > 0 ? `${file.width} x ${file.height}` : "尺寸未知"}
                            {formatImageFileSize(file.size) ? ` · ${formatImageFileSize(file.size)}` : ""}
                          </span>
                        </div>
                        <button type="button" aria-label="移除素材" onClick={(event) => { event.preventDefault(); removeImageFile(file.id); }}>
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
  const [draggingComponentId, setDraggingComponentId] = useState("");
  const [dragOverComponentId, setDragOverComponentId] = useState("");
  const draggingComponentIdRef = useRef("");
  const components = sortedPromptTemplateComponents(template.components);
  const [propertyTab, setPropertyTab] = useState<PropertyTab>("template");
  const manualNegativePrompt = String(template.rules.negativePrompt ?? "");
  const hasManualNegativePrompt = Boolean(manualNegativePrompt.trim());

  useEffect(() => {
    if (components.length === 0) setPropertyTab("template");
  }, [components.length]);

  useEffect(() => {
    setPropertyTab("template");
  }, [template.id]);

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

  return (
    <div className="template-editor">
      <aside className="template-builder-panel">
        <div className="template-builder-section">
          <div className="template-builder-head">
            <div>
              <strong>组件菜单</strong>
              <span>按住左侧把手拖动排序</span>
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
              const typeLabel = componentTypeOptions.find((option) => option.value === component.type)?.label ?? "组件";
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
                    aria-label="拖动组件"
                    onPointerDown={(event) => beginComponentDrag(component.id, event)}
                    onPointerMove={updateComponentDragTarget}
                    onPointerUp={finishComponentDrag}
                    onPointerCancel={cancelComponentDrag}
                  >
                    <GripVertical size={15} />
                  </button>
                  <button className="component-select-button" type="button" onClick={() => selectComponentForEdit(component.id)}>
                    <span>{component.label || "未命名组件"}</span>
                    <small>{typeLabel} · {componentWidthLabel(component)}</small>
                  </button>
                  <div className="component-list-actions">
                    <button type="button" onClick={() => onMoveComponent(component.id, -1)} disabled={index === 0} aria-label="上移组件">
                      <ArrowUp size={14} />
                    </button>
                    <button type="button" onClick={() => onMoveComponent(component.id, 1)} disabled={index === components.length - 1} aria-label="下移组件">
                      <ArrowDown size={14} />
                    </button>
                    <button type="button" onClick={() => onDuplicateComponent(component)} aria-label="复制组件">
                      <Copy size={14} />
                    </button>
                    <button type="button" onClick={() => onRemoveComponent(component.id)} aria-label="删除组件">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              );
            })}
            {components.length === 0 ? <div className="component-list-empty">请选择一个组件</div> : null}
          </div>
        </div>
      </aside>
      <aside className="template-property-panel">
        <div className="template-property-tabs" role="tablist" aria-label="属性面板">
          <button type="button" className={propertyTab === "template" ? "active" : ""} onClick={() => setPropertyTab("template")}>
            表单属性
          </button>
          <button type="button" className={propertyTab === "component" ? "active" : ""} onClick={() => setPropertyTab("component")}>
            组件属性
          </button>
        </div>
        {propertyTab === "component" ? (
          selectedComponent ? (
            <div className="template-settings-card component-settings-card">
              <div className="component-detail-head">
                <h3>组件属性</h3>
                <span>{componentWidthLabel(selectedComponent)}</span>
              </div>
              <label className="template-setting-field">
                <span className="template-setting-label">类型</span>
                <CustomSelect
                  value={selectedComponent.type}
                  options={componentTypeOptions}
                  onChange={(type) => {
                    const nextType = type as PromptTemplateComponentType;
                    onPatchComponent(selectedComponent.id, {
                      type: nextType,
                      width: nextType === "section" ? "full" : componentWidth(selectedComponent)
                    });
                  }}
                />
              </label>
              {selectedComponent.type !== "section" ? (
                <label className="template-setting-field">
                  <span className="template-setting-label">占用</span>
                  <CustomSelect
                    value={componentWidth(selectedComponent)}
                    options={componentWidthOptions}
                    onChange={(width) => onPatchComponent(selectedComponent.id, { width: width as PromptTemplateComponentWidth })}
                  />
                </label>
              ) : (
                <label className="template-setting-field">
                  <span className="template-setting-label">占用</span>
                  <input value="占用全部内容" readOnly />
                </label>
              )}
              <label className="template-setting-field">
                <span className="template-setting-label">标题</span>
                <input value={selectedComponent.label} onChange={(event) => onPatchComponent(selectedComponent.id, { label: event.target.value })} />
              </label>
              {selectedComponent.type !== "section" ? (
                <label className="template-setting-field">
                  <span className="template-setting-label" title={selectedComponent.type === "select" && selectedComponent.multiple ? "默认值（多选用逗号或换行分隔）" : "默认值"}>
                    {selectedComponent.type === "select" && selectedComponent.multiple ? "默认值（多选用逗号或换行分隔）" : "默认值"}
                  </span>
                  <input value={selectedComponent.defaultValue ?? ""} onChange={(event) => onPatchComponent(selectedComponent.id, { defaultValue: event.target.value })} />
                </label>
              ) : null}
              {selectedComponent.type === "text" || selectedComponent.type === "textarea" ? (
                <label className="template-setting-field wide">
                  <span className="template-setting-label">占位提示</span>
                  <input value={selectedComponent.placeholder ?? ""} onChange={(event) => onPatchComponent(selectedComponent.id, { placeholder: event.target.value })} />
                </label>
              ) : null}
              {selectedComponent.type === "select" ? (
                <>
                  <label className="template-setting-field wide">
                    <span className="template-setting-label">下拉选项</span>
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
                    允许多选
                  </label>
                </>
              ) : null}
              <label className="template-setting-field wide">
                <span className="template-setting-label">填写说明</span>
                <input value={selectedComponent.helpText ?? ""} onChange={(event) => onPatchComponent(selectedComponent.id, { helpText: event.target.value })} />
              </label>
              <label className="template-checkbox">
                <input
                  type="checkbox"
                  checked={Boolean(selectedComponent.required)}
                  onChange={(event) => onPatchComponent(selectedComponent.id, { required: event.target.checked })}
                  disabled={selectedComponent.type === "section"}
                />
                必填
              </label>
            </div>
          ) : (
            <div className="prompt-template-list-empty">请选择一个组件</div>
          )
        ) : (
          <div className="template-settings-card template-meta-card">
            <h3>表单属性</h3>
            <label className="template-setting-field">
              <span className="template-setting-label">表单名称</span>
              <input value={template.name} onChange={(event) => onPatchTemplate({ name: event.target.value })} />
            </label>
            <label className="template-setting-field">
              <span className="template-setting-label">图标</span>
              <CustomSelect
                value={template.icon}
                options={iconOptions}
                onChange={(icon) => onPatchTemplate({ icon })}
                className="template-icon-select"
                menuClassName="template-icon-select-menu"
              />
            </label>
            <label className="template-setting-field wide">
              <span className="template-setting-label">表单描述</span>
              <input value={template.description} onChange={(event) => onPatchTemplate({ description: event.target.value })} />
            </label>
            <label className="template-setting-field wide">
              <span className="template-setting-label">前置拼接</span>
              <textarea rows={2} value={template.rules.prefix ?? ""} onChange={(event) => onPatchTemplate({ rules: { ...template.rules, prefix: event.target.value } })} />
            </label>
            <label className="template-setting-field wide">
              <span className="template-setting-label">结尾拼接</span>
              <textarea rows={2} value={template.rules.suffix ?? ""} onChange={(event) => onPatchTemplate({ rules: { ...template.rules, suffix: event.target.value } })} />
            </label>
            <label className="template-setting-field wide">
              <span className="template-setting-label">反向提示词</span>
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
              title={hasManualNegativePrompt ? "已填写反向提示词，无需AI生成" : "由AI优化时生成反向提示词"}
            >
              <input
                type="checkbox"
                checked={!hasManualNegativePrompt && Boolean(template.output.negativeEnabled)}
                disabled={hasManualNegativePrompt}
                onChange={(event) => onPatchTemplate({ output: { ...template.output, negativeEnabled: event.target.checked } })}
              />
              AI生成反向提示词
            </label>
          </div>
        )}
      </aside>
      <div className="template-editor-preview-panel">
        <div className="template-editor-preview-head">
          <div>
            <strong>实时预览</strong>
            <span>这里展示完整表单页面，半行组件会自动并排</span>
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
        <div className="result-skeleton" aria-label="正在生成提示词">
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
              <span>{negativeLanguage === "en" ? "Negative prompt" : "反向提示词"}</span>
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
  const basePromptWithNegative = promptWithNegative(basePrompt, baseNegativePrompt, displayLanguage);
  const optimizedPrompt = selectedResult ? optimizedPromptForLanguage(selectedResult, displayLanguage, true) : "";
  const negativePrompt = selectedResult ? negativePromptForLanguage(selectedResult, displayLanguage, true) : "";
  const aiPromptWithNegative = promptWithNegative(optimizedPrompt, negativePrompt, displayLanguage);
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
            <h3>历史结果</h3>
            <p>默认显示最近 20 条，下滑自动加载更多。</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </header>
        <div className="prompt-template-history-layout">
          <aside className="prompt-template-history-menu" aria-label="历史结果快捷菜单" ref={menuRef} onScroll={handleMenuScroll}>
            {loading ? <div className="prompt-template-list-empty">加载中</div> : null}
            {!loading && results.length === 0 ? <div className="prompt-template-list-empty">暂无历史结果</div> : null}
            {results.map((result) => (
              <button
                type="button"
                key={result.id}
                className={result.id === selectedResult?.id ? "active" : ""}
                onClick={() => setSelectedId(result.id)}
              >
                <strong>{formatRelativeTemplateTime(result.createdAt)}</strong>
                <span>{formatTemplateDate(result.createdAt)}</span>
              </button>
            ))}
            {loadingMore ? <div className="prompt-template-history-loading">加载中</div> : null}
            {!loading && !loadingMore && hasMore ? (
              <button type="button" className="prompt-template-history-more" onClick={onLoadMore}>
                加载更多
              </button>
            ) : null}
          </aside>
          <section className="prompt-template-history-detail">
            {selectedResult ? (
              <>
                <div className="prompt-template-history-tools">
                  <div className="prompt-language-switch" role="tablist" aria-label="历史提示词语言">
                    <button type="button" className={displayLanguage === "zh" ? "active" : ""} onClick={() => setDisplayLanguage("zh")}>
                      中
                    </button>
                    <button
                      type="button"
                      className={displayLanguage === "en" ? "active" : ""}
                      onClick={() => setDisplayLanguage("en")}
                      disabled={!canSwitchEnglish}
                      title={canSwitchEnglish ? "切换英文" : "该记录暂无英文版本"}
                    >
                      EN
                    </button>
                  </div>
                  <button
                    type="button"
                    className={cx("prompt-diff-switch", showDiff && "active")}
                    aria-pressed={showDiff}
                    onClick={() => setShowDiff((current) => !current)}
                    title={showDiff ? "隐藏差异" : "显示差异"}
                  >
                    <span aria-hidden="true" />
                    显示差异
                  </button>
                  <div className="prompt-template-history-actions">
                    <button className="secondary-btn" type="button" onClick={() => setLoadTarget(selectedResult)}>
                      <Check size={15} />
                      载入
                    </button>
                  </div>
                </div>
                <div className="prompt-template-history-content">
                  <div className="prompt-template-history-block">
                    <div className="prompt-template-history-block-title">
                      <div className="prompt-template-history-block-title-main">
                        <FileText size={16} />
                        <strong>基础提示词</strong>
                      </div>
                      <div className="prompt-template-history-block-actions">
                        <button
                          className="secondary-btn icon-only-btn"
                          type="button"
                          onClick={() => onUsePrompt(basePromptWithNegative, "base")}
                          disabled={Boolean(usingPromptTarget) || !basePromptWithNegative.trim()}
                          aria-label={usingPromptTarget === "base" ? "带入中" : "去使用基础提示词"}
                          title={usingPromptTarget === "base" ? "带入中" : "去使用"}
                        >
                          <Send size={15} />
                        </button>
                        <button
                          className="secondary-btn icon-only-btn"
                          type="button"
                          onClick={() => onCopy(basePromptWithNegative)}
                          disabled={!basePromptWithNegative.trim()}
                          aria-label="复制基础提示词"
                          title="复制"
                        >
                          <Copy size={15} />
                        </button>
                      </div>
                    </div>
                    <pre>{basePrompt || (displayLanguage === "en" ? "未记录英文基础提示词" : "未记录基础提示词")}</pre>
                    {baseNegativePrompt ? (
                      <div className="prompt-template-history-negative">
                        <span>反向提示词</span>
                        <pre>{baseNegativePrompt}</pre>
                      </div>
                    ) : null}
                  </div>
                  <div className="prompt-template-history-block primary">
                    <div className="prompt-template-history-block-title">
                      <div className="prompt-template-history-block-title-main">
                        <Sparkles size={16} />
                        <strong>AI提示词</strong>
                      </div>
                      <div className="prompt-template-history-block-actions">
                        <button
                          className="secondary-btn icon-only-btn"
                          type="button"
                          onClick={() => onUsePrompt(aiPromptWithNegative, "ai")}
                          disabled={Boolean(usingPromptTarget) || !aiPromptWithNegative.trim()}
                          aria-label={usingPromptTarget === "ai" ? "带入中" : "去使用AI提示词"}
                          title={usingPromptTarget === "ai" ? "带入中" : "去使用"}
                        >
                          <Send size={15} />
                        </button>
                        <button
                          className="secondary-btn icon-only-btn"
                          type="button"
                          onClick={() => onCopy(aiPromptWithNegative)}
                          disabled={!aiPromptWithNegative.trim()}
                          aria-label="复制AI提示词"
                          title="复制"
                        >
                          <Copy size={15} />
                        </button>
                      </div>
                    </div>
                    <pre>
                      {diffEnabled
                        ? renderPromptDiffText(optimizedPrompt, basePrompt)
                        : (optimizedPrompt || (displayLanguage === "en" ? "未记录英文 AI 提示词" : "未记录 AI 提示词"))}
                    </pre>
                    {negativePrompt ? (
                      <div className="prompt-template-history-negative">
                        <span>{displayLanguage === "en" ? "Negative prompt" : "反向提示词"}</span>
                        <pre>{negativePrompt}</pre>
                      </div>
                    ) : null}
                  </div>
                </div>
              </>
            ) : (
              <div className="prompt-template-list-empty">暂无历史结果</div>
            )}
          </section>
        </div>
      </section>
      <ConfirmDialog
        open={Boolean(loadTarget)}
        title="载入历史结果"
        description={loadTarget ? `确认载入「${formatRelativeTemplateTime(loadTarget.createdAt)}」这条历史结果？当前显示的 AI 优化结果会被替换。` : ""}
        confirmText="载入"
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
