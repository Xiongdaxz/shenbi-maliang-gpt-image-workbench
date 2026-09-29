import { afterEach, describe, expect, test } from "bun:test";
import { createCompareLibraryVisibility, readCompareLibraryPinned, saveCompareLibraryPinned, readCompareLibraryCollapsed, saveCompareLibraryCollapsed } from "./imageCompareLibraryVisibility";

function fixture(initial: { pinned?: boolean; collapsed?: boolean; remember?: (collapsed: boolean) => void } = {}) {
  let time = 0, nextId = 0, collapsed = false;
  const tasks = new Map<number, { callback: () => void; at: number }>();
  const state = createCompareLibraryVisibility({
    initialPinned: initial.pinned, initialCollapsed: initial.collapsed, onRememberCollapsed: initial.remember,
    onCollapsedChange: (value) => { collapsed = value; },
    schedule: (callback, delay) => { const id = ++nextId; tasks.set(id, { callback, at: time + delay }); return id; },
    cancel: (id) => { tasks.delete(id); }
  });
  state.start();
  return { state, collapsed: () => collapsed, pending: () => tasks.size, advance: (duration: number) => {
    const end = time + duration;
    for (;;) {
      const next = [...tasks.entries()].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      time = next[1].at; tasks.delete(next[0]); next[1].callback();
    }
    time = end;
  } };
}

describe("comparison library auto hide", () => {
  test("shows on entry, hides after two seconds, and opens immediately at the edge", () => {
    const f = fixture();
    f.state.pin(false); // Apply the browser's initial unpinned preference.
    f.state.release(); // An unrelated pointer release must not shorten the intro.
    f.advance(1999); expect(f.collapsed()).toBe(false);
    f.advance(1); expect(f.collapsed()).toBe(true);
    f.state.enter(); expect(f.collapsed()).toBe(false);
    f.advance(10_000); expect(f.collapsed()).toBe(false);
  });
  test("leaving has a short grace period and returning cancels the pending hide", () => {
    const f = fixture(); f.state.enter(); f.state.leave();
    f.advance(299); expect(f.collapsed()).toBe(false);
    f.state.enter(); f.advance(1000); expect(f.collapsed()).toBe(false);
    f.state.leave(); f.advance(300); expect(f.collapsed()).toBe(true);
  });
  test("dragging the thumbnail list outside the rail stays open until release", () => {
    const f = fixture(); f.state.enter(); f.state.press(); f.state.leave();
    f.advance(3000); expect(f.collapsed()).toBe(false);
    f.state.release(); f.advance(300); expect(f.collapsed()).toBe(true);
  });
  test("keyboard focus keeps the rail open and does not latch a synthetic hover", () => {
    const f = fixture(); f.advance(2000);
    f.state.focus(true); f.state.reveal();
    f.advance(3000); expect(f.collapsed()).toBe(false);
    f.state.focus(false); f.advance(300); expect(f.collapsed()).toBe(true);
  });
  test("switching from keyboard to mouse focus within the rail restores leave-to-hide", () => {
    const f = fixture(); f.state.enter(); f.state.focus(true);
    f.advance(3000); expect(f.collapsed()).toBe(false);
    f.state.focus(false); f.state.press(); f.state.release();
    f.advance(3000); expect(f.collapsed()).toBe(false);
    f.state.leave(); f.advance(300); expect(f.collapsed()).toBe(true);
  });
  test("an outside pointer clears keyboard focus even if the clicked surface keeps DOM focus", () => {
    const f = fixture(); f.state.focus(true); f.state.leave();
    f.advance(3000); expect(f.collapsed()).toBe(false);
    f.state.focus(false); f.advance(300); expect(f.collapsed()).toBe(true);
  });
  test("repeated pointer focus updates do not shorten first entry or hide a pinned rail", () => {
    const f = fixture(); f.state.focus(false); f.advance(301);
    expect(f.collapsed()).toBe(false);
    f.state.pin(true); f.state.focus(true); f.state.focus(false); f.state.leave();
    f.advance(3000); expect(f.collapsed()).toBe(false);
  });
  test("touch opens the rail for repeated selections and hides it after an outside tap", () => {
    const f = fixture(); f.advance(2000); f.state.press(true); f.state.release(); f.state.reveal();
    f.advance(3000); expect(f.collapsed()).toBe(false);
    f.state.touchOutside(); f.advance(300); expect(f.collapsed()).toBe(true);
  });
  test("pinning disables initial and leave timers, unpinning restores auto hide", () => {
    const f = fixture(); f.state.pin(true); f.state.leave();
    f.advance(10_000); expect(f.collapsed()).toBe(false);
    expect(f.pending()).toBe(0);
    f.state.pin(false); f.advance(300); expect(f.collapsed()).toBe(true);
  });
  test("clean view and main-image dragging still hide a pinned rail and restore it afterward", () => {
    const f = fixture(); f.state.pin(true); f.state.suspend(true);
    f.state.enter(); f.advance(3000); expect(f.collapsed()).toBe(true);
    f.state.suspend(false); expect(f.collapsed()).toBe(false);
    f.state.pin(false); f.state.suspend(true); f.state.suspend(false);
    expect(f.collapsed()).toBe(true);
  });
  test("pinned mode toggles only on the ear, ignoring hover, touch and focus auto reveal", () => {
    const f = fixture(); f.state.pin(true); f.state.togglePinned();
    expect(f.collapsed()).toBe(true);
    f.state.enter(); f.state.focus(true); f.state.press(true); f.state.release(); f.state.reveal();
    f.advance(3000); expect(f.collapsed()).toBe(true);
    f.state.togglePinned(); expect(f.collapsed()).toBe(false);
    f.state.focus(false); f.state.leave(); f.state.touchOutside();
    f.advance(3000); expect(f.collapsed()).toBe(false);
  });
  test("main-image dragging and clean view preserve a manually collapsed pinned rail", () => {
    const f = fixture(); f.state.pin(true); f.state.togglePinned();
    f.state.suspend(true); f.state.suspend(true); f.state.togglePinned();
    f.state.suspend(false); expect(f.collapsed()).toBe(true);
    f.state.togglePinned(); expect(f.collapsed()).toBe(false);
    f.state.suspend(true); f.state.suspend(false); expect(f.collapsed()).toBe(false);
  });
  test("unpinning returns control to edge hover and ignores manual toggle requests", () => {
    const f = fixture(); f.state.pin(true); f.state.togglePinned(); f.state.pin(false);
    f.state.enter(); expect(f.collapsed()).toBe(false);
    f.state.togglePinned(); expect(f.collapsed()).toBe(false);
    f.state.leave(); f.advance(300); expect(f.collapsed()).toBe(true);
  });
  test("leaving the comparison cancels pending timers", () => {
    const f = fixture(); f.state.dispose();
    expect(f.pending()).toBe(0);
    f.advance(3000); expect(f.collapsed()).toBe(false);
  });
  test("a remembered collapsed rail starts collapsed in either pin mode without an intro flash", () => {
    for (const pinned of [false, true]) {
      const f = fixture({ pinned, collapsed: true });
      expect(f.collapsed()).toBe(true);
      f.state.pin(pinned);
      f.advance(3000);
      expect(f.collapsed()).toBe(true);
      expect(f.pending()).toBe(0);
      if (pinned) f.state.togglePinned(); else f.state.enter();
      expect(f.collapsed()).toBe(false);
    }
  });
  test("automatic and manual visibility changes are remembered but temporary hiding is not", () => {
    const remembered: boolean[] = [];
    const f = fixture({ remember: (value) => remembered.push(value) });
    f.advance(2000); f.state.enter();
    expect(remembered).toEqual([true, false]);
    f.state.pin(true);
    f.state.suspend(true); f.state.suspend(false);
    expect(remembered).toEqual([true, false]);
    f.state.togglePinned();
    expect(remembered).toEqual([true, false, true]);
    f.state.suspend(true); f.state.suspend(false);
    expect(remembered).toEqual([true, false, true]);
    f.state.togglePinned();
    expect(remembered).toEqual([true, false, true, false]);
  });
});

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

test("pin choice survives reopening and unavailable storage still allows using the page", () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  } } });
  expect(readCompareLibraryPinned()).toBe(false);
  expect(readCompareLibraryCollapsed()).toBe(false);
  saveCompareLibraryPinned(true); expect(readCompareLibraryPinned()).toBe(true);
  saveCompareLibraryCollapsed(true); expect(readCompareLibraryCollapsed()).toBe(true);
  const reopened = fixture({ pinned: readCompareLibraryPinned(), collapsed: readCompareLibraryCollapsed(), remember: saveCompareLibraryCollapsed });
  expect(reopened.collapsed()).toBe(true);
  reopened.state.togglePinned(); expect(readCompareLibraryCollapsed()).toBe(false);
  reopened.state.suspend(true); expect(readCompareLibraryCollapsed()).toBe(false);
  reopened.state.dispose();
  saveCompareLibraryPinned(false); expect(readCompareLibraryPinned()).toBe(false);
  Object.defineProperty(globalThis, "window", { configurable: true, value: { get localStorage() { throw new Error("blocked"); } } });
  expect(readCompareLibraryPinned()).toBe(false);
  expect(readCompareLibraryCollapsed()).toBe(false);
  expect(() => saveCompareLibraryPinned(true)).not.toThrow();
  expect(() => saveCompareLibraryCollapsed(true)).not.toThrow();
});
