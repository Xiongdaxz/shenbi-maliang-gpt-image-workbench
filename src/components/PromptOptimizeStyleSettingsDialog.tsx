import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";
import { ConfirmDialog, useToast } from "../ui";
import {
  cloneDefaultPromptOptimizeStyleGroups,
  createPromptOptimizeStyleValue,
  sanitizePromptOptimizeStyleGroups,
  type PromptOptimizeStyleGroup,
  type PromptOptimizeStyleItem
} from "../lib/promptOptimizeStyles";

type PromptOptimizeStyleSettingsDialogProps = {
  open: boolean;
  groups: PromptOptimizeStyleGroup[];
  saving?: boolean;
  onClose: () => void;
  onSave: (groups: PromptOptimizeStyleGroup[]) => void;
};

function styleDescription(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

export function PromptOptimizeStyleSettingsDialog({
  open,
  groups,
  saving,
  onClose,
  onSave
}: PromptOptimizeStyleSettingsDialogProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const savedGroups = useMemo(() => sanitizePromptOptimizeStyleGroups(groups), [groups]);
  const [draft, setDraft] = useState<PromptOptimizeStyleGroup[]>(() => savedGroups);
  const [activeGroupValue, setActiveGroupValue] = useState(savedGroups[0]?.value ?? "");
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const nextGroups = sanitizePromptOptimizeStyleGroups(groups);
    setDraft(nextGroups);
    setActiveGroupValue((current) => (
      nextGroups.some((group) => group.value === current) ? current : nextGroups[0]?.value ?? ""
    ));
  }, [groups, open]);

  useEffect(() => {
    if (!open) {
      setRestoreConfirmOpen(false);
      setCloseConfirmOpen(false);
    }
  }, [open]);

  if (!open) return null;

  const activeGroupIndex = Math.max(0, draft.findIndex((group) => group.value === activeGroupValue));
  const activeGroup = draft[activeGroupIndex] ?? null;
  const normalizedDraft = sanitizePromptOptimizeStyleGroups(draft);
  const dirty = JSON.stringify(normalizedDraft) !== JSON.stringify(savedGroups);

  function patchGroup(groupIndex: number, patch: Partial<PromptOptimizeStyleGroup>) {
    setDraft((current) => current.map((group, index) => index === groupIndex ? { ...group, ...patch } : group));
  }

  function patchChild(groupIndex: number, childIndex: number, patch: Partial<PromptOptimizeStyleItem>) {
    setDraft((current) => current.map((group, index) => {
      if (index !== groupIndex) return group;
      const children = (group.children ?? []).map((child, itemIndex) => (
        itemIndex === childIndex ? { ...child, ...patch } : child
      ));
      return { ...group, children };
    }));
  }

  function moveGroup(groupIndex: number, direction: -1 | 1) {
    setDraft((current) => {
      const nextIndex = groupIndex + direction;
      if (nextIndex < 0 || nextIndex >= current.length) return current;
      const next = current.slice();
      [next[groupIndex], next[nextIndex]] = [next[nextIndex], next[groupIndex]];
      return next;
    });
  }

  function moveChild(groupIndex: number, childIndex: number, direction: -1 | 1) {
    setDraft((current) => current.map((group, index) => {
      if (index !== groupIndex) return group;
      const children = (group.children ?? []).slice();
      const nextIndex = childIndex + direction;
      if (nextIndex < 0 || nextIndex >= children.length) return group;
      [children[childIndex], children[nextIndex]] = [children[nextIndex], children[childIndex]];
      return { ...group, children };
    }));
  }

  function addGroup() {
    const value = createPromptOptimizeStyleValue();
    setDraft((current) => [
      ...current,
      {
        value,
        label: "新主风格",
        description: "自定义优化方向。",
        prompt: "",
        visible: true,
        children: []
      }
    ]);
    setActiveGroupValue(value);
  }

  function removeGroup(groupIndex: number) {
    const next = draft.filter((_, index) => index !== groupIndex);
    const nextGroup = next[Math.min(Math.max(groupIndex, 0), next.length - 1)];
    setDraft(next);
    setActiveGroupValue(nextGroup?.value ?? "");
  }

  function addChild(groupIndex: number) {
    setDraft((current) => current.map((group, index) => {
      if (index !== groupIndex) return group;
      return {
        ...group,
        children: [
          ...(group.children ?? []),
          {
            value: createPromptOptimizeStyleValue(group.value),
            label: "新子风格",
            description: "细化主风格方向。",
            prompt: "",
            visible: true
          }
        ]
      };
    }));
  }

  function removeChild(groupIndex: number, childIndex: number) {
    setDraft((current) => current.map((group, index) => {
      if (index !== groupIndex) return group;
      return { ...group, children: (group.children ?? []).filter((_, itemIndex) => itemIndex !== childIndex) };
    }));
  }

  function restoreDefaults() {
    const defaults = cloneDefaultPromptOptimizeStyleGroups();
    setDraft(defaults);
    setActiveGroupValue(defaults[0]?.value ?? "");
  }

  function requestClose() {
    if (dirty) {
      setCloseConfirmOpen(true);
      return;
    }
    onClose();
  }

  return createPortal(
    <div
      className="prompt-style-settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section className="prompt-style-settings-dialog" role="dialog" aria-modal="true" aria-label={t("promptStyleSettings.aria")}>
        <header className="prompt-style-settings-head">
          <div>
            <strong>{t("promptStyleSettings.title")}</strong>
            <span>{t("promptStyleSettings.desc")}</span>
          </div>
          <button className="settings-close-btn" type="button" onClick={requestClose} aria-label={t("common.close")}>
            <X size={16} />
          </button>
        </header>
        <div className="prompt-style-settings-body">
          <aside className="prompt-style-main-panel">
            <div className="prompt-style-panel-head">
              <span>{t("promptStyleSettings.mainStyles")}</span>
              <button className="secondary-btn" type="button" onClick={addGroup}>
                <Plus size={14} />
                {t("common.add")}
              </button>
            </div>
            <div className="prompt-style-main-list">
              {draft.map((group, groupIndex) => {
                const active = group.value === activeGroup?.value;
                const visible = group.visible !== false;
                const children = group.children ?? [];
                return (
                  <button
                    key={group.value}
                    type="button"
                    className={cx("prompt-style-main-item", active && "active", !visible && "hidden")}
                    onClick={() => setActiveGroupValue(group.value)}
                  >
                    <span className="prompt-style-main-index">{groupIndex + 1}</span>
                    <span className="prompt-style-main-copy">
                      <strong>{group.label || t("promptStyleSettings.unnamedMain")}</strong>
                      <small>{children.length > 0 ? t("promptStyleSettings.childCount", { count: children.length }) : t("promptStyleSettings.noChildren")}</small>
                    </span>
                    <span className="prompt-style-main-actions">
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={t("promptStyleSettings.moveMainUp")}
                        aria-disabled={groupIndex === 0}
                        className={cx(groupIndex === 0 && "disabled")}
                        onClick={(event) => {
                          event.stopPropagation();
                          moveGroup(groupIndex, -1);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            moveGroup(groupIndex, -1);
                          }
                        }}
                      >
                        <ArrowUp size={13} />
                      </span>
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={t("promptStyleSettings.moveMainDown")}
                        aria-disabled={groupIndex === draft.length - 1}
                        className={cx(groupIndex === draft.length - 1 && "disabled")}
                        onClick={(event) => {
                          event.stopPropagation();
                          moveGroup(groupIndex, 1);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            event.stopPropagation();
                            moveGroup(groupIndex, 1);
                          }
                        }}
                      >
                        <ArrowDown size={13} />
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>
          <main className="prompt-style-detail-panel">
            {activeGroup ? (
              <>
                <section className="prompt-style-detail-section">
                  <div className="prompt-style-section-head">
                    <div>
                      <span>{t("promptStyleSettings.mainConfig")}</span>
                      <small>{activeGroup.visible === false ? t("promptStyleSettings.currentHidden") : t("promptStyleSettings.currentVisible")}</small>
                    </div>
                    <div className="prompt-style-section-actions">
                      <button
                        type="button"
                        onClick={() => patchGroup(activeGroupIndex, { visible: activeGroup.visible === false })}
                        aria-label={activeGroup.visible === false ? t("promptStyleSettings.showMain") : t("promptStyleSettings.hideMain")}
                        title={activeGroup.visible === false ? t("promptStyleSettings.showMain") : t("promptStyleSettings.hideMain")}
                      >
                        {activeGroup.visible === false ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                      <button
                        className="danger"
                        type="button"
                        onClick={() => removeGroup(activeGroupIndex)}
                        aria-label={t("promptStyleSettings.deleteMain")}
                        title={t("promptStyleSettings.deleteMain")}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="prompt-style-field-grid">
                    <label>
                      <span>{t("promptStyleSettings.name")}</span>
                      <input
                        value={activeGroup.label}
                        maxLength={40}
                        onChange={(event) => patchGroup(activeGroupIndex, { label: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>{t("promptStyleSettings.menuDescription")}</span>
                      <input
                        value={activeGroup.description}
                        maxLength={120}
                        onChange={(event) => patchGroup(activeGroupIndex, { description: event.target.value })}
                      />
                    </label>
                    <label className="wide">
                      <span>{t("promptStyleSettings.optimizeInstruction")}</span>
                      <textarea
                        value={activeGroup.prompt ?? ""}
                        rows={3}
                        maxLength={1200}
                        placeholder={t("promptStyleSettings.mainPromptPlaceholder")}
                        onChange={(event) => patchGroup(activeGroupIndex, { prompt: event.target.value })}
                      />
                    </label>
                  </div>
                </section>
                <section className="prompt-style-detail-section substyles">
                  <div className="prompt-style-section-head">
                    <div>
                      <span>{t("promptStyleSettings.substyles")}</span>
                      <small>{t("promptStyleSettings.substylesDesc")}</small>
                    </div>
                    <button className="secondary-btn" type="button" onClick={() => addChild(activeGroupIndex)}>
                      <Plus size={14} />
                      {t("promptStyleSettings.addSubstyle")}
                    </button>
                  </div>
                  <div className="prompt-style-child-list">
                    {(activeGroup.children ?? []).map((child, childIndex) => {
                      const childVisible = child.visible !== false;
                      return (
                        <article className={cx("prompt-style-child-item", !childVisible && "hidden")} key={child.value}>
                          <div className="prompt-style-child-head">
                            <span>{childIndex + 1}</span>
                            <strong>{child.label || t("promptStyleSettings.unnamedChild")}</strong>
                            <div className="prompt-style-child-actions">
                              <button type="button" onClick={() => moveChild(activeGroupIndex, childIndex, -1)} disabled={childIndex === 0} aria-label={t("promptStyleSettings.moveChildUp")}>
                                <ArrowUp size={14} />
                              </button>
                              <button type="button" onClick={() => moveChild(activeGroupIndex, childIndex, 1)} disabled={childIndex === (activeGroup.children ?? []).length - 1} aria-label={t("promptStyleSettings.moveChildDown")}>
                                <ArrowDown size={14} />
                              </button>
                              <button type="button" onClick={() => patchChild(activeGroupIndex, childIndex, { visible: !childVisible })} aria-label={childVisible ? t("promptStyleSettings.hideChild") : t("promptStyleSettings.showChild")}>
                                {childVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                              </button>
                              <button type="button" className="danger" onClick={() => removeChild(activeGroupIndex, childIndex)} aria-label={t("promptStyleSettings.deleteChild")}>
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                          <div className="prompt-style-field-grid compact">
                            <label>
                              <span>{t("promptStyleSettings.name")}</span>
                              <input
                                value={child.label}
                                maxLength={40}
                                onChange={(event) => patchChild(activeGroupIndex, childIndex, { label: event.target.value })}
                              />
                            </label>
                            <label>
                              <span>{t("promptStyleSettings.description")}</span>
                              <input
                                value={child.description}
                                maxLength={120}
                                onChange={(event) => patchChild(activeGroupIndex, childIndex, { description: event.target.value })}
                              />
                            </label>
                            <label className="wide">
                              <span>{t("promptStyleSettings.optimizeInstruction")}</span>
                              <textarea
                                value={child.prompt ?? ""}
                                rows={2}
                                maxLength={1200}
                                placeholder={t("promptStyleSettings.childPromptPlaceholder")}
                                onChange={(event) => patchChild(activeGroupIndex, childIndex, { prompt: event.target.value })}
                              />
                            </label>
                          </div>
                        </article>
                      );
                    })}
                    {(activeGroup.children ?? []).length === 0 ? (
                      <div className="prompt-style-empty">{t("promptStyleSettings.emptyChildren")}</div>
                    ) : null}
                  </div>
                </section>
              </>
            ) : (
              <div className="prompt-style-empty">{t("promptStyleSettings.emptyMain")}</div>
            )}
          </main>
        </div>
        <footer className="prompt-style-settings-footer">
          <div>
            <span>{dirty ? t("promptStyleSettings.dirty") : t("promptStyleSettings.saved")}</span>
            <small>{styleDescription(activeGroup?.description, t("promptStyleSettings.footerHint"))}</small>
          </div>
          <div className="prompt-style-footer-actions">
            <button className="secondary-btn" type="button" onClick={() => setRestoreConfirmOpen(true)}>
              <RotateCcw size={15} />
              {t("promptStyleSettings.restoreDefault")}
            </button>
            <button className="secondary-btn" type="button" onClick={requestClose}>
              {t("common.cancel")}
            </button>
            <button className="primary-btn" type="button" onClick={() => onSave(normalizedDraft)} disabled={!dirty || saving}>
              <Save size={15} />
              {saving ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </footer>
      </section>
      <ConfirmDialog
        open={restoreConfirmOpen}
        title={t("promptStyleSettings.restoreTitle")}
        description={t("promptStyleSettings.restoreDescription")}
        confirmText={t("promptStyleSettings.restoreDefault")}
        backdropClassName="modal-backdrop-top"
        onCancel={() => setRestoreConfirmOpen(false)}
        onConfirm={() => {
          restoreDefaults();
          setRestoreConfirmOpen(false);
          showToast(t("promptStyleSettings.toast.restored"), "info");
        }}
      />
      <ConfirmDialog
        open={closeConfirmOpen}
        title={t("promptStyleSettings.closeTitle")}
        description={t("promptStyleSettings.closeDescription")}
        confirmText={t("promptStyleSettings.saveAndClose")}
        cancelText={t("promptStyleSettings.closeOnly")}
        backdropClassName="modal-backdrop-top"
        onCancel={() => {
          setCloseConfirmOpen(false);
          onClose();
        }}
        onConfirm={() => {
          onSave(normalizedDraft);
          setCloseConfirmOpen(false);
          onClose();
        }}
      />
    </div>,
    document.body
  );
}
