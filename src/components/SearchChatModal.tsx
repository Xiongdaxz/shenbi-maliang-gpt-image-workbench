import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, MessageCirclePlus, Search, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useI18n } from "../i18n";
import { formatDate } from "../lib/format";
import { useWorkbench } from "../store/workbench";
import type { ChatSession } from "../types";
import { SearchHistoryInput } from "./SearchHistoryInput";

const SEARCH_CHAT_RESULT_LIMIT = 80;

export function SearchChatModal({ sessions, onClose }: { sessions: ChatSession[]; onClose: () => void }) {
  const { t } = useI18n();
  const [keyword, setKeyword] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const resetNewChatComposer = useWorkbench((state) => state.resetNewChatComposer);
  const searchKeyword = keyword.trim();
  const searchSessions = useQuery({
    queryKey: ["sessions", "search", searchKeyword],
    queryFn: ({ signal }) => api.sessions({ keyword: searchKeyword, limit: SEARCH_CHAT_RESULT_LIMIT }, { signal }),
    enabled: Boolean(searchKeyword)
  });
  const filteredSessions = useMemo(() => {
    const source = searchKeyword ? searchSessions.data?.sessions ?? [] : sessions;
    return source.slice(0, 80);
  }, [searchKeyword, searchSessions.data?.sessions, sessions]);

  useEffect(() => {
    inputRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const groups = useMemo(() => {
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

  const openSession = (path: string) => {
    if (path === "/" && location.pathname === "/") resetNewChatComposer();
    onClose();
    navigate(path);
  };

  return (
    <div className="search-modal-backdrop" onMouseDown={onClose}>
      <section className="search-modal" onMouseDown={(event) => event.stopPropagation()}>
        <header className="search-modal-head">
          <SearchHistoryInput
            scope="chat"
            ref={inputRef}
            value={keyword}
            onChange={setKeyword}
            placeholder={t("searchChat.placeholder")}
            ariaLabel={t("searchChat.aria")}
            className="search-modal-input"
            icon={<Search size={18} />}
          />
          <button type="button" onClick={onClose} aria-label={t("searchChat.close")}>
            <X size={20} />
          </button>
        </header>
        <div className="search-modal-list">
          <button type="button" className="search-new-chat" onClick={() => openSession("/")}>
            <MessageCirclePlus size={18} />
            <span>{t("searchChat.newChat")}</span>
          </button>
          {searchKeyword && searchSessions.isFetching ? <div className="search-empty">{t("searchChat.searching")}</div> : null}
          {groups.length === 0 && (!searchKeyword || !searchSessions.isFetching) ? <div className="search-empty">{t("searchChat.noMatch")}</div> : null}
          {groups.map((group) => (
            <section key={group.label} className="search-result-group">
              <h3>{group.label}</h3>
              {group.items.map((session) => (
                <button key={session.id} type="button" onClick={() => openSession(`/chat/${session.id}`)}>
                  <MessageCircle size={18} />
                  <span>{session.title}</span>
                  <time>{formatDate(session.updatedAt)}</time>
                </button>
              ))}
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}
