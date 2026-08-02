import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, BellRing, Cable, Check, Copy, Database, Github, KeyRound, Leaf, Link2, Monitor, Moon, Palette, Pencil, ScrollText, Search, Settings, Smile, Sun, Sunset, Trash2, UserRound, Volume1, Volume2, VolumeOff, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api, type ExternalMcpConnection } from "../../api";
import {
  languagePreferenceOptions,
  normalizeLanguagePreference,
  useI18n,
  type LanguagePreference
} from "../../i18n";
import { cx } from "../../lib/cx";
import { copyTextToClipboard } from "../../lib/clipboard";
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
  imageTaskBrowserNotificationPermissionToastKey,
  imageTaskBrowserNotificationSettingState,
  requestImageTaskBrowserNotificationPermission,
  type BrowserNotificationPermissionResult
} from "../../lib/imageTaskBrowserNotifications";
import type { EditSuggestionTone, ImagePreviewOpenMode, ImagePreviewWheelMode, ImageTaskSound, User, UserPreferences } from "../../types";
import { ConfirmDialog, CustomSelect, useToast } from "../../ui";
import { MarkdownView } from "../MarkdownView";
import { PromptColorSchemeSettingsDialog } from "../PromptColorSchemeSettingsDialog";
import { PromptOptimizeStyleSettingsDialog } from "../PromptOptimizeStyleSettingsDialog";
import { ImageTaskSoundSelect } from "./ImageTaskSoundSelect";
import { SharedLinksDialog } from "./SharedLinksDialog";

type SettingsSectionId = "general" | "sound" | "personalization" | "account" | "plugins" | "data" | "about";
type SettingsSectionDirection = "forward" | "backward";
type PluginConnectionAction = { kind: "revoke" | "restore" | "remove"; connection: ExternalMcpConnection } | null;

const PROJECT_REPOSITORY_URL = "https://github.com/Xiongdaxz/shenbi-maliang-gpt-image-workbench";
const CHANGELOG_PAGE_SIZE = 5;

const settingsSections: Array<{ id: SettingsSectionId; labelKey: string; icon: LucideIcon }> = [
  { id: "general", labelKey: "settings.nav.general", icon: Settings },
  { id: "sound", labelKey: "settings.nav.soundMenu", icon: BellRing },
  { id: "personalization", labelKey: "settings.nav.personalization", icon: Smile },
  { id: "account", labelKey: "settings.nav.account", icon: UserRound },
  { id: "plugins", labelKey: "settings.nav.plugins", icon: Cable },
  { id: "data", labelKey: "settings.nav.data", icon: Database },
  { id: "about", labelKey: "settings.nav.about", icon: Github }
];

const settingsSectionTitleKeys: Record<SettingsSectionId, string> = {
  general: "settings.nav.general",
  sound: "settings.nav.sound",
  personalization: "settings.nav.personalization",
  account: "settings.nav.account",
  plugins: "settings.nav.plugins",
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

function formatPluginConnectionTime(value: string, locale: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function pluginConnectionDisplayName(connection: ExternalMcpConnection) {
  return connection.userLabel.trim() || connection.deviceName.trim() || connection.clientName;
}

function pluginConnectionDeviceSummary(connection: ExternalMcpConnection, unavailableLabel: string) {
  return [
    connection.deviceName.trim() || unavailableLabel,
    connection.clientName,
    connection.deviceType.trim() || unavailableLabel
  ].join(" · ");
}

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
  const [pluginConnectionAction, setPluginConnectionAction] = useState<PluginConnectionAction>(null);
  const [pluginConnectionDetails, setPluginConnectionDetails] = useState<ExternalMcpConnection | null>(null);
  const [pluginConnectionLabelDraft, setPluginConnectionLabelDraft] = useState("");
  const [pluginConnectionLabelEditing, setPluginConnectionLabelEditing] = useState(false);
  const [pluginInstallCopied, setPluginInstallCopied] = useState(false);
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
  const pluginInstallCopiedTimerRef = useRef<number | null>(null);
  const [changelogSearchInput, setChangelogSearchInput] = useState("");
  const [changelogSearchKeyword, setChangelogSearchKeyword] = useState("");
  const [latestChangelogVersion, setLatestChangelogVersion] = useState("");
  const settingsContentRef = useRef<HTMLDivElement | null>(null);
  const { mode: appearanceMode, setMode: setAppearanceMode } = useAppearanceMode();
  const { showToast } = useToast();
  const { language, resolvedLanguage, setLanguage, t } = useI18n();
  const queryClient = useQueryClient();
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
  const pluginConnections = useQuery({
    queryKey: ["external-mcp-connections"],
    queryFn: api.externalMcpConnections,
    enabled: open && activeSection === "plugins"
  });
  const aiClientInstallBaseUrl = window.location.origin.replace(/\/+$/, "");
  const pluginInstallLinks = useQuery({
    queryKey: ["ai-client-install-links", aiClientInstallBaseUrl],
    queryFn: api.aiClientInstallLinks,
    enabled: open && activeSection === "plugins",
    staleTime: 60_000
  });
  const pluginInstallOption = pluginInstallLinks.data?.install ?? null;
  const copyPluginInstallInstruction = async () => {
    if (!pluginInstallOption) {
      showToast(t("aiClientInstall.addressUnavailable"), "error");
      return;
    }
    const copied = await copyTextToClipboard(pluginInstallOption.instruction);
    if (!copied) {
      showToast(t("aiClientInstall.copyFailed"), "error");
      return;
    }
    if (pluginInstallCopiedTimerRef.current) window.clearTimeout(pluginInstallCopiedTimerRef.current);
    setPluginInstallCopied(true);
    showToast(t("aiClientInstall.copySuccess"), "success");
    pluginInstallCopiedTimerRef.current = window.setTimeout(() => setPluginInstallCopied(false), 1800);
  };
  useEffect(() => () => {
    if (pluginInstallCopiedTimerRef.current) window.clearTimeout(pluginInstallCopiedTimerRef.current);
  }, []);
  const revokePluginConnection = useMutation({
    mutationFn: (connection: ExternalMcpConnection) => api.revokeExternalMcpConnection(connection.deviceId),
    onSuccess: async () => {
      setPluginConnectionAction(null);
      await queryClient.invalidateQueries({ queryKey: ["external-mcp-connections"] });
      showToast(t("settings.plugins.revoked"));
    },
    onError: (error) => showToast(error instanceof Error ? error.message : t("settings.plugins.revokeFailed"), "error")
  });
  const restorePluginConnection = useMutation({
    mutationFn: (connection: ExternalMcpConnection) => api.restoreExternalMcpConnection(connection.deviceId),
    onSuccess: async () => {
      setPluginConnectionAction(null);
      await queryClient.invalidateQueries({ queryKey: ["external-mcp-connections"] });
      showToast(t("settings.plugins.restored"));
    },
    onError: (error) => showToast(error instanceof Error ? error.message : t("settings.plugins.restoreFailed"), "error")
  });
  const removePluginConnection = useMutation({
    mutationFn: (connection: ExternalMcpConnection) => api.removeExternalMcpConnection(connection.deviceId),
    onSuccess: async () => {
      setPluginConnectionAction(null);
      await queryClient.invalidateQueries({ queryKey: ["external-mcp-connections"] });
      showToast(t("settings.plugins.removed"));
    },
    onError: (error) => showToast(error instanceof Error ? error.message : t("settings.plugins.removeFailed"), "error")
  });
  const updatePluginConnection = useMutation({
    mutationFn: ({ connection, userLabel }: { connection: ExternalMcpConnection; userLabel: string }) => (
      api.updateExternalMcpConnection(connection.deviceId, userLabel)
    ),
    onSuccess: async ({ userLabel }) => {
      setPluginConnectionDetails((connection) => connection ? { ...connection, userLabel } : null);
      setPluginConnectionLabelDraft(userLabel);
      setPluginConnectionLabelEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["external-mcp-connections"] });
      showToast(t("settings.plugins.detailsSaved"));
    },
    onError: (error) => showToast(error instanceof Error ? error.message : t("settings.plugins.detailsSaveFailed"), "error")
  });
  const commitPluginConnectionLabel = () => {
    if (!pluginConnectionDetails || updatePluginConnection.isPending) return;
    const draftLabel = pluginConnectionLabelDraft.trim();
    const userLabel = draftLabel === pluginConnectionDetails.deviceName.trim() ? "" : draftLabel;
    if (userLabel === pluginConnectionDetails.userLabel) {
      setPluginConnectionLabelDraft(pluginConnectionDisplayName(pluginConnectionDetails));
      setPluginConnectionLabelEditing(false);
      return;
    }
    updatePluginConnection.mutate({ connection: pluginConnectionDetails, userLabel });
  };
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
      setPluginConnectionAction(null);
      setPluginConnectionDetails(null);
      setPluginConnectionLabelDraft("");
      setPluginConnectionLabelEditing(false);
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
      } else {
        const toastKey = imageTaskBrowserNotificationPermissionToastKey(permission);
        if (toastKey) showToast(t(toastKey), "error");
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
  const mostRecentPluginConnectionDeviceId = (pluginConnections.data?.connections ?? []).reduce<{
    deviceId: string;
    lastAccessTime: number;
  } | null>((latest, connection) => {
    const lastAccessTime = new Date(connection.lastAccessAt).getTime();
    if (!Number.isFinite(lastAccessTime) || (latest && latest.lastAccessTime >= lastAccessTime)) return latest;
    return { deviceId: connection.deviceId, lastAccessTime };
  }, null)?.deviceId ?? "";
  const detailConnectionName = pluginConnectionDetails ? pluginConnectionDisplayName(pluginConnectionDetails) : "";
  const detailAuthorizedAt = formatPluginConnectionTime(pluginConnectionDetails?.createdAt ?? "", resolvedLanguage);
  const detailLastAccessAt = formatPluginConnectionTime(pluginConnectionDetails?.lastAccessAt ?? "", resolvedLanguage)
    || t("settings.plugins.neverAccessed");
  const detailRevokedAt = formatPluginConnectionTime(pluginConnectionDetails?.revokedAt ?? "", resolvedLanguage);
  const detailAccessExpiresAt = formatPluginConnectionTime(pluginConnectionDetails?.accessExpiresAt ?? "", resolvedLanguage);
  const detailRefreshExpiresAt = formatPluginConnectionTime(pluginConnectionDetails?.refreshExpiresAt ?? "", resolvedLanguage);
  const detailLastRefreshAt = formatPluginConnectionTime(pluginConnectionDetails?.lastRefreshAt ?? "", resolvedLanguage);
  const detailLastRefreshErrorAt = formatPluginConnectionTime(pluginConnectionDetails?.lastRefreshErrorAt ?? "", resolvedLanguage);
  const detailRefreshCapability = pluginConnectionDetails
    ? t(`settings.plugins.refreshCapability.${pluginConnectionDetails.refreshCapability}`)
    : "";

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
          ) : activeSection === "plugins" ? (
            <div className="settings-plugins">
              <p className="settings-plugins-intro">{t("settings.plugins.description")}</p>
              {pluginConnections.isLoading ? (
                <div className="settings-plugin-state">{t("settings.plugins.loading")}</div>
              ) : null}
              {pluginConnections.isError ? (
                <div className="settings-plugin-state is-error">
                  <span>{t("settings.plugins.loadFailed")}</span>
                  <button className="secondary-btn" type="button" onClick={() => void pluginConnections.refetch()}>
                    {t("settings.plugins.retry")}
                  </button>
                </div>
              ) : null}
              {!pluginConnections.isLoading && !pluginConnections.isError && (pluginConnections.data?.connections.length ?? 0) === 0 ? (
                <div className="settings-plugin-empty">
                  <div className="settings-plugin-empty-heading">
                    <span className="settings-plugin-empty-icon" aria-hidden="true"><Cable size={22} /></span>
                    <strong>{t("settings.plugins.emptyTitle")}</strong>
                    <p>{t("settings.plugins.emptyDesc")}</p>
                  </div>
                  {pluginInstallLinks.isError ? (
                    <div className="settings-plugin-install-error">
                      <span>{t("aiClientInstall.addressUnavailable")}</span>
                      <button className="secondary-btn" type="button" disabled={pluginInstallLinks.isFetching} onClick={() => void pluginInstallLinks.refetch()}>
                        {pluginInstallLinks.isFetching ? t("common.loading") : t("aiClientInstall.retry")}
                      </button>
                    </div>
                  ) : pluginInstallLinks.isLoading || !pluginInstallOption ? (
                    <p>{t("aiClientInstall.loadingAddress")}</p>
                  ) : (
                    <div className="settings-plugin-install-entry">
                      <button
                        className="settings-plugin-install-command"
                        type="button"
                        title={pluginInstallOption.instruction}
                        onClick={() => void copyPluginInstallInstruction()}
                      >
                        <span className="settings-plugin-install-copy">
                          <small>{t("settings.plugins.installInstruction")}</small>
                          <span>{pluginInstallOption.instruction}</span>
                        </span>
                        <span className="settings-plugin-install-copy-action">
                          {pluginInstallCopied ? <Check size={15} /> : <Copy size={15} />}
                          {pluginInstallCopied ? t("aiClientInstall.copied") : t("aiClientInstall.copyForAi")}
                        </span>
                      </button>
                    </div>
                  )}
                </div>
              ) : null}
              <div className="settings-plugin-list">
                {pluginConnections.data?.connections.map((connection) => {
                  const confirmActionPending = (
                    revokePluginConnection.isPending || restorePluginConnection.isPending || removePluginConnection.isPending
                  ) && pluginConnectionAction?.connection.deviceId === connection.deviceId;
                  const actionPending = confirmActionPending;
                  const lastAccessLabel = formatPluginConnectionTime(connection.lastAccessAt, resolvedLanguage)
                    || t("settings.plugins.neverAccessed");
                  const isMostRecentConnection = connection.deviceId === mostRecentPluginConnectionDeviceId;
                  return (
                    <article className={cx("settings-plugin-row", !connection.active && "is-inactive")} key={connection.deviceId}>
                      <span className="settings-plugin-app-icon" aria-hidden="true"><Monitor size={20} /></span>
                      <div className="settings-plugin-app">
                        <button
                          className="settings-plugin-name-btn"
                          type="button"
                          title={pluginConnectionDeviceSummary(connection, t("settings.plugins.clientNotReported"))}
                          onClick={() => {
                            setPluginConnectionDetails(connection);
                            setPluginConnectionLabelDraft(pluginConnectionDisplayName(connection));
                            setPluginConnectionLabelEditing(false);
                          }}
                        >
                          {pluginConnectionDisplayName(connection)}
                        </button>
                        <span className="settings-plugin-client-name">{connection.clientName}</span>
                      </div>
                      <span className="settings-plugin-access" title={`${t("settings.plugins.lastAccess")}：${lastAccessLabel}`}>
                        {t("settings.plugins.lastAccess")} {lastAccessLabel}
                      </span>
                      <div className="settings-plugin-statuses">
                        {isMostRecentConnection ? <span className="settings-plugin-context-tag">{t("settings.plugins.recent")}</span> : null}
                        {connection.isLocalDevice ? <span className="settings-plugin-context-tag">{t("settings.plugins.localDevice")}</span> : null}
                      </div>
                      <div className="settings-plugin-actions">
                        <button
                          className="secondary-btn settings-plugin-action-btn"
                          type="button"
                          disabled={actionPending}
                          onClick={() => setPluginConnectionAction({ kind: connection.active ? "revoke" : "restore", connection })}
                        >
                          {connection.active
                            ? (actionPending && pluginConnectionAction?.kind === "revoke"
                              ? t("settings.plugins.revoking")
                              : t("settings.plugins.revoke"))
                            : (actionPending && pluginConnectionAction?.kind === "restore"
                              ? t("settings.plugins.restoring")
                              : t("settings.plugins.restore"))}
                        </button>
                        <button
                          className="secondary-btn settings-plugin-action-btn"
                          type="button"
                          disabled={actionPending}
                          onClick={() => setPluginConnectionAction({ kind: "remove", connection })}
                        >
                          {actionPending && pluginConnectionAction?.kind === "remove"
                            ? t("settings.plugins.removing")
                            : t("settings.plugins.remove")}
                        </button>
                      </div>
                    </article>
                  );
                })}
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
      <ConfirmDialog
        open={Boolean(pluginConnectionDetails)}
        title={t("settings.plugins.detailsTitle")}
        description={pluginConnectionDetails ? (
          <div className="plugin-connection-details">
            <div className="plugin-connection-details-summary">
              <span className="settings-plugin-app-icon" aria-hidden="true"><Monitor size={17} /></span>
              <div>
                <div className="plugin-connection-details-name">
                  {pluginConnectionLabelEditing ? (
                    <input
                      autoFocus
                      aria-label={t("settings.plugins.editConnectionLabel")}
                      value={pluginConnectionLabelDraft}
                      maxLength={80}
                      disabled={updatePluginConnection.isPending}
                      onChange={(event) => setPluginConnectionLabelDraft(event.target.value)}
                      onBlur={commitPluginConnectionLabel}
                    />
                  ) : (
                    <>
                      <strong>{detailConnectionName}</strong>
                      <button
                        type="button"
                        aria-label={t("settings.plugins.editConnectionLabel")}
                        title={t("settings.plugins.editConnectionLabel")}
                        onClick={() => {
                          setPluginConnectionLabelDraft(detailConnectionName);
                          setPluginConnectionLabelEditing(true);
                        }}
                      >
                        <Pencil size={13} />
                      </button>
                    </>
                  )}
                </div>
                <span>{pluginConnectionDeviceSummary(pluginConnectionDetails, t("settings.plugins.clientNotReported"))}</span>
              </div>
              <span className="settings-plugin-statuses">
                {pluginConnectionDetails.deviceId === mostRecentPluginConnectionDeviceId ? (
                  <span className="settings-plugin-context-tag">{t("settings.plugins.recent")}</span>
                ) : null}
                {pluginConnectionDetails.isLocalDevice ? (
                  <span className="settings-plugin-context-tag">{t("settings.plugins.localDevice")}</span>
                ) : null}
              </span>
            </div>
            <div className="plugin-connection-detail-grid">
              <div>
                <span>{t("settings.plugins.lastAccessIp")}</span>
                <strong>{pluginConnectionDetails.lastAccessIp || "-"}</strong>
                {pluginConnectionDetails.lastAccessRegion ? <small>{pluginConnectionDetails.lastAccessRegion}</small> : null}
              </div>
              <div><span>{t("settings.plugins.authorizedAt")}</span><strong>{detailAuthorizedAt || "-"}</strong></div>
              <div><span>{t("settings.plugins.lastAccess")}</span><strong>{detailLastAccessAt}</strong></div>
              <div><span>{t("settings.plugins.refreshCapability")}</span><strong>{detailRefreshCapability}</strong></div>
              <div><span>{t("settings.plugins.accessExpiresAt")}</span><strong>{detailAccessExpiresAt || "-"}</strong></div>
              <div><span>{t("settings.plugins.refreshExpiresAt")}</span><strong>{detailRefreshExpiresAt || "-"}</strong></div>
              <div><span>{t("settings.plugins.lastRefreshAt")}</span><strong>{detailLastRefreshAt || t("settings.plugins.notRefreshed")}</strong></div>
              {pluginConnectionDetails.lastRefreshError ? (
                <div className="plugin-connection-detail-wide">
                  <span>{t("settings.plugins.lastRefreshError")}</span>
                  <strong>{pluginConnectionDetails.lastRefreshError}</strong>
                  {detailLastRefreshErrorAt ? <small>{detailLastRefreshErrorAt}</small> : null}
                </div>
              ) : null}
              {detailRevokedAt ? <div><span>{t("settings.plugins.revokedAt")}</span><strong>{detailRevokedAt}</strong></div> : null}
            </div>
          </div>
        ) : ""}
        confirmText={updatePluginConnection.isPending ? t("settings.plugins.detailsSaving") : t("common.save")}
        cancelText={t("common.cancel")}
        backdropClassName="modal-backdrop-top"
        className="plugin-connection-detail-dialog"
        onConfirm={() => {
          if (!pluginConnectionDetails || updatePluginConnection.isPending) return;
          const draftLabel = pluginConnectionLabelDraft.trim();
          const userLabel = draftLabel === pluginConnectionDetails.deviceName.trim() ? "" : draftLabel;
          if (userLabel === pluginConnectionDetails.userLabel) {
            setPluginConnectionDetails(null);
            return;
          }
          updatePluginConnection.mutate({ connection: pluginConnectionDetails, userLabel });
        }}
        onCancel={() => {
          if (updatePluginConnection.isPending) return;
          setPluginConnectionDetails(null);
          setPluginConnectionLabelDraft("");
          setPluginConnectionLabelEditing(false);
        }}
      />
      <ConfirmDialog
        open={Boolean(pluginConnectionAction)}
        title={t(pluginConnectionAction?.kind === "remove"
          ? "settings.plugins.removeTitle"
          : pluginConnectionAction?.kind === "restore"
            ? "settings.plugins.restoreTitle"
            : "settings.plugins.revokeTitle")}
        description={t(
          pluginConnectionAction?.kind === "remove"
            ? "settings.plugins.removeDescription"
            : pluginConnectionAction?.kind === "restore"
              ? "settings.plugins.restoreDescription"
              : "settings.plugins.revokeDescription",
          { name: pluginConnectionAction?.connection.clientName ?? "" }
        )}
        confirmText={pluginConnectionAction?.kind === "remove"
          ? (removePluginConnection.isPending ? t("settings.plugins.removing") : t("settings.plugins.remove"))
          : pluginConnectionAction?.kind === "restore"
            ? (restorePluginConnection.isPending ? t("settings.plugins.restoring") : t("settings.plugins.restore"))
            : (revokePluginConnection.isPending ? t("settings.plugins.revoking") : t("settings.plugins.revoke"))}
        cancelText={t("common.cancel")}
        destructive={pluginConnectionAction?.kind !== "restore"}
        backdropClassName="modal-backdrop-top"
        onConfirm={() => {
          if (
            !pluginConnectionAction
            || revokePluginConnection.isPending
            || restorePluginConnection.isPending
            || removePluginConnection.isPending
          ) return;
          if (pluginConnectionAction.kind === "remove") {
            removePluginConnection.mutate(pluginConnectionAction.connection);
          } else if (pluginConnectionAction.kind === "restore") {
            restorePluginConnection.mutate(pluginConnectionAction.connection);
          } else {
            revokePluginConnection.mutate(pluginConnectionAction.connection);
          }
        }}
        onCancel={() => {
          if (
            !revokePluginConnection.isPending
            && !restorePluginConnection.isPending
            && !removePluginConnection.isPending
          ) setPluginConnectionAction(null);
        }}
      />
    </div>
  );
}
