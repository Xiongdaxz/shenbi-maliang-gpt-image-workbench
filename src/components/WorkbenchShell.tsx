import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FocusEvent, FormEvent, MouseEvent, ReactNode } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { Camera, ChevronRight, FolderOpen, Images, Lightbulb, LogOut, Menu, MessageCircle, MessageCirclePlus, PanelLeft, Pin, PinOff, RotateCcw, Search, Settings, ShieldCheck, Sparkles, X } from "lucide-react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { languagePreferenceLabel, useI18n, type LocaleCode, type Translate } from "../i18n";
import type { AppearanceMode } from "../lib/appearance";
import { cx } from "../lib/cx";
import { pauseRenderingMotion } from "../lib/renderingMotion";
import { AssetsPage } from "../pages/AssetsPage";
import { CasesPage } from "../pages/CasesPage";
import { ChatPage } from "../pages/ChatPage";
import { ImagesPage } from "../pages/ImagesPage";
import { InspirationBarragePage } from "../pages/InspirationBarragePage";
import { PromptTemplateEditorPage, PromptTemplatesPage } from "../pages/PromptTemplatesPage";
import { useWorkbench } from "../store/workbench";
import type { ChatSession, ImageJob, User, UserPreferences } from "../types";
import { ConfirmDialog, useToast } from "../ui";
import { useInfinitePageLoader } from "../hooks/useInfinitePageLoader";
import { useImageJobEvents, type ImageJobEventPayload } from "../hooks/useImageJobEvents";
import { ProjectLogo } from "./ProjectLogo";
import { SearchChatModal } from "./SearchChatModal";
import { ArchivedChatsDialog } from "./settings/ArchivedChatsDialog";
import { AppSettingsDialog } from "./settings/AppSettingsDialog";
import { SessionActionsMenu } from "./sidebar/SessionActionsMenu";

type DeleteSessionTarget = {
  id: string;
  title: string;
  source: "active" | "archived";
};

const SIDEBAR_SESSION_PAGE_SIZE = 30;
const COLLAPSED_RECENT_CHAT_LIMIT = 10;
const COLLAPSED_RECENT_CARD_ESTIMATED_HEIGHT = 442;
const COLLAPSED_RECENT_VIEWPORT_PADDING = 14;
const USER_CARD_CLOSE_ANIMATION_MS = 240;
const SIDEBAR_TITLE_CHAR_DELAY_MS = 34;
const SIDEBAR_CONTENT_FADE_MS = 110;
const SIDEBAR_WIDTH_ANIMATION_MS = 200;
const SESSION_GROUP_COLLAPSE_STORAGE_KEY = "gpt-image.sidebar.session-groups.collapsed";
const IMAGE_EDIT_SUGGESTIONS_STALE_MS = 5 * 60 * 1000;
type SidebarMotionState = "expanded" | "collapsing" | "collapsed" | "expanding";
type SessionGroupKey = "pinned" | "recent";
type SessionGroupCollapseState = Record<SessionGroupKey, boolean>;
type SidebarFloatingTip = {
  label: string;
  shortcut?: string;
  left: number;
  top: number;
};
type SessionPage = Awaited<ReturnType<typeof api.sessions>>;
type ActiveSessionPages = InfiniteData<SessionPage, number>;

function PageRouteTransition({ children }: { children: ReactNode }) {
  return <div className="page-route-transition">{children}</div>;
}

function readSessionGroupCollapseState(): SessionGroupCollapseState {
  if (typeof window === "undefined") return { pinned: false, recent: false };
  try {
    const raw = window.localStorage.getItem(SESSION_GROUP_COLLAPSE_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      pinned: Boolean(parsed?.pinned),
      recent: Boolean(parsed?.recent)
    };
  } catch {
    return { pinned: false, recent: false };
  }
}

function writeSessionGroupCollapseState(state: SessionGroupCollapseState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SESSION_GROUP_COLLAPSE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Keep the in-memory state when browser storage is unavailable.
  }
}

function compareActiveSessions(left: ChatSession, right: ChatSession) {
  const leftPinnedAt = left.pinnedAt ?? "";
  const rightPinnedAt = right.pinnedAt ?? "";
  if (leftPinnedAt && rightPinnedAt && leftPinnedAt !== rightPinnedAt) return leftPinnedAt.localeCompare(rightPinnedAt);
  if (leftPinnedAt && !rightPinnedAt) return -1;
  if (!leftPinnedAt && rightPinnedAt) return 1;
  return right.updatedAt.localeCompare(left.updatedAt);
}

function validateProfileUsername(value: string, t: Translate) {
  const username = value.trim();
  if (!username) return t("profile.usernameRequired");
  if (value !== username) return t("profile.usernameRule");
  if (/ {2,}/.test(username)) return t("profile.usernameRule");
  if (/[^\S ]/.test(username)) return t("profile.usernameRule");
  if (!/^[\u4e00-\u9fffA-Za-z0-9_ -]+$/.test(username)) return t("profile.usernameRule");
  if (!/[\u4e00-\u9fffA-Za-z]/.test(username)) return t("profile.usernameNeedsLetter");
  const length = Array.from(username).length;
  return length >= 2 && length <= 20 ? "" : t("profile.usernameRule");
}

function userPreferencesToast(preferences: Partial<UserPreferences>, t: Translate, resolvedLanguage: LocaleCode) {
  if (preferences.language) {
    return t("settings.language.toast", { language: languagePreferenceLabel(preferences.language, t, resolvedLanguage) });
  }
  if (preferences.promptOptimizeStyleGroups) {
    return t("toast.promptStylesSaved");
  }
  if (typeof preferences.editSuggestionsEnabled === "boolean") {
    return preferences.editSuggestionsEnabled ? t("toast.editSuggestionsOn") : t("toast.editSuggestionsOff");
  }
  if (typeof preferences.autoUploadPastedAssets === "boolean") {
    return preferences.autoUploadPastedAssets ? t("toast.autoUploadOn") : t("toast.autoUploadOff");
  }
  if (preferences.editSuggestionTone) {
    const labelKeys: Record<UserPreferences["editSuggestionTone"], string> = {
      default: "settings.personalization.tone.default",
      practical: "settings.personalization.tone.practical",
      creative: "settings.personalization.tone.creative",
      detail: "settings.personalization.tone.detail"
    };
    return t("toast.suggestionToneChanged", { tone: t(labelKeys[preferences.editSuggestionTone] ?? "settings.personalization.tone.default") });
  }
  return t("toast.preferencesSaved");
}

function sidebarSessionTitle(title: string, fallback: string) {
  const normalized = title.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

let sidebarTitleMeasureCanvas: HTMLCanvasElement | null = null;

function measuredTextWidth(text: string, font: string) {
  if (typeof document === "undefined") return text.length * 14;
  sidebarTitleMeasureCanvas ??= document.createElement("canvas");
  const context = sidebarTitleMeasureCanvas.getContext("2d");
  if (!context) return text.length * 14;
  context.font = font;
  return context.measureText(text).width;
}

function truncateTextToWidth(text: string, maxWidth: number, font: string, ellipsisWhenTruncated: boolean) {
  if (maxWidth <= 0 || measuredTextWidth(text, font) <= maxWidth) return text;
  const chars = Array.from(text);
  const suffix = ellipsisWhenTruncated ? "..." : "";
  const suffixWidth = suffix ? measuredTextWidth(suffix, font) : 0;
  const availableWidth = Math.max(0, maxWidth - suffixWidth);
  let low = 0;
  let high = chars.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = chars.slice(0, mid).join("").trimEnd();
    if (measuredTextWidth(candidate, font) <= availableWidth) low = mid;
    else high = mid - 1;
  }
  const clipped = chars.slice(0, low).join("").trimEnd();
  if (!suffix || !clipped) return clipped;
  return `${clipped}${suffix}`;
}

function SidebarSessionTitle({
  title,
  titleStatus = "ready",
  className,
  ellipsisWhenTruncated = false,
  fallbackTitle,
  pendingTitle
}: {
  title: string;
  titleStatus?: ChatSession["titleStatus"];
  className: string;
  ellipsisWhenTruncated?: boolean;
  fallbackTitle: string;
  pendingTitle: string;
}) {
  const titlePending = titleStatus === "pending";
  const normalizedTitle = sidebarSessionTitle(title, fallbackTitle);
  const titleRef = useRef<HTMLSpanElement | null>(null);
  const [displayTitle, setDisplayTitle] = useState("");
  const [animateTitle, setAnimateTitle] = useState(false);
  const previousPendingRef = useRef(titlePending);

  const measuredDisplayTitle = useCallback(() => {
    const element = titleRef.current;
    if (!element) return normalizedTitle;
    const width = Math.max(0, Math.floor(element.clientWidth) - 1);
    const font = window.getComputedStyle(element).font;
    return truncateTextToWidth(normalizedTitle, width, font, ellipsisWhenTruncated);
  }, [ellipsisWhenTruncated, normalizedTitle]);

  useLayoutEffect(() => {
    if (titlePending) {
      previousPendingRef.current = true;
      setAnimateTitle(false);
      setDisplayTitle("");
      return undefined;
    }

    const nextTitle = measuredDisplayTitle();
    const shouldAnimate = previousPendingRef.current && nextTitle.trim().length > 0 && titleStatus === "ready";
    previousPendingRef.current = false;
    setAnimateTitle(shouldAnimate);
    setDisplayTitle(nextTitle);

    const element = titleRef.current;
    if (!element) return undefined;
    const updateDisplayTitle = () => {
      const measuredTitle = measuredDisplayTitle();
      setDisplayTitle((current) => (current === measuredTitle ? current : measuredTitle));
    };
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateDisplayTitle);
      return () => window.removeEventListener("resize", updateDisplayTitle);
    }
    const resizeObserver = new ResizeObserver(updateDisplayTitle);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [measuredDisplayTitle, titlePending, titleStatus]);

  const displayChars = useMemo(() => Array.from(displayTitle), [displayTitle]);

  return (
    <span
      className={cx(className, titlePending && "session-title-skeleton", animateTitle && "session-title-char-in")}
      ref={titleRef}
      aria-label={titlePending ? pendingTitle : normalizedTitle}
    >
      {titlePending ? (
        <span aria-hidden="true" />
      ) : animateTitle ? (
        displayChars.map((char, index) => (
          <span key={`${char}-${index}`} style={{ animationDelay: `${index * SIDEBAR_TITLE_CHAR_DELAY_MS}ms` }}>
            {char === " " ? "\u00a0" : char}
          </span>
        ))
      ) : (
        displayTitle
      )}
    </span>
  );
}

export function WorkbenchShell({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const { resolvedLanguage, t } = useI18n();
  const mobileMenuOpen = useWorkbench((state) => state.mobileMenuOpen);
  const setMobileMenuOpen = useWorkbench((state) => state.setMobileMenuOpen);
  const resetNewChatComposer = useWorkbench((state) => state.resetNewChatComposer);
  const sidebarCollapsed = useWorkbench((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useWorkbench((state) => state.setSidebarCollapsed);
  const sessionGenerationStates = useWorkbench((state) => state.sessionGenerationStates);
  const markSessionGenerationRunning = useWorkbench((state) => state.markSessionGenerationRunning);
  const markSessionGenerationCompleted = useWorkbench((state) => state.markSessionGenerationCompleted);
  const clearSessionGenerationStatus = useWorkbench((state) => state.clearSessionGenerationStatus);
  const clearSessionGenerationStatuses = useWorkbench((state) => state.clearSessionGenerationStatuses);
  const [searchOpen, setSearchOpen] = useState(false);
  const [userCardOpen, setUserCardOpen] = useState(false);
  const [userCardClosing, setUserCardClosing] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [editProfileDialogOpen, setEditProfileDialogOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [deleteAccountConfirmOpen, setDeleteAccountConfirmOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [archivedChatsOpen, setArchivedChatsOpen] = useState(false);
  const [openSessionMenuId, setOpenSessionMenuId] = useState<string | null>(null);
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<DeleteSessionTarget | null>(null);
  const [archiveAllConfirmOpen, setArchiveAllConfirmOpen] = useState(false);
  const [deleteAllConfirmOpen, setDeleteAllConfirmOpen] = useState(false);
  const [collapsedToggleVisible, setCollapsedToggleVisible] = useState(false);
  const [collapsedToggleArmed, setCollapsedToggleArmed] = useState(true);
  const [sidebarMotionState, setSidebarMotionState] = useState<SidebarMotionState>(() => (sidebarCollapsed ? "collapsed" : "expanded"));
  const [collapsedRecentOpen, setCollapsedRecentOpen] = useState(false);
  const [collapsedRecentTop, setCollapsedRecentTop] = useState<number | null>(null);
  const [sessionGroupsCollapsed, setSessionGroupsCollapsed] = useState<SessionGroupCollapseState>(readSessionGroupCollapseState);
  const [sidebarFloatingTip, setSidebarFloatingTip] = useState<SidebarFloatingTip | null>(null);
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const userFooterRef = useRef<HTMLDivElement | null>(null);
  const sidebarMainScrollRef = useRef<HTMLDivElement | null>(null);
  const collapsedRecentRef = useRef<HTMLDivElement | null>(null);
  const collapsedRecentCardRef = useRef<HTMLDivElement | null>(null);
  const userCardCloseTimerRef = useRef<number | null>(null);
  const sidebarMotionTimerRef = useRef<number | null>(null);
  const sidebarMotionFrameRef = useRef<number | null>(null);
  const configWindowRef = useRef<Window | null>(null);
  const userCardVisible = userCardOpen || userCardClosing;
  const sessions = useInfiniteQuery({
    queryKey: ["sessions", "active"],
    queryFn: ({ pageParam, signal }) => api.sessions({ limit: SIDEBAR_SESSION_PAGE_SIZE, offset: Number(pageParam) }, { signal }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => (lastPage.pageInfo.hasMore ? lastPage.pageInfo.offset + lastPage.pageInfo.limit : undefined)
  });
  const archivedSessions = useQuery({
    queryKey: ["sessions", "archived"],
    queryFn: ({ signal }) => api.sessions({ archived: true }, { signal }),
    enabled: settingsOpen || archivedChatsOpen
  });
  const avatarSource = user.username?.trim() || user.account?.trim() || "U";
  const avatarText = avatarSource.slice(0, 1).toUpperCase();
  const userAccountLabel = user.account?.trim() || t("sidebar.accountUnset");
  const deleteAccountConfirmationText = t("dialog.deleteAccount.confirmation", { username: user.username.trim() });
  const renderUserAvatar = (className?: string) => (
    <span className={cx("user-avatar", className)} aria-hidden="true">
      {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : avatarText}
    </span>
  );
  const activeChatSessionId = location.pathname.match(/^\/chat\/([^/]+)/)?.[1] ?? null;
  const openCurrentOrNewChat = useCallback(() => {
    pauseRenderingMotion();
    setMobileMenuOpen(false);
    if (location.pathname === "/") {
      resetNewChatComposer();
      return;
    }
    navigate("/", { replace: false });
  }, [location.pathname, navigate, resetNewChatComposer, setMobileMenuOpen]);
  const scrollSidebarHistoryToTop = useCallback(() => {
    sidebarMainScrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const sidebarToggleLabel = sidebarCollapsed ? t("sidebar.openSidebar") : t("sidebar.closeSidebar");
  const showSidebarFloatingTip = useCallback(
    (event: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>, tip: Pick<SidebarFloatingTip, "label" | "shortcut">) => {
      const rect = event.currentTarget.getBoundingClientRect();
      setSidebarFloatingTip({
        ...tip,
        left: rect.left + rect.width / 2,
        top: rect.bottom + 8
      });
    },
    []
  );
  const hideSidebarFloatingTip = useCallback(() => setSidebarFloatingTip(null), []);
  const clearSidebarMotionTimer = useCallback(() => {
    if (sidebarMotionFrameRef.current !== null) {
      window.cancelAnimationFrame(sidebarMotionFrameRef.current);
      sidebarMotionFrameRef.current = null;
    }
    if (sidebarMotionTimerRef.current === null) return;
    window.clearTimeout(sidebarMotionTimerRef.current);
    sidebarMotionTimerRef.current = null;
  }, []);

  useEffect(() => () => clearSidebarMotionTimer(), [clearSidebarMotionTimer]);

  useEffect(() => {
    setSidebarMotionState((current) => {
      if (current === "collapsing" || current === "expanding") return current;
      return sidebarCollapsed ? "collapsed" : "expanded";
    });
  }, [sidebarCollapsed]);

  const toggleSidebar = () => {
    setSidebarFloatingTip(null);
    setCollapsedToggleVisible(false);
    clearSidebarMotionTimer();
    if (sidebarCollapsed) {
      setCollapsedToggleArmed(true);
      setSidebarMotionState("expanding");
      sidebarMotionFrameRef.current = window.requestAnimationFrame(() => {
        sidebarMotionFrameRef.current = null;
        setSidebarCollapsed(false);
        sidebarMotionTimerRef.current = window.setTimeout(() => {
          setSidebarMotionState("expanded");
          sidebarMotionTimerRef.current = null;
        }, SIDEBAR_WIDTH_ANIMATION_MS);
      });
      return;
    }

    setCollapsedToggleArmed(false);
    setSidebarMotionState("collapsing");
    sidebarMotionTimerRef.current = window.setTimeout(() => {
      setSidebarCollapsed(true);
      sidebarMotionTimerRef.current = window.setTimeout(() => {
        setSidebarMotionState("collapsed");
        sidebarMotionTimerRef.current = null;
      }, SIDEBAR_WIDTH_ANIMATION_MS);
    }, SIDEBAR_CONTENT_FADE_MS);
  };

  const clearUserCardCloseTimer = useCallback(() => {
    if (userCardCloseTimerRef.current === null) return;
    window.clearTimeout(userCardCloseTimerRef.current);
    userCardCloseTimerRef.current = null;
  }, []);

  const openUserCard = useCallback(() => {
    clearUserCardCloseTimer();
    setUserCardClosing(false);
    setUserCardOpen(true);
  }, [clearUserCardCloseTimer]);

  const closeUserCard = useCallback(() => {
    if (!userCardOpen || userCardClosing) return;
    clearUserCardCloseTimer();
    setUserCardOpen(false);
    setUserCardClosing(true);
    userCardCloseTimerRef.current = window.setTimeout(() => {
      setUserCardClosing(false);
      userCardCloseTimerRef.current = null;
    }, USER_CARD_CLOSE_ANIMATION_MS);
  }, [clearUserCardCloseTimer, userCardClosing, userCardOpen]);

  const toggleUserCard = useCallback(() => {
    if (userCardOpen && !userCardClosing) {
      closeUserCard();
      return;
    }
    openUserCard();
  }, [closeUserCard, openUserCard, userCardClosing, userCardOpen]);

  const closeCollapsedRecent = useCallback(() => {
    setCollapsedRecentOpen(false);
  }, []);

  const measureCollapsedRecentTop = useCallback(() => {
    const rect = collapsedRecentRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const maxTop = window.innerHeight - COLLAPSED_RECENT_CARD_ESTIMATED_HEIGHT - COLLAPSED_RECENT_VIEWPORT_PADDING;
    const rawTop = rect.top - 6;
    return Math.min(Math.max(rawTop, COLLAPSED_RECENT_VIEWPORT_PADDING), Math.max(COLLAPSED_RECENT_VIEWPORT_PADDING, maxTop));
  }, []);

  const toggleCollapsedRecent = useCallback(() => {
    setCollapsedRecentOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        setCollapsedRecentTop(measureCollapsedRecentTop());
      }
      return nextOpen;
    });
  }, [measureCollapsedRecentTop]);

  const toggleSessionGroup = useCallback((group: SessionGroupKey) => {
    setSessionGroupsCollapsed((current) => {
      const next = {
        ...current,
        [group]: !current[group]
      };
      writeSessionGroupCollapseState(next);
      return next;
    });
  }, []);

  const removeSessionsFromCache = (ids: string[]) => {
    const idSet = new Set(ids);
    const removedCount = idSet.size;
    queryClient.setQueryData<ActiveSessionPages>(["sessions", "active"], (current) =>
      current
        ? {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              sessions: page.sessions.filter((item) => !idSet.has(item.id)),
              pageInfo: { ...page.pageInfo, total: Math.max(0, page.pageInfo.total - removedCount) }
            }))
          }
        : current
    );
    queryClient.setQueryData<SessionPage>(["sessions", "archived"], (current) =>
      current
        ? {
            ...current,
            sessions: current.sessions.filter((item) => !idSet.has(item.id)),
            pageInfo: { ...current.pageInfo, total: Math.max(0, current.pageInfo.total - removedCount) }
          }
        : current
    );
  };

  const upsertSessionCache = (queryKey: readonly string[], session: ChatSession) => {
    if (queryKey[1] === "active") {
      queryClient.setQueryData<ActiveSessionPages>(["sessions", "active"], (current) => {
        if (!current) return current;
        const [firstPage, ...restPages] = current.pages;
        if (!firstPage) return current;
        const existingSessions = current.pages.flatMap((page) => page.sessions);
        const wasPresent = existingSessions.some((item) => item.id === session.id);
        return {
          ...current,
          pages: [
            {
              ...firstPage,
              sessions: [session, ...firstPage.sessions.filter((item) => item.id !== session.id)].slice(0, firstPage.pageInfo.limit),
              pageInfo: { ...firstPage.pageInfo, total: wasPresent ? firstPage.pageInfo.total : firstPage.pageInfo.total + 1 }
            },
            ...restPages.map((page) => ({
              ...page,
              sessions: page.sessions.filter((item) => item.id !== session.id),
              pageInfo: { ...page.pageInfo, total: wasPresent ? page.pageInfo.total : page.pageInfo.total + 1 }
            }))
          ]
        };
      });
      return;
    }
    queryClient.setQueryData<SessionPage>(["sessions", "archived"], (current) => {
      if (!current) return current;
      const wasPresent = current.sessions.some((item) => item.id === session.id);
      return {
        ...current,
        sessions: [session, ...current.sessions.filter((item) => item.id !== session.id)],
        pageInfo: { ...current.pageInfo, total: wasPresent ? current.pageInfo.total : current.pageInfo.total + 1 }
      };
    });
  };

  const patchSessionInCache = (session: ChatSession) => {
    queryClient.setQueryData<ActiveSessionPages>(["sessions", "active"], (current) =>
      current
        ? {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              sessions: page.sessions.map((item) => (item.id === session.id ? { ...item, ...session } : item))
            }))
          }
        : current
    );
    queryClient.setQueryData<SessionPage>(["sessions", "archived"], (current) =>
      current
        ? {
            ...current,
            sessions: current.sessions.map((item) => (item.id === session.id ? { ...item, ...session } : item))
          }
        : current
    );
  };

  const leaveDeletedOrArchivedChat = (ids: string[]) => {
    if (!activeChatSessionId || !ids.includes(activeChatSessionId)) return;
    resetNewChatComposer();
    navigate("/", { replace: true });
  };

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      setLogoutConfirmOpen(false);
      queryClient.setQueryData(["me"], { user: null });
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" });
      clearSessionGenerationStatuses();
      navigate("/", { replace: true });
    }
  });
  const deleteAccount = useMutation({
    mutationFn: api.deleteAccount,
    onSuccess: () => {
      setDeleteAccountConfirmOpen(false);
      setSettingsOpen(false);
      queryClient.setQueryData(["me"], { user: null });
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" });
      clearSessionGenerationStatuses();
      navigate("/", { replace: true });
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.accountDeleteFailed"), "error");
    }
  });
  const archiveChat = useMutation({
    mutationFn: (payload: { sessionId: string; archived: boolean }) => api.archiveSession(payload.sessionId, payload.archived),
    onSuccess: ({ session }, payload) => {
      removeSessionsFromCache([payload.sessionId]);
      upsertSessionCache(payload.archived ? ["sessions", "archived"] : ["sessions", "active"], session);
      if (payload.archived) clearSessionGenerationStatus(payload.sessionId);
      if (payload.archived) leaveDeletedOrArchivedChat([payload.sessionId]);
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      showToast(payload.archived ? t("toast.chatArchived") : t("toast.chatUnarchived"));
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("common.error"), "error");
    }
  });
  const pinChat = useMutation({
    mutationFn: (payload: { sessionId: string; pinned: boolean }) => api.pinSession(payload.sessionId, payload.pinned),
    onSuccess: ({ session }, payload) => {
      queryClient.setQueryData<ActiveSessionPages>(["sessions", "active"], (current) => {
        if (!current) return current;
        const sortedSessions = current.pages
          .flatMap((page) => page.sessions)
          .map((item) => (item.id === session.id ? { ...item, ...session } : item))
          .sort(compareActiveSessions);
        let cursor = 0;
        return {
          ...current,
          pages: current.pages.map((page) => {
            const nextSessions = sortedSessions.slice(cursor, cursor + page.sessions.length);
            cursor += page.sessions.length;
            return { ...page, sessions: nextSessions };
          })
        };
      });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      showToast(payload.pinned ? t("toast.chatPinned") : t("toast.chatUnpinned"));
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.pinFailed"), "error");
    }
  });
  const renameChat = useMutation({
    mutationFn: (payload: { sessionId: string; title: string }) => api.renameSession(payload.sessionId, payload.title),
    onSuccess: ({ session }) => {
      patchSessionInCache(session);
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      showToast(t("toast.chatRenamed"));
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.chatRenameFailed"), "error");
    }
  });
  const archiveAllChats = useMutation({
    mutationFn: api.archiveAllSessions,
    onSuccess: ({ archived }) => {
      queryClient.setQueryData<ActiveSessionPages>(["sessions", "active"], (current) =>
        current
          ? {
              ...current,
              pages: current.pages.map((page) => ({ ...page, sessions: [], pageInfo: { ...page.pageInfo, total: 0, hasMore: false } }))
            }
          : current
      );
      clearSessionGenerationStatuses();
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      if (activeChatSessionId) {
        resetNewChatComposer();
        navigate("/", { replace: true });
      }
      showToast(archived > 0 ? t("toast.allChatsArchived") : t("toast.noChatsToArchive"), archived > 0 ? "success" : "info");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.archiveAllFailed"), "error");
    }
  });
  const unarchiveAllChats = useMutation({
    mutationFn: api.unarchiveAllSessions,
    onSuccess: ({ restored }) => {
      queryClient.setQueryData<SessionPage>(["sessions", "archived"], (current) =>
        current ? { ...current, sessions: [], pageInfo: { ...current.pageInfo, total: 0, hasMore: false } } : current
      );
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      showToast(restored > 0 ? t("toast.allChatsUnarchived") : t("toast.noArchivedChats"), restored > 0 ? "success" : "info");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.unarchiveAllFailed"), "error");
    }
  });
  const deleteChat = useMutation({
    mutationFn: api.deleteSession,
    onSuccess: (_result, sessionId) => {
      removeSessionsFromCache([sessionId]);
      queryClient.removeQueries({ queryKey: ["messages", sessionId] });
      queryClient.removeQueries({ queryKey: ["session-image-jobs", sessionId] });
      clearSessionGenerationStatus(sessionId);
      queryClient.invalidateQueries({ queryKey: ["images"] });
      queryClient.invalidateQueries({ queryKey: ["cases"] });
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      leaveDeletedOrArchivedChat([sessionId]);
      showToast(t("toast.chatDeleted"));
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.chatDeleteFailed"), "error");
    }
  });
  const deleteAllChats = useMutation({
    mutationFn: api.deleteAllSessions,
    onSuccess: () => {
      queryClient.setQueryData<ActiveSessionPages>(["sessions", "active"], (current) =>
        current
          ? {
              ...current,
              pages: current.pages.map((page) => ({ ...page, sessions: [], pageInfo: { ...page.pageInfo, total: 0, hasMore: false } }))
            }
          : current
      );
      queryClient.setQueryData<SessionPage>(["sessions", "archived"], (current) =>
        current ? { ...current, sessions: [], pageInfo: { ...current.pageInfo, total: 0, hasMore: false } } : current
      );
      queryClient.removeQueries({
        predicate: (query) => ["messages", "session-image-jobs"].includes(String(query.queryKey[0]))
      });
      clearSessionGenerationStatuses();
      queryClient.invalidateQueries({ queryKey: ["images"] });
      queryClient.invalidateQueries({ queryKey: ["cases"] });
      queryClient.invalidateQueries({ queryKey: ["assets"] });
      if (activeChatSessionId) {
        resetNewChatComposer();
        navigate("/", { replace: true });
      }
      showToast(t("toast.allChatsDeleted"));
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.allChatsDeleteFailed"), "error");
    }
  });
  const changePassword = useMutation({
    mutationFn: api.changePassword,
    onSuccess: () => {
      setPasswordDialogOpen(false);
      showToast(t("toast.passwordChanged"));
      queryClient.setQueryData(["me"], { user: null });
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" });
      navigate("/", { replace: true });
    }
  });
  const saveProfile = useMutation({
    mutationFn: async ({ username, avatarFile }: { username: string; avatarFile: File | null }) => {
      let nextUser = user;
      if (avatarFile) {
        const form = new FormData();
        form.set("file", avatarFile);
        nextUser = (await api.uploadAvatar(form)).user;
      }
      if (username.trim() !== user.username.trim()) {
        nextUser = (await api.changeUsername(username)).user;
      }
      return { user: nextUser };
    },
    onSuccess: (data) => {
      setEditProfileDialogOpen(false);
      queryClient.setQueryData(["me"], { user: data.user });
      showToast(t("toast.profileSaved"));
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.profileSaveFailed"), "error");
    }
  });
  const saveAppearanceMode = useMutation({
    mutationFn: api.saveAppearanceMode,
    onSuccess: (data) => {
      queryClient.setQueryData(["me"], { user: data.user });
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.themeSaveFailed"), "error");
    }
  });
  const saveUserPreferences = useMutation({
    mutationFn: (preferences: Partial<UserPreferences>) => api.saveUserPreferences(preferences),
    onSuccess: (data, preferences) => {
      queryClient.setQueryData(["me"], { user: data.user });
      queryClient.invalidateQueries({ queryKey: ["image-edit-suggestions"] });
      showToast(userPreferencesToast(preferences, t, resolvedLanguage));
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : t("toast.preferencesSaveFailed"), "error");
    }
  });
  const configAccess = useMutation({
    mutationFn: api.configAccess,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["config-status"] });
      const configWindow = configWindowRef.current;
      configWindowRef.current = null;
      if (configWindow && !configWindow.closed) {
        configWindow.location.replace("/config");
        return;
      }
      window.open("/config", "_blank");
    },
    onError: (error) => {
      if (configWindowRef.current && !configWindowRef.current.closed) {
        configWindowRef.current.close();
      }
      configWindowRef.current = null;
      showToast(error instanceof Error ? error.message : t("toast.configAccessFailed"), "error");
    }
  });

  const openPasswordDialog = () => {
    changePassword.reset();
    closeUserCard();
    setPasswordDialogOpen(true);
  };
  const openEditProfileDialog = () => {
    saveProfile.reset();
    closeUserCard();
    setEditProfileDialogOpen(true);
  };
  const openConfigDashboard = () => {
    if (configAccess.isPending) return;
    const configWindow = window.open("about:blank", "_blank");
    if (!configWindow) {
      showToast(t("toast.popupBlocked"), "error");
      return;
    }
    configWindow.opener = null;
    configWindowRef.current = configWindow;
    closeUserCard();
    configAccess.mutate();
  };
  const openSettingsDialog = () => {
    closeUserCard();
    setSettingsOpen(true);
  };
  const requestLogout = () => {
    if (logout.isPending) return;
    closeUserCard();
    setLogoutConfirmOpen(true);
  };
  const requestDeleteAccount = () => {
    if (deleteAccount.isPending) return;
    deleteAccount.reset();
    closeUserCard();
    setDeleteAccountConfirmOpen(true);
  };
  const confirmLogout = () => {
    if (logout.isPending) return;
    setLogoutConfirmOpen(false);
    logout.mutate();
  };
  const confirmDeleteAccount = () => {
    if (deleteAccount.isPending) return;
    deleteAccount.mutate(deleteAccountConfirmationText);
  };
  const requestDeleteSession = (session: Pick<ChatSession, "id" | "title">, source: DeleteSessionTarget["source"]) => {
    setOpenSessionMenuId(null);
    setDeleteSessionTarget({ id: session.id, title: session.title, source });
  };

  useEffect(() => {
    if (!userCardOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && userFooterRef.current?.contains(target)) return;
      closeUserCard();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [closeUserCard, userCardOpen]);

  useEffect(() => {
    if (!collapsedRecentOpen) return;
    const updatePosition = () => {
      setCollapsedRecentTop(measureCollapsedRecentTop());
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && collapsedRecentRef.current?.contains(target)) return;
      if (target && collapsedRecentCardRef.current?.contains(target)) return;
      closeCollapsedRecent();
    };

    updatePosition();
    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [closeCollapsedRecent, collapsedRecentOpen, measureCollapsedRecentTop]);

  useEffect(() => {
    closeCollapsedRecent();
  }, [closeCollapsedRecent, location.pathname, sidebarCollapsed]);

  useEffect(
    () => () => {
      clearUserCardCloseTimer();
    },
    [clearUserCardCloseTimer]
  );

  const activeSessions = sessions.data?.pages.flatMap((page) => page.sessions) ?? [];
  const pinnedSessions = activeSessions.filter((session) => session.pinnedAt);
  const recentSessions = activeSessions.filter((session) => !session.pinnedAt);
  const collapsedRecentSessions = activeSessions.slice(0, COLLAPSED_RECENT_CHAT_LIMIT);
  const activeSessionTotal = sessions.data?.pages[0]?.pageInfo?.total ?? activeSessions.length;
  const archivedChatSessions = archivedSessions.data?.sessions ?? [];
  const archivedSessionTotal = archivedSessions.data?.pageInfo?.total ?? archivedChatSessions.length;
  const activeSessionRunKey = activeSessions.map((session) => `${session.id}:${session.runningImageJobCount}`).join("|");
  const hasPendingSessionTitle = activeSessions.some((session) => session.titleStatus === "pending");
  const hasActiveSessionCache = Boolean(sessions.data?.pages.length);
  const showInitialSessionSkeleton = sessions.isLoading && !hasActiveSessionCache;
  const sessionListSentinelRef = useInfinitePageLoader({
    fetchNextPage: () => sessions.fetchNextPage(),
    hasNextPage: Boolean(sessions.hasNextPage),
    isFetchingNextPage: sessions.isFetchingNextPage,
    rootMargin: "260px"
  });
  const collapsedRecentCardStyle =
    collapsedRecentTop === null ? undefined : ({ top: collapsedRecentTop } satisfies CSSProperties);

  useEffect(() => {
    for (const session of activeSessions) {
      if (session.runningImageJobCount > 0) markSessionGenerationRunning(session.id);
    }
  }, [activeSessionRunKey, markSessionGenerationRunning]);

  useEffect(() => {
    if (!activeChatSessionId) return;
    if (sessionGenerationStates[activeChatSessionId]?.state === "completed") {
      clearSessionGenerationStatus(activeChatSessionId);
    }
  }, [activeChatSessionId, clearSessionGenerationStatus, sessionGenerationStates]);

  const refreshSessionsNonCancel = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["sessions"] }, { cancelRefetch: false });
  }, [queryClient]);

  useEffect(() => {
    if (!hasPendingSessionTitle) return undefined;
    const interval = window.setInterval(refreshSessionsNonCancel, 1600);
    return () => window.clearInterval(interval);
  }, [hasPendingSessionTitle, refreshSessionsNonCancel]);

  const pauseRenderingBeforeChatNavigation = useCallback((nextSessionId: string) => {
    if (nextSessionId === activeChatSessionId) return;
    pauseRenderingMotion();
  }, [activeChatSessionId]);

  const pauseRenderingBeforeRouteNavigation = useCallback(() => {
    pauseRenderingMotion();
  }, []);

  const updateSessionImageJobFromEvent = useCallback((payload: ImageJobEventPayload) => {
    let updated = false;
    queryClient.setQueryData<{ jobs: ImageJob[] }>(["session-image-jobs", payload.sessionId], (current) => {
      if (!current) return current;
      const jobs = current.jobs.map((job) => {
        if (job.id !== payload.jobId) return job;
        updated = true;
        const type = payload.type === "generation" || payload.type === "edit" ? payload.type : job.type;
        return {
          ...job,
          type,
          status: payload.status,
          resultImageId: payload.resultImageId !== undefined ? payload.resultImageId : job.resultImageId,
          error: payload.error !== undefined ? payload.error : job.error,
          updatedAt: payload.updatedAt
        };
      });
      return updated ? { ...current, jobs } : current;
    });
    return updated;
  }, [queryClient]);

  const prefetchImageEditSuggestions = useCallback((imageId: string | null | undefined) => {
    const normalizedImageId = imageId?.trim();
    const editSuggestionsEnabled = user.preferences?.editSuggestionsEnabled !== false;
    if (!normalizedImageId || !editSuggestionsEnabled) return;
    const editSuggestionTone = user.preferences?.editSuggestionTone ?? "default";
    void queryClient.prefetchQuery({
      queryKey: ["image-edit-suggestions", normalizedImageId, editSuggestionTone, editSuggestionsEnabled, resolvedLanguage],
      queryFn: () => api.imageEditSuggestions(normalizedImageId, resolvedLanguage),
      staleTime: IMAGE_EDIT_SUGGESTIONS_STALE_MS
    });
  }, [queryClient, resolvedLanguage, user.preferences?.editSuggestionTone, user.preferences?.editSuggestionsEnabled]);

  const handleImageJobEvent = useCallback((payload: ImageJobEventPayload) => {
    const sessionId = payload.sessionId.trim();
    if (!sessionId) return;
    if (payload.status === "succeeded") prefetchImageEditSuggestions(payload.resultImageId);
    if (payload.status === "running") {
      markSessionGenerationRunning(sessionId);
    } else if (payload.status === "succeeded") {
      markSessionGenerationCompleted(sessionId);
    } else {
      clearSessionGenerationStatus(sessionId);
    }
    refreshSessionsNonCancel();
    const updatedJobCache = updateSessionImageJobFromEvent(payload);
    if (!updatedJobCache) {
      queryClient.invalidateQueries({ queryKey: ["session-image-jobs", sessionId] });
    }
    if (payload.status !== "running") {
      queryClient.invalidateQueries({ queryKey: ["messages", sessionId] });
      queryClient.invalidateQueries({ queryKey: ["images"] });
      queryClient.invalidateQueries({ queryKey: ["cases"] });
    }
  }, [
    clearSessionGenerationStatus,
    markSessionGenerationCompleted,
    markSessionGenerationRunning,
    prefetchImageEditSuggestions,
    queryClient,
    refreshSessionsNonCancel,
    updateSessionImageJobFromEvent
  ]);

  useImageJobEvents({
    onConnected: refreshSessionsNonCancel,
    onJob: handleImageJobEvent
  });

  useEffect(() => {
    const isTypingTarget = (target: EventTarget | null) => {
      const element = target instanceof Element ? target : null;
      return Boolean(element?.closest("input, textarea, select, [contenteditable='true']"));
    };

    const handleGlobalShortcuts = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || isTypingTarget(event.target)) return;
      const withModifier = event.ctrlKey || event.metaKey;
      if (!withModifier) return;
      const key = event.key.toLowerCase();

      if (!event.shiftKey && key === "k") {
        event.preventDefault();
        setSearchOpen(true);
        setMobileMenuOpen(false);
        return;
      }

      if (event.shiftKey && key === "o") {
        event.preventDefault();
        openCurrentOrNewChat();
      }
    };

    window.addEventListener("keydown", handleGlobalShortcuts);
    return () => window.removeEventListener("keydown", handleGlobalShortcuts);
  }, [openCurrentOrNewChat]);

  const pendingPinSessionId = pinChat.isPending ? pinChat.variables?.sessionId ?? null : null;
  const globalSessionActionPending = renameChat.isPending || archiveChat.isPending || deleteChat.isPending;
  const renderSessionRows = (sessionRows: ChatSession[]) =>
    sessionRows.map((session) => {
      const rawGenerationState =
        sessionGenerationStates[session.id]?.state ?? (session.runningImageJobCount > 0 ? "running" : null);
      const isCurrentSession = session.id === activeChatSessionId;
      const titlePending = session.titleStatus === "pending";
      const sessionTitleLabel = titlePending ? t("sidebar.titlePending") : session.title;
      const generationState = isCurrentSession && rawGenerationState === "running" ? null : rawGenerationState;
      const pinned = Boolean(session.pinnedAt);
      const nextPinned = !pinned;
      const sessionActionPending = globalSessionActionPending || pendingPinSessionId === session.id;
      return (
        <div
          key={session.id}
          onMouseEnter={() => setHoveredSessionId(session.id)}
          onMouseLeave={() => setHoveredSessionId((current) => (current === session.id ? null : current))}
          className={cx(
            "recent-row",
            pinned && "pinned",
            titlePending && "has-title-pending",
            generationState && "has-generation-status",
            isCurrentSession && "active",
            openSessionMenuId === session.id && "menu-open"
          )}
        >
          <NavLink
            to={`/chat/${session.id}`}
            title={sessionTitleLabel}
            className={({ isActive }) => cx("recent-item", isActive && "active")}
            onPointerDown={() => pauseRenderingBeforeChatNavigation(session.id)}
            onClick={() => {
              pauseRenderingBeforeChatNavigation(session.id);
              setMobileMenuOpen(false);
              setOpenSessionMenuId(null);
              if (rawGenerationState === "completed") clearSessionGenerationStatus(session.id);
            }}
          >
            <SidebarSessionTitle
              title={session.title}
              titleStatus={session.titleStatus}
              className="recent-item-title"
              ellipsisWhenTruncated={hoveredSessionId === session.id || openSessionMenuId === session.id}
              fallbackTitle={t("sidebar.defaultSessionTitle")}
              pendingTitle={t("sidebar.titlePending")}
            />
          </NavLink>
          {generationState ? (
            <span
              className={cx("recent-generation-status", generationState)}
              role="status"
              aria-label={generationState === "running" ? t("sidebar.imageRunning") : t("sidebar.imageDone")}
            />
          ) : null}
          <button
            className={cx("session-pin-trigger", pinned && "is-pinned")}
            type="button"
            disabled={sessionActionPending}
            aria-label={pinned ? t("sidebar.unpinChat") : t("sidebar.pinChat")}
            title={pinned ? t("sidebar.unpin") : t("sidebar.pin")}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (sessionActionPending) return;
              pinChat.mutate({ sessionId: session.id, pinned: nextPinned });
            }}
          >
            {pinned ? <PinOff size={16} /> : <Pin size={16} />}
          </button>
          <SessionActionsMenu
            open={openSessionMenuId === session.id}
            title={session.title}
            pinned={pinned}
            disabled={sessionActionPending}
            onOpenChange={(open) => {
              setOpenSessionMenuId((current) => (open ? session.id : current === session.id ? null : current));
            }}
            onRename={(title) => renameChat.mutate({ sessionId: session.id, title })}
            onPin={() => pinChat.mutate({ sessionId: session.id, pinned: nextPinned })}
            onArchive={() => archiveChat.mutate({ sessionId: session.id, archived: true })}
            onDelete={() => requestDeleteSession(session, "active")}
          />
        </div>
      );
    });

  return (
    <div className={cx("app-shell", sidebarCollapsed && "sidebar-collapsed", `sidebar-motion-${sidebarMotionState}`)}>
      <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(true)} aria-label={t("sidebar.openMenu")}>
        <Menu size={20} />
      </button>
      <aside
        className={cx("sidebar", mobileMenuOpen && "open", collapsedToggleVisible && "collapsed-toggle-visible")}
        onMouseEnter={() => {
          if (sidebarCollapsed && collapsedToggleArmed) setCollapsedToggleVisible(true);
        }}
        onMouseLeave={() => {
          setCollapsedToggleVisible(false);
          setCollapsedToggleArmed(true);
        }}
      >
        <div className="sidebar-main-scroll" ref={sidebarMainScrollRef}>
          <div className="sidebar-fixed">
            <div className="sidebar-head">
              <div className="brand-row">
                <button
                  className="sidebar-logo-button"
                  type="button"
                  onClick={scrollSidebarHistoryToTop}
                  aria-label={t("sidebar.scrollTop")}
                  title={t("sidebar.scrollTop")}
                >
                  <ProjectLogo className="sidebar-logo" />
                </button>
              </div>
              <div className="sidebar-head-actions">
                {!sidebarCollapsed ? (
                  <button
                    className="sidebar-head-search"
                    type="button"
                    aria-label={t("sidebar.globalSearch")}
                    onMouseEnter={(event) => showSidebarFloatingTip(event, { label: t("sidebar.globalSearch"), shortcut: "Ctrl + K" })}
                    onMouseLeave={hideSidebarFloatingTip}
                    onFocus={(event) => showSidebarFloatingTip(event, { label: t("sidebar.globalSearch"), shortcut: "Ctrl + K" })}
                    onBlur={hideSidebarFloatingTip}
                    onClick={() => {
                      hideSidebarFloatingTip();
                      setSearchOpen(true);
                      setMobileMenuOpen(false);
                    }}
                  >
                    <Search size={18} />
                  </button>
                ) : null}
                <button
                  className="sidebar-toggle"
                  type="button"
                  onClick={toggleSidebar}
                  aria-label={sidebarToggleLabel}
                  data-sidebar-tip={sidebarCollapsed ? sidebarToggleLabel : undefined}
                  onMouseEnter={(event) => {
                    if (!sidebarCollapsed) showSidebarFloatingTip(event, { label: sidebarToggleLabel });
                  }}
                  onMouseLeave={hideSidebarFloatingTip}
                  onFocus={(event) => {
                    if (!sidebarCollapsed) showSidebarFloatingTip(event, { label: sidebarToggleLabel });
                  }}
                  onBlur={hideSidebarFloatingTip}
                >
                  <PanelLeft size={18} aria-hidden="true" />
                </button>
                <button className="icon-btn mobile-only" onClick={() => setMobileMenuOpen(false)} aria-label={t("sidebar.closeMenu")}>
                  <X size={18} />
                </button>
              </div>
            </div>
            <nav className="main-nav-actions" onClick={() => setMobileMenuOpen(false)}>
              <NavLink
                to="/"
                end
                className={({ isActive }) => cx("nav-item", "nav-item-with-shortcut-tip", isActive && "active")}
                aria-label={t("sidebar.newConversation")}
                onPointerDown={pauseRenderingBeforeRouteNavigation}
                onClick={() => {
                  pauseRenderingBeforeRouteNavigation();
                  openCurrentOrNewChat();
                }}
              >
                <MessageCirclePlus size={18} />
                <span>{t("sidebar.newConversation")}</span>
                <div className="sidebar-shortcut-tip" role="tooltip" aria-hidden="true">
                  <strong>{t("sidebar.newChat")}</strong>
                  <kbd>Ctrl + Shift + O</kbd>
                </div>
              </NavLink>
              {sidebarCollapsed ? (
                <button
                  type="button"
                  className={cx("nav-item", "nav-item-with-shortcut-tip", searchOpen && "active")}
                  aria-label={t("sidebar.globalSearch")}
                  onClick={() => {
                    setSearchOpen(true);
                    setMobileMenuOpen(false);
                  }}
                >
                  <Search size={18} />
                  <span>{t("sidebar.globalSearch")}</span>
                  <div className="sidebar-shortcut-tip" role="tooltip" aria-hidden="true">
                    <strong>{t("sidebar.globalSearch")}</strong>
                    <kbd>Ctrl + K</kbd>
                  </div>
                </button>
              ) : null}
            </nav>
          </div>
          <div className="sidebar-scroll">
            <nav className="main-nav" onClick={() => setMobileMenuOpen(false)}>
              <NavLink
                to="/cases"
                className={({ isActive }) => cx("nav-item", isActive && "active")}
                aria-label={t("sidebar.inspiration")}
                data-sidebar-tip={t("sidebar.inspiration")}
                onPointerDown={pauseRenderingBeforeRouteNavigation}
                onClick={pauseRenderingBeforeRouteNavigation}
              >
                <Lightbulb size={18} />
                <span>{t("sidebar.inspiration")}</span>
              </NavLink>
              <NavLink
                to="/assets"
                className={({ isActive }) => cx("nav-item", isActive && "active")}
                aria-label={t("sidebar.assets")}
                data-sidebar-tip={t("sidebar.assets")}
                onPointerDown={pauseRenderingBeforeRouteNavigation}
                onClick={pauseRenderingBeforeRouteNavigation}
              >
                <FolderOpen size={18} />
                <span>{t("sidebar.assets")}</span>
              </NavLink>
              <NavLink
                to="/images"
                className={({ isActive }) => cx("nav-item", isActive && "active")}
                aria-label={t("sidebar.images")}
                data-sidebar-tip={t("sidebar.images")}
                onPointerDown={pauseRenderingBeforeRouteNavigation}
                onClick={pauseRenderingBeforeRouteNavigation}
              >
                <Images size={18} />
                <span>{t("sidebar.images")}</span>
              </NavLink>
              <NavLink
                to="/prompt-templates"
                className={({ isActive }) => cx("nav-item", isActive && "active")}
                aria-label={t("sidebar.promptCreation")}
                data-sidebar-tip={t("sidebar.promptCreation")}
                onPointerDown={pauseRenderingBeforeRouteNavigation}
                onClick={pauseRenderingBeforeRouteNavigation}
              >
                <Sparkles size={18} />
                <span>{t("sidebar.promptCreation")}</span>
              </NavLink>
            </nav>
            <div className="collapsed-recent-wrap" ref={collapsedRecentRef}>
              <button
                className={cx("nav-item", "collapsed-recent-trigger", collapsedRecentOpen && "active")}
                type="button"
                onClick={toggleCollapsedRecent}
                onPointerDown={(event) => event.stopPropagation()}
                aria-label={t("sidebar.recentChats")}
                aria-expanded={collapsedRecentOpen}
                data-sidebar-tip={t("sidebar.recentChats")}
              >
                <MessageCircle size={18} />
              </button>
            </div>
            {pinnedSessions.length > 0 ? (
              <section className={cx("recent-section", "session-group", sessionGroupsCollapsed.pinned && "collapsed")}>
                <button
                  className="session-group-title"
                  type="button"
                  aria-expanded={!sessionGroupsCollapsed.pinned}
                  onClick={() => toggleSessionGroup("pinned")}
                >
                  <h2>{t("sidebar.pinned")}</h2>
                  <span className="session-group-chevron" aria-hidden="true">
                    <ChevronRight size={14} />
                  </span>
                </button>
                <div className="session-group-body" aria-hidden={sessionGroupsCollapsed.pinned}>
                  <div className="session-group-body-inner">
                    <div className="recent-list">{renderSessionRows(pinnedSessions)}</div>
                  </div>
                </div>
              </section>
            ) : null}
            <section className={cx("recent-section", "session-group", sessionGroupsCollapsed.recent && "collapsed")}>
              <button
                className="session-group-title"
                type="button"
                aria-expanded={!sessionGroupsCollapsed.recent}
                onClick={() => toggleSessionGroup("recent")}
              >
                <h2>{t("sidebar.recent")}</h2>
                <span className="session-group-chevron" aria-hidden="true">
                  <ChevronRight size={14} />
                </span>
              </button>
              <div className="session-group-body" aria-hidden={sessionGroupsCollapsed.recent}>
                <div className="session-group-body-inner">
                  <div className="recent-list">
                    {showInitialSessionSkeleton
                      ? Array.from({ length: 8 }).map((_, index) => <div className="recent-skeleton-row" key={`session-skeleton-${index}`} />)
                      : null}
                    {renderSessionRows(recentSessions)}
                    {!showInitialSessionSkeleton && sessions.hasNextPage ? <div className="recent-load-sentinel" ref={sessionListSentinelRef} /> : null}
                    {sessions.isFetchingNextPage
                      ? Array.from({ length: 4 }).map((_, index) => <div className="recent-skeleton-row compact" key={`session-next-skeleton-${index}`} />)
                      : null}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
        <div className="user-footer" ref={userFooterRef}>
          <div className={cx("user-footer-panel", userCardVisible && "is-open")}>
            <button
              className="user-footer-profile"
              type="button"
              onClick={toggleUserCard}
              aria-label={t("sidebar.userInfo")}
              aria-expanded={userCardOpen && !userCardClosing}
              data-sidebar-tip={t("sidebar.userInfo")}
            >
              {renderUserAvatar()}
              <span className="user-footer-name">
                <strong>{user.username}</strong>
                <span>{userAccountLabel}</span>
              </span>
            </button>
            <button
              className="icon-btn user-footer-logout"
              type="button"
              onClick={requestLogout}
              disabled={logout.isPending}
              aria-label={t("sidebar.logout")}
              data-sidebar-tip={t("sidebar.logout")}
            >
              <LogOut size={18} />
            </button>
          </div>
          {userCardVisible ? (
            <div
              className={cx("user-info-card", "ui-pop-motion")}
              role="dialog"
              aria-label={t("sidebar.userInfo")}
              data-state={userCardClosing ? "closing" : "open"}
              data-placement={sidebarCollapsed ? "bottom-start" : "top-start"}
            >
              <button className="user-info-action" type="button" onClick={openSettingsDialog}>
                <Settings size={16} />
                <span>{t("sidebar.settings")}</span>
              </button>
              {user.hasConfigAccess ? (
                <button
                  className="user-info-action"
                  type="button"
                  onClick={openConfigDashboard}
                  disabled={configAccess.isPending}
                >
                  <ShieldCheck size={16} />
                  <span>{configAccess.isPending ? t("sidebar.entering") : t("sidebar.admin")}</span>
                </button>
              ) : null}
              <button
                className="user-info-action user-info-logout"
                type="button"
                onClick={requestLogout}
                disabled={logout.isPending}
              >
                <LogOut size={16} />
                <span>{logout.isPending ? t("sidebar.loggingOut") : t("sidebar.logout")}</span>
              </button>
            </div>
          ) : null}
        </div>
      </aside>
      {sidebarFloatingTip
        ? createPortal(
            <div
              className="sidebar-floating-tip"
              role="tooltip"
              style={{ left: sidebarFloatingTip.left, top: sidebarFloatingTip.top }}
            >
              <strong>{sidebarFloatingTip.label}</strong>
              {sidebarFloatingTip.shortcut ? <kbd>{sidebarFloatingTip.shortcut}</kbd> : null}
            </div>,
            document.body
          )
        : null}
      {sidebarCollapsed && collapsedRecentOpen
        ? createPortal(
            <div
              className="collapsed-recent-card ui-pop-motion"
              role="dialog"
              aria-label={t("sidebar.recentChats")}
              style={collapsedRecentCardStyle}
              data-state="open"
              data-placement="bottom-start"
              ref={collapsedRecentCardRef}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <header>{t("sidebar.recentChats")}</header>
              <div className="collapsed-recent-card-list">
                {showInitialSessionSkeleton ? <div className="collapsed-recent-empty">{t("common.loadingEllipsis")}</div> : null}
                {!showInitialSessionSkeleton && collapsedRecentSessions.length === 0 ? (
                  <div className="collapsed-recent-empty">{t("sidebar.emptyChats")}</div>
                ) : null}
                {collapsedRecentSessions.map((session) => {
                  const isCurrentSession = session.id === activeChatSessionId;
                  const titlePending = session.titleStatus === "pending";
                  return (
                    <NavLink
                      key={session.id}
                      to={`/chat/${session.id}`}
                      title={titlePending ? t("sidebar.titlePending") : session.title}
                      className={cx("collapsed-recent-card-link", isCurrentSession && "active")}
                      onPointerDown={() => pauseRenderingBeforeChatNavigation(session.id)}
                      onClick={() => {
                        pauseRenderingBeforeChatNavigation(session.id);
                        closeCollapsedRecent();
                        setMobileMenuOpen(false);
                        setOpenSessionMenuId(null);
                        if (sessionGenerationStates[session.id]?.state === "completed") clearSessionGenerationStatus(session.id);
                      }}
                    >
                      <SidebarSessionTitle
                        title={session.title}
                        titleStatus={session.titleStatus}
                        className="collapsed-recent-card-title"
                        fallbackTitle={t("sidebar.defaultSessionTitle")}
                        pendingTitle={t("sidebar.titlePending")}
                      />
                    </NavLink>
                  );
                })}
              </div>
            </div>,
            document.body
          )
        : null}
      {mobileMenuOpen ? <div className="scrim" onClick={() => setMobileMenuOpen(false)} /> : null}
      {searchOpen ? <SearchChatModal sessions={activeSessions} onClose={() => setSearchOpen(false)} /> : null}
      {passwordDialogOpen ? (
        <ChangePasswordDialog
          pending={changePassword.isPending}
          error={changePassword.error instanceof Error ? changePassword.error.message : ""}
          onClose={() => setPasswordDialogOpen(false)}
          onSubmit={(payload) => {
            changePassword.reset();
            changePassword.mutate(payload);
          }}
        />
      ) : null}
      {editProfileDialogOpen ? (
        <EditProfileDialog
          currentUsername={user.username}
          account={user.account}
          avatarUrl={user.avatarUrl}
          pending={saveProfile.isPending}
          error={saveProfile.error instanceof Error ? saveProfile.error.message : ""}
          onClose={() => setEditProfileDialogOpen(false)}
          onSubmit={(payload) => {
            saveProfile.reset();
            saveProfile.mutate(payload);
          }}
        />
      ) : null}
      <AppSettingsDialog
        open={settingsOpen}
        user={user}
        activeSessionCount={activeSessionTotal}
        archivedSessionCount={archivedSessionTotal}
        archiveAllPending={archiveAllChats.isPending}
        deleteAllPending={deleteAllChats.isPending}
        deleteAccountPending={deleteAccount.isPending}
        preferencesSaving={saveUserPreferences.isPending}
        onClose={() => setSettingsOpen(false)}
        onChangePassword={openPasswordDialog}
        onEditProfile={openEditProfileDialog}
        onDeleteAccount={requestDeleteAccount}
        onAppearanceModeChange={(mode: AppearanceMode) => saveAppearanceMode.mutate(mode)}
        onPreferencesChange={(preferences) => saveUserPreferences.mutate(preferences)}
        onOpenArchivedChats={() => {
          setArchivedChatsOpen(true);
          archivedSessions.refetch();
        }}
        onArchiveAllChats={() => setArchiveAllConfirmOpen(true)}
        onDeleteAllChats={() => setDeleteAllConfirmOpen(true)}
      />
      <ArchivedChatsDialog
        open={archivedChatsOpen}
        sessions={archivedChatSessions}
        loading={archivedSessions.isLoading || archivedSessions.isFetching}
        actionPending={archiveChat.isPending || deleteChat.isPending}
        restoreAllPending={unarchiveAllChats.isPending}
        onClose={() => setArchivedChatsOpen(false)}
        onRestore={(session) => archiveChat.mutate({ sessionId: session.id, archived: false })}
        onRestoreAll={() => {
          if (!unarchiveAllChats.isPending) unarchiveAllChats.mutate();
        }}
        onDelete={(session) => requestDeleteSession(session, "archived")}
      />
      <ConfirmDialog
        open={logoutConfirmOpen}
        title={t("dialog.logout.title")}
        description={t("dialog.logout.description")}
        confirmText={t("dialog.logout.confirm")}
        cancelText={t("common.cancel")}
        destructive
        onConfirm={confirmLogout}
        onCancel={() => setLogoutConfirmOpen(false)}
      />
      <ConfirmDialog
        open={deleteAccountConfirmOpen}
        title={t("dialog.deleteAccount.title")}
        description={t("dialog.deleteAccount.description")}
        confirmText={deleteAccount.isPending ? t("common.deleting") : t("settings.account.delete")}
        cancelText={t("common.cancel")}
        confirmationText={deleteAccountConfirmationText}
        confirmationLabel={t("dialog.deleteAccount.confirmationLabel", { confirmation: deleteAccountConfirmationText })}
        destructive
        backdropClassName="modal-backdrop-top"
        onConfirm={confirmDeleteAccount}
        onCancel={() => {
          if (deleteAccount.isPending) return;
          setDeleteAccountConfirmOpen(false);
        }}
      />
      <ConfirmDialog
        open={Boolean(deleteSessionTarget)}
        title={t("dialog.deleteChat.title")}
        description={t("dialog.deleteChat.description", { title: deleteSessionTarget?.title ?? "" })}
        confirmText={t("common.delete")}
        cancelText={t("common.cancel")}
        confirmationText={t("common.confirm")}
        destructive
        backdropClassName={deleteSessionTarget?.source === "archived" ? "modal-backdrop-top" : undefined}
        onConfirm={() => {
          if (!deleteSessionTarget || deleteChat.isPending) return;
          const target = deleteSessionTarget;
          setDeleteSessionTarget(null);
          deleteChat.mutate(target.id);
        }}
        onCancel={() => setDeleteSessionTarget(null)}
      />
      <ConfirmDialog
        open={archiveAllConfirmOpen}
        title={t("dialog.archiveAll.title")}
        description={t("dialog.archiveAll.description", { count: activeSessionTotal })}
        confirmText={t("dialog.archiveAll.confirm")}
        cancelText={t("common.cancel")}
        backdropClassName="modal-backdrop-top"
        onConfirm={() => {
          if (archiveAllChats.isPending) return;
          setArchiveAllConfirmOpen(false);
          archiveAllChats.mutate();
        }}
        onCancel={() => setArchiveAllConfirmOpen(false)}
      />
      <ConfirmDialog
        open={deleteAllConfirmOpen}
        title={t("dialog.deleteAllChats.title")}
        description={t("dialog.deleteAllChats.description")}
        confirmText={t("settings.data.deleteAllAction")}
        cancelText={t("common.cancel")}
        confirmationText={t("common.confirm")}
        destructive
        backdropClassName="modal-backdrop-top"
        onConfirm={() => {
          if (deleteAllChats.isPending) return;
          setDeleteAllConfirmOpen(false);
          deleteAllChats.mutate();
        }}
        onCancel={() => setDeleteAllConfirmOpen(false)}
      />
      <main className="content">
        <Routes>
          <Route path="/" element={<ChatPage user={user} />} />
          <Route path="/chat/:sessionId" element={<ChatPage user={user} />} />
          <Route path="/cases" element={<PageRouteTransition key="cases"><CasesPage /></PageRouteTransition>} />
          <Route path="/cases/barrage" element={<PageRouteTransition key="cases-barrage"><InspirationBarragePage /></PageRouteTransition>} />
          <Route path="/prompt-templates" element={<PageRouteTransition key="prompt-templates"><PromptTemplatesPage /></PageRouteTransition>} />
          <Route path="/prompt-templates/:templateId/edit" element={<PageRouteTransition key="prompt-template-editor"><PromptTemplateEditorPage /></PageRouteTransition>} />
          <Route path="/assets" element={<PageRouteTransition key="assets"><AssetsPage /></PageRouteTransition>} />
          <Route path="/images" element={<PageRouteTransition key="images"><ImagesPage /></PageRouteTransition>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function ChangePasswordDialog({
  pending,
  error,
  onClose,
  onSubmit
}: {
  pending: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (payload: { currentPassword: string; newPassword: string }) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [localError, setLocalError] = useState("");
  const { t } = useI18n();

  useEffect(() => {
    setLocalError("");
  }, [currentPassword, newPassword, confirmPassword]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (!currentPassword || !newPassword) {
      setLocalError(t("profile.passwordRequired"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setLocalError(t("profile.passwordMismatch"));
      return;
    }
    onSubmit({ currentPassword, newPassword });
  };
  const errorMessage = localError || error;

  return (
    <div className="modal-backdrop modal-backdrop-top">
      <form className="case-modal compact-modal action-modal change-password-modal" onSubmit={submit}>
        <header>
          <h3>{t("profile.changePassword")}</h3>
          <button type="button" onClick={onClose} aria-label={t("common.close")}>
            <X size={18} />
          </button>
        </header>
        <label>
          {t("profile.currentPassword")}
          <input
            value={currentPassword}
            type="password"
            autoComplete="current-password"
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoFocus
          />
        </label>
        <label>
          {t("profile.newPassword")}
          <input
            value={newPassword}
            type="password"
            autoComplete="new-password"
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </label>
        <label>
          {t("profile.confirmNewPassword")}
          <input
            value={confirmPassword}
            type="password"
            autoComplete="new-password"
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </label>
        {errorMessage ? <div className="form-error">{errorMessage}</div> : null}
        <div className="row-actions">
          <button className="secondary-btn" type="button" onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </button>
          <button className="primary-btn" type="submit" disabled={pending || !currentPassword || !newPassword || !confirmPassword}>
            {pending ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </div>
  );
}

function EditProfileDialog({
  currentUsername,
  account,
  avatarUrl,
  pending,
  error,
  onClose,
  onSubmit
}: {
  currentUsername: string;
  account: string;
  avatarUrl?: string;
  pending: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (payload: { username: string; avatarFile: File | null }) => void;
}) {
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [username, setUsername] = useState(currentUsername);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState("");
  const [localError, setLocalError] = useState("");
  const [generatedUsername, setGeneratedUsername] = useState<{ previous: string; generated: string } | null>(null);
  const [usernameSuggestions, setUsernameSuggestions] = useState<string[]>([]);
  const { t } = useI18n();
  const trimmedUsername = username.trim();
  const currentTrimmedUsername = currentUsername.trim();
  const usernameValidationError = validateProfileUsername(username, t);
  const usernameChanged = trimmedUsername !== currentTrimmedUsername;
  const avatarChanged = Boolean(avatarFile);
  const visibleAvatarUrl = avatarPreviewUrl || avatarUrl;
  const visibleAvatarText = (trimmedUsername || currentTrimmedUsername || "U").slice(0, 1).toUpperCase();
  const canUndoGeneratedUsername = Boolean(generatedUsername && username === generatedUsername.generated);
  const suggestUsername = useMutation({
    mutationFn: (_previousUsername: string) => api.suggestUsername(),
    onSuccess: (data) => {
      const suggestions = (data.usernames?.length ? data.usernames : data.username ? [data.username] : [])
        .map((item) => item.trim())
        .filter((item, index, items) => item && items.indexOf(item) === index);
      setUsernameSuggestions(suggestions);
    }
  });

  useEffect(() => {
    setUsername(currentUsername);
    setAvatarFile(null);
    setAvatarPreviewUrl("");
    setLocalError("");
    setGeneratedUsername(null);
    setUsernameSuggestions([]);
    suggestUsername.reset();
  }, [currentUsername]);

  useEffect(() => {
    setLocalError("");
  }, [avatarFile, username]);

  useEffect(
    () => () => {
      if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
    },
    [avatarPreviewUrl]
  );

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || suggestUsername.isPending) return;
    if (usernameValidationError) return;
    if (!usernameChanged && !avatarChanged) {
      setLocalError(t("profile.noChanges"));
      return;
    }
    onSubmit({ username: trimmedUsername, avatarFile });
  };
  const generateUsername = () => {
    const previousUsername = generatedUsername?.previous ?? username;
    setLocalError("");
    suggestUsername.mutate(previousUsername);
  };
  const selectUsernameSuggestion = (candidate: string) => {
    const nextUsername = candidate.trim();
    if (!nextUsername) return;
    const previousUsername = generatedUsername?.previous ?? username;
    setUsername(nextUsername);
    setGeneratedUsername({ previous: previousUsername, generated: nextUsername });
    setLocalError("");
  };
  const errorMessage = usernameValidationError || localError || (suggestUsername.error instanceof Error ? suggestUsername.error.message : "") || error;

  return (
    <div className="modal-backdrop modal-backdrop-top">
      <form className="case-modal compact-modal action-modal edit-profile-modal" onSubmit={submit}>
        <header>
          <h3>{t("profile.editProfile")}</h3>
          <button type="button" onClick={onClose} aria-label={t("common.close")}>
            <X size={18} />
          </button>
        </header>
        <div className="edit-profile-avatar-wrap">
          <button
            className="edit-profile-avatar"
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            disabled={pending}
            aria-label={t("profile.editProfile")}
          >
            {visibleAvatarUrl ? <img src={visibleAvatarUrl} alt="" /> : <span>{visibleAvatarText}</span>}
            <span className="edit-profile-avatar-camera" aria-hidden="true">
              <Camera size={16} />
            </span>
          </button>
          <div className="edit-profile-account">{account}</div>
          <input
            ref={avatarInputRef}
            className="settings-avatar-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif"
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null;
              event.target.value = "";
              if (!file) return;
              if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
              setAvatarFile(file);
              setAvatarPreviewUrl(URL.createObjectURL(file));
            }}
          />
        </div>
        <label className="edit-profile-field">
          <span>{t("profile.username")}</span>
          <div className={cx("edit-profile-username-control", canUndoGeneratedUsername && "with-undo")}>
            <input
              value={username}
              autoComplete="name"
              aria-invalid={Boolean(usernameValidationError)}
              onChange={(event) => {
                const nextUsername = event.target.value;
                setUsername(nextUsername);
                if (generatedUsername && nextUsername !== generatedUsername.generated) setGeneratedUsername(null);
              }}
              autoFocus
            />
            <div className="edit-profile-username-actions">
              {canUndoGeneratedUsername ? (
                <button
                  className="edit-profile-username-action"
                  type="button"
                  disabled={pending || suggestUsername.isPending}
                  aria-label={t("profile.undoGeneratedUsername")}
                  title={t("profile.undoGeneratedUsername")}
                  onClick={() => {
                    if (!generatedUsername) return;
                    setUsername(generatedUsername.previous);
                    setGeneratedUsername(null);
                    suggestUsername.reset();
                  }}
                >
                  <RotateCcw size={16} />
                </button>
              ) : null}
              <button
                className="edit-profile-username-action"
                type="button"
                disabled={pending || suggestUsername.isPending}
                aria-label={canUndoGeneratedUsername ? t("profile.generateUsernameAgain") : t("profile.generateUsername")}
                title={canUndoGeneratedUsername ? t("profile.generateUsernameAgain") : t("profile.generateUsername")}
                onClick={generateUsername}
              >
                <Sparkles size={16} />
              </button>
            </div>
          </div>
          {suggestUsername.isPending || usernameSuggestions.length > 0 ? (
            <div className="edit-profile-username-suggestions" aria-live="polite">
              {suggestUsername.isPending ? (
                <span className="edit-profile-username-suggestion-label">{t("common.loading")}</span>
              ) : (
                usernameSuggestions.map((candidate) => (
                  <button
                    key={candidate}
                    className={cx("edit-profile-username-suggestion", trimmedUsername === candidate && "selected")}
                    type="button"
                    disabled={pending}
                    aria-pressed={trimmedUsername === candidate}
                    onClick={() => selectUsernameSuggestion(candidate)}
                  >
                    {candidate}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </label>
        {errorMessage ? <div className="form-error">{errorMessage}</div> : null}
        <div className="row-actions">
          <button className="secondary-btn" type="button" onClick={onClose} disabled={pending}>
            {t("common.cancel")}
          </button>
          <button
            className="primary-btn"
            type="submit"
            disabled={pending || suggestUsername.isPending || Boolean(usernameValidationError) || (!usernameChanged && !avatarChanged)}
          >
            {pending ? t("common.saving") : t("common.save")}
          </button>
        </div>
      </form>
    </div>
  );
}
