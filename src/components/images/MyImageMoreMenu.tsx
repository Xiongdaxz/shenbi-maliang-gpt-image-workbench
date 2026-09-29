import { useCallback, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { FolderOpen, Lightbulb, MoreHorizontal } from "lucide-react";
import { useI18n } from "../../i18n";

export function MyImageMoreMenu({ assetPending, onAddCase, onAddAsset }: {
  assetPending: boolean;
  onAddCase: () => void; onAddAsset: () => void;
}) {
  const { t } = useI18n();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const element = menu.current;
    const anchor = trigger.current;
    if (!element || !anchor) return;
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > window.innerHeight) { close(); return; }
      const width = element.offsetWidth, height = element.offsetHeight;
      const above = rect.top - 20, below = window.innerHeight - rect.bottom - 20;
      const top = above >= height || above > below ? rect.top - height - 8 : rect.bottom + 8;
      setPosition({ left: Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(top, window.innerHeight - height - 12)), visibility: "visible" });
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !element.contains(event.target) && !anchor.contains(event.target)) close();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
      if (!element.contains(document.activeElement) && document.activeElement !== anchor) return;
      if (event.key === "Tab") { close(true); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const buttons = [...element.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')];
      if (!buttons.length) return;
      event.preventDefault();
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : current < 0 ? (event.key === "ArrowDown" ? 0 : buttons.length - 1) : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    observer.observe(anchor);
    update();
    const focusFrame = requestAnimationFrame(() => element.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true }));
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keydown, true);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", keydown, true);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, close]);

  return <>
    <button ref={trigger} type="button" className="case-action-icon image-card-more-trigger" aria-label={t("common.more")} data-library-tooltip data-tooltip={t("common.more")}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { if (open) close(); else { setPosition({ visibility: "hidden" }); setOpen(true); } }}>
      <MoreHorizontal size={16} />
    </button>
    {open ? createPortal(<div ref={menu} id={id} className="image-card-more-menu" role="menu" aria-label={t("common.more")} style={position}>
      <button type="button" role="menuitem" className="image-card-more-item" onClick={() => { close(true); onAddCase(); }}><Lightbulb size={16} /><span>{t("pages.cases.addToInspiration")}</span></button>
      <button type="button" role="menuitem" className="image-card-more-item" disabled={assetPending} onClick={() => { close(true); onAddAsset(); }}><FolderOpen size={16} /><span>{t("pages.cases.addToAssets")}</span></button>
    </div>, document.body) : null}
  </>;
}
