import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, Ref } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Trash2, X } from "lucide-react";
import { api } from "../api";
import { useI18n, type Translate } from "../i18n";
import { cx } from "../lib/cx";
import type { SearchHistoryScope } from "../types";

type SearchHistoryInputProps = {
  scope: SearchHistoryScope;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel?: string;
  autoFocus?: boolean;
  className?: string;
  icon?: ReactNode;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  recordEnabled?: boolean;
};

function setForwardedRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  if (ref) ref.current = value;
}

function formatRelativeTime(value: string, t: Translate) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (diffSeconds < 60) return t("searchHistory.justNow");
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return t("searchHistory.minutesAgo", { count: diffMinutes });
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return t("searchHistory.hoursAgo", { count: diffHours });
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return t("searchHistory.daysAgo", { count: diffDays });
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return t("searchHistory.monthsAgo", { count: diffMonths });
  return t("searchHistory.yearsAgo", { count: Math.floor(diffMonths / 12) });
}

export const SearchHistoryInput = forwardRef<HTMLInputElement, SearchHistoryInputProps>(function SearchHistoryInput(
  { scope, value, onChange, placeholder, ariaLabel, autoFocus, className, icon, onKeyDown, recordEnabled = true },
  forwardedRef
) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastRecordedRef = useRef({ key: "", at: 0 });
  const isComposingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const [isComposing, setIsComposing] = useState(false);
  const historyQuery = useQuery({
    queryKey: ["search-history", scope],
    queryFn: () => api.searchHistory(scope)
  });
  const invalidateHistory = () => queryClient.invalidateQueries({ queryKey: ["search-history", scope] });
  const saveHistory = useMutation({
    mutationFn: (keyword: string) => api.recordSearchHistory({ scope, keyword }),
    onSuccess: invalidateHistory,
    onError: () => {
      lastRecordedRef.current = { key: "", at: 0 };
    }
  });
  const deleteHistory = useMutation({
    mutationFn: (id: string) => api.deleteSearchHistory(id),
    onSuccess: invalidateHistory
  });
  const clearHistory = useMutation({
    mutationFn: () => api.clearSearchHistory(scope),
    onSuccess: invalidateHistory
  });
  const history = historyQuery.data?.history ?? [];
  const visibleHistory = useMemo(() => history.slice(0, 8), [history]);
  const shouldShowMenu = open && !inputValue.trim() && visibleHistory.length > 0;

  function recordKeyword(rawKeyword = value) {
    if (!recordEnabled || isComposingRef.current || isComposing) return;
    const keyword = rawKeyword.trim();
    if (!keyword) return;
    const key = `${scope}:${keyword.toLocaleLowerCase()}`;
    const currentTime = Date.now();
    if (lastRecordedRef.current.key === key && currentTime - lastRecordedRef.current.at < 30000) return;
    lastRecordedRef.current = { key, at: currentTime };
    saveHistory.mutate(keyword);
  }

  useEffect(() => {
    if (!recordEnabled || isComposingRef.current || isComposing) return;
    const keyword = value.trim();
    if (!keyword) return;
    const timer = window.setTimeout(() => recordKeyword(keyword), 900);
    return () => window.clearTimeout(timer);
  }, [isComposing, recordEnabled, scope, value]);

  useEffect(() => {
    if (isComposingRef.current || isComposing) return;
    setInputValue(value);
  }, [isComposing, value]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div className={cx("search-history-field", className)} ref={rootRef}>
      {icon}
      <input
        ref={(node) => {
          inputRef.current = node;
          setForwardedRef(forwardedRef, node);
        }}
        value={inputValue}
        autoFocus={autoFocus}
        autoComplete="off"
        aria-label={ariaLabel ?? placeholder}
        onChange={(event) => {
          const nextValue = event.target.value;
          setInputValue(nextValue);
          setOpen(!nextValue.trim());
          if (isComposingRef.current || isComposing || (event.nativeEvent as InputEvent).isComposing) return;
          onChange(nextValue);
        }}
        onCompositionStart={() => {
          isComposingRef.current = true;
          setIsComposing(true);
        }}
        onCompositionEnd={(event) => {
          const nextValue = event.currentTarget.value;
          isComposingRef.current = false;
          setIsComposing(false);
          setInputValue(nextValue);
          onChange(nextValue);
          setOpen(!nextValue.trim());
        }}
        onFocus={() => {
          setOpen(!inputValue.trim());
          historyQuery.refetch();
        }}
        onBlur={() => {
          window.setTimeout(() => {
            if (!rootRef.current?.contains(document.activeElement)) setOpen(false);
          }, 0);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (event.key === "Enter" && !event.nativeEvent.isComposing) recordKeyword();
          onKeyDown?.(event);
        }}
        placeholder={placeholder}
      />
      <button
        type="button"
        className="search-history-input-clear"
        aria-label={t("searchHistory.clearInput")}
        title={t("common.clear")}
        tabIndex={inputValue ? 0 : -1}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (!inputValue) return;
          setInputValue("");
          onChange("");
          setOpen(true);
          inputRef.current?.focus();
        }}
        aria-hidden={inputValue ? undefined : true}
      >
        <X size={14} />
      </button>
      {shouldShowMenu ? (
        <div className="search-history-menu" role="listbox" aria-label={t("searchHistory.records")}>
          <div className="search-history-menu-head">
            <span>{t("searchHistory.title")}</span>
            <div className="search-history-menu-actions">
              <button
                type="button"
                className="search-history-clear"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => clearHistory.mutate()}
                disabled={clearHistory.isPending}
              >
                <Trash2 size={13} />
                {t("searchHistory.clearAll")}
              </button>
              <button
                type="button"
                className="search-history-close"
                aria-label={t("searchHistory.close")}
                title={t("common.close")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setOpen(false)}
              >
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="search-history-list">
            {visibleHistory.map((item) => (
              <div className="search-history-row" key={item.id}>
                <button
                  type="button"
                  className="search-history-select"
                  role="option"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setInputValue(item.keyword);
                    onChange(item.keyword);
                    recordKeyword(item.keyword);
                    setOpen(false);
                    inputRef.current?.focus();
                  }}
                >
                  <Clock size={15} />
                  <span>{item.keyword}</span>
                  <time>{formatRelativeTime(item.searchedAt, t)}</time>
                </button>
                <button
                  type="button"
                  className="search-history-delete"
                  aria-label={t("searchHistory.deleteRecord", { keyword: item.keyword })}
                  title={t("searchHistory.delete")}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => deleteHistory.mutate(item.id)}
                  disabled={deleteHistory.isPending}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
});
