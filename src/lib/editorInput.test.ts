import { describe, expect, test } from "bun:test";
import {
  editorPreviewPanY,
  shouldSubmitComposerOnEnter,
  shouldWheelAdjustToolSize,
  wheelSizeDelta
} from "./editorInput";

describe("composer keyboard behavior", () => {
  test("submits plain Enter but preserves Shift+Enter and IME composition", () => {
    expect(shouldSubmitComposerOnEnter("Enter", false, false)).toBe(true);
    expect(shouldSubmitComposerOnEnter("Enter", true, false)).toBe(false);
    expect(shouldSubmitComposerOnEnter("Enter", false, true)).toBe(false);
    expect(shouldSubmitComposerOnEnter("a", false, false)).toBe(false);
  });
});

describe("editor wheel size adjustment", () => {
  test("uses the wheel for tool size only while the image fits the window", () => {
    expect(shouldWheelAdjustToolSize("fit")).toBe(true);
    expect(shouldWheelAdjustToolSize(75)).toBe(false);
    expect(shouldWheelAdjustToolSize(100)).toBe(false);
  });

  test("centers fit-mode editing content above the composer without changing fixed-zoom pan", () => {
    expect(editorPreviewPanY(135, true, 75, 700, 900)).toBe(135);
    expect(editorPreviewPanY(135, true, "fit", 700, 900)).toBe(-100);
    expect(editorPreviewPanY(135, false, "fit", 700, 900)).toBe(135);
  });

  test("grows upward and shrinks downward using the dominant wheel axis", () => {
    expect(wheelSizeDelta(0, -100, 16)).toBe(16);
    expect(wheelSizeDelta(0, 100, 16)).toBe(-16);
    expect(wheelSizeDelta(-20, 4, 2)).toBe(2);
    expect(wheelSizeDelta(20, 4, 2)).toBe(-2);
  });

  test("ignores tiny, invalid, or unusable wheel input", () => {
    expect(wheelSizeDelta(0.5, 0.2, 16)).toBe(0);
    expect(wheelSizeDelta(Number.NaN, 0, 16)).toBe(0);
    expect(wheelSizeDelta(0, -100, 0)).toBe(0);
  });
});
