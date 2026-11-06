import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { Ellipsis, GalleryHorizontalEnd, ShieldCheck, Sparkles } from "lucide-react";
import { api } from "../../api";
import { useI18n } from "../../i18n";
import { cx } from "../../lib/cx";
import { OPENAI_VERIFY_WEB_URL } from "../../lib/imageProvenance";
import { SERIES_CREATION_AVAILABLE } from "../../lib/releaseFeatures";

const MORE_MENU_CLOSE_ANIMATION_MS = 120;
const MORE_MENU_GAP = 6;
const MORE_MENU_WIDTH = 190;
const MORE_MENU_ESTIMATED_HEIGHT = 138;
const MORE_MENU_VIEWPORT_PADDING = 10;

type MoreToolsMenuProps = {
  open: boolean;
  active: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: "/prompt-templates" | "/image-provenance" | "/image-sets") => void;
};

export function MoreToolsMenu({
  open,
  active,
  onOpenChange,
  onSelect
}: MoreToolsMenuProps) {
  const { t } = useI18n();
  const provenanceCapabilities = useQuery({
    queryKey: ["image-provenance-capabilities"],
    queryFn: api.imageProvenanceCapabilities,
    staleTime: 60_000
  });
  const useOfficialWebVerifier = provenanceCapabilities.data?.configured !== true;
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [closing, setClosing] = useState(false);
  const [menuStyle, setMenuStyle] = useState({ top: 0, left: 0 });
  const visible = open || closing;

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
    }, MORE_MENU_CLOSE_ANIMATION_MS);
  }, [clearCloseTimer, closing, onOpenChange, open]);

  useEffect(() => {
    if (!visible) return;
    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const menuHeight = menuRef.current?.offsetHeight ?? MORE_MENU_ESTIMATED_HEIGHT;
      const rawTop = rect.top;
      const rawLeft = rect.right + MORE_MENU_GAP;
      setMenuStyle({
        top: Math.min(
          Math.max(rawTop, MORE_MENU_VIEWPORT_PADDING),
          Math.max(MORE_MENU_VIEWPORT_PADDING, viewportHeight - menuHeight - MORE_MENU_VIEWPORT_PADDING)
        ),
        left: Math.min(
          Math.max(rawLeft, MORE_MENU_VIEWPORT_PADDING),
          Math.max(MORE_MENU_VIEWPORT_PADDING, viewportWidth - MORE_MENU_WIDTH - MORE_MENU_VIEWPORT_PADDING)
        )
      });
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && triggerRef.current?.contains(target)) return;
      if (target && menuRef.current?.contains(target)) return;
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    updatePosition();
    const frame = window.requestAnimationFrame(() => {
      updatePosition();
      if (open && !closing) menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    });
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [closeMenu, closing, open, visible]);

  useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

  const choose = (path: "/prompt-templates" | "/image-provenance" | "/image-sets") => {
    clearCloseTimer();
    setClosing(false);
    onOpenChange(false);
    onSelect(path);
  };

  const closeImmediately = () => {
    clearCloseTimer();
    setClosing(false);
    onOpenChange(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        className={cx("nav-item", (active || open) && "active")}
        type="button"
        aria-label={t("sidebar.more")}
        aria-haspopup="menu"
        aria-expanded={open && !closing}
        aria-current={active ? "page" : undefined}
        data-sidebar-tip={t("sidebar.more")}
        data-sidebar-selection-key="nav:/more"
        onClick={() => {
          if (open && !closing) closeMenu();
          else openMenu();
        }}
      >
        <Ellipsis size={18} />
        <span>{t("sidebar.more")}</span>
      </button>
      {visible
        ? createPortal(
            <div
              ref={menuRef}
              className="sidebar-more-card ui-pop-motion"
              role="menu"
              style={menuStyle}
              data-state={closing ? "closing" : "open"}
              data-placement="bottom-start"
            >
              <button type="button" role="menuitem" onClick={() => choose("/prompt-templates")}>
                <Sparkles size={17} />
                <span>{t("more.prompt.title")}</span>
              </button>
              {SERIES_CREATION_AVAILABLE ? (
                <button type="button" role="menuitem" onClick={() => choose("/image-sets")}>
                  <GalleryHorizontalEnd size={17} />
                  <span>{t("sets.title")}</span>
                </button>
              ) : null}
              {useOfficialWebVerifier ? (
                <a
                  role="menuitem"
                  href={OPENAI_VERIFY_WEB_URL}
                  target="_blank"
                  rel="noreferrer"
                  onClick={closeImmediately}
                >
                  <ShieldCheck size={17} />
                  <span>{t("more.provenance.title")}</span>
                </a>
              ) : (
                <button type="button" role="menuitem" onClick={() => choose("/image-provenance")}>
                  <ShieldCheck size={17} />
                  <span>{t("more.provenance.title")}</span>
                </button>
              )}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
