import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEventHandler, type CSSProperties, type RefObject } from "react";
import { ArrowUp, BrushCleaning, ImageIcon, Lightbulb, Plus, RotateCw, Sparkles, Undo2, WandSparkles, X } from "lucide-react";
import { ImageLightbox, type ImageLightboxState } from "../ImageLightbox";
import { MaterialPickerDrawer } from "../MaterialPicker";
import { ImageCountStepper, QualityPicker, SizePicker } from "../ImageOptionPickers";
import { PromptColorSchemeSelect } from "../PromptColorSchemeSelect";
import { PromptOptimizeStyleSelect } from "../PromptOptimizeStyleSelect";
import { PromptTemplateComposerPanel } from "./PromptTemplateComposerPanel";
import { api, type PromptColorScheme, type PromptTemplateOptimizeStyle } from "../../api";
import { cx } from "../../lib/cx";
import {
  applyPromptColorSchemeInjection,
  normalizePromptColorSchemeIds,
  promptCustomColorSchemeHexFromInjection,
  promptCustomColorSchemeInjectionText,
  promptColorSchemesByIds,
  promptColorSchemesInjectionText
} from "../../lib/promptColorSchemes";
import {
  isPromptOptimizeSeriesStyle,
  normalizePromptOptimizeStyle,
  promptOptimizeStyleDefaultPrompt,
  promptOptimizeStyleOption,
  type PromptOptimizeStyleGroup
} from "../../lib/promptOptimizeStyles";
import { useI18n } from "../../i18n";
import type { QualityOption, SizeOption } from "../../lib/imageOptions";
import type { ComposerPromptTemplateDraft, ComposerPromptTemplatePanelDraft } from "../../store/workbench";
import type { AssetItem, ImageEditSuggestion } from "../../types";
import { useToast } from "../../ui";

type QuickMenuSource = "plus" | "slash";
const QUICK_MENU_ITEM_COUNT = 3;
const PROMPT_INPUT_OPTIMIZE_STYLE_STORAGE_KEY = "gpt-image.prompt-input-optimize-style";

export type ChatComposerPreview = {
  id: string;
  url: string;
  previewUrl?: string;
  name: string;
  title: string;
  onRemove: () => void;
};

type ChatComposerProps = {
  autoOptimizePromptRequest?: { id: number; prompt: string } | null;
  assets?: { assets: AssetItem[] };
  busy: boolean;
  composerInstanceKey: string;
  draftPrompt: string;
  error: string;
  editSuggestions?: ImageEditSuggestion[];
  editSuggestionsLoading?: boolean;
  materialPickerOpen: boolean;
  placeholder: string;
  previews: ChatComposerPreview[];
  imageCount: number;
  promptColorSchemes: PromptColorScheme[];
  promptColorSchemeIds: string[];
  promptColorSchemeInjection?: string;
  promptInputOptimizeStyle: PromptTemplateOptimizeStyle;
  promptOptimizeCustomInstruction?: string;
  promptOptimizeStyleGroups: PromptOptimizeStyleGroup[];
  promptTemplateDraft?: ComposerPromptTemplateDraft | null;
  quality: string;
  qualityOptions: QualityOption[];
  selectedAssets: AssetItem[];
  size: string;
  sizeOptions: SizeOption[];
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onDraftPromptChange: (value: string) => void;
  onApplyEditSuggestion?: (suggestion: ImageEditSuggestion) => void;
  onAutoOptimizePromptRequestHandled?: (id: number) => void;
  onImageCountChange: (value: number) => void;
  onPaste: ClipboardEventHandler<HTMLTextAreaElement>;
  onQualityChange: (value: string) => void;
  onSelectedAssetsChange: (assets: AssetItem[]) => void;
  onSizeChange: (value: string) => void;
  onSubmit: () => void;
  onToggleAsset: (asset: AssetItem) => void;
  onOpenCasePicker: () => void;
  onToggleMaterialPicker: () => void;
  onPromptColorSchemeChange?: (state: { ids: string[]; injection: string; prompt: string }) => void;
  onPromptInputOptimizeStyleChange?: (value: PromptTemplateOptimizeStyle) => void;
  onPromptOptimizeCustomInstructionChange?: (value: string) => void;
  onPromptTemplateDraftChange?: (draft: ComposerPromptTemplateDraft | null) => void;
  draftCaseUsage?: { caseItemId: string; prompt: string } | null;
};

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function measureTextareaCaret(textarea: HTMLTextAreaElement, value: string, position: number) {
  const rect = textarea.getBoundingClientRect();
  const styles = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  mirror.style.position = "fixed";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.left = `${rect.left}px`;
  mirror.style.top = `${rect.top}px`;
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.style.boxSizing = styles.boxSizing;
  mirror.style.border = styles.border;
  mirror.style.padding = styles.padding;
  mirror.style.fontFamily = styles.fontFamily;
  mirror.style.fontSize = styles.fontSize;
  mirror.style.fontWeight = styles.fontWeight;
  mirror.style.letterSpacing = styles.letterSpacing;
  mirror.style.lineHeight = styles.lineHeight;
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.wordBreak = styles.wordBreak;
  mirror.textContent = value.slice(0, position);

  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const markerRect = marker.getBoundingClientRect();
  document.body.removeChild(mirror);

  return {
    left: markerRect.left - textarea.scrollLeft,
    top: markerRect.top - textarea.scrollTop
  };
}

export function ChatComposer({
  autoOptimizePromptRequest,
  assets,
  busy,
  composerInstanceKey,
  draftPrompt,
  error,
  editSuggestions = [],
  editSuggestionsLoading = false,
  materialPickerOpen,
  placeholder,
  previews,
  imageCount,
  promptColorSchemes,
  promptColorSchemeIds,
  promptColorSchemeInjection = "",
  promptInputOptimizeStyle,
  promptOptimizeCustomInstruction = "",
  promptOptimizeStyleGroups,
  promptTemplateDraft,
  quality,
  qualityOptions,
  selectedAssets,
  size,
  sizeOptions,
  textareaRef,
  onDraftPromptChange,
  onApplyEditSuggestion,
  onAutoOptimizePromptRequestHandled,
  onImageCountChange,
  onPaste,
  onQualityChange,
  onSelectedAssetsChange,
  onSizeChange,
  onSubmit,
  onToggleAsset,
  onOpenCasePicker,
  onToggleMaterialPicker,
  onPromptColorSchemeChange,
  onPromptInputOptimizeStyleChange,
  onPromptOptimizeCustomInstructionChange,
  onPromptTemplateDraftChange,
  draftCaseUsage
}: ChatComposerProps) {
  const [previewState, setPreviewState] = useState<ImageLightboxState | null>(null);
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);
  const [quickMenuSource, setQuickMenuSource] = useState<QuickMenuSource>("plus");
  const [quickMenuActiveIndex, setQuickMenuActiveIndex] = useState(0);
  const [slashMenuPosition, setSlashMenuPosition] = useState<{ left: number; top: number } | null>(null);
  const [promptTemplateOpen, setPromptTemplateOpen] = useState(() => Boolean(promptTemplateDraft?.open));
  const [promptTemplateLoading, setPromptTemplateLoading] = useState(false);
  const [promptTemplateStreaming, setPromptTemplateStreaming] = useState(false);
  const [promptTemplateTyping, setPromptTemplateTyping] = useState(false);
  const [promptTemplateTypedText, setPromptTemplateTypedText] = useState("");
  const [promptTemplateActionSlot, setPromptTemplateActionSlot] = useState<HTMLSpanElement | null>(null);
  const [promptTemplateOptimizeControlVisible, setPromptTemplateOptimizeControlVisible] = useState(false);
  const [promptInputOptimizePending, setPromptInputOptimizePending] = useState(false);
  const [promptInputOptimizeStreaming, setPromptInputOptimizeStreaming] = useState(false);
  const [promptInputCustomInstruction, setPromptInputCustomInstruction] = useState(promptOptimizeCustomInstruction);
  const [promptBeforeInputOptimize, setPromptBeforeInputOptimize] = useState("");
  const [promptTemplateCollapseSignal, setPromptTemplateCollapseSignal] = useState(0);
  const { showToast } = useToast();
  const { t } = useI18n();
  const quickMenuRef = useRef<HTMLDivElement | null>(null);
  const slashTriggerRef = useRef<{ index: number } | null>(null);
  const promptTemplateLoadingRef = useRef(false);
  const promptTemplateStreamedRef = useRef(false);
  const promptTemplateTypeTimerRef = useRef<number | null>(null);
  const promptTemplateTypewriterRef = useRef<HTMLDivElement | null>(null);
  const promptOptimizedDraftRef = useRef("");
  const handledAutoOptimizePromptRequestIdRef = useRef<number | null>(null);
  const promptTemplatePanelDraftRef = useRef<ComposerPromptTemplatePanelDraft | null>(promptTemplateDraft?.panel ?? null);
  const draftCaseUsageKey = useMemo(() => (
    draftCaseUsage ? `${draftCaseUsage.caseItemId}\u0000${draftCaseUsage.prompt}` : ""
  ), [draftCaseUsage]);
  const lastDraftCaseUsageKeyRef = useRef(draftCaseUsageKey);
  const promptOptimizationLoading = promptTemplateLoading || promptInputOptimizePending;
  const promptTextareaLoading = (promptTemplateLoading && !promptTemplateStreaming) || (promptInputOptimizePending && !promptInputOptimizeStreaming);
  const optimizeStyleOption = promptOptimizeStyleOption(promptInputOptimizeStyle, promptOptimizeStyleGroups);
  const normalizedPromptColorSchemeIds = normalizePromptColorSchemeIds(promptColorSchemeIds, promptColorSchemes).slice(0, 1);
  const promptColorSchemeCustomHex = normalizedPromptColorSchemeIds.length === 0
    ? promptCustomColorSchemeHexFromInjection(promptColorSchemeInjection)
    : "";
  const hasDraftPrompt = Boolean(draftPrompt.trim());
  const hasClearableInput = hasDraftPrompt || selectedAssets.length > 0;
  const clearInputLabel = selectedAssets.length > 0 ? t("composer.clearInputWithAssets") : t("composer.clearInput");
  const visibleEditSuggestions = editSuggestions.slice(0, 3);
  const showEditSuggestions = editSuggestionsLoading || visibleEditSuggestions.length > 0;
  const previewItems = previews.map((preview) => ({
    url: preview.previewUrl ?? preview.url,
    thumbnailUrl: preview.url,
    name: preview.name
  }));
  const handlePromptTemplateDraftChange = useCallback((panelDraft: ComposerPromptTemplatePanelDraft) => {
    promptTemplatePanelDraftRef.current = panelDraft;
    onPromptTemplateDraftChange?.({ open: true, panel: panelDraft });
  }, [onPromptTemplateDraftChange]);

  useEffect(() => {
    if (!quickMenuOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.isComposing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setQuickMenuActiveIndex((index) => {
          const step = event.key === "ArrowDown" ? 1 : -1;
          return (index + step + QUICK_MENU_ITEM_COUNT) % QUICK_MENU_ITEM_COUNT;
        });
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        selectActiveQuickMenuItem();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeQuickMenu(quickMenuSource === "slash");
      }
    }
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!quickMenuRef.current?.contains(target)) closeQuickMenu(quickMenuSource === "slash");
    }
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [draftPrompt, quickMenuActiveIndex, quickMenuOpen, quickMenuSource]);

  useEffect(() => {
    return () => {
      if (promptTemplateTypeTimerRef.current !== null) window.clearTimeout(promptTemplateTypeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(PROMPT_INPUT_OPTIMIZE_STYLE_STORAGE_KEY, promptInputOptimizeStyle);
    } catch {
      // localStorage can be unavailable in restricted browser modes.
    }
  }, [onPromptInputOptimizeStyleChange, promptInputOptimizeStyle]);

  function closePromptTemplatePanel() {
    promptTemplatePanelDraftRef.current = null;
    setPromptTemplateOpen(false);
    setPromptTemplateLoading(false);
    setPromptTemplateStreaming(false);
    setPromptTemplateOptimizeControlVisible(false);
    stopPromptTemplateTyping();
    onPromptTemplateDraftChange?.(null);
  }

  useEffect(() => {
    promptTemplatePanelDraftRef.current = promptTemplateDraft?.panel ?? null;
    setPromptTemplateOpen(Boolean(promptTemplateDraft?.open));
    setPromptTemplateLoading(false);
    setPromptTemplateStreaming(false);
    setPromptTemplateOptimizeControlVisible(false);
    setPromptTemplateCollapseSignal(0);
    stopPromptTemplateTyping();
  }, [composerInstanceKey]);

  useEffect(() => {
    if (promptTemplateLoading) {
      stopPromptTemplateTyping();
      promptTemplateLoadingRef.current = true;
      if (promptTemplateStreaming) promptTemplateStreamedRef.current = true;
      return;
    }
    if (promptInputOptimizePending) {
      stopPromptTemplateTyping();
      return;
    }
    if (promptTemplateLoadingRef.current && draftPrompt.trim() && !promptTemplateStreamedRef.current) startPromptTemplateTyping(draftPrompt);
    promptTemplateLoadingRef.current = false;
    promptTemplateStreamedRef.current = false;
  }, [draftPrompt, promptInputOptimizePending, promptTemplateLoading, promptTemplateStreaming]);

  useEffect(() => {
    if (!promptInputOptimizePending && !promptTemplateLoading && !promptTemplateTyping) return;
    scrollPromptTextareaToBottom();
  }, [draftPrompt, promptInputOptimizePending, promptTemplateLoading, promptTemplateTypedText, promptTemplateTyping]);

  function resetInputOptimizationState() {
    promptOptimizedDraftRef.current = "";
    setPromptBeforeInputOptimize("");
  }

  function updatePromptOptimizeCustomInstruction(value: string) {
    setPromptInputCustomInstruction(value);
    onPromptOptimizeCustomInstructionChange?.(value);
  }

  useEffect(() => {
    setPromptInputCustomInstruction(promptOptimizeCustomInstruction);
  }, [promptOptimizeCustomInstruction]);

  useLayoutEffect(() => {
    if (!promptBeforeInputOptimize || promptInputOptimizePending) return;
    if (draftPrompt === promptOptimizedDraftRef.current) return;
    resetInputOptimizationState();
  }, [draftPrompt, promptBeforeInputOptimize, promptInputOptimizePending]);

  useLayoutEffect(() => {
    if (draftCaseUsageKey === lastDraftCaseUsageKeyRef.current) return;
    lastDraftCaseUsageKeyRef.current = draftCaseUsageKey;
    if (draftCaseUsageKey) resetInputOptimizationState();
  }, [draftCaseUsageKey]);

  function scrollPromptTextareaToBottom() {
    const applyScroll = () => {
      const textarea = textareaRef.current;
      if (textarea) textarea.scrollTop = textarea.scrollHeight;
      const typewriter = promptTemplateTypewriterRef.current;
      if (typewriter) typewriter.scrollTop = typewriter.scrollHeight;
    };
    window.requestAnimationFrame(() => {
      applyScroll();
      window.requestAnimationFrame(applyScroll);
    });
  }

  function shouldOpenQuickMenuWithSlash(value: string, selectionStart: number | null) {
    const cursor = Number(selectionStart ?? value.length);
    const prefix = value.slice(0, cursor);
    const currentLine = prefix.slice(prefix.lastIndexOf("\n") + 1);
    return value.trim().length === 0 || currentLine.trim().length === 0;
  }

  function clearPendingSlash(removeSlash: boolean) {
    const trigger = slashTriggerRef.current;
    slashTriggerRef.current = null;
    const currentPrompt = textareaRef.current?.value ?? draftPrompt;
    if (!removeSlash || !trigger || currentPrompt[trigger.index] !== "/") return;
    const nextPrompt = `${currentPrompt.slice(0, trigger.index)}${currentPrompt.slice(trigger.index + 1)}`;
    onDraftPromptChange(nextPrompt);
    window.setTimeout(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const cursor = Math.min(trigger.index, nextPrompt.length);
      textarea.setSelectionRange(cursor, cursor);
    }, 0);
  }

  function closeQuickMenu(removeSlash = false) {
    clearPendingSlash(removeSlash);
    setQuickMenuOpen(false);
    setQuickMenuSource("plus");
    setQuickMenuActiveIndex(0);
    setSlashMenuPosition(null);
  }

  function closeSlashMenuWithoutChangingPrompt() {
    slashTriggerRef.current = null;
    setQuickMenuOpen(false);
    setQuickMenuSource("plus");
    setQuickMenuActiveIndex(0);
    setSlashMenuPosition(null);
  }

  function openQuickMenuFromPlus() {
    if (quickMenuOpen && quickMenuSource === "plus") {
      closeQuickMenu(false);
      return;
    }
    clearPendingSlash(quickMenuSource === "slash");
    setQuickMenuSource("plus");
    setQuickMenuActiveIndex(0);
    setSlashMenuPosition(null);
    setQuickMenuOpen(true);
  }

  function openQuickMenuFromSlash(textarea: HTMLTextAreaElement, value: string, slashIndex: number) {
    const caret = measureTextareaCaret(textarea, value, slashIndex + 1);
    slashTriggerRef.current = { index: slashIndex };
    setQuickMenuSource("slash");
    setQuickMenuActiveIndex(0);
    setSlashMenuPosition({
      left: clampNumber(caret.left - 10, 12, window.innerWidth - 160),
      top: Math.max(12, caret.top - 8)
    });
    setQuickMenuOpen(true);
  }

  function insertSlashAndOpenQuickMenu(textarea: HTMLTextAreaElement) {
    const start = Number(textarea.selectionStart ?? textarea.value.length);
    const end = Number(textarea.selectionEnd ?? start);
    const nextPrompt = `${textarea.value.slice(0, start)}/${textarea.value.slice(end)}`;
    onDraftPromptChange(nextPrompt);
    openQuickMenuFromSlash(textarea, nextPrompt, start);
    window.setTimeout(() => {
      textarea.setSelectionRange(start + 1, start + 1);
    }, 0);
  }

  function selectQuickMenuItem() {
    clearPendingSlash(true);
    setQuickMenuOpen(false);
    setQuickMenuSource("plus");
    setQuickMenuActiveIndex(0);
    setSlashMenuPosition(null);
  }

  function selectActiveQuickMenuItem() {
    if (quickMenuActiveIndex === 0) {
      openMaterialPickerFromMenu();
      return;
    }
    if (quickMenuActiveIndex === 1) {
      openCasePickerFromMenu();
      return;
    }
    openPromptTemplateFromMenu();
  }

  function stopPromptTemplateTyping() {
    if (promptTemplateTypeTimerRef.current !== null) {
      window.clearTimeout(promptTemplateTypeTimerRef.current);
      promptTemplateTypeTimerRef.current = null;
    }
    setPromptTemplateTyping(false);
    setPromptTemplateTypedText("");
  }

  function startPromptTemplateTyping(text: string) {
    if (promptTemplateTypeTimerRef.current !== null) window.clearTimeout(promptTemplateTypeTimerRef.current);
    const stepSize = Math.max(1, Math.ceil(text.length / 140));
    let nextLength = 0;
    setPromptTemplateTyping(true);
    setPromptTemplateTypedText("");
    const tick = () => {
      nextLength = Math.min(text.length, nextLength + stepSize);
      setPromptTemplateTypedText(text.slice(0, nextLength));
      if (nextLength >= text.length) {
        promptTemplateTypeTimerRef.current = window.setTimeout(() => {
          promptTemplateTypeTimerRef.current = null;
          setPromptTemplateTyping(false);
          setPromptTemplateTypedText("");
        }, 220);
        return;
      }
      promptTemplateTypeTimerRef.current = window.setTimeout(tick, 18);
    };
    promptTemplateTypeTimerRef.current = window.setTimeout(tick, 60);
  }

  function handleTextareaChange(value: string) {
    stopPromptTemplateTyping();
    resetInputOptimizationState();
    if (!value.trim() && promptInputOptimizeStyle !== "standard") {
      if (isPromptOptimizeSeriesStyle(promptInputOptimizeStyle, promptOptimizeStyleGroups) && imageCount !== 1) onImageCountChange(1);
      onPromptInputOptimizeStyleChange?.("standard");
    }
    const trigger = slashTriggerRef.current;
    if (quickMenuOpen && quickMenuSource === "slash" && trigger && value[trigger.index] !== "/") {
      closeSlashMenuWithoutChangingPrompt();
    }
    onDraftPromptChange(value);
  }

  function closeMaterialPickerWithMotion() {
    if (!materialPickerOpen) return;
    onToggleMaterialPicker();
  }

  function toggleMaterialPickerWithMotion() {
    if (materialPickerOpen) {
      closeMaterialPickerWithMotion();
      return;
    }
    onToggleMaterialPicker();
  }

  function openMaterialPickerFromMenu() {
    selectQuickMenuItem();
    toggleMaterialPickerWithMotion();
  }

  function openCasePickerFromMenu() {
    selectQuickMenuItem();
    onOpenCasePicker();
  }

  function openPromptTemplateFromMenu() {
    selectQuickMenuItem();
    if (materialPickerOpen) closeMaterialPickerWithMotion();
    const panelDraft = promptTemplatePanelDraftRef.current ?? promptTemplateDraft?.panel ?? null;
    setPromptTemplateOpen(true);
    onPromptTemplateDraftChange?.({ open: true, panel: panelDraft });
  }

  function collapsePromptTemplateOnInputFocus() {
    if (materialPickerOpen && selectedAssets.length > 0) closeMaterialPickerWithMotion();
    if (!promptTemplateOpen || !draftPrompt.trim()) return;
    setPromptTemplateCollapseSignal((value) => value + 1);
  }

  function promptWithOptionalNegative(prompt: string, negativePrompt: string | undefined) {
    const main = prompt.trim();
    const negative = String(negativePrompt ?? "").trim();
    return negative ? [main, `反向提示词：${negative}`].filter(Boolean).join("\n\n") : main;
  }

  function currentPromptOptimizeSource(sourceOverride?: string) {
    if (sourceOverride !== undefined) return sourceOverride;
    const currentDraftPrompt = textareaRef.current?.value ?? draftPrompt;
    return promptBeforeInputOptimize && currentDraftPrompt === promptOptimizedDraftRef.current ? promptBeforeInputOptimize : currentDraftPrompt;
  }

  async function optimizeCurrentPrompt(
    nextOptimizeStyle = promptInputOptimizeStyle,
    sourceOverride?: string,
    imageCountOverride?: number,
    customInstructionOverride = ""
  ) {
    const originalPrompt = currentPromptOptimizeSource(sourceOverride);
    const sourcePrompt = originalPrompt.trim();
    if (!sourcePrompt || promptInputOptimizePending) return;
    const optimizeImageCount = imageCountOverride ?? imageCount;
    const previousUndoPrompt = promptBeforeInputOptimize;
    stopPromptTemplateTyping();
    setPromptInputOptimizePending(true);
    setPromptInputOptimizeStreaming(false);
    setPromptBeforeInputOptimize("");
    try {
      let streamedPrompt = "";
      const data = await api.optimizePromptTextStream(
        {
          prompt: sourcePrompt,
          optimizeStyle: nextOptimizeStyle,
          imageCount: optimizeImageCount,
          customInstruction: customInstructionOverride
        },
        {
          onDelta: (chunk) => {
            streamedPrompt = chunk.reset ? chunk.delta : `${streamedPrompt}${chunk.delta}`;
            const nextText = streamedPrompt.trim();
            if (nextText) {
              setPromptInputOptimizeStreaming(true);
              onDraftPromptChange(nextText);
              scrollPromptTextareaToBottom();
            }
          }
        }
      );
      const optimizedPrompt = promptWithOptionalNegative(data.prompt, data.negativePrompt);
      if (!optimizedPrompt.trim()) throw new Error(t("composer.optimizeEmptyResult"));
      onDraftPromptChange(optimizedPrompt);
      scrollPromptTextareaToBottom();
      promptOptimizedDraftRef.current = optimizedPrompt;
      setPromptBeforeInputOptimize(originalPrompt);
      showToast(t("composer.optimizeSuccess"));
    } catch (error) {
      onDraftPromptChange(originalPrompt);
      setPromptBeforeInputOptimize(previousUndoPrompt);
      showToast(error instanceof Error ? error.message : t("composer.optimizeFailed"), "error");
    } finally {
      setPromptInputOptimizePending(false);
      setPromptInputOptimizeStreaming(false);
    }
  }

  useEffect(() => {
    const request = autoOptimizePromptRequest;
    if (!request || handledAutoOptimizePromptRequestIdRef.current === request.id) return;
    const sourcePrompt = request.prompt.trim();
    if (!sourcePrompt) {
      handledAutoOptimizePromptRequestIdRef.current = request.id;
      onAutoOptimizePromptRequestHandled?.(request.id);
      return;
    }
    if (promptOptimizationLoading) return;
    handledAutoOptimizePromptRequestIdRef.current = request.id;
    onAutoOptimizePromptRequestHandled?.(request.id);
    stopPromptTemplateTyping();
    resetInputOptimizationState();
    closeSlashMenuWithoutChangingPrompt();
    onDraftPromptChange(sourcePrompt);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
    void optimizeCurrentPrompt(promptInputOptimizeStyle, sourcePrompt);
  }, [autoOptimizePromptRequest?.id, promptOptimizationLoading]);

  function undoInputOptimization() {
    if (!promptBeforeInputOptimize || promptInputOptimizePending) return;
    stopPromptTemplateTyping();
    onDraftPromptChange(promptBeforeInputOptimize);
    resetInputOptimizationState();
    showToast(t("composer.optimizeUndo"));
  }

  function clearDraftPrompt() {
    if (promptOptimizationLoading) return;
    stopPromptTemplateTyping();
    resetInputOptimizationState();
    closeSlashMenuWithoutChangingPrompt();
    onPromptInputOptimizeStyleChange?.("standard");
    onPromptColorSchemeChange?.({ ids: [], injection: "", prompt: "" });
    if (imageCount !== 1) onImageCountChange(1);
    onDraftPromptChange("");
    if (selectedAssets.length > 0) onSelectedAssetsChange([]);
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function updatePromptOptimizeStyle(value: string) {
    const nextOptimizeStyle = normalizePromptOptimizeStyle(value, promptOptimizeStyleGroups);
    const currentDraftPrompt = textareaRef.current?.value ?? draftPrompt;
    const sourcePrompt = currentPromptOptimizeSource().trim();
    const currentDefaultPrompt = promptOptimizeStyleDefaultPrompt(promptInputOptimizeStyle, promptOptimizeStyleGroups).trim();
    const isUneditedStyleDefaultPrompt = currentDraftPrompt.trim() === currentDefaultPrompt;
    const styleChanged = nextOptimizeStyle !== promptInputOptimizeStyle;
    const shouldApplySeriesDefaultCount = styleChanged
      && isPromptOptimizeSeriesStyle(nextOptimizeStyle, promptOptimizeStyleGroups)
      && !isPromptOptimizeSeriesStyle(promptInputOptimizeStyle, promptOptimizeStyleGroups)
      && imageCount === 1;
    const nextImageCount = shouldApplySeriesDefaultCount ? 4 : imageCount;
    const shouldAutoOptimize = Boolean(sourcePrompt)
      && !promptInputOptimizePending
      && !promptTemplateOptimizeControlVisible
      && !isUneditedStyleDefaultPrompt;
    const shouldApplyDefaultPrompt = (!sourcePrompt || (styleChanged && isUneditedStyleDefaultPrompt))
      && !promptInputOptimizePending
      && !promptTemplateOptimizeControlVisible;
    onPromptInputOptimizeStyleChange?.(nextOptimizeStyle);
    if (shouldApplySeriesDefaultCount) onImageCountChange(nextImageCount);
    if (shouldApplyDefaultPrompt) {
      stopPromptTemplateTyping();
      resetInputOptimizationState();
      onDraftPromptChange(promptOptimizeStyleDefaultPrompt(nextOptimizeStyle, promptOptimizeStyleGroups));
      window.setTimeout(() => textareaRef.current?.focus(), 0);
      return;
    }
    if (shouldAutoOptimize) void optimizeCurrentPrompt(nextOptimizeStyle, sourcePrompt, nextImageCount);
  }

  function updatePromptColorSchemes(value: string[]) {
    if (promptOptimizationLoading) return;
    const nextIds = normalizePromptColorSchemeIds(value, promptColorSchemes).slice(0, 1);
    const nextSchemes = promptColorSchemesByIds(nextIds, promptColorSchemes);
    const nextInjection = promptColorSchemesInjectionText(nextSchemes);
    const currentPrompt = textareaRef.current?.value ?? draftPrompt;
    const result = applyPromptColorSchemeInjection(currentPrompt, promptColorSchemeInjection, nextInjection);
    stopPromptTemplateTyping();
    resetInputOptimizationState();
    closeSlashMenuWithoutChangingPrompt();
    onDraftPromptChange(result.prompt);
    onPromptColorSchemeChange?.({ ids: nextIds, injection: nextInjection, prompt: result.prompt });
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function updatePromptCustomColorScheme(hex: string) {
    if (promptOptimizationLoading) return;
    const nextInjection = promptCustomColorSchemeInjectionText(hex);
    if (!nextInjection) return;
    const currentPrompt = textareaRef.current?.value ?? draftPrompt;
    const result = applyPromptColorSchemeInjection(currentPrompt, promptColorSchemeInjection, nextInjection);
    stopPromptTemplateTyping();
    resetInputOptimizationState();
    closeSlashMenuWithoutChangingPrompt();
    onDraftPromptChange(result.prompt);
    onPromptColorSchemeChange?.({ ids: [], injection: nextInjection, prompt: result.prompt });
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function applyPromptTemplatePrompt(prompt: string) {
    if (!promptColorSchemeInjection.trim()) {
      onDraftPromptChange(prompt);
      return;
    }
    const result = applyPromptColorSchemeInjection(prompt, promptColorSchemeInjection, promptColorSchemeInjection);
    onDraftPromptChange(result.prompt);
    onPromptColorSchemeChange?.({
      ids: normalizedPromptColorSchemeIds,
      injection: promptColorSchemeInjection,
      prompt: result.prompt
    });
  }

  function submitPrompt() {
    const shouldClearUndo = Boolean(draftPrompt.trim()) && !busy && !promptOptimizationLoading;
    onSubmit();
    if (shouldClearUndo) {
      resetInputOptimizationState();
    }
  }

  const editSuggestionStrip = showEditSuggestions ? (
    <div className="composer-edit-suggestions" aria-label={t("composer.editSuggestions")}>
      {editSuggestionsLoading && visibleEditSuggestions.length === 0 ? (
        Array.from({ length: 3 }).map((_, index) => (
          <span
            key={index}
            className="composer-edit-suggestion-skeleton"
            style={{ "--composer-suggestion-delay": `${index * 95}ms` } as CSSProperties}
            aria-hidden="true"
          />
        ))
      ) : (
        visibleEditSuggestions.map((suggestion, index) => (
          <button
            key={suggestion.id}
            type="button"
            className="composer-edit-suggestion"
            style={{ "--composer-suggestion-delay": `${index * 95}ms` } as CSSProperties}
            title={suggestion.prompt}
            onClick={() => onApplyEditSuggestion?.(suggestion)}
          >
            {suggestion.label}
          </button>
        ))
      )}
    </div>
  ) : null;

  return (
    <footer className="composer-wrap">
      {error ? <div className="form-error">{error}</div> : null}
      {promptTemplateOpen ? editSuggestionStrip : null}
      {promptTemplateOpen ? (
        <PromptTemplateComposerPanel
          key={composerInstanceKey}
          selectedAssets={selectedAssets}
          onSelectedAssetsChange={onSelectedAssetsChange}
          onApplyPrompt={applyPromptTemplatePrompt}
          onClose={closePromptTemplatePanel}
          collapseSignal={promptTemplateCollapseSignal}
          onPromptLoadingChange={setPromptTemplateLoading}
          onPromptStreamingChange={setPromptTemplateStreaming}
          optimizeControlHost={promptTemplateActionSlot}
          onOptimizeControlVisibleChange={setPromptTemplateOptimizeControlVisible}
          promptOptimizeCustomInstruction={promptInputCustomInstruction}
          promptOptimizeStyleGroups={promptOptimizeStyleGroups}
          onPromptOptimizeCustomInstructionChange={updatePromptOptimizeCustomInstruction}
          initialDraft={promptTemplateDraft?.panel ?? promptTemplatePanelDraftRef.current}
          onDraftChange={handlePromptTemplateDraftChange}
        />
      ) : null}
      {!promptTemplateOpen ? editSuggestionStrip : null}
      <form
        className={cx("composer", previews.length > 0 && "has-preview", quickMenuOpen && "quick-menu-open")}
        onSubmit={(event) => {
          event.preventDefault();
          submitPrompt();
        }}
      >
        {previews.length > 0 ? (
          <div className="composer-preview-row">
            {previews.map((preview, index) => (
              <figure key={preview.id} className="composer-preview-card" title={preview.title}>
                <button
                  type="button"
                  className="composer-preview-open"
                  onClick={() => setPreviewState({ items: previewItems, index })}
                  aria-label={t("composer.previewNamed", { name: preview.name })}
                >
                  <img src={preview.url} alt={preview.name} />
                </button>
                <button type="button" className="composer-preview-remove" onClick={preview.onRemove} aria-label={t("composer.removeNamed", { name: preview.name })}>
                  <X size={15} />
                </button>
              </figure>
            ))}
          </div>
        ) : null}
        <div className={cx("composer-textarea-shell", promptTextareaLoading && "is-loading", promptTemplateTyping && "is-typing")}>
          <textarea
            ref={textareaRef}
            value={draftPrompt}
            onChange={(event) => handleTextareaChange(event.target.value)}
            onBeforeInput={(event) => {
              const data = "data" in event.nativeEvent ? String(event.nativeEvent.data ?? "") : "";
              if (data !== "/" || !shouldOpenQuickMenuWithSlash(event.currentTarget.value, event.currentTarget.selectionStart)) return;
              event.preventDefault();
              insertSlashAndOpenQuickMenu(event.currentTarget);
            }}
            onPaste={onPaste}
            onFocus={collapsePromptTemplateOnInputFocus}
            onKeyDown={(event) => {
              if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && shouldOpenQuickMenuWithSlash(event.currentTarget.value, event.currentTarget.selectionStart)) {
                event.preventDefault();
                insertSlashAndOpenQuickMenu(event.currentTarget);
                return;
              }
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              submitPrompt();
            }}
            placeholder={placeholder}
            rows={1}
          />
          {promptTextareaLoading ? (
            <div className="composer-textarea-skeleton" aria-hidden="true">
              <span />
              <span />
            </div>
          ) : null}
          {promptTemplateTyping ? <div className="composer-textarea-typewriter" ref={promptTemplateTypewriterRef} aria-hidden="true">{promptTemplateTypedText}</div> : null}
        </div>
        <div className="composer-actions">
          <div className="composer-quick-wrap" ref={quickMenuRef}>
            <button
              type="button"
              className="composer-tool-btn"
              aria-label={t("composer.addMenu")}
              aria-expanded={quickMenuOpen}
              data-tooltip={t("composer.addMenu")}
              onClick={openQuickMenuFromPlus}
            >
              <Plus size={24} strokeWidth={2} />
            </button>
            {quickMenuOpen ? (
              <div
                className={cx("composer-quick-menu", quickMenuSource === "slash" && "is-slash")}
                style={quickMenuSource === "slash" && slashMenuPosition ? slashMenuPosition : undefined}
                role="menu"
                aria-label={t("composer.quickOptions")}
              >
                <button
                  type="button"
                  role="menuitem"
                  className={cx(quickMenuActiveIndex === 0 && "active")}
                  aria-current={quickMenuActiveIndex === 0 ? "true" : undefined}
                  onMouseEnter={() => setQuickMenuActiveIndex(0)}
                  onFocus={() => setQuickMenuActiveIndex(0)}
                  onClick={openMaterialPickerFromMenu}
                >
                  <ImageIcon size={17} />
                  <strong>{t("composer.assets")}</strong>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={cx(quickMenuActiveIndex === 1 && "active")}
                  aria-current={quickMenuActiveIndex === 1 ? "true" : undefined}
                  onMouseEnter={() => setQuickMenuActiveIndex(1)}
                  onFocus={() => setQuickMenuActiveIndex(1)}
                  onClick={openCasePickerFromMenu}
                >
                  <Lightbulb size={17} />
                  <strong>{t("composer.inspiration")}</strong>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={cx(quickMenuActiveIndex === 2 && "active")}
                  aria-current={quickMenuActiveIndex === 2 ? "true" : undefined}
                  onMouseEnter={() => setQuickMenuActiveIndex(2)}
                  onFocus={() => setQuickMenuActiveIndex(2)}
                  onClick={openPromptTemplateFromMenu}
                >
                  <Sparkles size={17} />
                  <strong>{t("composer.promptTemplates")}</strong>
                </button>
              </div>
            ) : null}
          </div>
          <SizePicker value={size} options={sizeOptions} onChange={onSizeChange} />
          <QualityPicker value={quality} options={qualityOptions} onChange={onQualityChange} />
          <ImageCountStepper value={imageCount} onChange={onImageCountChange} />
          <span className="composer-prompt-template-style-tooltip composer-prompt-template-color-control" data-tooltip={t("settings.personalization.colorSchemes.title")}>
            <PromptColorSchemeSelect
              value={normalizedPromptColorSchemeIds}
              schemes={promptColorSchemes}
              onChange={updatePromptColorSchemes}
              customColorHex={promptColorSchemeCustomHex}
              onCustomColorSelect={updatePromptCustomColorScheme}
              disabled={promptOptimizationLoading}
              className="composer-prompt-template-color-select"
              menuClassName="composer-prompt-template-color-menu"
              menuPlacement="top"
              menuWidth={340}
            />
          </span>
          <span className="composer-prompt-template-action-slot" ref={setPromptTemplateActionSlot}>
            {!promptTemplateOptimizeControlVisible ? (
              <>
                <div className="composer-prompt-template-optimize-control is-default" aria-label={t("composer.optimizeOptions")}>
                  <button
                    type="button"
                    className="secondary-btn icon-only-btn composer-prompt-template-optimize-submit"
                    disabled={promptInputOptimizePending || !draftPrompt.trim()}
                    onClick={() => optimizeCurrentPrompt()}
                    aria-label={draftPrompt.trim() ? t("composer.optimizeInput", { style: optimizeStyleOption.label }) : t("composer.optimizeDisabled")}
                    title={draftPrompt.trim() ? t("composer.optimizeInput", { style: optimizeStyleOption.label }) : t("composer.optimizeDisabled")}
                    data-tooltip={t("composer.optimizeTooltip")}
                  >
                    {promptInputOptimizePending ? <RotateCw size={15} className="spin" /> : <WandSparkles size={15} />}
                  </button>
                  {promptBeforeInputOptimize ? (
                    <button
                      type="button"
                      className="secondary-btn icon-only-btn composer-prompt-template-undo-submit"
                      onClick={undoInputOptimization}
                      disabled={promptInputOptimizePending}
                      aria-label={t("composer.undoOptimize")}
                      title={t("composer.undoOptimize")}
                      data-tooltip={t("composer.undoOptimizeShort")}
                    >
                      <Undo2 size={15} />
                    </button>
                  ) : null}
                  <span className="composer-prompt-template-style-tooltip" data-tooltip={t("settings.personalization.promptStyles.title")}>
                    <PromptOptimizeStyleSelect
                      value={promptInputOptimizeStyle}
                      onChange={updatePromptOptimizeStyle}
                      groups={promptOptimizeStyleGroups}
                      customInstruction={promptInputCustomInstruction}
                      onCustomInstructionChange={updatePromptOptimizeCustomInstruction}
                      onCustomInstructionSubmit={() => optimizeCurrentPrompt(
                        promptInputOptimizeStyle,
                        undefined,
                        undefined,
                        promptInputCustomInstruction
                      )}
                      customInstructionSubmitDisabled={promptInputOptimizePending || !draftPrompt.trim()}
                      customInstructionSubmitPending={promptInputOptimizePending}
                      disabled={promptInputOptimizePending}
                      className="composer-prompt-template-style-select"
                      menuClassName="composer-prompt-template-style-menu"
                      menuPlacement="top"
                      menuWidth={260}
                    />
                  </span>
                </div>
                <button
                  type="button"
                  className={cx("composer-tool-btn composer-prompt-template-clear-submit", hasClearableInput && "is-visible")}
                  onClick={clearDraftPrompt}
                  disabled={!hasClearableInput || promptOptimizationLoading}
                  aria-hidden={!hasClearableInput}
                  tabIndex={hasClearableInput ? 0 : -1}
                  aria-label={clearInputLabel}
                  title={clearInputLabel}
                  data-tooltip={clearInputLabel}
                >
                  <BrushCleaning size={15} />
                </button>
              </>
            ) : null}
          </span>
          <span className="composer-action-spacer" />
          <button className="send-btn" disabled={busy || promptOptimizationLoading || !draftPrompt.trim()} aria-label={t("composer.send")}>
            <ArrowUp size={22} />
          </button>
        </div>
      </form>
      <MaterialPickerDrawer
        open={materialPickerOpen}
        assets={assets}
        selectedAssets={selectedAssets}
        onToggleAsset={onToggleAsset}
        onSelectedAssetsChange={onSelectedAssetsChange}
        onClose={closeMaterialPickerWithMotion}
      />
      <ImageLightbox
        state={previewState}
        onClose={() => setPreviewState(null)}
        onChangeIndex={(index) => setPreviewState((state) => (state ? { ...state, index } : state))}
      />
    </footer>
  );
}
