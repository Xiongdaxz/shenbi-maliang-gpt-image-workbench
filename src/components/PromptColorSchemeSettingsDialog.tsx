import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, Pencil, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import { api, type PromptColorScheme, type PromptColorSchemePayload } from "../api";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";
import {
  defaultPromptColorSchemes,
  normalizePromptColorSchemeHex,
  type PromptColorSchemeColor,
  type PromptColorSchemeGradient
} from "../lib/promptColorSchemes";
import { ConfirmDialog, useToast } from "../ui";

type PromptColorSchemeSettingsDialogProps = {
  open: boolean;
  onClose: () => void;
};

function nextLocalId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function cloneScheme(scheme: PromptColorScheme): PromptColorScheme {
  return {
    ...scheme,
    colors: scheme.colors.map((color) => ({ ...color })),
    gradients: scheme.gradients.map((gradient) => ({ ...gradient, colors: [...gradient.colors] }))
  };
}

function schemePayload(scheme: PromptColorScheme): PromptColorSchemePayload {
  return {
    name: scheme.name,
    description: scheme.description,
    category: scheme.category,
    colors: scheme.colors,
    gradients: scheme.gradients,
    prompt: scheme.prompt,
    visible: scheme.visible,
    sortOrder: scheme.sortOrder
  };
}

function sameSchemePayload(a: PromptColorScheme, b: PromptColorScheme) {
  return JSON.stringify(schemePayload(a)) === JSON.stringify(schemePayload(b));
}

function newSchemePayload(sortOrder: number, category = "自定义"): PromptColorSchemePayload {
  return {
    name: "新色系",
    description: "适合自定义场景的色彩方案。",
    category,
    colors: [
      { id: nextLocalId("color"), name: "主色", role: "主色", hex: "#2563EB" },
      { id: nextLocalId("color"), name: "背景色", role: "背景色", hex: "#F8FAFC" }
    ],
    gradients: [
      { id: nextLocalId("gradient"), name: "主渐变", role: "背景色", colors: ["#EFF6FF", "#BFDBFE"] }
    ],
    prompt: "保持整体配色统一，不要与用户已明确指定的颜色冲突。",
    visible: true,
    sortOrder
  };
}

function newEmptySchemePayload(sortOrder: number, category = "自定义"): PromptColorSchemePayload {
  return {
    name: "新色系",
    description: "",
    category,
    colors: [],
    gradients: [],
    prompt: "",
    visible: true,
    sortOrder
  };
}

function defaultSchemeDraft(
  scheme: typeof defaultPromptColorSchemes[number],
  source: PromptColorScheme
): PromptColorScheme {
  return {
    ...source,
    builtinKey: scheme.builtinKey,
    name: scheme.name,
    description: scheme.description ?? "",
    category: scheme.category ?? "自定义",
    colors: (scheme.colors ?? []).map((color) => ({ ...color })),
    gradients: (scheme.gradients ?? []).map((gradient) => ({ ...gradient, colors: [...gradient.colors] })),
    prompt: scheme.prompt ?? "",
    visible: scheme.visible ?? true,
    sortOrder: scheme.sortOrder ?? source.sortOrder,
    deletedAt: ""
  };
}

function gradientPreviewStyle(colors: string[]) {
  const normalized = colors.map(normalizePromptColorSchemeHex).filter(Boolean);
  const previewColors = normalized.length >= 2 ? normalized : ["#F8FAFC", "#CBD5E1"];
  const stops = previewColors.map((color, index) => {
    const position = previewColors.length === 1 ? 100 : Math.round((index / (previewColors.length - 1)) * 100);
    return `${color} ${position}%`;
  });
  return { background: `linear-gradient(90deg, ${stops.join(", ")})` };
}

export function PromptColorSchemeSettingsDialog({ open, onClose }: PromptColorSchemeSettingsDialogProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { t } = useI18n();
  const schemesQuery = useQuery({
    queryKey: ["prompt-color-schemes", "settings"],
    queryFn: () => api.promptColorSchemes({ includeDeleted: true }),
    enabled: open
  });
  const schemes = schemesQuery.data?.schemes ?? [];
  const schemeById = useMemo(() => new Map(schemes.map((scheme) => [scheme.id, scheme])), [schemes]);
  const [draftsById, setDraftsById] = useState<Record<string, PromptColorScheme>>({});
  const [deletedSchemeIds, setDeletedSchemeIds] = useState<Set<string>>(() => new Set());
  const visibleDraftSchemes = useMemo(
    () => schemes
      .map((scheme) => draftsById[scheme.id] ?? scheme)
      .filter((scheme) => !scheme.deletedAt && !deletedSchemeIds.has(scheme.id)),
    [deletedSchemeIds, draftsById, schemes]
  );
  const categories = useMemo(() => {
    const names = visibleDraftSchemes.map((scheme) => scheme.category || "自定义");
    return Array.from(new Set(names));
  }, [visibleDraftSchemes]);
  const [activeCategory, setActiveCategory] = useState("");
  const [editingCategory, setEditingCategory] = useState("");
  const [categoryNameDraft, setCategoryNameDraft] = useState("");
  const activeCategoryName = activeCategory || categories[0] || "自定义";
  const categorySchemes = useMemo(
    () => visibleDraftSchemes.filter((scheme) => (scheme.category || "自定义") === activeCategoryName),
    [activeCategoryName, visibleDraftSchemes]
  );
  const [selectedId, setSelectedId] = useState("");
  const [savingDrafts, setSavingDrafts] = useState(false);
  const selected = categorySchemes.find((scheme) => scheme.id === selectedId) ?? categorySchemes[0] ?? visibleDraftSchemes[0] ?? null;
  const [draft, setDraft] = useState<PromptColorScheme | null>(null);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const dirtyDrafts = useMemo(
    () => Object.values(draftsById).filter((item) => {
      const source = schemeById.get(item.id);
      return source && !deletedSchemeIds.has(item.id) ? !sameSchemePayload(item, source) : false;
    }),
    [deletedSchemeIds, draftsById, schemeById]
  );
  const dirty = dirtyDrafts.length > 0 || deletedSchemeIds.size > 0;

  useEffect(() => {
    if (!open) return;
    if (categories.length === 0) {
      if (activeCategory) setActiveCategory("");
      return;
    }
    if (!activeCategory || !categories.includes(activeCategory)) {
      setActiveCategory(categories[0]);
    }
  }, [activeCategory, categories, open]);

  useEffect(() => {
    if (!open) return;
    if (!selected || selected.id === selectedId) return;
    setSelectedId(selected.id);
  }, [open, selected?.id, selectedId]);

  useEffect(() => {
    if (!open) return;
    setDraft(selected ? cloneScheme(draftsById[selected.id] ?? selected) : null);
  }, [draftsById, open, selected?.id, selected?.updatedAt]);

  useEffect(() => {
    if (!open) {
      setRestoreConfirmOpen(false);
      setCloseConfirmOpen(false);
      setDraftsById({});
      setDeletedSchemeIds(new Set());
    }
  }, [open]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["prompt-color-schemes"] });
  const createScheme = useMutation({
    mutationFn: api.createPromptColorScheme,
    onSuccess: (data) => {
      if (data.scheme) {
        setActiveCategory(data.scheme.category || "自定义");
        setSelectedId(data.scheme.id);
      }
      invalidate();
      showToast(t("promptColorSettings.toast.created"));
    },
    onError: (error) => showToast(error instanceof Error ? error.message : t("promptColorSettings.toast.createFailed"), "error")
  });
  const updateScheme = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: PromptColorSchemePayload }) => api.updatePromptColorScheme(id, payload),
    onSuccess: (data) => {
      if (data.scheme) {
        setActiveCategory(data.scheme.category || "自定义");
        setSelectedId(data.scheme.id);
      }
      invalidate();
      showToast(t("promptColorSettings.toast.saved"));
    },
    onError: (error) => showToast(error instanceof Error ? error.message : t("promptColorSettings.toast.saveFailed"), "error")
  });
  const deleteScheme = useMutation({
    mutationFn: api.deletePromptColorScheme,
    onMutate: (id) => {
      setDraftsById((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    },
    onSuccess: () => {
      setSelectedId("");
      invalidate();
      showToast(t("promptColorSettings.toast.deleted"));
    },
    onError: (error) => showToast(error instanceof Error ? error.message : t("promptColorSettings.toast.deleteFailed"), "error")
  });
  if (!open) return null;

  function nextCategoryName() {
    const names = new Set(categories);
    if (!names.has("新分类")) return "新分类";
    let index = 2;
    while (names.has(`新分类${index}`)) index += 1;
    return `新分类${index}`;
  }

  function createCategory() {
    const category = nextCategoryName();
    createScheme.mutate(newEmptySchemePayload((schemes.at(-1)?.sortOrder ?? 0) + 10, category));
  }

  function setDraftValue(updater: (current: PromptColorScheme) => PromptColorScheme) {
    setDraft((current) => {
      const base = current ?? selected;
      if (!base) return current;
      const next = updater(cloneScheme(base));
      setDraftsById((items) => ({ ...items, [next.id]: cloneScheme(next) }));
      return next;
    });
  }

  function patchDraft(patch: Partial<PromptColorScheme>) {
    setDraftValue((current) => ({ ...current, ...patch }));
  }

  function startEditingCategory(category: string) {
    setEditingCategory(category);
    setCategoryNameDraft(category);
  }

  function cancelEditingCategory() {
    setEditingCategory("");
    setCategoryNameDraft("");
  }

  function commitCategoryName() {
    const source = editingCategory;
    const nextName = categoryNameDraft.trim();
    if (!source) return;
    if (!nextName) {
      showToast(t("promptColorSettings.toast.categoryRequired"), "error");
      return;
    }
    if (nextName !== source && categories.includes(nextName)) {
      showToast(t("promptColorSettings.toast.categoryDuplicate"), "error");
      return;
    }
    if (nextName === source) {
      cancelEditingCategory();
      return;
    }
    const changedSchemes = visibleDraftSchemes
      .filter((scheme) => (scheme.category || "自定义") === source)
      .map((scheme) => ({ ...cloneScheme(scheme), category: nextName }));
    setDraftsById((items) => {
      const nextItems = { ...items };
      for (const scheme of changedSchemes) {
        nextItems[scheme.id] = cloneScheme(scheme);
      }
      return nextItems;
    });
    setDraft((current) => current && (current.category || "自定义") === source ? { ...current, category: nextName } : current);
    setActiveCategory(nextName);
    cancelEditingCategory();
  }

  function deleteCategory(category: string) {
    const deletedIds = visibleDraftSchemes
      .filter((scheme) => (scheme.category || "自定义") === category)
      .map((scheme) => scheme.id);
    if (deletedIds.length === 0) return;
    setDeletedSchemeIds((current) => {
      const next = new Set(current);
      for (const id of deletedIds) next.add(id);
      return next;
    });
    setDraftsById((items) => {
      const nextItems = { ...items };
      for (const id of deletedIds) delete nextItems[id];
      return nextItems;
    });
    const nextCategory = categories.find((item) => item !== category) ?? "";
    setActiveCategory(nextCategory);
    setSelectedId("");
    setDraft(null);
    cancelEditingCategory();
  }

  function patchColor(index: number, patch: Partial<PromptColorSchemeColor>) {
    setDraftValue((current) => ({
      ...current,
      colors: current.colors.map((color, colorIndex) => colorIndex === index ? { ...color, ...patch } : color)
    }));
  }

  function patchGradient(index: number, patch: Partial<PromptColorSchemeGradient>) {
    setDraftValue((current) => ({
      ...current,
      gradients: current.gradients.map((gradient, gradientIndex) => gradientIndex === index ? { ...gradient, ...patch } : gradient)
    }));
  }

  function patchGradientColor(gradientIndex: number, colorIndex: number, value: string) {
    setDraftValue((current) => ({
      ...current,
      gradients: current.gradients.map((gradient, index) => {
        if (index !== gradientIndex) return gradient;
        return {
          ...gradient,
          colors: gradient.colors.map((color, itemIndex) => itemIndex === colorIndex ? value : color)
        };
      })
    }));
  }

  async function saveDraft(closeAfterSave = false) {
    const idsToDelete = Array.from(deletedSchemeIds);
    if (dirtyDrafts.length === 0 && idsToDelete.length === 0) {
      if (closeAfterSave) onClose();
      return;
    }
    setSavingDrafts(true);
    try {
      await Promise.all([
        ...idsToDelete.map((id) => api.deletePromptColorScheme(id)),
        ...dirtyDrafts.map((item) => api.updatePromptColorScheme(item.id, schemePayload(item)))
      ]);
      setDraftsById({});
      setDeletedSchemeIds(new Set());
      await invalidate();
      const changedCount = dirtyDrafts.length + idsToDelete.length;
      showToast(changedCount > 1 ? t("promptColorSettings.toast.savedChanges", { count: changedCount }) : t("promptColorSettings.toast.saved"));
      if (closeAfterSave) onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : t("promptColorSettings.toast.saveFailed"), "error");
    } finally {
      setSavingDrafts(false);
    }
  }

  function moveSelected(direction: -1 | 1) {
    if (!selected) return;
    const index = categorySchemes.findIndex((scheme) => scheme.id === selected.id);
    const target = categorySchemes[index + direction];
    if (!target) return;
    const selectedOrder = selected.sortOrder;
    const targetOrder = target.sortOrder;
    updateScheme.mutate({ id: selected.id, payload: { ...schemePayload(selected), sortOrder: targetOrder } });
    updateScheme.mutate({ id: target.id, payload: { ...schemePayload(target), sortOrder: selectedOrder } });
  }

  function restoreDefaultsDraft() {
    const schemesByBuiltinKey = new Map<string, PromptColorScheme>();
    for (const scheme of schemes) {
      if (scheme.builtinKey) schemesByBuiltinKey.set(scheme.builtinKey, draftsById[scheme.id] ?? scheme);
    }
    const nextDrafts: Record<string, PromptColorScheme> = {};
    const restoredIds: string[] = [];
    for (const defaultScheme of defaultPromptColorSchemes) {
      const source = schemesByBuiltinKey.get(defaultScheme.builtinKey);
      if (!source) continue;
      const restored = defaultSchemeDraft(defaultScheme, source);
      nextDrafts[restored.id] = restored;
      restoredIds.push(restored.id);
    }
    if (restoredIds.length === 0) return;
    setDraftsById((items) => ({ ...items, ...nextDrafts }));
    setDeletedSchemeIds((current) => {
      const next = new Set(current);
      for (const id of restoredIds) next.delete(id);
      return next;
    });
    const firstRestored = nextDrafts[restoredIds[0]];
    setActiveCategory(firstRestored?.category ?? "");
    setSelectedId(firstRestored?.id ?? "");
    setDraft(firstRestored ? cloneScheme(firstRestored) : null);
  }

  function requestClose() {
    if (dirty) {
      setCloseConfirmOpen(true);
      return;
    }
    onClose();
  }

  const busy = createScheme.isPending || updateScheme.isPending || deleteScheme.isPending || savingDrafts;

  return createPortal(
    <div
      className="prompt-style-settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section className="prompt-style-settings-dialog prompt-color-settings-dialog" role="dialog" aria-modal="true" aria-label={t("promptColorSettings.aria")}>
        <header className="prompt-style-settings-head">
          <div>
            <strong>{t("promptColorSettings.title")}</strong>
            <span>{t("promptColorSettings.desc")}</span>
          </div>
          <button className="settings-close-btn" type="button" onClick={requestClose} aria-label={t("common.close")}>
            <X size={16} />
          </button>
        </header>
        <div className="prompt-style-settings-body">
          <aside className="prompt-style-main-panel">
            <div className="prompt-style-panel-head">
              <span>{t("promptColorSettings.categories")}</span>
              <button className="secondary-btn" type="button" disabled={busy} onClick={createCategory}>
                <Plus size={14} />
                {t("promptColorSettings.addCategory")}
              </button>
            </div>
            <div className="prompt-style-main-list">
              {categories.map((category, index) => {
                const count = visibleDraftSchemes.filter((scheme) => (scheme.category || "自定义") === category).length;
                const editing = editingCategory === category;
                return (
                  <div
                    key={category}
                    className={cx("prompt-style-main-item prompt-color-category-item", category === activeCategoryName && "active", editing && "editing")}
                  >
                    {editing ? (
                      <div className="prompt-color-category-select editing">
                        <span className="prompt-style-main-index">{index + 1}</span>
                        <span className="prompt-style-main-copy">
                          <input
                            autoFocus
                            value={categoryNameDraft}
                            onChange={(event) => setCategoryNameDraft(event.target.value)}
                            onBlur={commitCategoryName}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                commitCategoryName();
                              }
                              if (event.key === "Escape") {
                                event.preventDefault();
                                cancelEditingCategory();
                              }
                            }}
                          />
                          <small>{t("promptColorSettings.schemeCount", { count })}</small>
                        </span>
                      </div>
                    ) : (
                      <button
                        className="prompt-color-category-select"
                        type="button"
                        onClick={() => setActiveCategory(category)}
                      >
                        <span className="prompt-style-main-index">{index + 1}</span>
                        <span className="prompt-style-main-copy">
                          <strong>{category}</strong>
                          <small>{t("promptColorSettings.schemeCount", { count })}</small>
                        </span>
                      </button>
                    )}
                    <span className="prompt-color-category-actions">
                      <button
                        className="prompt-color-category-edit"
                        type="button"
                        aria-label={t("promptColorSettings.editCategory")}
                        title={t("promptColorSettings.editCategory")}
                        onClick={() => startEditingCategory(category)}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        className="prompt-color-category-delete"
                        type="button"
                        aria-label={t("promptColorSettings.deleteCategory")}
                        title={t("promptColorSettings.deleteCategory")}
                        onClick={() => deleteCategory(category)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
          </aside>
          <main className="prompt-style-detail-panel">
            <section className="prompt-style-detail-section">
              <div className="prompt-style-section-head">
                <div>
                  <span>{activeCategoryName}</span>
                  <small>{t("promptColorSettings.schemeCount", { count: categorySchemes.length })}</small>
                </div>
                <button
                  className="secondary-btn"
                  type="button"
                  disabled={busy}
                  onClick={() => createScheme.mutate(newSchemePayload((schemes.at(-1)?.sortOrder ?? 0) + 10, activeCategoryName))}
                >
                  <Plus size={14} />
                  {t("common.add")}
                </button>
              </div>
              <div className="prompt-color-settings-card-list">
                {categorySchemes.map((scheme) => (
                  <button
                    key={scheme.id}
                    type="button"
                    className={cx("prompt-color-settings-card", scheme.id === draft?.id && "active", !scheme.visible && "hidden")}
                    onClick={() => setSelectedId(scheme.id)}
                  >
                    <span className="prompt-color-settings-card-copy">
                      <strong>{scheme.name}</strong>
                      <small>{scheme.description}</small>
                    </span>
                    {scheme.id === draft?.id ? (
                      <span className="prompt-color-settings-card-check" aria-hidden="true">
                        <Check size={14} />
                      </span>
                    ) : null}
                  </button>
                ))}
                {categorySchemes.length === 0 ? <div className="settings-empty">{t("promptColorSettings.emptyCategory")}</div> : null}
              </div>
            </section>
            {draft ? (
              <>
                <section className="prompt-style-detail-section">
                  <div className="prompt-style-section-head">
                    <div>
                      <span>{t("promptColorSettings.schemeConfig")}</span>
                      <small>{draft.visible ? t("promptStyleSettings.currentVisible") : t("promptStyleSettings.currentHidden")}</small>
                    </div>
                    <div className="prompt-style-section-actions">
                      <button type="button" onClick={() => moveSelected(-1)} disabled={busy} aria-label={t("promptColorSettings.moveSchemeUp")} title={t("promptColorSettings.moveSchemeUp")}>
                        <ArrowUp size={15} />
                      </button>
                      <button type="button" onClick={() => moveSelected(1)} disabled={busy} aria-label={t("promptColorSettings.moveSchemeDown")} title={t("promptColorSettings.moveSchemeDown")}>
                        <ArrowDown size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={() => patchDraft({ visible: !draft.visible })}
                        aria-label={draft.visible ? t("promptColorSettings.hideScheme") : t("promptColorSettings.showScheme")}
                        title={draft.visible ? t("promptColorSettings.hideScheme") : t("promptColorSettings.showScheme")}
                      >
                        {draft.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                      </button>
                      <button className="danger" type="button" disabled={busy} onClick={() => deleteScheme.mutate(draft.id)} aria-label={t("promptColorSettings.deleteScheme")} title={t("promptColorSettings.deleteScheme")}>
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="prompt-color-settings-basic-grid">
                    <label>
                      <span>{t("promptColorSettings.name")}</span>
                      <input value={draft.name} onChange={(event) => patchDraft({ name: event.target.value })} />
                    </label>
                    <label>
                      <span>{t("promptColorSettings.scene")}</span>
                      <input value={draft.description} onChange={(event) => patchDraft({ description: event.target.value })} />
                    </label>
                    <label className="wide">
                      <span>{t("promptColorSettings.prompt")}</span>
                      <input value={draft.prompt} onChange={(event) => patchDraft({ prompt: event.target.value })} />
                    </label>
                  </div>
                </section>

                <section className="prompt-style-detail-section">
                  <div className="prompt-style-section-head">
                    <div>
                      <span>{t("promptTemplates.editor.solidColorSwatches")}</span>
                      <small>{draft.colors.length}/12</small>
                    </div>
                    <button
                      className="secondary-btn"
                      type="button"
                      disabled={draft.colors.length >= 12}
                      onClick={() => patchDraft({ colors: [...draft.colors, { id: nextLocalId("color"), name: "新颜色", role: "辅助色", hex: "#2563EB" }] })}
                    >
                      <Plus size={14} />
                      {t("common.add")}
                    </button>
                  </div>
                  <div className="prompt-color-settings-option-list">
                    {draft.colors.map((color, index) => (
                      <div className="prompt-color-settings-option" key={color.id}>
                        <input type="color" value={normalizePromptColorSchemeHex(color.hex) || "#2563EB"} onChange={(event) => patchColor(index, { hex: event.target.value })} aria-label={t("promptTemplates.editor.pickColor")} />
                        <input value={color.name} onChange={(event) => patchColor(index, { name: event.target.value })} placeholder={t("promptColorSettings.colorNamePlaceholder")} />
                        <input value={color.role} onChange={(event) => patchColor(index, { role: event.target.value })} placeholder={t("promptColorSettings.rolePlaceholder")} />
                        <input value={color.hex} onChange={(event) => patchColor(index, { hex: event.target.value })} placeholder="#2563EB" />
                        <button type="button" aria-label={t("promptColorSettings.deleteColor")} onClick={() => patchDraft({ colors: draft.colors.filter((_, itemIndex) => itemIndex !== index) })}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="prompt-style-detail-section">
                  <div className="prompt-style-section-head">
                    <div>
                      <span>{t("promptTemplates.editor.gradientCombinations")}</span>
                      <small>{draft.gradients.length}/12</small>
                    </div>
                    <button
                      className="secondary-btn"
                      type="button"
                      disabled={draft.gradients.length >= 12}
                      onClick={() => patchDraft({ gradients: [...draft.gradients, { id: nextLocalId("gradient"), name: "新渐变", role: "背景色", colors: ["#2563EB", "#8B5CF6"] }] })}
                    >
                      <Plus size={14} />
                      {t("common.add")}
                    </button>
                  </div>
                  <div className="prompt-color-settings-gradient-list">
                    {draft.gradients.map((gradient, gradientIndex) => (
                      <div className="prompt-color-settings-gradient" key={gradient.id}>
                        <div className="prompt-color-settings-gradient-preview" style={gradientPreviewStyle(gradient.colors)} />
                        <div className="prompt-color-settings-gradient-fields">
                          <input value={gradient.name} onChange={(event) => patchGradient(gradientIndex, { name: event.target.value })} placeholder={t("promptColorSettings.gradientNamePlaceholder")} />
                          <input value={gradient.role} onChange={(event) => patchGradient(gradientIndex, { role: event.target.value })} placeholder={t("promptColorSettings.rolePlaceholder")} />
                        </div>
                        <div className="prompt-color-settings-gradient-colors">
                          {gradient.colors.map((color, colorIndex) => (
                            <span key={`${gradient.id}-${colorIndex}`}>
                              <input type="color" value={normalizePromptColorSchemeHex(color) || "#2563EB"} onChange={(event) => patchGradientColor(gradientIndex, colorIndex, event.target.value)} aria-label={t("promptTemplates.editor.pickGradientColor")} />
                              <input value={color} onChange={(event) => patchGradientColor(gradientIndex, colorIndex, event.target.value)} />
                              {gradient.colors.length > 2 ? (
                                <button
                                  type="button"
                                  aria-label={t("promptColorSettings.deleteGradientColor")}
                                  onClick={() => patchGradient(gradientIndex, { colors: gradient.colors.filter((_, itemIndex) => itemIndex !== colorIndex) })}
                                >
                                  <Trash2 size={13} />
                                </button>
                              ) : null}
                            </span>
                          ))}
                          {gradient.colors.length < 5 ? (
                            <button type="button" onClick={() => patchGradient(gradientIndex, { colors: [...gradient.colors, "#FFFFFF"] })}>
                              <Plus size={13} />
                            </button>
                          ) : null}
                        </div>
                        <button type="button" className="prompt-color-settings-delete-gradient" aria-label={t("promptTemplates.editor.deleteGradient")} onClick={() => patchDraft({ gradients: draft.gradients.filter((_, itemIndex) => itemIndex !== gradientIndex) })}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            ) : (
              <div className="settings-empty">{t("promptColorSettings.emptySchemes")}</div>
            )}
          </main>
        </div>
        <footer className="prompt-style-settings-footer">
          <div>
            <span>{dirty ? t("promptStyleSettings.dirty") : t("promptColorSettings.saveHint")}</span>
          </div>
          <div className="prompt-style-footer-actions">
            <button className="secondary-btn" type="button" disabled={busy} onClick={() => setRestoreConfirmOpen(true)}>
              <RotateCcw size={14} />
              {t("promptStyleSettings.restoreDefault")}
            </button>
            <button className="secondary-btn" type="button" onClick={requestClose}>
              {t("common.cancel")}
            </button>
            <button className="primary-btn" type="button" disabled={!dirty || busy} onClick={() => saveDraft()}>
              <Save size={14} />
              {t("common.save")}
            </button>
          </div>
        </footer>
      </section>
      <ConfirmDialog
        open={restoreConfirmOpen}
        title={t("promptColorSettings.restoreTitle")}
        description={t("promptColorSettings.restoreDescription")}
        confirmText={t("promptStyleSettings.restoreDefault")}
        backdropClassName="modal-backdrop-top"
        onCancel={() => setRestoreConfirmOpen(false)}
        onConfirm={() => {
          restoreDefaultsDraft();
          setRestoreConfirmOpen(false);
          showToast(t("promptColorSettings.toast.restored"), "info");
        }}
      />
      <ConfirmDialog
        open={closeConfirmOpen}
        title={t("promptColorSettings.closeTitle")}
        description={t("promptColorSettings.closeDescription")}
        confirmText={t("promptStyleSettings.saveAndClose")}
        cancelText={t("promptStyleSettings.closeOnly")}
        backdropClassName="modal-backdrop-top"
        onCancel={() => {
          setCloseConfirmOpen(false);
          onClose();
        }}
        onConfirm={() => {
          setCloseConfirmOpen(false);
          saveDraft(true);
        }}
      />
    </div>,
    document.body
  );
}
