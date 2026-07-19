import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, ImageUp, MoreHorizontal } from "lucide-react";
import { useI18n } from "../i18n";
import { cx } from "../lib/cx";

const CASE_MORE_MENU_WIDTH = 176;
const CASE_MORE_MENU_HEIGHT = 88;
const CASE_MORE_MENU_GAP = 6;
const CASE_MORE_MENU_VIEWPORT_PADDING = 10;
const CASE_MORE_MENU_CLOSE_ANIMATION_MS = 240;

type CaseMaterialActionsMenuProps = {
  buttonClassName: string;
  onUseAsMaterial: () => void;
  onAddToAssets: () => void;
};

type CaseMoreMenuPlacement = "top-end" | "bottom-end";

function clamp(value: number, min: number, max: number) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function CaseMaterialActionsMenu({ buttonClassName, onUseAsMaterial, onAddToAssets }: CaseMaterialActionsMenuProps) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const [placement, setPlacement] = useState<CaseMoreMenuPlacement>("bottom-end");
  const menuVisible = (open || closing) && Boolean(menuStyle);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const measureMenuPosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return null;

    const spaceBelow = window.innerHeight - rect.bottom - CASE_MORE_MENU_VIEWPORT_PADDING;
    const spaceAbove = rect.top - CASE_MORE_MENU_VIEWPORT_PADDING;
    const nextPlacement: CaseMoreMenuPlacement =
      spaceBelow < CASE_MORE_MENU_HEIGHT && spaceAbove > spaceBelow ? "top-end" : "bottom-end";
    const rawTop =
      nextPlacement === "top-end"
        ? rect.top - CASE_MORE_MENU_HEIGHT - CASE_MORE_MENU_GAP
        : rect.bottom + CASE_MORE_MENU_GAP;
    const viewportWidth = document.documentElement.clientWidth;
    const maxTop = window.innerHeight - CASE_MORE_MENU_HEIGHT - CASE_MORE_MENU_VIEWPORT_PADDING;
    const maxRight = viewportWidth - CASE_MORE_MENU_WIDTH - CASE_MORE_MENU_VIEWPORT_PADDING;

    return {
      placement: nextPlacement,
      style: {
        top: clamp(rawTop, CASE_MORE_MENU_VIEWPORT_PADDING, maxTop),
        right: clamp(viewportWidth - rect.right, CASE_MORE_MENU_VIEWPORT_PADDING, maxRight)
      } satisfies CSSProperties
    };
  }, []);

  const openMenu = useCallback(() => {
    const position = measureMenuPosition();
    if (!position) return;
    clearCloseTimer();
    setMenuStyle(position.style);
    setPlacement(position.placement);
    setClosing(false);
    setOpen(true);
  }, [clearCloseTimer, measureMenuPosition]);

  const closeMenu = useCallback(() => {
    if (!open || closing) return;
    clearCloseTimer();
    setOpen(false);
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setClosing(false);
      setMenuStyle(null);
      closeTimerRef.current = null;
    }, CASE_MORE_MENU_CLOSE_ANIMATION_MS);
  }, [clearCloseTimer, closing, open]);

  useEffect(() => {
    if (!menuVisible) return;
    const updatePosition = () => {
      const position = measureMenuPosition();
      if (!position) return;
      setMenuStyle(position.style);
      setPlacement(position.placement);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target && (rootRef.current?.contains(target) || target.closest(".case-more-action-card"))) return;
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
  }, [closeMenu, measureMenuPosition, menuVisible]);

  useEffect(
    () => () => {
      clearCloseTimer();
    },
    [clearCloseTimer]
  );

  return (
    <div className="case-more-menu-wrap" ref={rootRef}>
      <button
        ref={triggerRef}
        className={buttonClassName}
        type="button"
        aria-label={t("pages.cases.moreActions")}
        aria-haspopup="menu"
        aria-expanded={open && !closing}
        title={t("common.more")}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (open && !closing) {
            closeMenu();
            return;
          }
          openMenu();
        }}
      >
        <MoreHorizontal size={16} />
      </button>
      {menuVisible && menuStyle
        ? createPortal(
            <div
              className={cx("case-more-action-card", "ui-pop-motion")}
              role="menu"
              style={menuStyle}
              data-state={closing ? "closing" : "open"}
              data-placement={placement}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  onUseAsMaterial();
                }}
              >
                <ImageUp size={16} />
                <span>{t("pages.cases.useAsMaterial")}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  closeMenu();
                  onAddToAssets();
                }}
              >
                <FolderOpen size={16} />
                <span>{t("pages.cases.addToAssets")}</span>
              </button>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
