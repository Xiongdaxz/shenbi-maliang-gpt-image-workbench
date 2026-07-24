import { useCallback, useEffect, useRef, useState } from "react";
import { cx } from "../../lib/cx";

export type ChatBranchSwitchOption = {
  id: string;
  label: string;
  active: boolean;
  title: string;
};

export function ChatBranchSwitch({
  ariaLabel,
  options,
  optionAriaLabel,
  onSelect
}: {
  ariaLabel: string;
  options: ChatBranchSwitchOption[];
  optionAriaLabel: (option: ChatBranchSwitchOption) => string;
  onSelect: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousActiveIdRef = useRef<string | null>(null);
  const [scrollEdges, setScrollEdges] = useState({ start: false, end: false });

  const updateScrollEdges = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
    const nextEdges = {
      start: element.scrollLeft > 1,
      end: element.scrollLeft < maxScrollLeft - 1
    };
    setScrollEdges((current) => (
      current.start === nextEdges.start && current.end === nextEdges.end ? current : nextEdges
    ));
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const frame = window.requestAnimationFrame(() => {
      const activeButton = element.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      const activeId = activeButton?.dataset.branchId ?? null;
      if (activeButton && activeId !== previousActiveIdRef.current) {
        const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
        const centeredScrollLeft = activeButton.offsetLeft + activeButton.offsetWidth / 2 - element.clientWidth / 2;
        const targetScrollLeft = Math.min(maxScrollLeft, Math.max(0, centeredScrollLeft));
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        element.scrollTo({
          left: targetScrollLeft,
          behavior: previousActiveIdRef.current && !reduceMotion ? "smooth" : "auto"
        });
      }
      previousActiveIdRef.current = activeId;
      updateScrollEdges();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [options, updateScrollEdges]);

  useEffect(() => {
    const onResize = () => updateScrollEdges();
    const element = scrollRef.current;
    const observer = element && typeof ResizeObserver === "function"
      ? new ResizeObserver(onResize)
      : null;
    if (element) observer?.observe(element);
    window.addEventListener("resize", onResize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [updateScrollEdges]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      if (element.scrollWidth <= element.clientWidth) return;
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (!delta) return;
      const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
      const canAdvance = delta < 0 ? element.scrollLeft > 1 : element.scrollLeft < maxScrollLeft - 1;
      if (!canAdvance) return;
      event.preventDefault();
      element.scrollLeft += delta;
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div className={cx("chat-branch-switch-shell", scrollEdges.start && "can-scroll-start", scrollEdges.end && "can-scroll-end")}>
      <div
        ref={scrollRef}
        className="chat-branch-switch"
        aria-label={ariaLabel}
        onScroll={updateScrollEdges}
      >
        {options.map((option) => (
          <button
            key={option.id}
            data-branch-id={option.id}
            type="button"
            className={cx(option.active && "active")}
            onClick={() => onSelect(option.id)}
            aria-label={optionAriaLabel(option)}
            aria-pressed={option.active}
            title={option.title}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
