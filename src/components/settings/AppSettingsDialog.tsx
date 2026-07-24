import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Archive, BellRing, Database, Github, KeyRound, Leaf, Link2, Monitor, Moon, Palette, Pencil, ScrollText, Search, Settings, Smile, Sun, Sunset, Trash2, UserRound, Volume1, Volume2, VolumeOff, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "../../api";
import {
  languagePreferenceOptions,
  normalizeLanguagePreference,
  useI18n,
  type LanguagePreference
} from "../../i18n";
import { cx } from "../../lib/cx";
import { useAppearanceMode } from "../../hooks/useAppearanceMode";
import { useInfinitePageLoader } from "../../hooks/useInfinitePageLoader";
import type { AppearanceMode } from "../../lib/appearance";
import { sanitizePromptOptimizeStyleGroups } from "../../lib/promptOptimizeStyles";
import {
  DEFAULT_IMAGE_TASK_SOUND_VOLUME,
  type ImageTaskSoundId
} from "../../lib/imageTaskSounds";
import {
  playImageTaskSound,
  stopImageTaskSoundPlayback
} from "../../lib/imageTaskSoundPlayer";
import {
  getImageTaskBrowserNotificationPermission,
  imageTaskBrowserNotificationSettingState,
  requestImageTaskBrowserNotificationPermission,
  type BrowserNotificationPermissionResult
} from "../../lib/imageTaskBrowserNotifications";
import type { EditSuggestionTone, ImagePreviewOpenMode, ImagePreviewWheelMode, ImageTaskSound, User, UserPreferences } from "../../types";
import { CustomSelect, useToast } from "../../ui";
import { MarkdownView } from "../MarkdownView";
import { PromptColorSchemeSettingsDialog } from "../PromptColorSchemeSettingsDialog";
import { PromptOptimizeStyleSettingsDialog } from "../PromptOptimizeStyleSettingsDialog";
import { ImageTaskSoundSelect } from "./ImageTaskSoundSelect";
import { SharedLinksDialog } from "./SharedLinksDialog";

type SettingsSectionId = "general" | "sound" | "personalization" | "account" | "data" | "about";
type SettingsSectionDirection = "forward" | "backward";

const PROJECT_REPOSITORY_URL = "https://github.com/Xiongdaxz/shenbi-maliang-gpt-image-workbench";
const CHANGELOG_PAGE_SIZE = 5;

const settingsSections: Array<{ id: SettingsSectionId; labelKey: string; icon: LucideIcon }> = [
  { id: "general", labelKey: "settings.nav.general", icon: Settings },
  { id: "sound", labelKey: "settings.nav.soundMenu", icon: BellRing },
  { id: "personalization", labelKey: "settings.nav.personalization", icon: Smile },
  { id: "account", labelKey: "settings.nav.account", icon: UserRound },
  { id: "data", labelKey: "settings.nav.data", icon: Database },
  { id: "about", labelKey: "settings.nav.about", icon: Github }
];

const settingsSectionTitleKeys: Record<SettingsSectionId, string> = {
  general: "settings.nav.general",
  sound: "settings.nav.sound",
  personalization: "settings.nav.personalization",
  account: "settings.nav.account",
  data: "settings.nav.data",
  about: "settings.nav.about"
};

const appearanceOptions: Array<{ value: AppearanceMode; labelKey: string; icon: LucideIcon }> = [
  { value: "system", labelKey: "appearance.system", icon: Monitor },
  { value: "light", labelKey: "appearance.light", icon: Sun },
  { value: "dark", labelKey: "appearance.dark", icon: Moon },
  { value: "maliang", labelKey: "appearance.maliang", icon: Sunset },
  { value: "chunyu", labelKey: "appearance.chunyu", icon: Leaf }
];

const editSuggestionToneOptions: Array<{ value: EditSuggestionTone; labelKey: string; descriptionKey: string }> = [
  { value: "default", labelKey: "settings.personalization.tone.default", descriptionKey: "settings.personalization.tone.defaultDesc" },
  { value: "practical", labelKey: "settings.personalization.tone.practical", descriptionKey: "settings.personalization.tone.practicalDesc" },
  { value: "creative", labelKey: "settings.personalization.tone.creative", descriptionKey: "settings.personalization.tone.creativeDesc" },
  { value: "detail", labelKey: "settings.personalization.tone.detail", descriptionKey: "settings.personalization.tone.detailDesc" }
];

const imagePreviewWheelOptions: Array<{ value: ImagePreviewWheelMode; labelKey: string; descriptionKey: string }> = [
  { value: "pan", labelKey: "settings.general.imagePreview.wheel.pan", descriptionKey: "settings.general.imagePreview.wheel.panDesc" },
  { value: "zoom", labelKey: "settings.general.imagePreview.wheel.zoom", descriptionKey: "settings.general.imagePreview.wheel.zoomDesc" }
];

const imagePreviewOpenOptions: Array<{ value: ImagePreviewOpenMode; labelKey: string; descriptionKey: string }> = [
  { value: "contain", labelKey: "settings.general.imagePreview.open.contain", descriptionKey: "settings.general.imagePreview.open.containDesc" },
  { value: "actual", labelKey: "settings.general.imagePreview.open.actual", descriptionKey: "settings.general.imagePreview.open.actualDesc" }
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
  imageTaskSounds: ImageTaskSound[];
  imageTaskSoundsLoading?: boolean;
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
  imageTaskSounds,
  imageTaskSoundsLoading,
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
  const [sectionDirection, setSectionDirection] = useState<SettingsSectionDirection>("forward");
  const [contentTransitioning, setContentTransitioning] = useState(false);
  const [promptStyleSettingsOpen, setPromptStyleSettingsOpen] = useState(false);
  const [promptColorSchemeSettingsOpen, setPromptColorSchemeSettingsOpen] = useState(false);
  const [sharedLinksOpen, setSharedLinksOpen] = useState(false);
  const [soundVolumeDraft, setSoundVolumeDraft] = useState(DEFAULT_IMAGE_TASK_SOUND_VOLUME);
  const [soundEnabledDraft, setSoundEnabledDraft] = useState(true);
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState<BrowserNotificationPermissionResult>(
    () => getImageTaskBrowserNotificationPermission()
  );
  const [browserNotificationPermissionPending, setBrowserNotificationPermissionPending] = useState(false);
  const [soundPreviewId, setSoundPreviewId] = useState<ImageTaskSoundId | null>(null);
  const soundPreviewTokenRef = useRef(0);
  const soundPreviewIdRef = useRef<ImageTaskSoundId | null>(null);
  const committedSoundVolumeRef = useRef(DEFAULT_IMAGE_TASK_SOUND_VOLUME);
  const soundVolumeDraftRef = useRef(DEFAULT_IMAGE_TASK_SOUND_VOLUME);
  const lastNonZeroSoundVolumeRef = useRef(DEFAULT_IMAGE_TASK_SOUND_VOLUME);
  const soundEnabledDraftRef = useRef(true);
  const restoreSoundOnVolumeCommitRef = useRef(false);
  const [changelogSearchInput, setChangelogSearchInput] = useState("");
  const [changelogSearchKeyword, setChangelogSearchKeyword] = useState("");
  const [latestChangelogVersion, setLatestChangelogVersion] = useState("");
  const settingsContentRef = useRef<HTMLDivElement | null>(null);
  const { mode: appearanceMode, setMode: setAppearanceMode } = useAppearanceMode();
  const { showToast } = useToast();
  const { language, resolvedLanguage, setLanguage, t } = useI18n();
  const sharedLinkCount = useQuery({
    queryKey: ["session-share-links", "count"],
    queryFn: ({ signal }) => api.sessionShareLinks({ limit: 1, offset: 0 }, { signal }),
    enabled: open
  });
  const languageOptions = useMemo(() => languagePreferenceOptions(t, resolvedLanguage), [resolvedLanguage, t]);
  const toneOptions = useMemo(
    () => editSuggestionToneOptions.map((option) => ({
      value: option.value,
      label: t(option.labelKey),
      description: t(option.descriptionKey)
    })),
    [t]
  );
  const previewWheelOptions = useMemo(
    () => imagePreviewWheelOptions.map((option) => ({
      value: option.value,
      label: t(option.labelKey),
      description: t(option.descriptionKey)
    })),
    [t]
  );
  const previewOpenOptions = useMemo(
    () => imagePreviewOpenOptions.map((option) => ({
      value: option.value,
      label: t(option.labelKey),
      description: t(option.descriptionKey)
    })),
    [t]
  );
  const soundOptions = useMemo(
    () => imageTaskSounds.map((sound) => ({ value: sound.id, label: sound.name })),
    [imageTaskSounds]
  );
  const changelog = useInfiniteQuery({
    queryKey: ["changelog", "paged", changelogSearchKeyword],
    queryFn: ({ pageParam }) => api.changelog({
      limit: CHANGELOG_PAGE_SIZE,
      offset: Number(pageParam),
      keyword: changelogSearchKeyword
    }),
    initialPageParam: 0,
    // Keep the pages the user has already viewed when switching settings sections.
    // Changelog edits explicitly invalidate this key, which still triggers a refresh.
    staleTime: Infinity,
    getNextPageParam: (lastPage) => (
      lastPage.pageInfo.hasMore ? lastPage.pageInfo.offset + lastPage.pageInfo.limit : undefined
    ),
    enabled: open && activeSection === "about"
  });
  const branding = useQuery({
    queryKey: ["branding"],
    queryFn: api.branding,
    enabled: open
  });
  const promptColorSchemes = useQuery({
    queryKey: ["prompt-color-schemes"],
    queryFn: () => api.promptColorSchemes(),
    enabled: open && (activeSection === "personalization" || promptColorSchemeSettingsOpen)
  });
  const promptOptimizeStyleGroups = useMemo(
    () => sanitizePromptOptimizeStyleGroups(user.preferences?.promptOptimizeStyleGroups),
    [user.preferences?.promptOptimizeStyleGroups]
  );
  const preferences = useMemo(() => ({
    editSuggestionsEnabled: user.preferences?.editSuggestionsEnabled ?? true,
    editSuggestionTone: user.preferences?.editSuggestionTone ?? "default" as const,
    autoUploadPastedAssets: user.preferences?.autoUploadPastedAssets ?? true,
    imagePreviewWheelMode: user.preferences?.imagePreviewWheelMode ?? "pan" as const,
    imagePreviewOpenMode: user.preferences?.imagePreviewOpenMode ?? "contain" as const,
    imageTaskSoundEnabled: user.preferences?.imageTaskSoundEnabled ?? true,
    imageTaskBrowserNotificationEnabled: user.preferences?.imageTaskBrowserNotificationEnabled ?? false,
    imageTaskSoundVolume: user.preferences?.imageTaskSoundVolume ?? DEFAULT_IMAGE_TASK_SOUND_VOLUME,
    imageTaskSuccessSoundId: user.preferences?.imageTaskSuccessSoundId ?? "",
    imageTaskFailureSoundId: user.preferences?.imageTaskFailureSoundId ?? "",
    language: normalizeLanguagePreference(user.preferences?.language ?? language),
    promptOptimizeStyleGroups
  }), [
    language,
    promptOptimizeStyleGroups,
    user.preferences?.autoUploadPastedAssets,
    user.preferences?.editSuggestionTone,
    user.preferences?.editSuggestionsEnabled,
    user.preferences?.imagePreviewOpenMode,
    user.preferences?.imagePreviewWheelMode,
    user.preferences?.imageTaskFailureSoundId,
    user.preferences?.imageTaskBrowserNotificationEnabled,
    user.preferences?.imageTaskSoundEnabled,
    user.preferences?.imageTaskSoundVolume,
    user.preferences?.imageTaskSuccessSoundId,
    user.preferences?.language
  ]);
  const browserNotificationState = imageTaskBrowserNotificationSettingState(
    preferences.imageTaskBrowserNotificationEnabled,
    browserNotificationPermission
  );
  const browserNotificationPreferenceEnabled = browserNotificationState !== "disabled";

  useEffect(() => {
    if (preferencesSaving) return;
    soundVolumeDraftRef.current = preferences.imageTaskSoundVolume;
    setSoundVolumeDraft(preferences.imageTaskSoundVolume);
    committedSoundVolumeRef.current = preferences.imageTaskSoundVolume;
    if (preferences.imageTaskSoundVolume > 0) lastNonZeroSoundVolumeRef.current = preferences.imageTaskSoundVolume;
  }, [preferences.imageTaskSoundVolume, preferencesSaving]);

  useEffect(() => {
    if (!preferencesSaving) {
      soundEnabledDraftRef.current = preferences.imageTaskSoundEnabled;
      restoreSoundOnVolumeCommitRef.current = false;
      setSoundEnabledDraft(preferences.imageTaskSoundEnabled);
    }
  }, [preferences.imageTaskSoundEnabled, preferencesSaving]);

  useEffect(() => {
    if (!open) return;
    const refreshPermission = () => {
      setBrowserNotificationPermission(getImageTaskBrowserNotificationPermission());
    };
    refreshPermission();
    window.addEventListener("focus", refreshPermission);
    document.addEventListener("visibilitychange", refreshPermission);
    return () => {
      window.removeEventListener("focus", refreshPermission);
      document.removeEventListener("visibilitychange", refreshPermission);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      soundPreviewTokenRef.current += 1;
      soundPreviewIdRef.current = null;
      setSoundPreviewId(null);
      stopImageTaskSoundPlayback();
      setActiveSection("general");
      setContentTransitioning(false);
      setSharedLinksOpen(false);
      setChangelogSearchInput("");
      setChangelogSearchKeyword("");
    }
  }, [open]);

  useEffect(() => () => {
    soundPreviewTokenRef.current += 1;
    soundPreviewIdRef.current = null;
    stopImageTaskSoundPlayback();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setChangelogSearchKeyword(changelogSearchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [changelogSearchInput]);

  useEffect(() => {
    if (settingsContentRef.current) settingsContentRef.current.scrollTop = 0;
  }, [changelogSearchKeyword]);

  const entries = useMemo(() => changelog.data?.pages.flatMap((page) => page.entries) ?? [], [changelog.data?.pages]);
  const changelogSearchPending = changelogSearchInput.trim() !== changelogSearchKeyword;
  const changelogLoading = changelog.isLoading || changelogSearchPending;
  const hasChangelogSearch = Boolean(changelogSearchKeyword);
  const visibleChangelogEntries = changelogSearchPending ? [] : entries;
  useEffect(() => {
    if (!changelogSearchKeyword && entries[0]?.version) setLatestChangelogVersion(entries[0].version);
  }, [changelogSearchKeyword, entries]);
  const changelogLoadMoreRef = useInfinitePageLoader({
    fetchNextPage: () => changelog.fetchNextPage(),
    hasNextPage: !changelogSearchPending && Boolean(changelog.hasNextPage),
    isFetchingNextPage: changelog.isFetchingNextPage,
    rootRef: settingsContentRef,
    rootMargin: "160px"
  });
  const activeSectionIndex = Math.max(0, settingsSections.findIndex((item) => item.id === activeSection));
  const settingsNavStyle = { "--settings-nav-active-offset": `${activeSectionIndex * 44}px` } as CSSProperties;
  const selectSection = (nextSection: SettingsSectionId) => {
    if (nextSection === activeSection) return;
    const nextIndex = settingsSections.findIndex((item) => item.id === nextSection);
    setSectionDirection(nextIndex > activeSectionIndex ? "forward" : "backward");
    setContentTransitioning(true);
    if (settingsContentRef.current) settingsContentRef.current.scrollTop = 0;
    setActiveSection(nextSection);
  };
  const resetChangelogSearch = () => {
    setChangelogSearchInput("");
    setChangelogSearchKeyword("");
  };
  const playSoundPreview = (soundId: ImageTaskSoundId, volume = soundVolumeDraft) => {
    const token = soundPreviewTokenRef.current + 1;
    soundPreviewTokenRef.current = token;
    soundPreviewIdRef.current = soundId;
    setSoundPreviewId(soundId);
    const soundUrl = imageTaskSounds.find((sound) => sound.id === soundId)?.url ?? "";
    const started = playImageTaskSound(soundUrl, volume, () => {
      if (soundPreviewTokenRef.current !== token) return;
      soundPreviewIdRef.current = null;
      setSoundPreviewId(null);
    });
    if (!started && soundPreviewTokenRef.current === token) {
      soundPreviewIdRef.current = null;
      setSoundPreviewId(null);
    }
  };
  const stopSoundPreview = () => {
    soundPreviewTokenRef.current += 1;
    soundPreviewIdRef.current = null;
    setSoundPreviewId(null);
    stopImageTaskSoundPlayback();
  };
  const commitSoundVolume = (nextVolume: number) => {
    const restoreSound = nextVolume > 0 && restoreSoundOnVolumeCommitRef.current;
    restoreSoundOnVolumeCommitRef.current = false;
    if (nextVolume === committedSoundVolumeRef.current && !restoreSound) return;
    committedSoundVolumeRef.current = nextVolume;
    if (nextVolume > 0) lastNonZeroSoundVolumeRef.current = nextVolume;
    if (nextVolume === 0) {
      soundEnabledDraftRef.current = false;
      setSoundEnabledDraft(false);
    }
    onPreferencesChange(nextVolume === 0
      ? { imageTaskSoundEnabled: false, imageTaskSoundVolume: 0 }
      : restoreSound
        ? { imageTaskSoundEnabled: true, imageTaskSoundVolume: nextVolume }
        : { imageTaskSoundVolume: nextVolume });
  };
  const changeSoundVolume = (nextVolume: number) => {
    const restoringFromMuted = soundVolumeDraftRef.current === 0 && nextVolume > 0;
    soundVolumeDraftRef.current = nextVolume;
    setSoundVolumeDraft(nextVolume);
    if (nextVolume === 0) {
      stopSoundPreview();
      restoreSoundOnVolumeCommitRef.current = false;
      soundEnabledDraftRef.current = false;
      setSoundEnabledDraft(false);
      return;
    }
    lastNonZeroSoundVolumeRef.current = nextVolume;
    if (restoringFromMuted && !soundEnabledDraftRef.current) {
      restoreSoundOnVolumeCommitRef.current = true;
      soundEnabledDraftRef.current = true;
      setSoundEnabledDraft(true);
    }
  };
  const finishSoundVolumeChange = (nextVolume: number) => {
    commitSoundVolume(nextVolume);
    if (nextVolume > 0 && preferences.imageTaskSuccessSoundId) playSoundPreview(preferences.imageTaskSuccessSoundId, nextVolume);
  };
  const toggleSoundEnabled = () => {
    const nextEnabled = !soundEnabledDraftRef.current;
    if (nextEnabled && soundVolumeDraft === 0) {
      const restoredVolume = lastNonZeroSoundVolumeRef.current || DEFAULT_IMAGE_TASK_SOUND_VOLUME;
      soundEnabledDraftRef.current = true;
      soundVolumeDraftRef.current = restoredVolume;
      setSoundEnabledDraft(true);
      setSoundVolumeDraft(restoredVolume);
      committedSoundVolumeRef.current = restoredVolume;
      onPreferencesChange({ imageTaskSoundEnabled: true, imageTaskSoundVolume: restoredVolume });
      return;
    }
    soundEnabledDraftRef.current = nextEnabled;
    setSoundEnabledDraft(nextEnabled);
    if (!nextEnabled) stopSoundPreview();
    onPreferencesChange({ imageTaskSoundEnabled: nextEnabled });
  };
  const toggleBrowserNotificationEnabled = async () => {
    if (browserNotificationPreferenceEnabled) {
      onPreferencesChange({ imageTaskBrowserNotificationEnabled: false });
      return;
    }
    setBrowserNotificationPermissionPending(true);
    try {
      const permission = await requestImageTaskBrowserNotificationPermission();
      setBrowserNotificationPermission(permission);
      if (permission === "granted") {
        onPreferencesChange({ imageTaskBrowserNotificationEnabled: true });
      } else if (permission === "insecure-context") {
        showToast(t("toast.imageTaskBrowserNotificationInsecureContext"), "error");
      } else if (permission === "unsupported") {
        showToast(t("toast.imageTaskBrowserNotificationUnsupported"), "error");
      } else {
        showToast(t("toast.imageTaskBrowserNotificationPermissionDenied"), "error");
      }
    } finally {
      setBrowserNotificationPermissionPending(false);
    }
  };
  const toggleSoundPreview = (soundId: ImageTaskSoundId) => {
    if (soundPreviewIdRef.current === soundId) {
      stopSoundPreview();
      return;
    }
    playSoundPreview(soundId);
  };

  if (!open) return null;

  const latestVersion = latestChangelogVersion || (!changelogSearchKeyword ? entries[0]?.version ?? "" : "");
  const avatarSource = user.username?.trim() || user.account?.trim() || "U";
  const avatarText = avatarSource.slice(0, 1).toUpperCase();
  const toneDisabled = !preferences.editSuggestionsEnabled;
  const promptStyleGroupCount = preferences.promptOptimizeStyleGroups.length;
  const promptSubStyleCount = preferences.promptOptimizeStyleGroups.reduce((total, group) => total + (group.children?.length ?? 0), 0);
  const colorSchemeList = promptColorSchemes.data?.schemes ?? [];
  const visibleColorSchemes = colorSchemeList.filter((scheme) => scheme.visible);
  const SoundVolumeIcon = soundVolumeDraft === 0 ? VolumeOff : soundVolumeDraft < 50 ? Volume1 : Volume2;
  const soundUnavailable = imageTaskSounds.length === 0;
  const visibleColorSchemeCategoryCount = new Set(visibleColorSchemes.map((scheme) => scheme.category?.trim() || t("promptColorScheme.customCategory"))).size;
  const visibleColorSchemeCount = visibleColorSchemes.length;
  const activeAppearanceIndex = Math.max(0, appearanceOptions.findIndex((option) => option.value === appearanceMode));
  const showGithubEntry = branding.data?.showGithubEntry ?? true;

  return (
    <div
      className="settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label={t("settings.dialog.title")}>
        <aside className="settings-side" aria-label={t("settings.dialog.menu")}>
          <button className="settings-close-btn" type="button" onClick={onClose} aria-label={t("settings.close")}>
            <X size={20} />
          </button>
          <nav className="settings-nav" style={settingsNavStyle}>
            {settingsSections.map((item) => {
              const Icon = item.id === "about" && !showGithubEntry ? ScrollText : item.icon;
              return (
                <button
                  key={item.id}
                  className={cx("settings-nav-item", item.id === activeSection && "active")}
                  type="button"
                  onClick={() => selectSection(item.id)}
                >
                  <Icon size={18} />
                  <span>{t(item.labelKey)}</span>
                </button>
              );
            })}
          </nav>
        </aside>
        <div className="settings-content" ref={settingsContentRef}>
          <div
            key={activeSection}
            className={cx(
              "settings-content-view",
              activeSection === "sound" && "is-sound-section",
              contentTransitioning && `is-entering-${sectionDirection}`
            )}
            onAnimationEnd={(event) => {
              if (event.target === event.currentTarget) setContentTransitioning(false);
            }}
          >
            <header className="settings-content-head">
              <h2>{t(settingsSectionTitleKeys[activeSection])}</h2>
            </header>
            {activeSection === "general" ? (
            <div className="settings-list">
              <div className="settings-row settings-appearance-row">
                <div>
                  <strong>{t("settings.general.appearance.title")}</strong>
                  <span>{t("settings.general.appearance.desc")}</span>
                </div>
                <div
                  className="appearance-mode-control"
                  data-active-index={activeAppearanceIndex}
                  role="group"
                  aria-label={t("settings.general.appearance.title")}
                >
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
                          showToast(t("settings.general.appearance.toast"));
                        }}
                      >
                        <Icon size={15} />
                        <span>{t(option.labelKey)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="settings-row settings-language-row">
                <div>
                  <strong>{t("settings.language.title")}</strong>
                  <span>{t("settings.language.desc")}</span>
                </div>
                <CustomSelect
                  value={preferences.language}
                  options={languageOptions}
                  onChange={(value) => {
                    const nextLanguage = normalizeLanguagePreference(value) as LanguagePreference;
                    if (nextLanguage === preferences.language) return;
                    setLanguage(nextLanguage);
                    onPreferencesChange({ language: nextLanguage });
                  }}
                  className="settings-language-select"
                  menuClassName="settings-language-menu"
                  menuWidth={260}
                />
              </div>
              <div className="settings-row settings-preference-row">
                <div>
                  <strong>{t("settings.general.autoUpload.title")}</strong>
                  <span>{t("settings.general.autoUpload.desc")}</span>
                </div>
                <button
                  className={cx("settings-switch-control", preferences.autoUploadPastedAssets && "checked")}
                  type="button"
                  role="switch"
                  aria-checked={preferences.autoUploadPastedAssets}
                  aria-label={t("settings.general.autoUpload.title")}
                  onClick={() => onPreferencesChange({ autoUploadPastedAssets: !preferences.autoUploadPastedAssets })}
                >
                  <span className="settings-switch-track" aria-hidden="true">
                    <span className="settings-switch-thumb" />
                  </span>
                </button>
              </div>
              <h3 className="settings-group-title">{t("settings.general.imagePreview.group")}</h3>
              <div className="settings-row settings-language-row">
                <div>
                  <strong>{t("settings.general.imagePreview.wheel.title")}</strong>
                  <span>{t("settings.general.imagePreview.wheel.desc")}</span>
                </div>
                <CustomSelect
                  value={preferences.imagePreviewWheelMode}
                  options={previewWheelOptions}
                  onChange={(value) => {
                    const nextMode = imagePreviewWheelOptions.find((option) => option.value === value)?.value;
                    if (!nextMode || nextMode === preferences.imagePreviewWheelMode) return;
                    onPreferencesChange({ imagePreviewWheelMode: nextMode });
                  }}
                  className="settings-image-preview-select"
                  menuClassName="settings-image-preview-menu"
                  menuWidth={340}
                  disabled={preferencesSaving}
                />
              </div>
              <div className="settings-row settings-language-row">
                <div>
                  <strong>{t("settings.general.imagePreview.open.title")}</strong>
                  <span>{t("settings.general.imagePreview.open.desc")}</span>
                </div>
                <CustomSelect
                  value={preferences.imagePreviewOpenMode}
                  options={previewOpenOptions}
                  onChange={(value) => {
                    const nextMode = imagePreviewOpenOptions.find((option) => option.value === value)?.value;
                    if (!nextMode || nextMode === preferences.imagePreviewOpenMode) return;
                    onPreferencesChange({ imagePreviewOpenMode: nextMode });
                  }}
                  className="settings-image-preview-select"
                  menuClassName="settings-image-preview-menu"
                  menuWidth={340}
                  disabled={preferencesSaving}
                />
              </div>
            </div>
          ) : activeSection === "sound" ? (
            <div className="settings-list settings-sound-list">
              <div className="settings-row settings-preference-row">
                <div>
                  <strong>{t("settings.sound.browserNotification.title")}</strong>
                  <span>{t("settings.sound.browserNotification.desc")}</span>
                </div>
                <button
                  className={cx("settings-switch-control", browserNotificationPreferenceEnabled && "checked")}
                  type="button"
                  role="switch"
                  aria-checked={browserNotificationPreferenceEnabled}
                  aria-label={t("settings.sound.browserNotification.title")}
                  disabled={preferencesSaving || browserNotificationPermissionPending}
                  onClick={() => void toggleBrowserNotificationEnabled()}
                >
                  <span className="settings-switch-track" aria-hidden="true">
                    <span className="settings-switch-thumb" />
                  </span>
                </button>
              </div>
              {soundUnavailable ? (
                <div className="settings-sound-empty" role="status">
                  <VolumeOff size={18} aria-hidden="true" />
                  <span>{t(imageTaskSoundsLoading ? "settings.sound.catalog.loading" : "settings.sound.catalog.empty")}</span>
                </div>
              ) : null}
              <div className="settings-row settings-preference-row">
                <div>
                  <strong>{t("settings.sound.enabled.title")}</strong>
                  <span>{t("settings.sound.enabled.desc")}</span>
                </div>
                <button
                  className={cx("settings-switch-control", soundEnabledDraft && !soundUnavailable && "checked")}
                  type="button"
                  role="switch"
                  aria-checked={soundEnabledDraft && !soundUnavailable}
                  aria-label={t("settings.sound.enabled.title")}
                  disabled={preferencesSaving || soundUnavailable}
                  onClick={toggleSoundEnabled}
                >
                  <span className="settings-switch-track" aria-hidden="true">
                    <span className="settings-switch-thumb" />
                  </span>
                </button>
              </div>
              <div className="settings-row settings-sound-volume-row">
                <div>
                  <strong>{t("settings.sound.volume.title")}</strong>
                  <span>{t("settings.sound.volume.desc")}</span>
                </div>
                <div className="settings-sound-volume-control">
                  <SoundVolumeIcon size={17} aria-hidden="true" />
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={soundVolumeDraft}
                    disabled={preferencesSaving || soundUnavailable}
                    aria-label={t("settings.sound.volume.title")}
                    style={{ "--settings-sound-volume": `${soundVolumeDraft}%` } as CSSProperties}
                    onChange={(event) => {
                      const nextVolume = Number(event.target.value);
                      changeSoundVolume(nextVolume);
                    }}
                    onPointerDown={stopSoundPreview}
                    onPointerUp={(event) => finishSoundVolumeChange(Number(event.currentTarget.value))}
                    onPointerCancel={(event) => commitSoundVolume(Number(event.currentTarget.value))}
                    onKeyUp={(event) => finishSoundVolumeChange(Number(event.currentTarget.value))}
                    onBlur={(event) => commitSoundVolume(Number(event.currentTarget.value))}
                  />
                  <output>{soundVolumeDraft}%</output>
                </div>
              </div>
              <div className="settings-row settings-sound-tone-row">
                <div>
                  <strong>{t("settings.sound.success.title")}</strong>
                  <span>{t("settings.sound.success.desc")}</span>
                </div>
                <ImageTaskSoundSelect
                  value={preferences.imageTaskSuccessSoundId}
                  options={soundOptions}
                  playingSoundId={soundPreviewId}
                  disabled={preferencesSaving || soundUnavailable}
                  onChange={(soundId) => {
                    if (soundId !== preferences.imageTaskSuccessSoundId) onPreferencesChange({ imageTaskSuccessSoundId: soundId });
                    playSoundPreview(soundId);
                  }}
                  onPreviewToggle={toggleSoundPreview}
                />
              </div>
              <div className="settings-row settings-sound-tone-row">
                <div>
                  <strong>{t("settings.sound.failure.title")}</strong>
                  <span>{t("settings.sound.failure.desc")}</span>
                </div>
                <ImageTaskSoundSelect
                  value={preferences.imageTaskFailureSoundId}
                  options={soundOptions}
                  playingSoundId={soundPreviewId}
                  disabled={preferencesSaving || soundUnavailable}
                  onChange={(soundId) => {
                    if (soundId !== preferences.imageTaskFailureSoundId) onPreferencesChange({ imageTaskFailureSoundId: soundId });
                    playSoundPreview(soundId);
                  }}
                  onPreviewToggle={toggleSoundPreview}
                />
              </div>
            </div>
          ) : activeSection === "personalization" ? (
            <div className="settings-list">
              <div className="settings-row settings-preference-row">
                <div>
                  <strong>{t("settings.personalization.editSuggestions.title")}</strong>
                  <span>{t("settings.personalization.editSuggestions.desc")}</span>
                </div>
                <div className="settings-edit-suggestions-control">
                  <button
                    className={cx("settings-switch-control", preferences.editSuggestionsEnabled && "checked")}
                    type="button"
                    role="switch"
                    aria-checked={preferences.editSuggestionsEnabled}
                    aria-label={t("settings.personalization.editSuggestions.title")}
                    onClick={() => onPreferencesChange({ editSuggestionsEnabled: !preferences.editSuggestionsEnabled })}
                  >
                    <span className="settings-switch-track" aria-hidden="true">
                      <span className="settings-switch-thumb" />
                    </span>
                  </button>
                  <CustomSelect
                    value={preferences.editSuggestionTone}
                    options={toneOptions}
                    onChange={(value) => {
                      const nextTone = editSuggestionToneOptions.find((option) => option.value === value)?.value;
                      if (!nextTone || nextTone === preferences.editSuggestionTone) return;
                      onPreferencesChange({ editSuggestionTone: nextTone });
                    }}
                    disabled={toneDisabled}
                    className="settings-edit-suggestion-select"
                    menuClassName="settings-edit-suggestion-menu"
                    menuWidth={300}
                    menuAutoWidth
                    menuAutoWidthPadding={28}
                  />
                </div>
              </div>
              <div className="settings-row settings-prompt-styles-entry">
                <div>
                  <strong>{t("settings.personalization.promptStyles.title")}</strong>
                  <span>
                    {t("settings.personalization.promptStyles.desc", { groupCount: promptStyleGroupCount, childCount: promptSubStyleCount })}
                  </span>
                </div>
                <button className="secondary-btn" type="button" onClick={() => setPromptStyleSettingsOpen(true)}>
                  <Settings size={15} />
                  {t("settings.personalization.promptStyles.manage")}
                </button>
              </div>
              <div className="settings-row settings-prompt-styles-entry">
                <div>
                  <strong>{t("settings.personalization.colorSchemes.title")}</strong>
                  <span>
                    {t("settings.personalization.colorSchemes.desc", { categoryCount: visibleColorSchemeCategoryCount, schemeCount: visibleColorSchemeCount })}
                  </span>
                </div>
                <button className="secondary-btn" type="button" onClick={() => setPromptColorSchemeSettingsOpen(true)}>
                  <Palette size={15} />
                  {t("settings.personalization.colorSchemes.manage")}
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
                    <strong>{t("settings.account.account")}</strong>
                    <span>{user.account}</span>
                  </div>
                </div>
                <button className="secondary-btn" type="button" onClick={onEditProfile}>
                  <Pencil size={15} />
                  {t("settings.account.editProfile")}
                </button>
              </div>
              <div className="settings-row">
                <div>
                  <strong>{t("settings.account.username")}</strong>
                  <span>{user.username}</span>
                </div>
              </div>
              <div className="settings-row">
                <div>
                  <strong>{t("settings.account.password")}</strong>
                  <span>{t("settings.account.passwordDesc")}</span>
                </div>
                <button className="secondary-btn" type="button" onClick={onChangePassword}>
                  <KeyRound size={15} />
                  {t("settings.account.changePassword")}
                </button>
              </div>
              <div className="settings-row">
                <div>
                  <strong>{t("settings.account.email")}</strong>
                  <span>{user.email || t("settings.account.emailEmpty")}</span>
                </div>
              </div>
              <div className="settings-row">
                <div>
                  <strong>{t("settings.account.team")}</strong>
                  <span>{user.teamName || user.teamId || t("settings.account.defaultTeam")}</span>
                </div>
              </div>
              <div className="settings-row danger">
                <div>
                  <strong>{t("settings.account.delete")}</strong>
                  <span>{t("settings.account.deleteDesc")}</span>
                </div>
                <button className="danger-outline-btn" type="button" onClick={onDeleteAccount} disabled={deleteAccountPending}>
                  <Trash2 size={15} />
                  {deleteAccountPending ? t("common.deleting") : t("settings.account.delete")}
                </button>
              </div>
            </div>
          ) : activeSection === "data" ? (
            <div className="settings-list">
              <div className="settings-row">
                <div>
                  <strong>{t("settings.data.sharedLinks")}</strong>
                  <span>{sharedLinkCount.data?.pageInfo.total ?? 0}</span>
                </div>
                <button className="secondary-btn" type="button" onClick={() => setSharedLinksOpen(true)}>
                  <Link2 size={15} />
                  {t("common.manage")}
                </button>
              </div>
              <div className="settings-row">
                <div>
                  <strong>{t("settings.data.archivedChats")}</strong>
                  <span>{archivedSessionCount}</span>
                </div>
                <button className="secondary-btn" type="button" onClick={onOpenArchivedChats}>
                  <Archive size={15} />
                  {t("common.manage")}
                </button>
              </div>
              <div className="settings-row">
                <div>
                  <strong>{t("settings.data.archiveAll")}</strong>
                  <span>{activeSessionCount}</span>
                </div>
                <button
                  className="secondary-btn"
                  type="button"
                  onClick={onArchiveAllChats}
                  disabled={archiveAllPending || activeSessionCount === 0}
                >
                  <Archive size={15} />
                  {archiveAllPending ? t("settings.data.archiving") : t("settings.data.archiveAllAction")}
                </button>
              </div>
              <div className="settings-row danger">
                <div>
                  <strong>{t("settings.data.deleteAll")}</strong>
                  <span>{activeSessionCount + archivedSessionCount}</span>
                </div>
                <button
                  className="danger-outline-btn"
                  type="button"
                  onClick={onDeleteAllChats}
                  disabled={deleteAllPending || activeSessionCount + archivedSessionCount === 0}
                >
                  <Trash2 size={15} />
                  {t("settings.data.deleteAllAction")}
                </button>
              </div>
            </div>
          ) : (
            <div className="settings-about">
              <div className="settings-list settings-about-list">
                <div className="settings-row settings-about-version-row">
                  <div>
                    <strong>{t("settings.about.currentVersion")}</strong>
                    <span>{latestVersion || "-"}</span>
                  </div>
                  {showGithubEntry ? (
                    <a className="secondary-btn" href={PROJECT_REPOSITORY_URL} target="_blank" rel="noreferrer">
                      <Github size={15} />
                      GitHub
                    </a>
                  ) : null}
                </div>
              </div>
              <div className="settings-changelog">
                <div className="settings-changelog-head">
                  <h3 className="settings-section-title">{t("settings.about.changelog")}</h3>
                  <div className="settings-changelog-search">
                    <Search size={16} aria-hidden="true" />
                    <input
                      value={changelogSearchInput}
                      onChange={(event) => setChangelogSearchInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") resetChangelogSearch();
                      }}
                      placeholder={t("settings.about.changelogSearchPlaceholder")}
                      aria-label={t("settings.about.changelogSearchAria")}
                    />
                    <button
                      type="button"
                      className={cx("settings-changelog-search-clear", changelogSearchInput && "is-visible")}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={resetChangelogSearch}
                      aria-label={t("common.clear")}
                      title={t("common.clear")}
                      tabIndex={changelogSearchInput ? 0 : -1}
                      aria-hidden={!changelogSearchInput}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
                {changelogLoading ? <div className="settings-empty">{t("settings.about.changelogLoading")}</div> : null}
                {changelog.error ? <div className="form-error">{changelog.error.message}</div> : null}
                {!changelogLoading && visibleChangelogEntries.length === 0 ? <div className="settings-empty">{hasChangelogSearch ? t("settings.about.changelogSearchEmpty") : t("settings.about.changelogEmpty")}</div> : null}
                {visibleChangelogEntries.map((entry) => (
                  <article className="settings-changelog-entry" key={entry.id}>
                    <header>
                      <strong>{entry.version}</strong>
                      <time>{entry.date || "-"}</time>
                    </header>
                    <MarkdownView markdown={entry.content} />
                  </article>
                ))}
                {!changelogSearchPending && changelog.hasNextPage ? <div className="settings-changelog-load-sentinel" ref={changelogLoadMoreRef} aria-hidden="true" /> : null}
                {changelog.isFetchingNextPage ? <div className="settings-changelog-load-state">{t("settings.about.changelogLoading")}</div> : null}
              </div>
            </div>
            )}
          </div>
        </div>
      </section>
      <PromptOptimizeStyleSettingsDialog
        open={promptStyleSettingsOpen}
        groups={preferences.promptOptimizeStyleGroups}
        saving={preferencesSaving}
        onClose={() => setPromptStyleSettingsOpen(false)}
        onSave={(nextGroups) => {
          onPreferencesChange({ promptOptimizeStyleGroups: nextGroups });
        }}
      />
      <PromptColorSchemeSettingsDialog
        open={promptColorSchemeSettingsOpen}
        onClose={() => setPromptColorSchemeSettingsOpen(false)}
      />
      <SharedLinksDialog
        open={sharedLinksOpen}
        onClose={() => setSharedLinksOpen(false)}
        onCloseSettings={onClose}
      />
    </div>
  );
}
