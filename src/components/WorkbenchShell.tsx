import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FocusEvent, FormEvent, MouseEvent } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { Camera, ChevronRight, FolderOpen, Images, Lightbulb, LogOut, Menu, MessageCircle, MessageCirclePlus, PanelLeft, Pin, PinOff, RotateCcw, Search, Settings, ShieldCheck, Sparkles, X } from "lucide-react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
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
const USERNAME_RULE_MESSAGE =
  "用户名支持中文、英文、数字、单个空格、下划线和短横线，长度 2-20 个字符，不支持首尾空格或连续空格";
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

function validateProfileUsername(value: string) {
  const username = value.trim();
  if (!username) return "请填写用户名";
  if (value !== username) return USERNAME_RULE_MESSAGE;
  if (/ {2,}/.test(username)) return USERNAME_RULE_MESSAGE;
  if (/[^\S ]/.test(username)) return USERNAME_RULE_MESSAGE;
  if (!/^[\u4e00-\u9fffA-Za-z0-9_ -]+$/.test(username)) return USERNAME_RULE_MESSAGE;
  if (!/[\u4e00-\u9fffA-Za-z]/.test(username)) return "用户名至少包含一个中文或英文字母";
  const length = Array.from(username).length;
  return length >= 2 && length <= 20 ? "" : USERNAME_RULE_MESSAGE;
}

function userPreferencesToast(preferences: Partial<UserPreferences>) {
  if (preferences.promptOptimizeStyleGroups) {
    return "AI 优化风格已保存";
  }
  if (typeof preferences.editSuggestionsEnabled === "boolean") {
    return preferences.editSuggestionsEnabled ? "续改建议已开启" : "续改建议已关闭";
  }
  if (typeof preferences.autoUploadPastedAssets === "boolean") {
    return preferences.autoUploadPastedAssets ? "自动上传素材库已开启" : "自动上传素材库已关闭";
  }
  if (preferences.editSuggestionTone) {
    const labels: Record<UserPreferences["editSuggestionTone"], string> = {
      default: "默认",
      practical: "实用优化",
      creative: "创意扩展",
      detail: "细节修复"
    };
    return `建议倾向已切换为：${labels[preferences.editSuggestionTone] ?? "默认"}`;
  }
  return "个性化设置已保存";
}

function sidebarSessionTitle(title: string) {
  const normalized = title.replace(/\s+/g, " ").trim();
  return normalized || "新的图像对话";
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
  ellipsisWhenTruncated = false
}: {
  title: string;
  titleStatus?: ChatSession["titleStatus"];
  className: string;
  ellipsisWhenTruncated?: boolean;
}) {
  const titlePending = titleStatus === "pending";
  const normalizedTitle = sidebarSessionTitle(title);
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
      aria-label={titlePending ? "标题生成中" : normalizedTitle}
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
  const userAccountLabel = user.account?.trim() || "未设置账号";
  const deleteAccountConfirmationText = `${user.username.trim()}确认删除账户`;
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
  const sidebarToggleLabel = sidebarCollapsed ? "打开边栏" : "关闭边栏";
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
      showToast(error instanceof Error ? error.message : "删除账户失败", "error");
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
      showToast(payload.archived ? "已归档聊天" : "已取消归档");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "操作失败", "error");
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
      showToast(payload.pinned ? "已置顶聊天" : "已取消置顶");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "置顶失败", "error");
    }
  });
  const renameChat = useMutation({
    mutationFn: (payload: { sessionId: string; title: string }) => api.renameSession(payload.sessionId, payload.title),
    onSuccess: ({ session }) => {
      patchSessionInCache(session);
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      showToast("聊天已重命名");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "重命名失败", "error");
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
      showToast(archived > 0 ? "已归档所有聊天" : "没有可归档的聊天", archived > 0 ? "success" : "info");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "全部归档失败", "error");
    }
  });
  const unarchiveAllChats = useMutation({
    mutationFn: api.unarchiveAllSessions,
    onSuccess: ({ restored }) => {
      queryClient.setQueryData<SessionPage>(["sessions", "archived"], (current) =>
        current ? { ...current, sessions: [], pageInfo: { ...current.pageInfo, total: 0, hasMore: false } } : current
      );
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      showToast(restored > 0 ? "已取消全部归档" : "没有已归档聊天", restored > 0 ? "success" : "info");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "全部取消归档失败", "error");
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
      showToast("已删除聊天及关联图片、灵感、素材");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "删除聊天失败", "error");
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
      showToast("已删除所有聊天及关联图片、灵感、素材");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "删除所有聊天失败", "error");
    }
  });
  const changePassword = useMutation({
    mutationFn: api.changePassword,
    onSuccess: () => {
      setPasswordDialogOpen(false);
      showToast("密码已修改，请重新登录");
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
      showToast("个人资料已保存");
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "个人资料保存失败", "error");
    }
  });
  const saveAppearanceMode = useMutation({
    mutationFn: api.saveAppearanceMode,
    onSuccess: (data) => {
      queryClient.setQueryData(["me"], { user: data.user });
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "主题保存失败", "error");
    }
  });
  const saveUserPreferences = useMutation({
    mutationFn: (preferences: Partial<UserPreferences>) => api.saveUserPreferences(preferences),
    onSuccess: (data, preferences) => {
      queryClient.setQueryData(["me"], { user: data.user });
      queryClient.invalidateQueries({ queryKey: ["image-edit-suggestions"] });
      showToast(userPreferencesToast(preferences));
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : "个性化设置保存失败", "error");
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
      showToast(error instanceof Error ? error.message : "无法进入管理后台", "error");
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
      showToast("浏览器阻止了新标签页，请允许弹窗后重试", "error");
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

  const handleImageJobEvent = useCallback((payload: ImageJobEventPayload) => {
    const sessionId = payload.sessionId.trim();
    if (!sessionId) return;
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
      const sessionTitleLabel = titlePending ? "标题生成中" : session.title;
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
            />
          </NavLink>
          {generationState ? (
            <span
              className={cx("recent-generation-status", generationState)}
              role="status"
              aria-label={generationState === "running" ? "图片生成中" : "图片已生成"}
            />
          ) : null}
          <button
            className={cx("session-pin-trigger", pinned && "is-pinned")}
            type="button"
            disabled={sessionActionPending}
            aria-label={pinned ? "取消置顶聊天" : "置顶聊天"}
            title={pinned ? "取消置顶" : "置顶"}
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
            onOpenChange={(open) => setOpenSessionMenuId(open ? session.id : null)}
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
      <button className="mobile-menu-btn" onClick={() => setMobileMenuOpen(true)} aria-label="打开菜单">
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
                  aria-label="回到对话记录顶部"
                  title="回到对话记录顶部"
                >
                  <ProjectLogo className="sidebar-logo" />
                </button>
              </div>
              <div className="sidebar-head-actions">
                {!sidebarCollapsed ? (
                  <button
                    className="sidebar-head-search"
                    type="button"
                    aria-label="搜索聊天"
                    onMouseEnter={(event) => showSidebarFloatingTip(event, { label: "搜索聊天", shortcut: "Ctrl + K" })}
                    onMouseLeave={hideSidebarFloatingTip}
                    onFocus={(event) => showSidebarFloatingTip(event, { label: "搜索聊天", shortcut: "Ctrl + K" })}
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
                <button className="icon-btn mobile-only" onClick={() => setMobileMenuOpen(false)} aria-label="关闭菜单">
                  <X size={18} />
                </button>
              </div>
            </div>
            <nav className="main-nav-actions" onClick={() => setMobileMenuOpen(false)}>
              <NavLink
                to="/"
                end
                className={({ isActive }) => cx("nav-item", "nav-item-with-shortcut-tip", isActive && "active")}
                aria-label="新对话"
                onPointerDown={pauseRenderingBeforeRouteNavigation}
                onClick={() => {
                  pauseRenderingBeforeRouteNavigation();
                  openCurrentOrNewChat();
                }}
              >
                <MessageCirclePlus size={18} />
                <span>新对话</span>
                <div className="sidebar-shortcut-tip" role="tooltip" aria-hidden="true">
                  <strong>新聊天</strong>
                  <kbd>Ctrl + Shift + O</kbd>
                </div>
              </NavLink>
              {sidebarCollapsed ? (
                <button
                  type="button"
                  className={cx("nav-item", "nav-item-with-shortcut-tip", searchOpen && "active")}
                  aria-label="搜索聊天"
                  onClick={() => {
                    setSearchOpen(true);
                    setMobileMenuOpen(false);
                  }}
                >
                  <Search size={18} />
                  <span>搜索聊天</span>
                  <div className="sidebar-shortcut-tip" role="tooltip" aria-hidden="true">
                    <strong>搜索聊天</strong>
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
                aria-label="灵感空间"
                data-sidebar-tip="灵感空间"
                onPointerDown={pauseRenderingBeforeRouteNavigation}
                onClick={pauseRenderingBeforeRouteNavigation}
              >
                <Lightbulb size={18} />
                <span>灵感空间</span>
              </NavLink>
              <NavLink
                to="/assets"
                className={({ isActive }) => cx("nav-item", isActive && "active")}
                aria-label="素材库"
                data-sidebar-tip="素材库"
                onPointerDown={pauseRenderingBeforeRouteNavigation}
                onClick={pauseRenderingBeforeRouteNavigation}
              >
                <FolderOpen size={18} />
                <span>素材库</span>
              </NavLink>
              <NavLink
                to="/images"
                className={({ isActive }) => cx("nav-item", isActive && "active")}
                aria-label="我的图片"
                data-sidebar-tip="我的图片"
                onPointerDown={pauseRenderingBeforeRouteNavigation}
                onClick={pauseRenderingBeforeRouteNavigation}
              >
                <Images size={18} />
                <span>我的图片</span>
              </NavLink>
              <NavLink
                to="/prompt-templates"
                className={({ isActive }) => cx("nav-item", isActive && "active")}
                aria-label="创作提示词"
                data-sidebar-tip="创作提示词"
                onPointerDown={pauseRenderingBeforeRouteNavigation}
                onClick={pauseRenderingBeforeRouteNavigation}
              >
                <Sparkles size={18} />
                <span>创作提示词</span>
              </NavLink>
            </nav>
            <div className="collapsed-recent-wrap" ref={collapsedRecentRef}>
              <button
                className={cx("nav-item", "collapsed-recent-trigger", collapsedRecentOpen && "active")}
                type="button"
                onClick={toggleCollapsedRecent}
                onPointerDown={(event) => event.stopPropagation()}
                aria-label="最近聊天"
                aria-expanded={collapsedRecentOpen}
                data-sidebar-tip="最近聊天"
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
                  <h2>已置顶</h2>
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
                <h2>最近</h2>
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
              aria-label="查看用户信息"
              aria-expanded={userCardOpen && !userCardClosing}
              data-sidebar-tip="查看用户信息"
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
              aria-label="退出登录"
              data-sidebar-tip="退出登录"
            >
              <LogOut size={18} />
            </button>
          </div>
          {userCardVisible ? (
            <div
              className={cx("user-info-card", "ui-pop-motion")}
              role="dialog"
              aria-label="用户信息"
              data-state={userCardClosing ? "closing" : "open"}
              data-placement={sidebarCollapsed ? "bottom-start" : "top-start"}
            >
              <button className="user-info-action" type="button" onClick={openSettingsDialog}>
                <Settings size={16} />
                <span>设置</span>
              </button>
              {user.hasConfigAccess ? (
                <button
                  className="user-info-action"
                  type="button"
                  onClick={openConfigDashboard}
                  disabled={configAccess.isPending}
                >
                  <ShieldCheck size={16} />
                  <span>{configAccess.isPending ? "进入中" : "管理后台"}</span>
                </button>
              ) : null}
              <button
                className="user-info-action user-info-logout"
                type="button"
                onClick={requestLogout}
                disabled={logout.isPending}
              >
                <LogOut size={16} />
                <span>{logout.isPending ? "退出中" : "退出登录"}</span>
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
              aria-label="最近聊天"
              style={collapsedRecentCardStyle}
              data-state="open"
              data-placement="bottom-start"
              ref={collapsedRecentCardRef}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <header>最近聊天</header>
              <div className="collapsed-recent-card-list">
                {showInitialSessionSkeleton ? <div className="collapsed-recent-empty">加载中...</div> : null}
                {!showInitialSessionSkeleton && collapsedRecentSessions.length === 0 ? (
                  <div className="collapsed-recent-empty">暂无聊天</div>
                ) : null}
                {collapsedRecentSessions.map((session) => {
                  const isCurrentSession = session.id === activeChatSessionId;
                  const titlePending = session.titleStatus === "pending";
                  return (
                    <NavLink
                      key={session.id}
                      to={`/chat/${session.id}`}
                      title={titlePending ? "标题生成中" : session.title}
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
                      <SidebarSessionTitle title={session.title} titleStatus={session.titleStatus} className="collapsed-recent-card-title" />
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
        title="确认退出登录"
        description="退出后需要重新登录，确认现在退出吗？"
        confirmText="退出登录"
        cancelText="取消"
        destructive
        onConfirm={confirmLogout}
        onCancel={() => setLogoutConfirmOpen(false)}
      />
      <ConfirmDialog
        open={deleteAccountConfirmOpen}
        title="删除账户"
        description="删除后会退出登录，并清理该账户的聊天、图片、素材、灵感空间内容、提示词表单和个人设置。该操作不可恢复。"
        confirmText={deleteAccount.isPending ? "删除中" : "删除账户"}
        cancelText="取消"
        confirmationText={deleteAccountConfirmationText}
        confirmationLabel={`请输入“${deleteAccountConfirmationText}”确认删除账户`}
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
        title="删除聊天"
        description={`会从聊天列表删除。该聊天生成的图片会从我的图片删除；基于这些图片保存到灵感空间的灵感、加入素材库的素材也会同步删除。确认删除「${deleteSessionTarget?.title ?? ""}」吗？`}
        confirmText="删除"
        cancelText="取消"
        confirmationText="确认"
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
        title="归档所有聊天"
        description={`将把当前 ${activeSessionTotal} 条聊天移入已归档列表，确认继续吗？`}
        confirmText="全部归档"
        cancelText="取消"
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
        title="删除所有聊天"
        description="会从聊天列表删除所有聊天和已归档聊天。相关生成图片会从我的图片删除；基于这些图片保存到灵感空间的灵感、加入素材库的素材也会同步删除。确认继续吗？"
        confirmText="全部删除"
        cancelText="取消"
        confirmationText="确认"
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
          <Route path="/cases" element={<CasesPage />} />
          <Route path="/cases/barrage" element={<InspirationBarragePage />} />
          <Route path="/prompt-templates" element={<PromptTemplatesPage />} />
          <Route path="/prompt-templates/:templateId/edit" element={<PromptTemplateEditorPage />} />
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/images" element={<ImagesPage />} />
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

  useEffect(() => {
    setLocalError("");
  }, [currentPassword, newPassword, confirmPassword]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (!currentPassword || !newPassword) {
      setLocalError("请填写当前密码和新密码");
      return;
    }
    if (newPassword !== confirmPassword) {
      setLocalError("两次输入的新密码不一致");
      return;
    }
    onSubmit({ currentPassword, newPassword });
  };
  const errorMessage = localError || error;

  return (
    <div className="modal-backdrop modal-backdrop-top">
      <form className="case-modal compact-modal action-modal change-password-modal" onSubmit={submit}>
        <header>
          <h3>修改密码</h3>
          <button type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        <label>
          当前密码
          <input
            value={currentPassword}
            type="password"
            autoComplete="current-password"
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoFocus
          />
        </label>
        <label>
          新密码
          <input
            value={newPassword}
            type="password"
            autoComplete="new-password"
            onChange={(event) => setNewPassword(event.target.value)}
          />
        </label>
        <label>
          确认新密码
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
            取消
          </button>
          <button className="primary-btn" type="submit" disabled={pending || !currentPassword || !newPassword || !confirmPassword}>
            {pending ? "保存中" : "保存"}
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
  const trimmedUsername = username.trim();
  const currentTrimmedUsername = currentUsername.trim();
  const usernameValidationError = validateProfileUsername(username);
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
      setLocalError("个人资料没有变化");
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
          <h3>编辑个人资料</h3>
          <button type="button" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>
        <div className="edit-profile-avatar-wrap">
          <button
            className="edit-profile-avatar"
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            disabled={pending}
            aria-label="修改头像"
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
          <span>用户名</span>
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
                  aria-label="撤销生成的用户名"
                  title="撤销生成的用户名"
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
                aria-label={canUndoGeneratedUsername ? "再次生成用户名" : "自动生成用户名"}
                title={canUndoGeneratedUsername ? "再次生成用户名" : "自动生成用户名"}
                onClick={generateUsername}
              >
                <Sparkles size={16} />
              </button>
            </div>
          </div>
          {suggestUsername.isPending || usernameSuggestions.length > 0 ? (
            <div className="edit-profile-username-suggestions" aria-live="polite">
              {suggestUsername.isPending ? (
                <span className="edit-profile-username-suggestion-label">生成中</span>
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
            取消
          </button>
          <button
            className="primary-btn"
            type="submit"
            disabled={pending || suggestUsername.isPending || Boolean(usernameValidationError) || (!usernameChanged && !avatarChanged)}
          >
            {pending ? "保存中" : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}
