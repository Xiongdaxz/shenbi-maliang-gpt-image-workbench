type TabEvent = Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey" | "target" | "preventDefault">;

/** The fixed card lives outside the pane; preserve the trigger's logical Tab order. */
export function routeCompareInfoTab(event: TabEvent, anchor: HTMLButtonElement, panel: HTMLElement, dismiss: () => void) {
  if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return;
  const buttons = [...panel.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
  if (!buttons.length) return;
  if (!event.shiftKey && event.target === anchor) {
    event.preventDefault();
    buttons[0].focus();
  } else if (event.shiftKey && event.target === buttons[0]) {
    event.preventDefault();
    anchor.focus({ preventScroll: true });
  } else if (!event.shiftKey && event.target === buttons.at(-1)) {
    event.preventDefault();
    dismiss();
    anchor.parentElement?.querySelector<HTMLButtonElement>(".image-compare-favorite:not(:disabled)")?.focus({ preventScroll: true });
  }
}

export function compareInfoHasKeyboardFocus(anchor: Element | null, panel: Element | null, focused: Element | null) {
  return Boolean(focused?.matches(":focus-visible") && (focused === anchor || panel?.contains(focused)));
}
