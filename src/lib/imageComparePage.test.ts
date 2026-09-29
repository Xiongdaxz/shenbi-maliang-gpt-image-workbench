import { afterEach, describe, expect, test } from "bun:test";
import { isReturningFromImageCompare, lockImageComparePageScroll } from "./imageComparePage";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");

function page({ gutter = 10, padding = "", computedPadding = "0px", overflow = "" } = {}) {
  const root = { style: { overflow, scrollbarGutter: "stable", color: "red" }, getBoundingClientRect: () => ({ width: 1280 - gutter }) };
  const body = { style: { overflow, paddingRight: padding, color: "blue" } };
  const view = { innerWidth: 1280, scrollX: 0, scrollY: 2400, getComputedStyle: () => ({ paddingRight: computedPadding }) };
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: root, body } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: view });
  return { root, body, view };
}

afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
});

describe("comparison preserves its background gallery", () => {
  test("removing a classic scrollbar preserves the gallery's available width and scroll position", () => {
    const { root, body, view } = page({ gutter: 10, padding: "1rem", computedPadding: "16px" });
    const widthBefore = 1280 - 10 - 16;
    const restore = lockImageComparePageScroll();
    expect(body.style.paddingRight).toBe("26px");
    expect(1280 - Number.parseFloat(body.style.paddingRight)).toBe(widthBefore);
    expect(root.style.overflow).toBe("hidden");
    expect(body.style.overflow).toBe("hidden");
    expect(root.style.scrollbarGutter).toBe("auto");
    expect(view.scrollY).toBe(2400);
    restore();
    expect(body.style.paddingRight).toBe("1rem");
    expect(root.style.overflow).toBe("");
    expect(body.style.overflow).toBe("");
    expect(root.style.scrollbarGutter).toBe("stable");
    expect(view.scrollY).toBe(2400);
  });
  test("overlay scrollbars and an already locked page do not accumulate padding", () => {
    const { root, body } = page({ gutter: 0, padding: "10px", computedPadding: "10px", overflow: "hidden" });
    const restore = lockImageComparePageScroll();
    expect(body.style.paddingRight).toBe("10px");
    restore();
    expect(root.style.overflow).toBe("hidden");
    expect(body.style.overflow).toBe("hidden");
    expect(body.style.paddingRight).toBe("10px");
  });
  test("repeated comparison entry restores styles without disturbing later changes", () => {
    const { root, body } = page();
    for (let index = 0; index < 2; index++) {
      const restore = lockImageComparePageScroll();
      expect(body.style.paddingRight).toBe("10px");
      restore();
      expect(body.style.paddingRight).toBe("");
    }
    const restore = lockImageComparePageScroll();
    restore();
    body.style.paddingRight = "20px";
    restore();
    expect(body.style.paddingRight).toBe("20px");
    expect(root.style.color).toBe("red");
    expect(body.style.color).toBe("blue");
  });
  test("only the comparison-to-gallery return bypasses the shell's separate scroll restoration", () => {
    expect(isReturningFromImageCompare("/images/compare", "/images")).toBe(true);
    expect(isReturningFromImageCompare("/cases", "/images")).toBe(false);
    expect(isReturningFromImageCompare("/images", "/images/compare")).toBe(false);
    expect(isReturningFromImageCompare("/images/compare", "/assets")).toBe(false);
    expect(isReturningFromImageCompare("/images/compare", "/chat/session")).toBe(false);
  });
});
