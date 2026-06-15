import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import { cx } from "../lib/cx";
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
  const savedGroups = useMemo(() => sanitizePromptOptimizeStyleGroups(groups), [groups]);
  const [draft, setDraft] = useState<PromptOptimizeStyleGroup[]>(() => savedGroups);
  const [activeGroupValue, setActiveGroupValue] = useState(savedGroups[0]?.value ?? "");

  useEffect(() => {
    if (!open) return;
    const nextGroups = sanitizePromptOptimizeStyleGroups(groups);
    setDraft(nextGroups);
    setActiveGroupValue((current) => (
      nextGroups.some((group) => group.value === current) ? current : nextGroups[0]?.value ?? ""
    ));
  }, [groups, open]);

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

  return createPortal(
    <div
      className="prompt-style-settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="prompt-style-settings-dialog" role="dialog" aria-modal="true" aria-label="AI 优化风格设置">
        <header className="prompt-style-settings-head">
          <div>
            <strong>AI 优化风格</strong>
            <span>左侧管理主风格，右侧配置选中主风格和子风格。</span>
          </div>
          <button className="settings-close-btn" type="button" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </header>
        <div className="prompt-style-settings-body">
          <aside className="prompt-style-main-panel">
            <div className="prompt-style-panel-head">
              <span>主风格</span>
              <button className="secondary-btn" type="button" onClick={addGroup}>
                <Plus size={14} />
                新增
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
                      <strong>{group.label || "未命名主风格"}</strong>
                      <small>{children.length > 0 ? `${children.length} 个子风格` : "无子风格"}</small>
                    </span>
                    <span className="prompt-style-main-actions">
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label="上移主风格"
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
                        aria-label="下移主风格"
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
                      <span>主风格配置</span>
                      <small>{activeGroup.visible === false ? "当前隐藏" : "当前显示"}</small>
                    </div>
                    <div className="prompt-style-section-actions">
                      <button
                        type="button"
                        onClick={() => patchGroup(activeGroupIndex, { visible: activeGroup.visible === false })}
                        aria-label={activeGroup.visible === false ? "显示主风格" : "隐藏主风格"}
                        title={activeGroup.visible === false ? "显示主风格" : "隐藏主风格"}
                      >
                        {activeGroup.visible === false ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                      <button
                        className="danger"
                        type="button"
                        onClick={() => removeGroup(activeGroupIndex)}
                        aria-label="删除主风格"
                        title="删除主风格"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="prompt-style-field-grid">
                    <label>
                      <span>名称</span>
                      <input
                        value={activeGroup.label}
                        maxLength={40}
                        onChange={(event) => patchGroup(activeGroupIndex, { label: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>菜单说明</span>
                      <input
                        value={activeGroup.description}
                        maxLength={120}
                        onChange={(event) => patchGroup(activeGroupIndex, { description: event.target.value })}
                      />
                    </label>
                    <label className="wide">
                      <span>优化指令</span>
                      <textarea
                        value={activeGroup.prompt ?? ""}
                        rows={3}
                        maxLength={1200}
                        placeholder="留空时使用系统默认规则；填写后会作为这个主风格的专属优化方向。"
                        onChange={(event) => patchGroup(activeGroupIndex, { prompt: event.target.value })}
                      />
                    </label>
                  </div>
                </section>
                <section className="prompt-style-detail-section substyles">
                  <div className="prompt-style-section-head">
                    <div>
                      <span>子风格</span>
                      <small>用于细化当前主风格，菜单中会缩进显示。</small>
                    </div>
                    <button className="secondary-btn" type="button" onClick={() => addChild(activeGroupIndex)}>
                      <Plus size={14} />
                      新增子风格
                    </button>
                  </div>
                  <div className="prompt-style-child-list">
                    {(activeGroup.children ?? []).map((child, childIndex) => {
                      const childVisible = child.visible !== false;
                      return (
                        <article className={cx("prompt-style-child-item", !childVisible && "hidden")} key={child.value}>
                          <div className="prompt-style-child-head">
                            <span>{childIndex + 1}</span>
                            <strong>{child.label || "未命名子风格"}</strong>
                            <div className="prompt-style-child-actions">
                              <button type="button" onClick={() => moveChild(activeGroupIndex, childIndex, -1)} disabled={childIndex === 0} aria-label="上移子风格">
                                <ArrowUp size={14} />
                              </button>
                              <button type="button" onClick={() => moveChild(activeGroupIndex, childIndex, 1)} disabled={childIndex === (activeGroup.children ?? []).length - 1} aria-label="下移子风格">
                                <ArrowDown size={14} />
                              </button>
                              <button type="button" onClick={() => patchChild(activeGroupIndex, childIndex, { visible: !childVisible })} aria-label={childVisible ? "隐藏子风格" : "显示子风格"}>
                                {childVisible ? <Eye size={14} /> : <EyeOff size={14} />}
                              </button>
                              <button type="button" className="danger" onClick={() => removeChild(activeGroupIndex, childIndex)} aria-label="删除子风格">
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                          <div className="prompt-style-field-grid compact">
                            <label>
                              <span>名称</span>
                              <input
                                value={child.label}
                                maxLength={40}
                                onChange={(event) => patchChild(activeGroupIndex, childIndex, { label: event.target.value })}
                              />
                            </label>
                            <label>
                              <span>说明</span>
                              <input
                                value={child.description}
                                maxLength={120}
                                onChange={(event) => patchChild(activeGroupIndex, childIndex, { description: event.target.value })}
                              />
                            </label>
                            <label className="wide">
                              <span>优化指令</span>
                              <textarea
                                value={child.prompt ?? ""}
                                rows={2}
                                maxLength={1200}
                                placeholder="留空时继承主风格和系统子风格规则。"
                                onChange={(event) => patchChild(activeGroupIndex, childIndex, { prompt: event.target.value })}
                              />
                            </label>
                          </div>
                        </article>
                      );
                    })}
                    {(activeGroup.children ?? []).length === 0 ? (
                      <div className="prompt-style-empty">还没有子风格，可以直接使用主风格，也可以新增子风格。</div>
                    ) : null}
                  </div>
                </section>
              </>
            ) : (
              <div className="prompt-style-empty">暂无主风格，请新增一个主风格。</div>
            )}
          </main>
        </div>
        <footer className="prompt-style-settings-footer">
          <div>
            <span>{dirty ? "有未保存修改" : "当前配置已保存"}</span>
            <small>{styleDescription(activeGroup?.description, "选择左侧主风格后配置它的子风格。")}</small>
          </div>
          <div className="prompt-style-footer-actions">
            <button className="secondary-btn" type="button" onClick={restoreDefaults}>
              <RotateCcw size={15} />
              恢复默认
            </button>
            <button className="secondary-btn" type="button" onClick={onClose}>
              取消
            </button>
            <button className="primary-btn" type="button" onClick={() => onSave(normalizedDraft)} disabled={!dirty || saving}>
              <Save size={15} />
              {saving ? "保存中" : "保存"}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body
  );
}
