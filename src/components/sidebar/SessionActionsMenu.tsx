import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Archive, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { cx } from "../../lib/cx";

const SESSION_MENU_CLOSE_ANIMATION_MS = 240;

type SessionActionsMenuProps = {
  open: boolean;
  title: string;
  pinned?: boolean;
  disabled?: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (title: string) => void;
  onPin: () => void;
  onArchive: () => void;
  onDelete: () => void;
};

export function SessionActionsMenu({ open, title, pinned, disabled, onOpenChange, onRename, onPin, onArchive, onDelete }: SessionActionsMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameSettledRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const [closing, setClosing] = useState(false);
  const [menuStyle, setMenuStyle] = useState({ top: 0, left: 0 });
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const menuVisible = open || closing;

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const openMenu = useCallback(() => {
    clearCloseTimer();
    setClosing(false);
    onOpenChange(true);
  }, [clearCloseTimer, onOpenChange]);

  const closeMenu = useCallback(() => {
    if (!open || closing) return;
    clearCloseTimer();
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setClosing(false);
      closeTimerRef.current = null;
      onOpenChange(false);
    }, SESSION_MENU_CLOSE_ANIMATION_MS);
  }, [clearCloseTimer, closing, onOpenChange, open]);

  const beginRename = useCallback(() => {
    renameSettledRef.current = false;
    setDraftTitle(title);
    setRenaming(true);
  }, [title]);

  const commitRename = useCallback(() => {
    if (!renaming || renameSettledRef.current) return;
    renameSettledRef.current = true;
    const nextTitle = draftTitle.replace(/\s+/g, " ").trim();
    setRenaming(false);
    if (!nextTitle || nextTitle === title.replace(/\s+/g, " ").trim()) return;
    closeMenu();
    onRename(nextTitle);
  }, [closeMenu, draftTitle, onRename, renaming, title]);

  const cancelRename = useCallback(() => {
    renameSettledRef.current = true;
    setDraftTitle(title);
    setRenaming(false);
  }, [title]);

  useEffect(() => {
    if (!open) return;
    clearCloseTimer();
    setClosing(false);
    setDraftTitle(title);
  }, [clearCloseTimer, open, title]);

  useEffect(() => {
    if (!renaming) return;
    const frame = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [renaming]);

  useEffect(() => {
    if (menuVisible) return;
    setRenaming(false);
    setDraftTitle(title);
  }, [menuVisible, title]);

  useEffect(() => {
    if (!menuVisible) return;
    const updatePosition = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportPadding = 10;
      const menuWidth = renaming ? 220 : 136;
      setMenuStyle({
        top: rect.bottom + 4,
        left: Math.min(rect.left, window.innerWidth - menuWidth - viewportPadding)
      });
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      const inMenu = target instanceof Element && target.closest(".session-action-card");
      if (target && rootRef.current?.contains(target)) return;
      if (inMenu) return;
      closeMenu();
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
  }, [closeMenu, menuVisible, renaming]);

  useEffect(
    () => () => {
      clearCloseTimer();
    },
    []
  );

  return (
    <div className={cx("session-menu-wrap", open && "open")} ref={rootRef}>
      <button
        className="session-menu-trigger"
        type="button"
        disabled={disabled}
        aria-label="更多聊天操作"
        aria-haspopup="menu"
        aria-expanded={open && !closing}
        title="更多"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (disabled) return;
          if (open && !closing) {
            closeMenu();
            return;
          }
          openMenu();
        }}
      >
        <MoreHorizontal size={18} />
      </button>
      {menuVisible
        ? createPortal(
            <div
              className={cx("session-action-card", renaming && "is-renaming", "ui-pop-motion")}
              role="menu"
              style={menuStyle}
              data-state={closing ? "closing" : "open"}
              data-placement="bottom-end"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              {renaming ? (
                <input
                  ref={renameInputRef}
                  className="session-rename-input"
                  value={draftTitle}
                  disabled={disabled}
                  aria-label="编辑聊天标题"
                  onChange={(event) => setDraftTitle(event.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitRename();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      cancelRename();
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  onClick={beginRename}
                >
                  <Pencil size={16} />
                  <span>重命名</span>
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  onPin();
                }}
              >
                {pinned ? <PinOff size={16} /> : <Pin size={16} />}
                <span>{pinned ? "取消置顶" : "置顶聊天"}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  onArchive();
                }}
              >
                <Archive size={16} />
                <span>归档</span>
              </button>
              <button
                className="danger"
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  onDelete();
                }}
              >
                <Trash2 size={16} />
                <span>删除</span>
              </button>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
