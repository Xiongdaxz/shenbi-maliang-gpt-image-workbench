import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
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
  ChevronDown,
  ClipboardList,
  Coffee,
  Crown,
  Film,
  Flower2,
  Frame,
  Gamepad2,
  Gem,
  Gift,
  Globe,
  Handshake,
  Heart,
  Hotel,
  House,
  Image as ImageIcon,
  Landmark,
  Laptop,
  LayoutTemplate,
  Layers,
  Leaf,
  Lightbulb,
  Loader2,
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
  Pizza,
  Plane,
  Podcast,
  Radio,
  ReceiptText,
  RotateCw,
  Rocket,
  ScanEye,
  Search,
  ScrollText,
  Shapes,
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
import { api, type PromptTemplateOptimizeStyle } from "../../api";
import { PromptOptimizeStyleSelect } from "../PromptOptimizeStyleSelect";
import { PromptTemplateColorPicker } from "../PromptTemplateColorPicker";
import { cx } from "../../lib/cx";
import {
  normalizePromptOptimizeStyle,
  promptOptimizeStyleGroups,
  promptOptimizeStyleOption,
  type PromptOptimizeStyleGroup
} from "../../lib/promptOptimizeStyles";
import type { ComposerPromptResultKey, ComposerPromptTemplatePanelDraft } from "../../store/workbench";
import {
  buildBasePrompt,
  initialPromptTemplateFormValues,
  normalizePromptTemplateColorValue,
  promptTemplateDefaultValues,
  promptTemplateSignature,
  sortedPromptTemplateComponents
} from "../../lib/promptTemplates";
import type {
  AssetItem,
  PromptTemplate,
  PromptTemplateComponent,
  PromptTemplateFormValue,
  PromptTemplateFormValues,
  PromptTemplateImageFile,
  PromptTemplateImageValue,
  PromptTemplateResult
} from "../../types";
import { CustomSelect, useToast } from "../../ui";

type PromptDisplayLanguage = "zh" | "en";
type PromptResultKey = ComposerPromptResultKey;
type OptimizeRequest = PromptResultKey | {
  customInstruction?: string;
  outputKey?: PromptResultKey;
  optimizeStyle?: PromptTemplateOptimizeStyle;
} | undefined;

const promptTemplateIconMap: Record<string, LucideIcon> = {
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
  Clapperboard,
  ClipboardList,
  Coffee,
  Crown,
  Film,
  Flower2,
  Frame,
  Gamepad2,
  Gem,
  Gift,
  Globe,
  Handshake,
  Heart,
  Hotel,
  House,
  Image: ImageIcon,
  ImageIcon,
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
  Pizza,
  Plane,
  Podcast,
  Radio,
  ReceiptText,
  Rocket,
  ScanEye,
  ScrollText,
  Shapes,
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
  Trees,
  Trophy,
  Truck,
  Tv,
  Type,
  Umbrella,
  Users,
  Utensils,
  Video,
  WalletCards,
  WandSparkles,
  Waves,
  Workflow,
  Zap
};

function looksLikePromptJson(value: string) {
  const text = value.trim();
  return text.startsWith("{") || text.startsWith("[");
}

function parsePromptJsonText(value: string) {
  if (!looksLikePromptJson(value)) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function nestedStringField(source: unknown, keys: string[]) {
  if (!source || typeof source !== "object") return "";
  const record = source as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function promptTextFromJsonRecord(record: Record<string, unknown>, language: PromptDisplayLanguage) {
  const keys = language === "en"
    ? ["promptEn", "prompt_en", "enPrompt", "englishPrompt", "optimizedPromptEn", "optimized_prompt_en", "finalPromptEn"]
    : ["promptZh", "prompt_zh", "zhPrompt", "chinesePrompt", "optimizedPromptZh", "optimized_prompt_zh", "finalPromptZh"];
  const nestedKeys = language === "en" ? ["en", "english"] : ["zh", "cn", "chinese"];
  return nestedStringField(record, keys)
    || nestedStringField(record.promptVersions, nestedKeys)
    || nestedStringField(record.prompts, nestedKeys)
    || nestedStringField(record.optimizedPrompts, nestedKeys);
}

function negativePromptTextFromJsonRecord(record: Record<string, unknown>, language: PromptDisplayLanguage) {
  const keys = language === "en"
    ? ["negativePromptEn", "negative_prompt_en", "enNegativePrompt", "englishNegativePrompt"]
    : ["negativePromptZh", "negative_prompt_zh", "zhNegativePrompt", "chineseNegativePrompt"];
  const nestedKeys = language === "en" ? ["en", "english"] : ["zh", "cn", "chinese"];
  return nestedStringField(record, keys)
    || nestedStringField(record.negativePrompts, nestedKeys);
}

function normalizePromptText(value: unknown, language: PromptDisplayLanguage, kind: "prompt" | "negative" = "prompt") {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text) return "";
  const parsed = parsePromptJsonText(text);
  if (!parsed || Array.isArray(parsed)) return text;
  const record = parsed as Record<string, unknown>;
  return kind === "negative" ? negativePromptTextFromJsonRecord(record, language) : promptTextFromJsonRecord(record, language);
}

function optimizedPromptForLanguage(result: PromptTemplateResult | null, language: PromptDisplayLanguage, strict = false) {
  if (!result) return "";
  const localized = normalizePromptText(result.optimizedPrompts?.[language], language);
  if (localized) return localized;
  const generic = normalizePromptText(result.optimizedPrompt, language);
  if (generic && (result.language === language || !strict)) return generic;
  return "";
}

function negativePromptForLanguage(result: PromptTemplateResult | null, language: PromptDisplayLanguage, strict = false) {
  if (!result) return "";
  const localized = normalizePromptText(result.negativePrompts?.[language], language, "negative");
  if (localized) return localized;
  const generic = normalizePromptText(result.negativePrompt, language, "negative");
  if (generic && (result.language === language || !strict)) return generic;
  return "";
}

function promptWithNegative(prompt: string, negativePrompt: string, language: PromptDisplayLanguage) {
  const main = prompt.trim();
  const negative = negativePrompt.trim();
  if (!negative) return main;
  const title = language === "en" ? "Negative prompt" : "反向提示词";
  return [main, `${title}：${negative}`].filter(Boolean).join("\n\n");
}

function manualNegativePromptFromTemplate(template: PromptTemplate | null | undefined) {
  return String(template?.rules?.negativePrompt ?? "").trim();
}

function mergePromptTemplateFormValues(template: PromptTemplate, value: unknown): PromptTemplateFormValues {
  const defaults = initialPromptTemplateFormValues(template);
  if (!value || typeof value !== "object" || Array.isArray(value)) return defaults;
  const source = value as PromptTemplateFormValues;
  const next: PromptTemplateFormValues = { ...defaults };
  for (const component of template.components) {
    if (component.type === "section") continue;
    if (source[component.id] === undefined) continue;
    if (component.type === "color") {
      next[component.id] = normalizePromptTemplateColorValue(source[component.id], component);
    } else {
      next[component.id] = source[component.id];
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
          files: (imageValue.files ?? []).map((file) => ({
            id: file.id,
            fileName: file.fileName,
            size: file.size,
            width: file.width,
            height: file.height,
            previewUrl: file.previewUrl,
            downloadUrl: file.downloadUrl,
            mimeType: file.mimeType,
            assetId: file.assetId,
            asset: file.asset ?? null,
            uploaded: file.uploaded
          }))
        }
      ];
    })
  ) as PromptTemplateFormValues;
}

function componentLayoutClass(component: PromptTemplateComponent) {
  if (component.type === "section") return "layout-full";
  if (component.width === "half" || component.width === "full") {
    return component.width === "half" ? "layout-half" : "layout-full";
  }
  return component.type === "text" || component.type === "select" ? "layout-half" : "layout-full";
}

function formatImageFileSize(bytes: number | undefined) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 100 * 1024 ? 1 : 0)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function collectPromptTemplateAssets(formValues: PromptTemplateFormValues) {
  const assets: AssetItem[] = [];
  const seen = new Set<string>();
  Object.values(formValues).forEach((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const imageValue = value as PromptTemplateImageValue;
    (imageValue.files ?? []).forEach((file) => {
      const asset = file.asset;
      if (!asset || seen.has(asset.id)) return;
      seen.add(asset.id);
      assets.push(asset);
    });
  });
  return assets;
}

function mergeAssets(current: AssetItem[], nextAssets: AssetItem[]) {
  if (nextAssets.length === 0) return current;
  const seen = new Set(current.map((asset) => asset.id));
  const merged = [...current];
  nextAssets.forEach((asset) => {
    if (seen.has(asset.id)) return;
    seen.add(asset.id);
    merged.push(asset);
  });
  return merged;
}

function resultLabel(value: PromptResultKey) {
  if (value === "base-en") return "基础英文";
  if (value === "ai-zh") return "AI优化中文";
  if (value === "ai-en") return "AI优化英文";
  return "基础中文";
}

type PromptResultOption = {
  value: PromptResultKey;
  label: string;
  description: string;
  disabled: boolean;
  loading?: boolean;
  needsOptimize?: boolean;
};

function dropdownOptionDisabled(option: object | undefined) {
  return Boolean(option && "disabled" in option && option.disabled);
}

function fallbackActiveIndex<T extends object>(options: T[], preferredIndex: number) {
  if (preferredIndex >= 0 && !dropdownOptionDisabled(options[preferredIndex])) return preferredIndex;
  return options.findIndex((option) => !dropdownOptionDisabled(option));
}

function moveActiveIndex<T extends object>(options: T[], currentIndex: number, step: 1 | -1) {
  if (options.length === 0) return -1;
  const startIndex = fallbackActiveIndex(options, currentIndex);
  if (startIndex < 0) return -1;
  for (let offset = 1; offset <= options.length; offset += 1) {
    const nextIndex = (startIndex + offset * step + options.length) % options.length;
    if (!dropdownOptionDisabled(options[nextIndex])) return nextIndex;
  }
  return startIndex;
}

function resultLanguage(value: PromptResultKey): PromptDisplayLanguage {
  return value.endsWith("-en") ? "en" : "zh";
}

function promptTemplateIconFor(name: string | undefined) {
  return name ? promptTemplateIconMap[name] ?? Sparkles : Sparkles;
}

export function PromptTemplateComposerPanel({
  selectedAssets,
  onSelectedAssetsChange,
  onApplyPrompt,
  onClose,
  collapseSignal,
  onPromptLoadingChange,
  onPromptStreamingChange,
  optimizeControlHost,
  optimizeStyle: controlledOptimizeStyle,
  promptOptimizeCustomInstruction = "",
  promptOptimizeStyleGroups: userPromptOptimizeStyleGroups = promptOptimizeStyleGroups,
  onOptimizeStyleChange,
  onPromptOptimizeCustomInstructionChange,
  onOptimizeControlVisibleChange,
  initialDraft,
  onDraftChange
}: {
  selectedAssets: AssetItem[];
  onSelectedAssetsChange: (assets: AssetItem[]) => void;
  onApplyPrompt: (prompt: string) => void;
  onClose: () => void;
  collapseSignal?: number;
  onPromptLoadingChange?: (loading: boolean) => void;
  onPromptStreamingChange?: (streaming: boolean) => void;
  optimizeControlHost?: HTMLElement | null;
  optimizeStyle?: PromptTemplateOptimizeStyle;
  promptOptimizeCustomInstruction?: string;
  promptOptimizeStyleGroups?: PromptOptimizeStyleGroup[];
  onOptimizeStyleChange?: (value: PromptTemplateOptimizeStyle) => void;
  onPromptOptimizeCustomInstructionChange?: (value: string) => void;
  onOptimizeControlVisibleChange?: (visible: boolean) => void;
  initialDraft?: ComposerPromptTemplatePanelDraft | null;
  onDraftChange?: (draft: ComposerPromptTemplatePanelDraft) => void;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const initialDraftRef = useRef(initialDraft ?? null);
  const restoredInitialDraftRef = useRef(false);
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [selectedId, setSelectedId] = useState(initialDraftRef.current?.selectedId ?? "");
  const [collapsed, setCollapsed] = useState(Boolean(initialDraftRef.current?.collapsed));
  const [formValues, setFormValues] = useState<PromptTemplateFormValues>(initialDraftRef.current?.formValues ?? {});
  const [outputKey, setOutputKey] = useState<PromptResultKey>(initialDraftRef.current?.outputKey ?? "base-zh");
  const [outputMenuOpen, setOutputMenuOpen] = useState(false);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [internalOptimizeStyle, setInternalOptimizeStyle] = useState<PromptTemplateOptimizeStyle>(
    initialDraftRef.current?.optimizeStyle ?? "standard"
  );
  const [optimizeCustomInstruction, setOptimizeCustomInstruction] = useState(promptOptimizeCustomInstruction);
  const [activeResult, setActiveResult] = useState<PromptTemplateResult | null>(initialDraftRef.current?.activeResult ?? null);
  const [optimizedSignature, setOptimizedSignature] = useState(initialDraftRef.current?.optimizedSignature ?? "");
  const [streamingOptimizedPromptZh, setStreamingOptimizedPromptZh] = useState("");
  const [streamingOptimizedPromptEn, setStreamingOptimizedPromptEn] = useState("");
  const [streamingBasePromptEn, setStreamingBasePromptEn] = useState("");
  const draftTouchedRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const lastAppliedPromptRef = useRef("");
  const autoTranslationKeyRef = useRef("");
  const autoSelectedAiResultRef = useRef("");
  const syncedAssetIdsRef = useRef<Set<string>>(new Set());
  const dismissedSyncedAssetIdsRef = useRef<Set<string>>(new Set());
  const keywordInputRef = useRef<HTMLInputElement | null>(null);
  const keywordComposingRef = useRef(false);
  const promptStyleGroups = userPromptOptimizeStyleGroups;
  const optimizeStyle = normalizePromptOptimizeStyle(controlledOptimizeStyle ?? internalOptimizeStyle, promptStyleGroups);

  function updateOptimizeCustomInstruction(value: string) {
    setOptimizeCustomInstruction(value);
    onPromptOptimizeCustomInstructionChange?.(value);
  }

  useEffect(() => {
    setOptimizeCustomInstruction(promptOptimizeCustomInstruction);
  }, [promptOptimizeCustomInstruction]);

  const templatesQuery = useQuery({
    queryKey: ["prompt-templates", "composer", keyword],
    queryFn: () => api.promptTemplates({ scope: "all", keyword })
  });
  const allTemplatesQuery = useQuery({
    queryKey: ["prompt-templates", "composer-switcher", "all"],
    queryFn: () => api.promptTemplates({ scope: "all" })
  });
  const templates = templatesQuery.data?.templates ?? [];
  const switchTemplates = allTemplatesQuery.data?.templates ?? templates;
  const selectedTemplate = switchTemplates.find((template) => template.id === selectedId) ?? templates.find((template) => template.id === selectedId) ?? null;

  const formDraftQuery = useQuery({
    queryKey: ["prompt-template-form-draft", selectedTemplate?.id],
    queryFn: () => api.promptTemplateFormDraft(selectedTemplate!.id),
    enabled: Boolean(selectedTemplate)
  });
  const historyQuery = useQuery({
    queryKey: ["prompt-template-results", selectedTemplate?.id, "composer-latest"],
    queryFn: () => api.promptTemplateResults(selectedTemplate!.id, { limit: 1 }),
    enabled: Boolean(selectedTemplate)
  });
  const latestHistoryResult = historyQuery.data?.results[0] ?? null;

  const basePrompt = useMemo(
    () => (selectedTemplate ? buildBasePrompt(selectedTemplate, formValues, "zh") : ""),
    [formValues, selectedTemplate]
  );
  const manualNegativePrompt = manualNegativePromptFromTemplate(selectedTemplate);
  const signature = selectedTemplate ? promptTemplateSignature(selectedTemplate.id, "zh", formValues, basePrompt) : "";
  const resultStale = Boolean(activeResult && optimizedSignature && optimizedSignature !== signature);
  const activeResultMatchesBase = Boolean(activeResult && !resultStale && activeResult.basePrompt.trim() === basePrompt.trim());
  const resultBasePromptEn = activeResultMatchesBase ? String(activeResult?.basePromptEn ?? "").trim() : "";

  const baseTranslationQuery = useQuery({
    queryKey: ["prompt-template-base-translation", selectedTemplate?.id, signature],
    queryFn: () => api.promptTemplateBaseTranslation(selectedTemplate!.id, signature),
    enabled: Boolean(selectedTemplate && outputKey === "base-en" && signature && !resultBasePromptEn)
  });
  const baseTranslation = baseTranslationQuery.data?.translation ?? null;
  const savedBasePromptEn = resultBasePromptEn || (baseTranslation?.basePrompt.trim() === basePrompt.trim() ? baseTranslation.basePromptEn ?? "" : "");
  const savedBaseNegativePromptEn = baseTranslation?.negativePrompt.trim() === manualNegativePrompt.trim() ? baseTranslation.negativePromptEn ?? "" : "";

  const translateBasePrompt = useMutation({
    mutationFn: () =>
      api.translatePromptTemplateStream(
        selectedTemplate!.id,
        { prompt: basePrompt, negativePrompt: manualNegativePrompt, signature },
        { onDelta: (chunk) => setStreamingBasePromptEn((text) => chunk.reset ? chunk.delta : `${text}${chunk.delta}`) }
      ),
    onMutate: () => setStreamingBasePromptEn(""),
    onSuccess: (data) => {
      setStreamingBasePromptEn("");
      if (selectedTemplate && data.translation) {
        queryClient.setQueryData(["prompt-template-base-translation", selectedTemplate.id, signature], {
          translation: data.translation,
          staleTranslation: null
        });
      }
    },
    onError: (error) => {
      setStreamingBasePromptEn("");
      showToast(error instanceof Error ? error.message : "基础提示词翻译失败", "error");
    }
  });
  const selectedBaseEnglishLoading = outputKey === "base-en" && (baseTranslationQuery.isFetching || translateBasePrompt.isPending);
  const selectedBaseEnglishStreaming = outputKey === "base-en" && Boolean(streamingBasePromptEn.trim());

  const optimize = useMutation({
    mutationFn: (request?: OptimizeRequest) => {
      const requestStyle = typeof request === "object" ? request.optimizeStyle : undefined;
      const nextOptimizeStyle = requestStyle ?? optimizeStyle;
      const requestCustomInstruction = typeof request === "object" ? request.customInstruction ?? "" : "";
      return api.optimizePromptTemplateStream(
        selectedTemplate!.id,
        {
          language: "zh",
          formValues,
          basePrompt,
          optimizeStyle: nextOptimizeStyle,
          customInstruction: requestCustomInstruction
        },
        {
          onDelta: (chunk) => {
            if (chunk.language === "en") {
              setStreamingOptimizedPromptEn((text) => chunk.reset ? chunk.delta : `${text}${chunk.delta}`);
            } else {
              setStreamingOptimizedPromptZh((text) => chunk.reset ? chunk.delta : `${text}${chunk.delta}`);
              setOutputKey((current) => current === "ai-en" ? current : "ai-zh");
            }
          }
        }
      );
    },
    onMutate: (request) => {
      const requestedOutputKey = typeof request === "string" ? request : request?.outputKey;
      setOutputKey(requestedOutputKey?.startsWith("ai") ? requestedOutputKey : "ai-zh");
      setStreamingOptimizedPromptZh("");
      setStreamingOptimizedPromptEn("");
    },
    onSuccess: (data, request) => {
      const requestedOutputKey = typeof request === "string" ? request : request?.outputKey;
      setStreamingOptimizedPromptZh("");
      setStreamingOptimizedPromptEn("");
      if (!data.result) {
        setOutputKey("base-zh");
        showToast("AI 优化已结束，但没有返回结果", "info");
        return;
      }
      setActiveResult(data.result);
      setOptimizedSignature(signature);
      setOutputKey(requestedOutputKey?.startsWith("ai") ? requestedOutputKey : "ai-zh");
      showToast("AI 优化完成");
      if (selectedTemplate) queryClient.invalidateQueries({ queryKey: ["prompt-template-results", selectedTemplate.id] });
    },
    onError: (error) => {
      setStreamingOptimizedPromptZh("");
      setStreamingOptimizedPromptEn("");
      setOutputKey("base-zh");
      showToast(error instanceof Error ? error.message : "AI 优化失败，基础提示词仍可使用", "error");
    }
  });

  useEffect(() => {
    onPromptLoadingChange?.(optimize.isPending || selectedBaseEnglishLoading);
    return () => onPromptLoadingChange?.(false);
  }, [onPromptLoadingChange, optimize.isPending, selectedBaseEnglishLoading]);

  useEffect(() => {
    if (!selectedTemplate) return;
    const draft = initialDraftRef.current;
    const shouldRestoreDraft = Boolean(
      draft
      && !restoredInitialDraftRef.current
      && draft.selectedId === selectedTemplate.id
    );
    draftTouchedRef.current = shouldRestoreDraft;
    syncedAssetIdsRef.current.clear();
    dismissedSyncedAssetIdsRef.current.clear();
    setFormValues(shouldRestoreDraft && draft ? mergePromptTemplateFormValues(selectedTemplate, draft.formValues) : initialPromptTemplateFormValues(selectedTemplate));
    const nextOptimizeStyle = normalizePromptOptimizeStyle(
      shouldRestoreDraft && draft ? draft.optimizeStyle : selectedTemplate.optimizeStyle,
      promptStyleGroups
    );
    setInternalOptimizeStyle(nextOptimizeStyle);
    onOptimizeStyleChange?.(nextOptimizeStyle);
    setActiveResult(shouldRestoreDraft && draft ? draft.activeResult : null);
    setOptimizedSignature(shouldRestoreDraft && draft ? draft.optimizedSignature : "");
    setOutputKey(shouldRestoreDraft && draft ? draft.outputKey : "base-zh");
    setStreamingOptimizedPromptZh("");
    setStreamingOptimizedPromptEn("");
    setStreamingBasePromptEn("");
    autoSelectedAiResultRef.current = "";
    if (shouldRestoreDraft && draft) setCollapsed(draft.collapsed);
    if (shouldRestoreDraft) restoredInitialDraftRef.current = true;
  }, [onOptimizeStyleChange, promptStyleGroups, selectedTemplate?.id]);

  useEffect(() => {
    if (!selectedTemplate || !selectedId) return;
    onDraftChange?.({
      selectedId,
      collapsed,
      formValues,
      outputKey,
      optimizeStyle,
      activeResult,
      optimizedSignature
    });
  }, [activeResult, collapsed, formValues, onDraftChange, optimizeStyle, optimizedSignature, outputKey, selectedId, selectedTemplate?.id]);

  useEffect(() => {
    if (!selectedTemplate || !formDraftQuery.isSuccess || draftTouchedRef.current) return;
    setFormValues(mergePromptTemplateFormValues(selectedTemplate, formDraftQuery.data.draft?.formValues));
  }, [formDraftQuery.dataUpdatedAt, formDraftQuery.isSuccess, selectedTemplate?.id]);

  useEffect(() => {
    if (!selectedTemplate || !latestHistoryResult || activeResult || optimize.isPending) return;
    setActiveResult(latestHistoryResult);
    setOptimizedSignature(
      promptTemplateSignature(
        selectedTemplate.id,
        "zh",
        latestHistoryResult.formSnapshot as PromptTemplateFormValues,
        latestHistoryResult.basePrompt
      )
    );
  }, [activeResult, latestHistoryResult?.id, optimize.isPending, selectedTemplate?.id]);

  useEffect(() => {
    if (!selectedTemplate || !draftTouchedRef.current) return;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    const storageValues = promptTemplateFormValuesForStorage(formValues);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      api.savePromptTemplateFormDraft(selectedTemplate.id, storageValues).catch((error) => {
        console.warn("表单草稿保存失败", error);
      });
    }, 600);
    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [formValues, selectedTemplate?.id]);

  useEffect(() => {
    if (resultStale && outputKey.startsWith("ai")) setOutputKey("base-zh");
  }, [outputKey, resultStale]);

  useEffect(() => {
    if (outputKey !== "base-en") {
      autoTranslationKeyRef.current = "";
      return;
    }
    if (!selectedTemplate || historyQuery.isFetching || !basePrompt.trim() || savedBasePromptEn || translateBasePrompt.isPending) return;
    const key = `${selectedTemplate.id}:${signature}:${basePrompt}:${manualNegativePrompt}`;
    if (autoTranslationKeyRef.current === key) return;
    autoTranslationKeyRef.current = key;
    translateBasePrompt.mutate();
  }, [basePrompt, historyQuery.isFetching, manualNegativePrompt, outputKey, savedBasePromptEn, selectedTemplate?.id, signature, translateBasePrompt.isPending]);

  const baseZhPrompt = promptWithNegative(basePrompt, manualNegativePrompt, "zh");
  const baseEnPrompt = promptWithNegative(streamingBasePromptEn || savedBasePromptEn, savedBaseNegativePromptEn, "en");
  const aiZhBody = optimize.isPending ? streamingOptimizedPromptZh : optimizedPromptForLanguage(activeResult, "zh", true);
  const aiEnBody = optimize.isPending
    ? (streamingOptimizedPromptEn || streamingOptimizedPromptZh)
    : optimizedPromptForLanguage(activeResult, "en", true);
  const aiZhPrompt = promptWithNegative(
    aiZhBody,
    negativePromptForLanguage(activeResult, "zh", true) || manualNegativePrompt,
    "zh"
  );
  const aiEnPrompt = promptWithNegative(
    aiEnBody,
    negativePromptForLanguage(activeResult, "en", true),
    "en"
  );

  const hasAiZhPrompt = Boolean(optimizedPromptForLanguage(activeResult, "zh", true).trim());
  const hasAiEnPrompt = Boolean(optimizedPromptForLanguage(activeResult, "en", true).trim());
  const aiZhNeedsOptimize = Boolean(basePrompt.trim()) && !optimize.isPending && (resultStale || !hasAiZhPrompt);
  const aiEnNeedsOptimize = Boolean(basePrompt.trim()) && !optimize.isPending && (resultStale || !hasAiEnPrompt);
  const selectedOptimizedStream = outputKey === "ai-en"
    ? (streamingOptimizedPromptEn || streamingOptimizedPromptZh)
    : outputKey === "ai-zh"
      ? streamingOptimizedPromptZh
      : "";
  const liveZhOptimizedStreaming = optimize.isPending
    && Boolean(streamingOptimizedPromptZh.trim())
    && (outputKey === "base-zh" || outputKey === "ai-zh");
  const selectedPromptStreaming = selectedBaseEnglishStreaming || (optimize.isPending && (
    (outputKey.startsWith("ai") && Boolean(selectedOptimizedStream.trim()))
    || liveZhOptimizedStreaming
  ));
  const resultOptions: PromptResultOption[] = [
    { value: "base-zh" as const, label: "基础中文", description: "表单实时生成", disabled: !baseZhPrompt.trim() },
    {
      value: "base-en" as const,
      label: "基础英文",
      description: translateBasePrompt.isPending || baseTranslationQuery.isFetching ? "翻译中" : "基础提示词英文版",
      loading: translateBasePrompt.isPending || baseTranslationQuery.isFetching,
      disabled: !basePrompt.trim()
    },
    {
      value: "ai-zh" as const,
      label: "AI优化中文",
      description: optimize.isPending ? "优化中" : aiZhNeedsOptimize ? "点击生成优化结果" : "AI 优化结果",
      loading: optimize.isPending && outputKey === "ai-zh",
      needsOptimize: aiZhNeedsOptimize,
      disabled: !basePrompt.trim()
    },
    {
      value: "ai-en" as const,
      label: "AI优化英文",
      description: optimize.isPending ? "生成中" : aiEnNeedsOptimize ? "点击生成优化结果" : "AI 优化英文版",
      loading: optimize.isPending && outputKey === "ai-en",
      needsOptimize: aiEnNeedsOptimize,
      disabled: !basePrompt.trim()
    }
  ];
  const templateOptions = switchTemplates.map((template) => ({
    value: template.id,
    label: template.name,
    description: template.description || "创作提示词表单",
    icon: template.icon
  }));

  const selectedPrompt = liveZhOptimizedStreaming
    ? aiZhPrompt
    : outputKey === "base-en"
      ? baseEnPrompt
      : outputKey === "ai-zh"
        ? aiZhPrompt
        : outputKey === "ai-en"
          ? aiEnPrompt
          : baseZhPrompt;
  const optimizeActionLabel = optimize.isPending ? "优化中" : activeResult ? "重新优化" : "AI 优化";
  const optimizeStyleOption = promptOptimizeStyleOption(optimizeStyle, promptStyleGroups);
  const headerStatus = resultStale ? "AI 结果需要重新优化" : optimize.isPending ? "AI 优化中" : "";

  useEffect(() => {
    if (!selectedTemplate || !activeResult || optimize.isPending || resultStale || !aiZhPrompt.trim()) return;
    const autoKey = `${activeResult.id}:${optimizedSignature}`;
    if (autoSelectedAiResultRef.current === autoKey) return;
    autoSelectedAiResultRef.current = autoKey;
    setOutputKey("ai-zh");
  }, [activeResult?.id, aiZhPrompt, optimizedSignature, optimize.isPending, resultStale, selectedTemplate?.id]);

  useEffect(() => {
    if (!selectedTemplate || !selectedPrompt.trim()) return;
    if (lastAppliedPromptRef.current === selectedPrompt) return;
    lastAppliedPromptRef.current = selectedPrompt;
    onApplyPrompt(selectedPrompt);
  }, [onApplyPrompt, selectedPrompt, selectedTemplate?.id]);

  useEffect(() => {
    onPromptStreamingChange?.(selectedPromptStreaming);
    return () => onPromptStreamingChange?.(false);
  }, [onPromptStreamingChange, selectedPromptStreaming]);

  useEffect(() => {
    const nextAssets = collectPromptTemplateAssets(formValues);
    const formAssetIds = new Set(nextAssets.map((asset) => asset.id));
    const selectedAssetIds = new Set(selectedAssets.map((asset) => asset.id));
    Array.from(syncedAssetIdsRef.current).forEach((assetId) => {
      if (!formAssetIds.has(assetId)) {
        syncedAssetIdsRef.current.delete(assetId);
        dismissedSyncedAssetIdsRef.current.delete(assetId);
        return;
      }
      if (!selectedAssetIds.has(assetId)) dismissedSyncedAssetIdsRef.current.add(assetId);
    });
    if (nextAssets.length === 0) return;
    const assetsToSync = nextAssets.filter((asset) => {
      if (selectedAssetIds.has(asset.id)) {
        syncedAssetIdsRef.current.add(asset.id);
        dismissedSyncedAssetIdsRef.current.delete(asset.id);
        return false;
      }
      return !dismissedSyncedAssetIdsRef.current.has(asset.id);
    });
    if (assetsToSync.length === 0) return;
    const merged = mergeAssets(selectedAssets, nextAssets);
    if (merged.length !== selectedAssets.length) {
      assetsToSync.forEach((asset) => syncedAssetIdsRef.current.add(asset.id));
      onSelectedAssetsChange(mergeAssets(selectedAssets, assetsToSync));
    }
  }, [formValues, onSelectedAssetsChange, selectedAssets]);

  function handleFormValuesChange(nextValues: PromptTemplateFormValues) {
    draftTouchedRef.current = true;
    setFormValues(nextValues);
  }

  function selectResult(nextValue: PromptResultKey) {
    const option = resultOptions.find((item) => item.value === nextValue);
    if (!option || option.disabled) return;
    setOutputKey(nextValue);
    setOutputMenuOpen(false);
    if (option.needsOptimize && !optimize.isPending) optimize.mutate(nextValue);
  }

  function selectTemplate(nextValue: string) {
    if (!nextValue) return;
    setTemplateMenuOpen(false);
    setOutputMenuOpen(false);
    setCollapsed(true);
    if (nextValue !== selectedId) setSelectedId(nextValue);
  }

  function setOutputMenuOpenOnly(open: boolean) {
    setOutputMenuOpen(open);
    if (open) setTemplateMenuOpen(false);
  }

  function setTemplateMenuOpenOnly(open: boolean) {
    setTemplateMenuOpen(open);
    if (open) setOutputMenuOpen(false);
  }

  function expandCollapsedPanel() {
    setTemplateMenuOpen(false);
    setOutputMenuOpen(false);
    setCollapsed(false);
  }

  function updateOptimizeStyle(value: string) {
    const nextOptimizeStyle = normalizePromptOptimizeStyle(value, promptStyleGroups);
    const shouldAutoOptimize = nextOptimizeStyle !== optimizeStyle && Boolean(basePrompt.trim()) && !optimize.isPending;
    setInternalOptimizeStyle(nextOptimizeStyle);
    onOptimizeStyleChange?.(nextOptimizeStyle);
    if (shouldAutoOptimize) optimize.mutate({ optimizeStyle: nextOptimizeStyle });
  }

  function clearKeyword() {
    if (!keywordInput) return;
    keywordComposingRef.current = false;
    setKeywordInput("");
    setKeyword("");
    keywordInputRef.current?.focus();
  }

  useEffect(() => {
    if (!collapseSignal || !selectedTemplate) return;
    setCollapsed(true);
  }, [collapseSignal, selectedTemplate?.id]);

  const optimizeControl = selectedTemplate ? (
    <div className="composer-prompt-template-optimize-control">
      <button
        type="button"
        className="secondary-btn icon-only-btn composer-prompt-template-optimize-submit"
        disabled={optimize.isPending || !basePrompt.trim()}
        onClick={() => optimize.mutate(undefined)}
        aria-label={`${optimizeActionLabel}，${optimizeStyleOption.label}风格`}
        title={`${optimizeActionLabel}，${optimizeStyleOption.label}风格`}
        data-tooltip="AI优化提示词"
      >
        {optimize.isPending ? <RotateCw size={15} className="spin" /> : <WandSparkles size={15} />}
      </button>
      <span className="composer-prompt-template-style-tooltip" data-tooltip="AI优化风格">
        <PromptOptimizeStyleSelect
          value={optimizeStyle}
          onChange={updateOptimizeStyle}
          groups={promptStyleGroups}
          customInstruction={optimizeCustomInstruction}
          onCustomInstructionChange={updateOptimizeCustomInstruction}
          onCustomInstructionSubmit={() => optimize.mutate({ customInstruction: optimizeCustomInstruction })}
          customInstructionSubmitDisabled={optimize.isPending || !basePrompt.trim()}
          customInstructionSubmitPending={optimize.isPending}
          disabled={optimize.isPending}
          className="composer-prompt-template-style-select"
          menuClassName="composer-prompt-template-style-menu"
          menuPlacement="top"
          menuWidth={260}
        />
      </span>
    </div>
  ) : null;
  const optimizeControlPortal = optimizeControl && optimizeControlHost ? createPortal(optimizeControl, optimizeControlHost) : null;
  const optimizeControlVisible = Boolean(optimizeControlPortal);

  useEffect(() => {
    onOptimizeControlVisibleChange?.(optimizeControlVisible);
    return () => onOptimizeControlVisibleChange?.(false);
  }, [onOptimizeControlVisibleChange, optimizeControlVisible]);

  if (collapsed) {
    const CollapsedTemplateIcon = promptTemplateIconFor(selectedTemplate?.icon);
    return (
      <>
        {optimizeControlPortal}
        <div className="composer-prompt-template-collapsed">
          <button
            type="button"
            className="composer-prompt-template-expand-hitarea"
            onClick={expandCollapsedPanel}
            aria-label="展开提示词表单"
            title="展开提示词表单"
          />
          <div
            className="composer-prompt-template-collapsed-main"
            onClick={(event) => {
              const target = event.target as HTMLElement | null;
              if (target?.closest(".composer-template-select")) return;
              expandCollapsedPanel();
            }}
          >
            <PromptTemplateDropdown
              value={selectedTemplate?.id ?? ""}
              options={templateOptions}
              open={templateMenuOpen}
              onOpenChange={setTemplateMenuOpenOnly}
              onChange={selectTemplate}
              fallbackIcon={CollapsedTemplateIcon}
            />
            {optimize.isPending ? <b>优化中</b> : resultStale ? <b className="stale">需要重新优化</b> : activeResult ? <b>已优化</b> : null}
          </div>
          <div className="composer-prompt-template-collapsed-actions">
            <PromptResultDropdown
              value={outputKey}
              options={resultOptions}
              open={outputMenuOpen}
              onOpenChange={setOutputMenuOpenOnly}
              onChange={selectResult}
            />
            <button type="button" className="composer-prompt-template-icon-btn" onClick={onClose} aria-label="关闭提示词表单">
              <X size={15} />
            </button>
          </div>
        </div>
      </>
    );
  }

  if (!selectedTemplate) {
    return (
      <section className="composer-prompt-template-panel is-list" aria-label="提示词表单列表">
        <header className="composer-prompt-template-head">
          <div>
            <Sparkles size={17} />
            <strong>提示词表单</strong>
            <span>{templates.length > 0 ? `${templates.length} 个可用表单` : "选择表单后填写"}</span>
          </div>
          <button type="button" className="composer-prompt-template-icon-btn" onClick={onClose} aria-label="关闭提示词表单">
            <X size={16} />
          </button>
        </header>
        <label className="composer-prompt-template-search">
          <Search size={15} />
          <input
            ref={keywordInputRef}
            value={keywordInput}
            onChange={(event) => {
              const nextValue = event.target.value;
              setKeywordInput(nextValue);
              if (keywordComposingRef.current || (event.nativeEvent as InputEvent).isComposing) return;
              setKeyword(nextValue);
            }}
            onCompositionStart={() => {
              keywordComposingRef.current = true;
            }}
            onCompositionEnd={(event) => {
              const nextValue = event.currentTarget.value;
              keywordComposingRef.current = false;
              setKeywordInput(nextValue);
              setKeyword(nextValue);
            }}
            placeholder="搜索表单"
          />
          <button
            type="button"
            className="composer-prompt-template-search-clear"
            aria-label="清除搜索内容"
            title="清除"
            tabIndex={keywordInput ? 0 : -1}
            aria-hidden={keywordInput ? undefined : true}
            onMouseDown={(event) => event.preventDefault()}
            onClick={clearKeyword}
          >
            <X size={14} />
          </button>
        </label>
        <div className="composer-prompt-template-list">
          {templatesQuery.isLoading ? <div className="composer-prompt-template-empty">正在加载表单</div> : null}
          {!templatesQuery.isLoading && templates.length === 0 ? <div className="composer-prompt-template-empty">暂无匹配表单</div> : null}
          {templates.map((template) => {
            const TemplateIcon = promptTemplateIconFor(template.icon);
            return (
              <button
                key={template.id}
                type="button"
                className="composer-prompt-template-card"
                onClick={() => selectTemplate(template.id)}
              >
                <span className="composer-prompt-template-card-icon" aria-hidden="true">
                  <TemplateIcon size={18} strokeWidth={2.1} />
                </span>
                <span>
                  <strong>{template.name}</strong>
                  <small>{template.description || "创作提示词表单"}</small>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <>
    {optimizeControlPortal}
    <section className="composer-prompt-template-panel is-form" aria-label="填写提示词表单">
      <header className="composer-prompt-template-head">
        <div>
          <button type="button" className="composer-prompt-template-back" onClick={() => setSelectedId("")} aria-label="返回表单列表">
            <ArrowLeft size={16} />
          </button>
          <strong>{selectedTemplate.name}</strong>
          {headerStatus ? <span>{headerStatus}</span> : null}
        </div>
        <div className="composer-prompt-template-head-actions">
          <PromptResultDropdown
            value={outputKey}
            options={resultOptions}
            open={outputMenuOpen}
            onOpenChange={setOutputMenuOpenOnly}
            onChange={selectResult}
          />
          <button
            type="button"
            className="composer-prompt-template-icon-btn"
            onClick={() => setCollapsed(true)}
            aria-label="收起提示词表单"
            title="收起"
          >
            <ChevronDown size={16} />
          </button>
          <button type="button" className="composer-prompt-template-icon-btn" onClick={onClose} aria-label="关闭提示词表单">
            <X size={16} />
          </button>
        </div>
      </header>
      <PromptTemplateMiniForm
        template={selectedTemplate}
        formValues={formValues}
        onChange={handleFormValuesChange}
      />
    </section>
    </>
  );
}

function PromptTemplateDropdown({
  value,
  options,
  open,
  onOpenChange,
  onChange,
  fallbackIcon
}: {
  value: string;
  options: Array<{ value: string; label: string; description: string; icon?: string }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: string) => void;
  fallbackIcon: LucideIcon;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === selected?.value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const SelectedIcon = selected?.icon ? promptTemplateIconFor(selected.icon) : fallbackIcon;

  useEffect(() => {
    if (open) setActiveIndex(fallbackActiveIndex(options, selectedIndex));
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!ref.current?.contains(target)) onOpenChange(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onOpenChange, open]);

  function commitActiveOption() {
    const option = options[activeIndex];
    if (option) onChange(option.value);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        onOpenChange(true);
        setActiveIndex(fallbackActiveIndex(options, selectedIndex));
        return;
      }
      setActiveIndex((index) => moveActiveIndex(options, index, event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        onOpenChange(true);
        setActiveIndex(fallbackActiveIndex(options, selectedIndex));
        return;
      }
      commitActiveOption();
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      onOpenChange(false);
    }
  }

  return (
    <div className="composer-template-select" ref={ref}>
      <button type="button" className="composer-template-select-trigger" onClick={() => onOpenChange(!open)} onKeyDown={handleKeyDown} aria-expanded={open}>
        <span className="composer-prompt-template-collapsed-icon" aria-hidden="true">
          <SelectedIcon size={16} strokeWidth={2.1} />
        </span>
        <strong>{selected?.label || "提示词表单"}</strong>
        <ChevronDown size={15} className={open ? "open" : ""} />
      </button>
      {open ? (
        <div className="composer-result-select-menu composer-template-select-menu" role="listbox">
          {options.map((option, index) => {
            const TemplateIcon = promptTemplateIconFor(option.icon);
            return (
              <button
                key={option.value}
                type="button"
                className={cx(option.value === value && "active", index === activeIndex && "keyboard-active")}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => onChange(option.value)}
              >
                <span className="composer-template-select-option-icon" aria-hidden="true">
                  <TemplateIcon size={16} strokeWidth={2.1} />
                </span>
                <span className="composer-template-select-option-text">
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
                {option.value === value ? <Check size={18} strokeWidth={2.4} className="composer-select-check" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function PromptResultDropdown({
  value,
  options,
  open,
  onOpenChange,
  onChange
}: {
  value: PromptResultKey;
  options: PromptResultOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (value: PromptResultKey) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === selected?.value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);

  useEffect(() => {
    if (open) setActiveIndex(fallbackActiveIndex(options, selectedIndex));
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!ref.current?.contains(target)) onOpenChange(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onOpenChange, open]);

  function commitActiveOption() {
    const option = options[activeIndex];
    if (option && !option.disabled) onChange(option.value);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        onOpenChange(true);
        setActiveIndex(fallbackActiveIndex(options, selectedIndex));
        return;
      }
      setActiveIndex((index) => moveActiveIndex(options, index, event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        onOpenChange(true);
        setActiveIndex(fallbackActiveIndex(options, selectedIndex));
        return;
      }
      commitActiveOption();
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      onOpenChange(false);
    }
  }

  return (
    <div className="composer-result-select" ref={ref}>
      <button type="button" className="composer-result-select-trigger" onClick={() => onOpenChange(!open)} onKeyDown={handleKeyDown} aria-expanded={open}>
        <span>{selected.label}</span>
        <ChevronDown size={15} className={open ? "open" : ""} />
      </button>
      {open ? (
        <div className="composer-result-select-menu" role="listbox">
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              disabled={option.disabled}
              className={cx(option.value === value && "active", index === activeIndex && "keyboard-active")}
              onMouseEnter={() => {
                if (!option.disabled) setActiveIndex(index);
              }}
              onClick={() => onChange(option.value)}
            >
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              {option.loading ? <Loader2 size={14} className="spin" /> : option.value === value ? <Check size={18} strokeWidth={2.4} className="composer-select-check" /> : option.needsOptimize ? <RotateCw size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PromptTemplateMiniForm({
  template,
  formValues,
  onChange
}: {
  template: PromptTemplate;
  formValues: PromptTemplateFormValues;
  onChange: (value: PromptTemplateFormValues) => void;
}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const components = sortedPromptTemplateComponents(template.components);
  const patchValue = (id: string, value: PromptTemplateFormValue) => onChange({ ...formValues, [id]: value });

  if (components.length === 0) {
    return <div className="composer-prompt-template-empty">这个表单还没有字段</div>;
  }

  return (
    <div className="composer-prompt-template-form">
      {components.map((component) => {
        if (component.type === "section") {
          return <div className={cx("template-section-title", componentLayoutClass(component))} key={component.id}>{component.label}</div>;
        }
        const value = formValues[component.id];
        if (component.type === "textarea") {
          return (
            <label className={cx("template-field", componentLayoutClass(component))} key={component.id}>
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
            <label className={cx("template-field", componentLayoutClass(component))} key={component.id}>
              <span>{component.label}{component.required ? <b>*</b> : null}</span>
              {component.multiple ? (
                <div className="composer-template-multi-options">
                  {options.map((option) => {
                    const active = selectedValues.includes(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={active ? "active" : ""}
                        onClick={() => {
                          patchValue(
                            component.id,
                            active ? selectedValues.filter((item) => item !== option.value) : [...selectedValues, option.value]
                          );
                        }}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
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
            <label className={cx("template-field", componentLayoutClass(component))} key={component.id}>
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
            <div className={cx("template-field", componentLayoutClass(component))} key={component.id}>
              <span>{component.label}{component.required ? <b>*</b> : null}</span>
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
                      const settled = await Promise.allSettled(selectedFiles.map(async (file): Promise<PromptTemplateImageFile> => {
                        const form = new FormData();
                        form.set("file", file);
                        form.set("space", "private");
                        const result = await api.uploadAsset(form);
                        const asset = result.asset;
                        return {
                          id: asset.id,
                          fileName: asset.name || file.name,
                          size: asset.size || file.size,
                          width: asset.imageWidth,
                          height: asset.imageHeight,
                          previewUrl: asset.thumbnailUrl || asset.previewUrl || asset.url,
                          downloadUrl: asset.originalUrl || asset.url,
                          mimeType: asset.mimeType || file.type,
                          assetId: asset.id,
                          asset,
                          uploaded: true
                        };
                      }));
                      const uploadedFiles = settled
                        .filter((result): result is PromiseFulfilledResult<PromptTemplateImageFile> => result.status === "fulfilled")
                        .map((result) => result.value);
                      const failedCount = settled.length - uploadedFiles.length;
                      if (uploadedFiles.length > 0) {
                        queryClient.invalidateQueries({ queryKey: ["assets"] });
                        const nextFiles = [...imageFiles, ...uploadedFiles];
                        patchValue(component.id, {
                          ...imageValue,
                          files: nextFiles,
                          fileName: nextFiles[0]?.fileName ?? "",
                          uploaded: nextFiles.length > 0,
                          previewUrl: nextFiles[0]?.previewUrl ?? ""
                        });
                      }
                      if (failedCount > 0) showToast(`${failedCount} 张素材原图保存失败`, "error");
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
                        <button type="button" aria-label="移除素材" onClick={() => removeImageFile(file.id)}>
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
          <label className={cx("template-field", componentLayoutClass(component))} key={component.id}>
            <span>{component.label}{component.required ? <b>*</b> : null}</span>
            <input value={String(value ?? "")} placeholder={component.placeholder} onChange={(event) => patchValue(component.id, event.target.value)} />
            {component.helpText ? <small>{component.helpText}</small> : null}
          </label>
        );
      })}
    </div>
  );
}
