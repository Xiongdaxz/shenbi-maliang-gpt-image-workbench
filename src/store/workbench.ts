import { create } from "zustand";
import type { PromptTemplateOptimizeStyle } from "../lib/promptOptimizeStyles";
import type { AssetItem, CaseMaterialItem, Message, WorkImage } from "../types";
import type { PromptTemplateFormValues, PromptTemplateResult } from "../types";

const COMPOSER_DRAFTS_STORAGE_KEY = "gpt-image.composer-drafts.v1";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "gpt-image.sidebar.collapsed";

export const COMPOSER_NEW_DRAFT_SCOPE_KEY = "new";

export type ImageLibraryContinuation = {
  sessionId?: string;
  anchorId?: string;
  keyword?: string;
  favoriteOnly?: boolean;
  sort: "asc" | "desc";
  nextCursor: string | null;
  hasMore: boolean;
};

export type ImageLibraryContinuations = Partial<Record<"newer" | "older", ImageLibraryContinuation>>;

export type ImageEditorImageSort = "asc" | "desc";

export type ImageEditorOpenRequest = {
  image: WorkImage;
  images?: WorkImage[];
  imageSort?: ImageEditorImageSort;
  totalImageCount?: number;
  libraryContinuations?: ImageLibraryContinuations;
  initialPrompt?: string;
  preserveSelectedAssets?: boolean;
  persistAcrossSessionChange?: boolean;
  discardDraftOnClose?: boolean;
};

export type PendingEditorCancellationReturn = {
  clientRequestId: string;
  request: ImageEditorOpenRequest;
  selectedCaseMaterials: CaseMaterialItem[];
  selectedAssets: AssetItem[];
  imageCount: number;
  size: string;
  quality: string;
  promptInputOptimizeStyle: PromptTemplateOptimizeStyle;
  promptColorSchemeIds: string[];
  promptColorSchemeInjection: string;
  promptTemplate: ComposerPromptTemplateDraft | null;
  activeBranchId: string;
};

export type DraftCaseUsage = {
  caseItemId: string;
  prompt: string;
};

export type ComposerPromptResultKey = "base-zh" | "base-en" | "ai-zh" | "ai-en";

export type ComposerPromptTemplatePanelDraft = {
  selectedId: string;
  collapsed: boolean;
  formValues: PromptTemplateFormValues;
  outputKey: ComposerPromptResultKey;
  optimizeStyle: PromptTemplateOptimizeStyle;
  activeResult: PromptTemplateResult | null;
  optimizedSignature: string;
};

export type ComposerPromptTemplateDraft = {
  open: boolean;
  panel: ComposerPromptTemplatePanelDraft | null;
};

export type ComposerSessionDraft = {
  draftPrompt: string;
  draftCaseUsage: DraftCaseUsage | null;
  selectedCaseMaterials: CaseMaterialItem[];
  selectedAssets: AssetItem[];
  imageCount: number;
  size: string;
  quality: string;
  promptInputOptimizeStyle: PromptTemplateOptimizeStyle;
  promptColorSchemeIds: string[];
  promptColorSchemeId: string;
  promptColorSchemeInjection: string;
  promptTemplate: ComposerPromptTemplateDraft | null;
};

export type SessionGenerationState = {
  state: "running" | "completed";
  updatedAt: number;
};

export type NewChatPromptOptimizeRequest = {
  id: number;
  prompt: string;
};

export type PendingChatSubmit = {
  scope: string;
  mode: "generation" | "edit";
  message: Message;
};

type WorkbenchState = {
  draftPrompt: string;
  draftCaseUsage: DraftCaseUsage | null;
  editImage: WorkImage | null;
  editorImageRequest: ImageEditorOpenRequest | null;
  selectedCaseMaterials: CaseMaterialItem[];
  selectedAssets: AssetItem[];
  materialPickerOpen: boolean;
  mobileMenuOpen: boolean;
  newChatResetKey: number;
  sidebarCollapsed: boolean;
  composerDrafts: Record<string, ComposerSessionDraft>;
  sessionGenerationStates: Record<string, SessionGenerationState>;
  newChatPromptOptimizeRequest: NewChatPromptOptimizeRequest | null;
  pendingChatSubmit: PendingChatSubmit | null;
  pendingEditorCancellationReturn: PendingEditorCancellationReturn | null;
  setDraftPrompt: (value: string, caseUsage?: DraftCaseUsage | null) => void;
  setEditImage: (image: WorkImage | null) => void;
  setEditorImageRequest: (request: ImageEditorOpenRequest | null) => void;
  setSelectedCaseMaterials: (caseMaterials: CaseMaterialItem[]) => void;
  setSelectedCaseMaterial: (caseMaterial: CaseMaterialItem | null) => void;
  setSelectedAssets: (assets: AssetItem[]) => void;
  toggleAsset: (asset: AssetItem) => void;
  upsertComposerDraft: (scopeKey: string, draft: Partial<ComposerSessionDraft>) => void;
  clearComposerDraft: (scopeKey: string) => void;
  resetNewChatComposer: () => void;
  startNewChatPromptOptimize: (prompt: string) => void;
  clearNewChatPromptOptimizeRequest: (id: number) => void;
  setPendingChatSubmit: (pendingChatSubmit: PendingChatSubmit | null) => void;
  setPendingEditorCancellationReturn: (pendingEditorCancellationReturn: PendingEditorCancellationReturn | null) => void;
  setPendingChatSubmitScope: (scope: string) => void;
  clearPendingChatSubmitForScopes: (scopes: string[]) => void;
  setMaterialPickerOpen: (value: boolean) => void;
  setMobileMenuOpen: (value: boolean) => void;
  setSidebarCollapsed: (value: boolean) => void;
  markSessionGenerationRunning: (sessionId: string) => void;
  markSessionGenerationCompleted: (sessionId: string) => void;
  clearSessionGenerationStatus: (sessionId: string) => void;
  clearSessionGenerationStatuses: (sessionIds?: string[]) => void;
};

function uniqueCaseMaterials(caseMaterials: CaseMaterialItem[]) {
  const seen = new Set<string>();
  return caseMaterials.filter((item) => {
    if (seen.has(item.caseItemId)) return false;
    seen.add(item.caseItemId);
    return true;
  });
}

function emptyComposerDraft(): ComposerSessionDraft {
  return {
    draftPrompt: "",
    draftCaseUsage: null,
    selectedCaseMaterials: [],
    selectedAssets: [],
    imageCount: 1,
    size: "",
    quality: "",
    promptInputOptimizeStyle: "standard",
    promptColorSchemeIds: [],
    promptColorSchemeId: "",
    promptColorSchemeInjection: "",
    promptTemplate: null
  };
}

function normalizeComposerDraft(value: unknown): ComposerSessionDraft {
  const draft = {
    ...emptyComposerDraft(),
    ...(value && typeof value === "object" && !Array.isArray(value) ? value as Partial<ComposerSessionDraft> : {})
  };
  const rawIds = Array.isArray(draft.promptColorSchemeIds)
    ? draft.promptColorSchemeIds
    : String(draft.promptColorSchemeId || "")
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item && item !== "none");
  const promptColorSchemeIds = Array.from(new Set(rawIds.map(String))).slice(0, 1);
  return {
    ...draft,
    promptColorSchemeIds,
    promptColorSchemeId: String(promptColorSchemeIds[0] || ""),
    promptColorSchemeInjection: String(draft.promptColorSchemeInjection || "")
  };
}

function hasComposerDraftContent(draft: ComposerSessionDraft) {
  return Boolean(
    draft.draftPrompt.trim()
    || draft.draftCaseUsage
    || draft.selectedCaseMaterials.length > 0
    || draft.selectedAssets.length > 0
    || draft.imageCount !== 1
    || draft.size
    || draft.quality
    || draft.promptInputOptimizeStyle !== "standard"
    || draft.promptColorSchemeIds.length > 0
    || draft.promptColorSchemeInjection.trim()
    || draft.promptTemplate
  );
}

function readComposerDraftsFromStorage(): Record<string, ComposerSessionDraft> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(COMPOSER_DRAFTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const source = parsed as Record<string, unknown>;
    const normalized: Record<string, ComposerSessionDraft> = {};
    const newDrafts: Array<{ key: string; order: number; draft: ComposerSessionDraft }> = [];
    for (const [key, value] of Object.entries(source)) {
      const draft = normalizeComposerDraft(value);
      if (key === COMPOSER_NEW_DRAFT_SCOPE_KEY) {
        newDrafts.push({ key, order: Number.MAX_SAFE_INTEGER, draft });
        continue;
      }
      const newMatch = key.match(/^new:(\d+)$/);
      if (newMatch) {
        newDrafts.push({ key, order: Number(newMatch[1]), draft });
        continue;
      }
      if (key.startsWith("session:")) normalized[key] = draft;
    }
    const selectedNewDraft = newDrafts
      .sort((left, right) => right.order - left.order)
      .find((item) => hasComposerDraftContent(item.draft))?.draft
      ?? newDrafts.sort((left, right) => right.order - left.order)[0]?.draft;
    if (selectedNewDraft && hasComposerDraftContent(selectedNewDraft)) {
      normalized[COMPOSER_NEW_DRAFT_SCOPE_KEY] = selectedNewDraft;
    }
    return normalized;
  } catch {
    return {};
  }
}

function writeComposerDraftsToStorage(composerDrafts: Record<string, ComposerSessionDraft>) {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(composerDrafts).length === 0) {
      window.sessionStorage.removeItem(COMPOSER_DRAFTS_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(COMPOSER_DRAFTS_STORAGE_KEY, JSON.stringify(composerDrafts));
  } catch {
    // Drafts can include image metadata; if the browser quota is full, keep the in-memory copy.
  }
}

function readSidebarCollapsedFromStorage() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSidebarCollapsedToStorage(sidebarCollapsed: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? "1" : "0");
  } catch {
    // Keep the in-memory value when browser storage is unavailable.
  }
}

const initialComposerDrafts = readComposerDraftsFromStorage();
writeComposerDraftsToStorage(initialComposerDrafts);
const initialSidebarCollapsed = readSidebarCollapsedFromStorage();

export const useWorkbench = create<WorkbenchState>((set) => ({
  draftPrompt: "",
  draftCaseUsage: null,
  editImage: null,
  editorImageRequest: null,
  selectedCaseMaterials: [],
  selectedAssets: [],
  materialPickerOpen: false,
  mobileMenuOpen: false,
  newChatResetKey: 0,
  sidebarCollapsed: initialSidebarCollapsed,
  composerDrafts: initialComposerDrafts,
  sessionGenerationStates: {},
  newChatPromptOptimizeRequest: null,
  pendingChatSubmit: null,
  pendingEditorCancellationReturn: null,
  setDraftPrompt: (draftPrompt, caseUsage) =>
    set((state) => ({
      draftPrompt,
      draftCaseUsage: caseUsage === undefined ? (draftPrompt.trim() ? state.draftCaseUsage : null) : caseUsage
    })),
  setEditImage: (editImage) => set({ editImage }),
  setEditorImageRequest: (editorImageRequest) => set({ editorImageRequest }),
  setSelectedCaseMaterials: (selectedCaseMaterials) => set({ selectedCaseMaterials: uniqueCaseMaterials(selectedCaseMaterials) }),
  setSelectedCaseMaterial: (selectedCaseMaterial) => set({ selectedCaseMaterials: selectedCaseMaterial ? [selectedCaseMaterial] : [] }),
  setSelectedAssets: (selectedAssets) => set({ selectedAssets }),
  toggleAsset: (asset) =>
    set((state) => ({
      selectedAssets: state.selectedAssets.some((item) => item.id === asset.id)
        ? state.selectedAssets.filter((item) => item.id !== asset.id)
        : [...state.selectedAssets, asset]
    })),
  upsertComposerDraft: (scopeKey, draft) =>
    set((state) => {
      if (!scopeKey) return state;
      const current = state.composerDrafts[scopeKey] ?? emptyComposerDraft();
      const composerDrafts = {
        ...state.composerDrafts,
        [scopeKey]: {
          ...current,
          ...draft
        }
      };
      writeComposerDraftsToStorage(composerDrafts);
      return {
        composerDrafts
      };
    }),
  clearComposerDraft: (scopeKey) =>
    set((state) => {
      if (!scopeKey || !state.composerDrafts[scopeKey]) return state;
      const next = { ...state.composerDrafts };
      delete next[scopeKey];
      writeComposerDraftsToStorage(next);
      return { composerDrafts: next };
    }),
  resetNewChatComposer: () =>
    set((state) => {
      const newChatResetKey = state.newChatResetKey + 1;
      const composerDrafts = { ...state.composerDrafts };
      delete composerDrafts[COMPOSER_NEW_DRAFT_SCOPE_KEY];
      writeComposerDraftsToStorage(composerDrafts);
      return {
        draftPrompt: "",
        draftCaseUsage: null,
        editImage: null,
        editorImageRequest: null,
        selectedCaseMaterials: [],
        selectedAssets: [],
        materialPickerOpen: false,
        composerDrafts,
        newChatResetKey
      };
    }),
  startNewChatPromptOptimize: (prompt) =>
    set((state) => {
      const nextPrompt = prompt.trim();
      if (!nextPrompt) return state;
      const newChatResetKey = state.newChatResetKey + 1;
      const nextDraft = {
        ...emptyComposerDraft(),
        draftPrompt: nextPrompt
      };
      const composerDrafts = {
        ...state.composerDrafts,
        [COMPOSER_NEW_DRAFT_SCOPE_KEY]: nextDraft
      };
      writeComposerDraftsToStorage(composerDrafts);
      return {
        draftPrompt: nextPrompt,
        draftCaseUsage: null,
        editImage: null,
        editorImageRequest: null,
        selectedCaseMaterials: [],
        selectedAssets: [],
        materialPickerOpen: false,
        composerDrafts,
        newChatResetKey,
        newChatPromptOptimizeRequest: {
          id: newChatResetKey,
          prompt: nextPrompt
        }
      };
    }),
  clearNewChatPromptOptimizeRequest: (id) =>
    set((state) => (
      state.newChatPromptOptimizeRequest?.id === id
        ? { newChatPromptOptimizeRequest: null }
        : state
    )),
  setPendingChatSubmit: (pendingChatSubmit) => set({ pendingChatSubmit }),
  setPendingEditorCancellationReturn: (pendingEditorCancellationReturn) => set({ pendingEditorCancellationReturn }),
  setPendingChatSubmitScope: (scope) =>
    set((state) => (
      state.pendingChatSubmit && state.pendingChatSubmit.scope !== scope
        ? { pendingChatSubmit: { ...state.pendingChatSubmit, scope } }
        : state
    )),
  clearPendingChatSubmitForScopes: (scopes) =>
    set((state) => {
      if (!state.pendingChatSubmit) return state;
      const scopeSet = new Set(scopes.filter(Boolean));
      return scopeSet.has(state.pendingChatSubmit.scope) ? { pendingChatSubmit: null } : state;
    }),
  setMaterialPickerOpen: (materialPickerOpen) => set({ materialPickerOpen }),
  setMobileMenuOpen: (mobileMenuOpen) => set({ mobileMenuOpen }),
  setSidebarCollapsed: (sidebarCollapsed) => {
    writeSidebarCollapsedToStorage(sidebarCollapsed);
    set({ sidebarCollapsed });
  },
  markSessionGenerationRunning: (sessionId) =>
    set((state) => {
      if (!sessionId) return state;
      const current = state.sessionGenerationStates[sessionId];
      if (current?.state === "running") return state;
      return {
        sessionGenerationStates: {
          ...state.sessionGenerationStates,
          [sessionId]: { state: "running", updatedAt: Date.now() }
        }
      };
    }),
  markSessionGenerationCompleted: (sessionId) =>
    set((state) => {
      if (!sessionId) return state;
      const current = state.sessionGenerationStates[sessionId];
      if (current?.state === "completed") return state;
      return {
        sessionGenerationStates: {
          ...state.sessionGenerationStates,
          [sessionId]: { state: "completed", updatedAt: Date.now() }
        }
      };
    }),
  clearSessionGenerationStatus: (sessionId) =>
    set((state) => {
      if (!sessionId || !state.sessionGenerationStates[sessionId]) return state;
      const next = { ...state.sessionGenerationStates };
      delete next[sessionId];
      return { sessionGenerationStates: next };
    }),
  clearSessionGenerationStatuses: (sessionIds) =>
    set((state) => {
      if (!sessionIds) return { sessionGenerationStates: {} };
      const next = { ...state.sessionGenerationStates };
      let changed = false;
      for (const sessionId of sessionIds) {
        if (!next[sessionId]) continue;
        delete next[sessionId];
        changed = true;
      }
      return changed ? { sessionGenerationStates: next } : state;
    })
}));
