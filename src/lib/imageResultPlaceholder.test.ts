import { describe, expect, test } from "bun:test";
import { imageResultPlaceholderState } from "./imageResultPlaceholder";

describe("image result placeholder state", () => {
  test("animates only while the image job is running", () => {
    expect(imageResultPlaceholderState(false, "running")).toBe("rendering");
    expect(imageResultPlaceholderState(false, "succeeded")).toBe("unavailable");
    expect(imageResultPlaceholderState(false, "failed")).toBe("failed");
    expect(imageResultPlaceholderState(false, "cancelled")).toBe("failed");
    expect(imageResultPlaceholderState(false)).toBe("unavailable");
  });

  test("does not render a placeholder when the slot has an image", () => {
    expect(imageResultPlaceholderState(true, "running")).toBe("hidden");
  });
});
