import { describe, expect, test } from "bun:test";
import { compareInfoHasKeyboardFocus, routeCompareInfoTab } from "./imageCompareFocus";

function focusFixture(favoriteDisabled = false) {
  let active: HTMLButtonElement | null = null;
  let dismissed = false;
  const button = () => {
    const element = { focus: () => { active = element; }, matches: () => true } as unknown as HTMLButtonElement;
    return element;
  };
  const anchor = button(), close = button(), copy = button(), favorite = button();
  Object.assign(anchor, { parentElement: { querySelector: () => favoriteDisabled ? null : favorite } });
  const panel = { querySelectorAll: () => [close, copy], contains: (element: Element) => element === close || element === copy } as unknown as HTMLElement;
  const dismiss = () => { dismissed = true; anchor.focus(); };
  const tab = (target: HTMLButtonElement, shiftKey = false, ctrlKey = false) => {
    let prevented = false;
    routeCompareInfoTab({ key: "Tab", target, shiftKey, ctrlKey, altKey: false, metaKey: false, preventDefault: () => { prevented = true; } }, anchor, panel, dismiss);
    return prevented;
  };
  return { anchor, close, copy, favorite, panel, tab, active: () => active, dismissed: () => dismissed };
}

describe("comparison info keyboard navigation", () => {
  test("Tab enters the portalled card immediately and Shift+Tab returns to its trigger", () => {
    const f = focusFixture();
    expect(f.tab(f.anchor)).toBe(true);
    expect(f.active()).toBe(f.close);
    expect(compareInfoHasKeyboardFocus(f.anchor, f.panel, f.active())).toBe(true);
    expect(f.tab(f.close, true)).toBe(true);
    expect(f.active()).toBe(f.anchor);
    expect(f.dismissed()).toBe(false);
  });
  test("the card preserves normal internal tabbing and exits to the next pane control", () => {
    const f = focusFixture();
    expect(f.tab(f.close)).toBe(false);
    expect(f.tab(f.copy, true)).toBe(false);
    expect(f.tab(f.copy)).toBe(true);
    expect(f.dismissed()).toBe(true);
    expect(f.active()).toBe(f.favorite);
    expect(compareInfoHasKeyboardFocus(f.anchor, f.panel, f.active())).toBe(false);
  });
  test("a disabled next control leaves focus on the trigger after dismissal", () => {
    const f = focusFixture(true);
    f.tab(f.copy);
    expect(f.active()).toBe(f.anchor);
    expect(f.dismissed()).toBe(true);
  });
  test("hover dismissal respects keyboard focus without pinning a mouse-focused trigger", () => {
    const f = focusFixture();
    expect(compareInfoHasKeyboardFocus(f.anchor, f.panel, f.copy)).toBe(true);
    Object.assign(f.anchor, { matches: () => false });
    expect(compareInfoHasKeyboardFocus(f.anchor, f.panel, f.anchor)).toBe(false);
    expect(compareInfoHasKeyboardFocus(f.anchor, f.panel, null)).toBe(false);
    expect(f.tab(f.anchor, false, true)).toBe(false);
  });
});
