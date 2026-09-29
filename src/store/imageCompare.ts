import { create } from "zustand";
import { createCompareDraft, parseCompareDraft, type CompareDraft } from "../lib/imageCompare";

const STORAGE_KEY = "gpt-image.image-comparison.v1";
type CompareState = {
  ownerId: string | null;
  draft: CompareDraft | null;
  open: boolean;
  bindOwner: (id: string | null) => void;
  start: (ids: string[]) => void;
  resume: () => void;
  save: (draft: CompareDraft) => void;
  close: () => void;
};

function storeDraft(ownerId: string | null, draft: CompareDraft | null) {
  try {
    if (ownerId && draft) sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ownerId, draft }));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch { /* Storage is optional; the current tab can continue in memory. */ }
}

export const useImageCompare = create<CompareState>((set, get) => ({
  ownerId: null, draft: null, open: false,
  bindOwner: (ownerId) => {
    if (ownerId && ownerId === get().ownerId) return;
    let draft: CompareDraft | null = null;
    if (ownerId && !get().ownerId) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
        if (saved?.ownerId === ownerId) draft = parseCompareDraft(saved.draft);
      } catch { /* Invalid or unavailable storage starts a fresh comparison. */ }
    }
    storeDraft(ownerId, draft);
    set({ ownerId, draft, open: false });
  },
  start: (ids) => {
    const draft = createCompareDraft(ids), ownerId = get().ownerId;
    if (!ownerId || !draft) return;
    storeDraft(ownerId, draft);
    set({ draft, open: true });
  },
  resume: () => { if (get().ownerId && get().draft) set({ open: true }); },
  save: (value) => {
    const draft = parseCompareDraft(value), ownerId = get().ownerId;
    if (!ownerId || !draft) return;
    storeDraft(ownerId, draft);
    set({ draft });
  },
  close: () => set({ open: false })
}));
