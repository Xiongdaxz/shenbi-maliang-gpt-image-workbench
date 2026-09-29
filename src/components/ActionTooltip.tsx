import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import "../styles/action-tooltip.css";

type Tip = { target: HTMLElement; text: string };
type Position = { left: number; top: number; arrow: number; side: "top" | "bottom" | "right" };

/** One floating tip for the workbench, including buttons inside clipped rails.
 * Presentation matches the assistant-image toolbar's dark bubble and arrow. */
export function ActionTooltip({ container, hidden = false, selector = "[data-tooltip], button" }: { container: HTMLElement | null; hidden?: boolean; selector?: string }) {
  const id = useId();
  const [tip, setTip] = useState<Tip | null>(null);
  const activeTarget = useRef<HTMLElement | null>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<Position | null>(null);

  useEffect(() => {
    const close = () => { activeTarget.current = null; setTip(null); };
    close();
    if (!container || hidden) return;
    const findTarget = (node: EventTarget | null) => {
      const element = node instanceof Element ? node.closest<HTMLElement>(selector) : null;
      return element && container.contains(element) ? element : null;
    };
    const show = (target: HTMLElement | null) => {
      if (!target || target.closest("[inert], [aria-hidden=true], [data-tooltip-disabled]") || !target.getClientRects().length) { close(); return; }
      if (target.matches('[aria-haspopup][aria-expanded="true"], .image-download-trigger[aria-expanded="true"]')) { close(); return; }
      if (target === activeTarget.current) return;
      const text = (target.dataset.tooltip || target.getAttribute("aria-label") || target.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) { close(); return; }
      activeTarget.current = target;
      setPosition(null);
      setTip({ target, text: text.length > 220 ? `${text.slice(0, 220)}…` : text });
    };
    const over = (event: PointerEvent) => { if (event.pointerType !== "touch") show(findTarget(event.target)); };
    const out = (event: PointerEvent) => {
      if (event.relatedTarget instanceof Node && activeTarget.current?.contains(event.relatedTarget)) return;
      close();
    };
    const focus = (event: FocusEvent) => {
      if (event.target instanceof Element && event.target.matches(":focus-visible")) show(findTarget(event.target));
    };
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    container.addEventListener("pointerover", over);
    container.addEventListener("pointerout", out);
    container.addEventListener("pointerdown", close, true);
    // Keyboard and assistive activation emit click without pointerdown.
    container.addEventListener("click", close, true);
    container.addEventListener("focusin", focus);
    container.addEventListener("focusout", close);
    container.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", keydown);
    return () => {
      container.removeEventListener("pointerover", over);
      container.removeEventListener("pointerout", out);
      container.removeEventListener("pointerdown", close, true);
      container.removeEventListener("click", close, true);
      container.removeEventListener("focusin", focus);
      container.removeEventListener("focusout", close);
      container.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", keydown);
    };
  }, [container, hidden, selector]);

  useLayoutEffect(() => {
    if (!tip || hidden || !bubble.current) return;
    const target = tip.target;
    if (!target.isConnected) { setTip(null); return; }
    const rect = target.getBoundingClientRect();
    const { width, height } = bubble.current.getBoundingClientRect();
    const clamp = (value: number, max: number) => Math.max(8, Math.min(Math.max(8, max), value));
    const onRail = target.closest(".image-compare-library, .image-compare-library-handle");
    if (onRail && rect.right + width + 20 <= window.innerWidth) {
      const top = clamp(rect.top + rect.height / 2 - height / 2, window.innerHeight - height - 8);
      setPosition({ side: "right", left: rect.right + 12, top, arrow: Math.max(8, Math.min(height - 8, rect.top + rect.height / 2 - top)) });
    } else {
      const side = rect.top >= height + 20 ? "top" : "bottom";
      const left = clamp(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8);
      const top = side === "top" ? rect.top - height - 12 : rect.bottom + 12;
      setPosition({ side, left, top: clamp(top, window.innerHeight - height - 8), arrow: Math.max(8, Math.min(width - 8, rect.left + rect.width / 2 - left)) });
    }
    const previous = target.getAttribute("aria-describedby");
    target.setAttribute("aria-describedby", [previous, id].filter(Boolean).join(" "));
    return () => {
      if (previous) target.setAttribute("aria-describedby", previous);
      else target.removeAttribute("aria-describedby");
    };
  }, [tip, hidden, id]);

  useEffect(() => {
    if (!tip || hidden) return;
    const observer = new MutationObserver(() => { activeTarget.current = null; setTip(null); });
    observer.observe(tip.target, { attributes: true, attributeFilter: ["data-tooltip", "aria-expanded"] });
    return () => observer.disconnect();
  }, [tip, hidden]);

  if (!tip || hidden) return null;
  return createPortal(<div ref={bubble} id={id} role="tooltip" className="action-tooltip" data-side={position?.side || "top"}
    style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? "visible" : "hidden", "--tip-arrow": `${position?.arrow ?? 12}px` } as CSSProperties}>
    {tip.text}
  </div>, document.body);
}
