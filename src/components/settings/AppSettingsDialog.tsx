import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Archive, Check, Database, KeyRound, Monitor, Moon, Palette, Pencil, ScrollText, Settings, Smile, Sun, Trash2, UserRound, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "../../api";
import { cx } from "../../lib/cx";
import { useAppearanceMode } from "../../hooks/useAppearanceMode";
import type { AppearanceMode } from "../../lib/appearance";
import { sanitizePromptOptimizeStyleGroups } from "../../lib/promptOptimizeStyles";
import type { EditSuggestionTone, User, UserPreferences } from "../../types";
import { useToast } from "../../ui";
import { MarkdownView } from "../MarkdownView";
import { PromptOptimizeStyleSettingsDialog } from "../PromptOptimizeStyleSettingsDialog";

type SettingsSectionId = "general" | "personalization" | "account" | "data" | "changelog";

const settingsSections: Array<{ id: SettingsSectionId; label: string; icon: LucideIcon }> = [
  { id: "general", label: "常规", icon: Settings },
  { id: "personalization", label: "个性化", icon: Smile },
  { id: "account", label: "账户", icon: UserRound },
  { id: "data", label: "数据管理", icon: Database },
  { id: "changelog", label: "更新日志", icon: ScrollText }
];

const settingsSectionTitles: Record<SettingsSectionId, string> = {
  general: "常规",
  personalization: "个性化",
  account: "账户",
  data: "数据管理",
  changelog: "更新日志"
};

const appearanceOptions: Array<{ value: AppearanceMode; label: string; icon: LucideIcon }> = [
  { value: "system", label: "系统", icon: Monitor },
  { value: "dark", label: "深色", icon: Moon },
  { value: "light", label: "浅色", icon: Sun },
  { value: "maliang", label: "马良", icon: Palette }
];

const editSuggestionToneOptions: Array<{ value: EditSuggestionTone; label: string; description: string }> = [
  { value: "default", label: "默认", description: "兼顾可用性、创意扩展和细节修复。" },
  { value: "practical", label: "实用优化", description: "强化排版清晰、信息层级、阅读顺序和商业可用性。" },
  { value: "creative", label: "创意扩展", description: "强化场景变化、风格包装、叙事感和视觉记忆点。" },
  { value: "detail", label: "细节修复", description: "强化文字、主体、背景、材质、光影和局部瑕疵修正。" }
];

type AppSettingsDialogProps = {
  open: boolean;
  user: User;
  activeSessionCount: number;
  archivedSessionCount: number;
  archiveAllPending?: boolean;
  deleteAllPending?: boolean;
  deleteAccountPending?: boolean;
  preferencesSaving?: boolean;
  onClose: () => void;
  onChangePassword: () => void;
  onEditProfile: () => void;
  onDeleteAccount: () => void;
  onAppearanceModeChange: (mode: AppearanceMode) => void;
  onPreferencesChange: (preferences: Partial<UserPreferences>) => void;
  onOpenArchivedChats: () => void;
  onArchiveAllChats: () => void;
  onDeleteAllChats: () => void;
};

export function AppSettingsDialog({
  open,
  user,
  activeSessionCount,
  archivedSessionCount,
  archiveAllPending,
  deleteAllPending,
  deleteAccountPending,
  preferencesSaving,
  onClose,
  onChangePassword,
  onEditProfile,
  onDeleteAccount,
  onAppearanceModeChange,
  onPreferencesChange,
  onOpenArchivedChats,
  onArchiveAllChats,
  onDeleteAllChats
}: AppSettingsDialogProps) {
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("general");
  const [promptStyleSettingsOpen, setPromptStyleSettingsOpen] = useState(false);
  const { mode: appearanceMode, setMode: setAppearanceMode } = useAppearanceMode();
  const { showToast } = useToast();
  const changelog = useQuery({
    queryKey: ["changelog"],
    queryFn: api.changelog,
    enabled: open && activeSection === "changelog"
  });

  useEffect(() => {
    if (!open) setActiveSection("general");
  }, [open]);

  if (!open) return null;

  const entries = changelog.data?.entries ?? [];
  const latestEntry = entries[0];
  const avatarSource = user.username?.trim() || user.account?.trim() || "U";
  const avatarText = avatarSource.slice(0, 1).toUpperCase();
  const preferences = {
    editSuggestionsEnabled: user.preferences?.editSuggestionsEnabled ?? true,
    editSuggestionTone: user.preferences?.editSuggestionTone ?? "default" as const,
    autoUploadPastedAssets: user.preferences?.autoUploadPastedAssets ?? true,
    promptOptimizeStyleGroups: sanitizePromptOptimizeStyleGroups(user.preferences?.promptOptimizeStyleGroups)
  };
  const toneDisabled = !preferences.editSuggestionsEnabled;
  const promptStyleGroupCount = preferences.promptOptimizeStyleGroups.length;
  const promptSubStyleCount = preferences.promptOptimizeStyleGroups.reduce((total, group) => total + (group.children?.length ?? 0), 0);

  return (
    <div
      className="settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label="设置">
        <aside className="settings-side" aria-label="设置菜单">
          <button className="settings-close-btn" type="button" onClick={onClose} aria-label="关闭设置">
            <X size={20} />
          </button>
          <nav className="settings-nav">
            {settingsSections.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  className={cx("settings-nav-item", item.id === activeSection && "active")}
                  type="button"
                  onClick={() => setActiveSection(item.id)}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>
        <div className="settings-content">
          <header className="settings-content-head">
            <h2>{settingsSectionTitles[activeSection]}</h2>
          </header>
          {activeSection === "general" ? (
            <div className="settings-list">
              <div className="settings-row settings-appearance-row">
                <div>
                  <strong>外观</strong>
                  <span>选择工作台界面的显示模式</span>
                </div>
                <div className="appearance-mode-control" role="group" aria-label="外观模式">
                  {appearanceOptions.map((option) => {
                    const Icon = option.icon;
                    const active = option.value === appearanceMode;
                    return (
                      <button
                        key={option.value}
                        className={cx("appearance-mode-button", active && "active")}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          if (active) return;
                          setAppearanceMode(option.value);
                          onAppearanceModeChange(option.value);
                          showToast("外观已更新");
                        }}
                      >
                        <Icon size={15} />
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="settings-row settings-preference-row">
                <div>
                  <strong>自动上传素材库</strong>
                  <span>开启后，输入框粘贴的图片会自动保存到素材库；关闭后仅作为本次输入素材使用</span>
                </div>
                <button
                  className={cx("settings-switch-control", preferences.autoUploadPastedAssets && "checked")}
                  type="button"
                  role="switch"
                  aria-checked={preferences.autoUploadPastedAssets}
                  aria-label="自动上传素材库"
                  onClick={() => onPreferencesChange({ autoUploadPastedAssets: !preferences.autoUploadPastedAssets })}
                >
                  <span className="settings-switch-track" aria-hidden="true">
                    <span className="settings-switch-thumb" />
                  </span>
                </button>
              </div>
            </div>
          ) : activeSection === "personalization" ? (
            <div className="settings-list">
              <div className="settings-row settings-preference-row">
                <div>
                  <strong>续改建议</strong>
                  <span>控制对话输入框上方的 3 条图片续改建议</span>
                </div>
                <button
                  className={cx("settings-switch-control", preferences.editSuggestionsEnabled && "checked")}
                  type="button"
                  role="switch"
                  aria-checked={preferences.editSuggestionsEnabled}
                  aria-label="续改建议"
                  onClick={() => onPreferencesChange({ editSuggestionsEnabled: !preferences.editSuggestionsEnabled })}
                >
                  <span className="settings-switch-track" aria-hidden="true">
                    <span className="settings-switch-thumb" />
                  </span>
                </button>
              </div>
              {preferences.editSuggestionsEnabled ? (
                <div className="settings-row settings-preference-tone-row">
                  <div>
                    <strong>建议倾向</strong>
                    <span>影响新生成的续改建议内容，默认就是当前效果</span>
                  </div>
                  <div className={cx("settings-tone-options", toneDisabled && "disabled")} role="radiogroup" aria-label="续改建议倾向">
                    {editSuggestionToneOptions.map((option) => {
                      const active = option.value === preferences.editSuggestionTone;
                      return (
                        <button
                          key={option.value}
                          className={cx("settings-tone-option", active && "active")}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          disabled={toneDisabled}
                          onClick={() => {
                            if (toneDisabled || active) return;
                            onPreferencesChange({ editSuggestionTone: option.value });
                          }}
                        >
                          <span className="settings-tone-option-head">
                            <strong>{option.label}</strong>
                            {active ? (
                              <span className="settings-tone-check" aria-hidden="true">
                                <Check size={14} strokeWidth={2.5} />
                              </span>
                            ) : null}
                          </span>
                          <span>{option.description}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <div className="settings-row settings-prompt-styles-entry">
                <div>
                  <strong>AI 优化风格</strong>
                  <span>
                    {promptStyleGroupCount} 个主风格，{promptSubStyleCount} 个子风格；可设置排序、显示状态和专属优化指令
                  </span>
                </div>
                <button className="secondary-btn" type="button" onClick={() => setPromptStyleSettingsOpen(true)}>
                  <Settings size={15} />
                  管理风格
                </button>
              </div>
            </div>
          ) : activeSection === "account" ? (
            <div className="settings-list">
              <div className="settings-row settings-account-row">
                <div className="settings-account-main">
                  <span className="settings-avatar-display" aria-hidden="true">
                    {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span>{avatarText}</span>}
                  </span>
                  <div className="settings-account-text">
                    <strong>账号</strong>
                    <span>{user.account}</span>
                  </div>
                </div>
                <button className="secondary-btn" type="button" onClick={onEditProfile}>
                  <Pencil size={15} />
                  编辑个人资料
                </button>
              </div>
              <div className="settings-row">
                <div>
                  <strong>用户名</strong>
                  <span>{user.username}</span>
                </div>
              </div>
              <div className="settings-row">
                <div>
                  <strong>登录密码</strong>
                  <span>用于账号登录验证</span>
                </div>
                <button className="secondary-btn" type="button" onClick={onChangePassword}>
                  <KeyRound size={15} />
                  修改密码
                </button>
              </div>
              <div className="settings-row">
                <div>
                  <strong>邮箱</strong>
                  <span>{user.email || "未填写邮箱"}</span>
                </div>
              </div>
              <div className="settings-row">
                <div>
                  <strong>所属团队</strong>
                  <span>{user.teamName || user.teamId || "默认团队"}</span>
                </div>
              </div>
              <div className="settings-row danger">
                <div>
                  <strong>删除账户</strong>
                  <span>删除后会退出登录，并清理该账户的聊天、图片、素材和个人数据</span>
                </div>
                <button className="danger-outline-btn" type="button" onClick={onDeleteAccount} disabled={deleteAccountPending}>
                  <Trash2 size={15} />
                  {deleteAccountPending ? "删除中" : "删除账户"}
                </button>
              </div>
            </div>
          ) : activeSection === "data" ? (
            <div className="settings-list">
              <div className="settings-row">
                <div>
                  <strong>已归档的聊天</strong>
                  <span>{archivedSessionCount} 条</span>
                </div>
                <button className="secondary-btn" type="button" onClick={onOpenArchivedChats}>
                  管理
                </button>
              </div>
              <div className="settings-row">
                <div>
                  <strong>归档所有聊天</strong>
                  <span>{activeSessionCount} 条</span>
                </div>
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={onArchiveAllChats}
                  disabled={archiveAllPending || activeSessionCount === 0}
                >
                  <Archive size={15} />
                  {archiveAllPending ? "归档中" : "全部归档"}
                </button>
              </div>
              <div className="settings-row danger">
                <div>
                  <strong>删除所有聊天</strong>
                  <span>{activeSessionCount + archivedSessionCount} 条</span>
                </div>
                <button
                  className="danger-outline-btn"
                  type="button"
                  onClick={onDeleteAllChats}
                  disabled={deleteAllPending || activeSessionCount + archivedSessionCount === 0}
                >
                  <Trash2 size={15} />
                  全部删除
                </button>
              </div>
            </div>
          ) : (
            <div className="settings-changelog">
              <div className="settings-changelog-summary">
                <span>当前版本</span>
                <strong>{latestEntry?.version ?? "-"}</strong>
              </div>
              {changelog.isLoading ? <div className="settings-empty">更新日志加载中...</div> : null}
              {changelog.error ? <div className="form-error">{changelog.error.message}</div> : null}
              {!changelog.isLoading && entries.length === 0 ? <div className="settings-empty">暂无更新日志</div> : null}
              {entries.map((entry) => (
                <article className="settings-changelog-entry" key={entry.version}>
                  <header>
                    <strong>{entry.version}</strong>
                    <time>{entry.date || "-"}</time>
                  </header>
                  <MarkdownView markdown={entry.content} />
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
      <PromptOptimizeStyleSettingsDialog
        open={promptStyleSettingsOpen}
        groups={preferences.promptOptimizeStyleGroups}
        saving={preferencesSaving}
        onClose={() => setPromptStyleSettingsOpen(false)}
        onSave={(nextGroups) => {
          onPreferencesChange({ promptOptimizeStyleGroups: nextGroups });
          setPromptStyleSettingsOpen(false);
        }}
      />
    </div>
  );
}
