import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderOpen, Images, Lightbulb, MessageCircle, MessageCirclePlus, Search, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useI18n } from "../i18n";
import { formatDate } from "../lib/format";
import { promptTemplateIconFor } from "../lib/promptTemplateIcons";
import { chronologicalWorkImages, workImageFromLibraryCard } from "../lib/workImages";
import { useWorkbench, type ImageLibraryContinuations } from "../store/workbench";
import type { ChatSession, GlobalSearchItem, GlobalSearchResultScope } from "../types";
import { useToast } from "../ui";
import { SearchHistoryInput } from "./SearchHistoryInput";
import { SkeletonImage } from "./SkeletonImage";

const SEARCH_CHAT_RESULT_LIMIT = 80;
const GLOBAL_SEARCH_GROUP_LIMIT = 5;
const GLOBAL_SEARCH_TABS = ["all", "chat", "images", "assets", "cases", "promptTemplates"] as const;

type GlobalSearchTabScope = (typeof GLOBAL_SEARCH_TABS)[number];

function resultKey(item: GlobalSearchItem) {
  return `${item.scope}:${item.id}`;
}

function resultPath(item: GlobalSearchItem, keyword: string) {
  if (item.scope === "chat") return `/chat/${encodeURIComponent(item.id)}`;
  const params = new URLSearchParams();
  params.set("keyword", keyword);
  if (item.scope === "promptTemplates") {
    params.set("scope", "all");
    params.set("template", item.id);
    return `/prompt-templates?${params.toString()}`;
  }
  params.set("open", item.id);
  return `/${item.scope}?${params.toString()}`;
}

function ResultIcon({ item }: { item: GlobalSearchItem }) {
  if ((item.scope === "images" || item.scope === "assets" || item.scope === "cases") && item.thumbnailUrl) {
    return (
      <span className="global-search-result-thumb">
        <SkeletonImage src={item.thumbnailUrl} alt="" />
      </span>
    );
  }
  if (item.scope === "chat") return <MessageCircle size={19} />;
  if (item.scope === "images") return <Images size={19} />;
  if (item.scope === "assets") return <FolderOpen size={19} />;
  if (item.scope === "cases") return <Lightbulb size={19} />;
  const PromptTemplateIcon = promptTemplateIconFor(item.icon);
  return <PromptTemplateIcon size={19} />;
}

export function SearchChatModal({ sessions, onClose }: { sessions: ChatSession[]; onClose: () => void }) {
  const { t } = useI18n();
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [activeScope, setActiveScope] = useState<GlobalSearchTabScope>("all");
  const [activeResultIndex, setActiveResultIndex] = useState(-1);
  const [openingImageId, setOpeningImageId] = useState("");
  const [tabIndicator, setTabIndicator] = useState({ left: 0, width: 0, ready: false });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const tabButtonRefs = useRef(new Map<GlobalSearchTabScope, HTMLButtonElement>());
  const navigate = useNavigate();
  const location = useLocation();
  const { showToast } = useToast();
  const resetNewChatComposer = useWorkbench((state) => state.resetNewChatComposer);
  const setDraftPrompt = useWorkbench((state) => state.setDraftPrompt);
  const setEditImage = useWorkbench((state) => state.setEditImage);
  const setEditorImageRequest = useWorkbench((state) => state.setEditorImageRequest);
  const normalizedInput = keyword.trim();
  const searchKeyword = debouncedKeyword.trim();
  const allSearchResults = useQuery({
    queryKey: ["global-search", "all", searchKeyword, 0],
    queryFn: ({ signal }) =>
      api.globalSearch(
        {
          q: searchKeyword,
          scope: "all",
          limit: GLOBAL_SEARCH_GROUP_LIMIT,
          offset: 0
        },
        { signal }
      ),
    enabled: Boolean(searchKeyword),
    staleTime: 30_000
  });
  const scopedSearchResults = useQuery({
    queryKey: ["global-search", activeScope, searchKeyword, 0],
    queryFn: ({ signal }) =>
      api.globalSearch(
        {
          q: searchKeyword,
          scope: activeScope,
          limit: SEARCH_CHAT_RESULT_LIMIT,
          offset: 0
        },
        { signal }
      ),
    enabled: Boolean(searchKeyword) && activeScope !== "all",
    staleTime: 30_000
  });
  const searchResults = activeScope === "all" ? allSearchResults : scopedSearchResults;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedKeyword(normalizedInput), 250);
    return () => window.clearTimeout(timer);
  }, [normalizedInput]);

  useEffect(() => {
    if (!normalizedInput) {
      setDebouncedKeyword("");
      setActiveScope("all");
      setActiveResultIndex(-1);
    }
  }, [normalizedInput]);

  useEffect(() => {
    inputRef.current?.focus();
    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleDocumentKeyDown);
    return () => document.removeEventListener("keydown", handleDocumentKeyDown);
  }, [onClose]);

  const filteredSessions = useMemo(() => sessions.slice(0, SEARCH_CHAT_RESULT_LIMIT), [sessions]);
  const recentGroups = useMemo(() => {
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const grouped: Array<{ label: string; items: ChatSession[] }> = [
      { label: t("searchChat.today"), items: [] },
      { label: t("searchChat.yesterday"), items: [] },
      { label: t("searchChat.earlier"), items: [] }
    ];
    for (const session of filteredSessions) {
      const time = new Date(session.updatedAt).getTime();
      if (time >= todayStart) grouped[0].items.push(session);
      else if (time >= yesterdayStart) grouped[1].items.push(session);
      else grouped[2].items.push(session);
    }
    return grouped.filter((group) => group.items.length > 0);
  }, [filteredSessions, t]);

  const visibleGroups = useMemo(
    () => normalizedInput === searchKeyword
      ? (searchResults.data?.groups ?? []).filter((group) => group.items.length > 0)
      : [],
    [normalizedInput, searchKeyword, searchResults.data?.groups]
  );
  const flatResults = useMemo(() => visibleGroups.flatMap((group) => group.items), [visibleGroups]);
  const resultIndexes = useMemo(
    () => new Map(flatResults.map((item, index) => [resultKey(item), index])),
    [flatResults]
  );
  const tabCounts = useMemo(() => {
    const counts = new Map<GlobalSearchResultScope, number>();
    if (normalizedInput === searchKeyword) {
      for (const group of allSearchResults.data?.groups ?? []) counts.set(group.scope, group.total);
    }
    return counts;
  }, [allSearchResults.data?.groups, normalizedInput, searchKeyword]);
  const allResultCount = useMemo(
    () => GLOBAL_SEARCH_TABS.slice(1).reduce(
      (total, scope) => total + (tabCounts.get(scope as GlobalSearchResultScope) ?? 0),
      0
    ),
    [tabCounts]
  );

  const updateTabIndicator = useCallback(() => {
    const activeButton = tabButtonRefs.current.get(activeScope);
    if (!activeButton) return;
    setTabIndicator({ left: activeButton.offsetLeft, width: activeButton.offsetWidth, ready: true });
  }, [activeScope]);

  useLayoutEffect(() => {
    updateTabIndicator();
    const tabList = tabListRef.current;
    const activeButton = tabButtonRefs.current.get(activeScope);
    if (!tabList || !activeButton) return;
    const observer = new ResizeObserver(updateTabIndicator);
    observer.observe(tabList);
    observer.observe(activeButton);
    const buttonStart = activeButton.offsetLeft;
    const buttonEnd = buttonStart + activeButton.offsetWidth;
    if (buttonStart < tabList.scrollLeft || buttonEnd > tabList.scrollLeft + tabList.clientWidth) {
      tabList.scrollTo({
        left: buttonStart - (tabList.clientWidth - activeButton.offsetWidth) / 2,
        behavior: "smooth"
      });
    }
    return () => observer.disconnect();
  }, [activeScope, allSearchResults.dataUpdatedAt, normalizedInput, updateTabIndicator]);

  useEffect(() => {
    setActiveResultIndex(flatResults.length > 0 ? 0 : -1);
  }, [activeScope, flatResults.length, searchResults.dataUpdatedAt]);

  useEffect(() => {
    if (activeResultIndex < 0) return;
    const activeButton = document.querySelector<HTMLElement>(`[data-global-search-index="${activeResultIndex}"]`);
    activeButton?.scrollIntoView({ block: "nearest" });
  }, [activeResultIndex]);

  const openPath = useCallback((path: string) => {
    if (path === "/" && location.pathname === "/") resetNewChatComposer();
    onClose();
    navigate(path);
  }, [location.pathname, navigate, onClose, resetNewChatComposer]);

  const openResult = useCallback(async (item: GlobalSearchItem) => {
    if (item.scope === "images") {
      if (openingImageId) return;
      setOpeningImageId(item.id);
      try {
        const { image } = await api.imageDetail(item.id);
        if (!image) throw new Error("Image not found");
        let editorImages = [image];
        let libraryContinuations: ImageLibraryContinuations | undefined;
        if (image.sessionId) {
          const [olderPage, newerPage] = await Promise.all([
            api.libraryImages({ sessionId: image.sessionId, anchorId: image.id, sort: "desc", limit: 15 }).catch(() => null),
            api.libraryImages({ sessionId: image.sessionId, anchorId: image.id, sort: "asc", limit: 15 }).catch(() => null)
          ]);
          const cards = chronologicalWorkImages(
            Array.from(new Map(
              [...(olderPage?.items ?? []), ...(newerPage?.items ?? [])]
                .map((card) => [card.id, workImageFromLibraryCard(card)])
            ).values())
          );
          const activeIndex = cards.findIndex((card) => card.id === image.id);
          if (activeIndex >= 0) {
            const neighbors = cards.slice(Math.max(0, activeIndex - 1), activeIndex + 2);
            const neighborDetails = await Promise.all(
              neighbors
                .filter((card) => card.id !== image.id)
                .map((card) => api.imageDetail(card.id).then((result) => result.image).catch(() => null))
            );
            const detailsById = new Map([
              [image.id, image],
              ...neighborDetails
                .filter((detail): detail is NonNullable<typeof detail> => Boolean(detail))
                .map((detail) => [detail.id, detail] as const)
            ]);
            editorImages = cards.map((card) => detailsById.get(card.id) ?? card);
            libraryContinuations = {
              ...(newerPage?.pageInfo.hasMore && newerPage.pageInfo.nextCursor
                ? {
                    newer: {
                      sessionId: image.sessionId,
                      anchorId: image.id,
                      sort: "asc" as const,
                      nextCursor: newerPage.pageInfo.nextCursor,
                      hasMore: true
                    }
                  }
                : {}),
              ...(olderPage?.pageInfo.hasMore && olderPage.pageInfo.nextCursor
                ? {
                    older: {
                      sessionId: image.sessionId,
                      anchorId: image.id,
                      sort: "desc" as const,
                      nextCursor: olderPage.pageInfo.nextCursor,
                      hasMore: true
                    }
                  }
                : {})
            };
          }
        }
        setOpeningImageId("");
        setDraftPrompt("");
        setEditImage(null);
        setEditorImageRequest({ image, images: editorImages, imageSort: "asc", libraryContinuations });
        onClose();
        navigate("/");
      } catch {
        setOpeningImageId("");
        showToast(t("globalSearch.openUnavailable"), "error");
      }
      return;
    }
    openPath(resultPath(item, normalizedInput));
  }, [navigate, normalizedInput, onClose, openPath, openingImageId, setDraftPrompt, setEditImage, setEditorImageRequest, showToast, t]);

  const selectScope = useCallback((scope: GlobalSearchTabScope, focus = false) => {
    setActiveScope(scope);
    setActiveResultIndex(-1);
    if (focus) window.requestAnimationFrame(() => tabButtonRefs.current.get(scope)?.focus());
  }, []);

  const handleTabKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>, scope: GlobalSearchTabScope) => {
    const currentIndex = GLOBAL_SEARCH_TABS.indexOf(scope);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % GLOBAL_SEARCH_TABS.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + GLOBAL_SEARCH_TABS.length) % GLOBAL_SEARCH_TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = GLOBAL_SEARCH_TABS.length - 1;
    else return;
    event.preventDefault();
    selectScope(GLOBAL_SEARCH_TABS[nextIndex], true);
  }, [selectScope]);

  const handleInputKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" && flatResults.length > 0) {
      event.preventDefault();
      setActiveResultIndex((value) => (value + 1 + flatResults.length) % flatResults.length);
      return;
    }
    if (event.key === "ArrowUp" && flatResults.length > 0) {
      event.preventDefault();
      setActiveResultIndex((value) => (value - 1 + flatResults.length) % flatResults.length);
      return;
    }
    if (event.key === "Enter" && activeResultIndex >= 0 && flatResults[activeResultIndex]) {
      event.preventDefault();
      openResult(flatResults[activeResultIndex]);
    }
  }, [activeResultIndex, flatResults, openResult]);

  const searchPending = Boolean(normalizedInput) && (normalizedInput !== searchKeyword || searchResults.isFetching);
  const searchSettled = Boolean(searchKeyword) && normalizedInput === searchKeyword && !searchResults.isFetching;

  return (
    <div className="search-modal-backdrop" onMouseDown={onClose}>
      <section className="search-modal global-search-modal" role="dialog" aria-modal="true" aria-label={t("globalSearch.aria")} onMouseDown={(event) => event.stopPropagation()}>
        <header className="search-modal-head">
          <SearchHistoryInput
            scope="global"
            ref={inputRef}
            value={keyword}
            onChange={setKeyword}
            onKeyDown={handleInputKeyDown}
            placeholder={t("globalSearch.placeholder")}
            ariaLabel={t("globalSearch.aria")}
            className="search-modal-input"
            icon={<Search size={18} />}
            recordEnabled={Boolean(searchKeyword)
              && normalizedInput === searchKeyword
              && !allSearchResults.isFetching
              && !allSearchResults.isError
              && allResultCount > 0}
          />
          <button type="button" onClick={onClose} aria-label={t("globalSearch.close")}>
            <X size={20} />
          </button>
        </header>
        <div className={normalizedInput ? "global-search-body has-tabs" : "global-search-body"}>
          {normalizedInput ? (
            <div className="global-search-tabs-shell">
              <div className="global-search-tabs" ref={tabListRef} role="tablist" aria-label={t("globalSearch.categories")}>
                <span
                  className={tabIndicator.ready ? "global-search-tab-indicator ready" : "global-search-tab-indicator"}
                  style={{ width: tabIndicator.width, transform: `translateX(${tabIndicator.left}px)` }}
                  aria-hidden="true"
                />
                {GLOBAL_SEARCH_TABS.map((scope) => {
                  const count = scope === "all" ? allResultCount : tabCounts.get(scope);
                  const active = activeScope === scope;
                  return (
                    <button
                      key={scope}
                      id={`global-search-tab-${scope}`}
                      ref={(node) => {
                        if (node) tabButtonRefs.current.set(scope, node);
                        else tabButtonRefs.current.delete(scope);
                      }}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-controls="global-search-results"
                      tabIndex={active ? 0 : -1}
                      className={active ? "global-search-tab active" : "global-search-tab"}
                      onClick={() => selectScope(scope)}
                      onKeyDown={(event) => handleTabKeyDown(event, scope)}
                    >
                      <span>{t(`globalSearch.tab.${scope}`)}</span>
                      <small>{normalizedInput === searchKeyword && !allSearchResults.isFetching ? (count ?? 0) : "—"}</small>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div
            id="global-search-results"
            className="search-modal-list global-search-list"
            aria-busy={searchPending}
            role={normalizedInput ? "tabpanel" : undefined}
            aria-labelledby={normalizedInput ? `global-search-tab-${activeScope}` : undefined}
          >
            {!normalizedInput ? (
              <>
                <button type="button" className="search-new-chat" onClick={() => openPath("/")}>
                  <MessageCirclePlus size={18} />
                  <span>{t("searchChat.newChat")}</span>
                </button>
                {recentGroups.length === 0 ? <div className="search-empty">{t("searchChat.noMatch")}</div> : null}
                {recentGroups.map((group) => (
                  <section key={group.label} className="search-result-group">
                    <h3>{group.label}</h3>
                    {group.items.map((session) => (
                      <button key={session.id} type="button" onClick={() => openPath(`/chat/${session.id}`)}>
                        <MessageCircle size={18} />
                        <span>{session.title}</span>
                        <time>{formatDate(session.updatedAt)}</time>
                      </button>
                    ))}
                  </section>
                ))}
              </>
            ) : (
              <>
                {searchPending ? <div className="search-empty global-search-status">{t("globalSearch.searching")}</div> : null}
                {searchSettled && searchResults.isError ? <div className="search-empty global-search-status">{t("globalSearch.failed")}</div> : null}
                {searchSettled && !searchResults.isError && visibleGroups.length === 0 ? <div className="search-empty global-search-status">{t("globalSearch.noMatch")}</div> : null}
                {visibleGroups.map((group) => (
                  <section key={group.scope} className={activeScope === "all" ? "search-result-group global-search-result-group" : "search-result-group global-search-result-group is-tab-panel"}>
                    {activeScope === "all" ? (
                      <header className="global-search-group-head">
                        <h3>{t(`globalSearch.group.${group.scope}`, { count: group.total })}</h3>
                        {group.total > group.items.length ? (
                          <button type="button" onClick={() => selectScope(group.scope)}>
                            {t("globalSearch.viewAll", { count: group.total })}
                          </button>
                        ) : null}
                      </header>
                    ) : null}
                    {group.items.map((item) => {
                      const resultIndex = resultIndexes.get(resultKey(item)) ?? -1;
                      const isActive = resultIndex === activeResultIndex;
                      return (
                        <button
                          key={resultKey(item)}
                          type="button"
                          className={isActive ? "global-search-result active" : "global-search-result"}
                          data-global-search-index={resultIndex}
                          aria-selected={isActive}
                          aria-busy={item.scope === "images" && openingImageId === item.id}
                          disabled={Boolean(openingImageId)}
                          onMouseEnter={() => setActiveResultIndex(resultIndex)}
                          onClick={() => void openResult(item)}
                        >
                          <ResultIcon item={item} />
                          <span className="global-search-result-copy">
                            <strong>{item.title}</strong>
                            {item.scope === "chat" && item.matchedPrompt ? <small>{item.matchedPrompt}</small> : null}
                            {item.scope === "images" ? <small>{t(`globalSearch.image.${item.kind}`)} · {item.size}</small> : null}
                            {item.scope === "assets" ? <small>{item.categoryNames.length > 0 ? item.categoryNames.join(" / ") : item.sourceUsername}</small> : null}
                            {item.scope === "cases" ? <small>{item.prompt}</small> : null}
                            {item.scope === "promptTemplates" && item.description ? <small>{item.description}</small> : null}
                          </span>
                          <time>{formatDate(item.scope === "chat" || item.scope === "promptTemplates" ? item.updatedAt : item.createdAt)}</time>
                        </button>
                      );
                    })}
                  </section>
                ))}
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
