import { useEffect, useMemo, useRef, type RefObject } from "react";
import { createCompareLibraryVisibility, saveCompareLibraryCollapsed } from "../lib/imageCompareLibraryVisibility";

export function useCompareLibraryVisibility(zone: RefObject<HTMLDivElement | null>, suspended: boolean, pinned: boolean, collapsed: boolean, onCollapsedChange: (collapsed: boolean) => void) {
  const controller = useRef<ReturnType<typeof createCompareLibraryVisibility> | null>(null);
  const initial = useRef({ pinned, collapsed });
  const onChange = useRef(onCollapsedChange);
  onChange.current = onCollapsedChange;
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  useEffect(() => {
    const state = createCompareLibraryVisibility({
      initialPinned: initial.current.pinned, initialCollapsed: initial.current.collapsed,
      onCollapsedChange: (collapsed) => onChange.current(collapsed),
      onRememberCollapsed: saveCompareLibraryCollapsed,
      schedule: (callback, delay) => window.setTimeout(callback, delay), cancel: (timer) => window.clearTimeout(timer)
    });
    controller.current = state;
    state.start();
    const release = () => state.release();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !zone.current?.contains(event.target)) {
        state.focus(false);
        state.touchOutside();
      }
    };
    const blur = () => { state.suspend(true); state.suspend(suspendedRef.current); };
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", blur);
    return () => {
      state.dispose(); controller.current = null;
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", blur);
    };
  }, [zone]);
  useEffect(() => { controller.current?.suspend(suspended); }, [suspended]);
  useEffect(() => { controller.current?.pin(pinned); }, [pinned]);
  return useMemo(() => ({
    enter: () => controller.current?.enter(), leave: () => controller.current?.leave(),
    reveal: () => controller.current?.reveal(),
    togglePinned: () => controller.current?.togglePinned(),
    focus: (value: boolean) => controller.current?.focus(value),
    press: (touch: boolean) => controller.current?.press(touch)
  }), []);
}
