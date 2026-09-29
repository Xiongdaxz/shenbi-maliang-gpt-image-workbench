export const COMPARE_LIBRARY_INITIAL_DELAY = 2000;
export const COMPARE_LIBRARY_LEAVE_DELAY = 300;
const PIN_STORAGE_KEY = "gpt-image.compare-library.pinned";
const COLLAPSED_STORAGE_KEY = "gpt-image.compare-library.collapsed";

export function readCompareLibraryPinned() {
  try { return window.localStorage.getItem(PIN_STORAGE_KEY) === "true"; } catch { return false; }
}

export function saveCompareLibraryPinned(pinned: boolean) {
  try { window.localStorage.setItem(PIN_STORAGE_KEY, String(pinned)); } catch { /* Browser storage is optional. */ }
}

export function readCompareLibraryCollapsed() {
  try { return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === "true"; } catch { return false; }
}

export function saveCompareLibraryCollapsed(collapsed: boolean) {
  try { window.localStorage.setItem(COLLAPSED_STORAGE_KEY, String(collapsed)); } catch { /* Browser storage is optional. */ }
}

/** Keep the edge rail open while it is being used; hiding never changes the canvas. */
export function createCompareLibraryVisibility({ onCollapsedChange, onRememberCollapsed, initialPinned = false, initialCollapsed = false, schedule, cancel }: {
  onCollapsedChange: (collapsed: boolean) => void;
  onRememberCollapsed?: (collapsed: boolean) => void;
  initialPinned?: boolean;
  initialCollapsed?: boolean;
  schedule: (callback: () => void, delay: number) => number;
  cancel: (timer: number) => void;
}) {
  let timer: number | undefined;
  let collapsed = initialCollapsed;
  let hovering = false, focused = false, pressed = false, touched = false;
  let suspended = false, disposed = false;
  let pinned = initialPinned;
  let manuallyCollapsed = initialCollapsed;
  const clear = () => { if (timer !== undefined) cancel(timer); timer = undefined; };
  const change = (value: boolean, remember = true) => {
    if (disposed || collapsed === value) return;
    collapsed = value;
    if (remember) onRememberCollapsed?.(value);
    onCollapsedChange(value);
  };
  const hideSoon = (delay = COMPARE_LIBRARY_LEAVE_DELAY) => {
    clear();
    if (disposed || suspended || pinned || hovering || focused || pressed || touched) return;
    timer = schedule(() => { timer = undefined; change(true); }, delay);
  };
  const open = () => { if (disposed || suspended) return; clear(); change(false); };
  return {
    start: () => { onCollapsedChange(collapsed); if (!collapsed) hideSoon(COMPARE_LIBRARY_INITIAL_DELAY); },
    reveal: () => { if (pinned) return; open(); hideSoon(); },
    enter: () => { if (disposed || suspended) return; hovering = true; if (!pinned) open(); },
    leave: () => { hovering = false; hideSoon(); },
    focus: (value: boolean) => { if (focused === value) return; focused = value; if (value && !pinned) open(); else hideSoon(); },
    press: (touch = false) => { if (disposed || suspended) return; pressed = true; touched ||= touch; if (!pinned) open(); },
    release: () => { if (!pressed) return; pressed = false; hideSoon(); },
    touchOutside: () => { if (!touched) return; touched = false; focused = false; hovering = false; hideSoon(); },
    pin: (value: boolean) => { if (pinned === value) return; pinned = value; manuallyCollapsed = false; if (value) open(); else hideSoon(); },
    togglePinned: () => {
      if (disposed || suspended || !pinned) return;
      clear(); manuallyCollapsed = !manuallyCollapsed; change(manuallyCollapsed);
    },
    suspend: (value: boolean) => {
      suspended = value;
      if (!value) { if (pinned) change(manuallyCollapsed, false); return; }
      clear(); hovering = false; focused = false; pressed = false; touched = false;
      change(true, false);
    },
    dispose: () => { disposed = true; clear(); }
  };
}
