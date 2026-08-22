import { describe, expect, test } from "bun:test";
import {
  OPAQUE_BACKGROUND_PROMPT_INSTRUCTION,
  TRANSPARENT_BACKGROUND_PROMPT_INSTRUCTION,
  imageBackgroundRequestOptions,
  imageBackgroundRequestOptionsFromMetadata,
  injectImageBackgroundInstruction,
  isImageBackgroundOption,
  normalizeImageBackgroundOption
} from "./imageBackground";

describe("image background options", () => {
  test("normalizes supported values and falls back to auto", () => {
    expect(normalizeImageBackgroundOption(" TRANSPARENT ")).toBe("transparent");
    expect(normalizeImageBackgroundOption("opaque")).toBe("opaque");
    expect(normalizeImageBackgroundOption("unknown")).toBe("auto");
    expect(isImageBackgroundOption("auto")).toBe(true);
    expect(isImageBackgroundOption("jpeg")).toBe(false);
  });

  test("forces transparent requests to PNG", () => {
    expect(imageBackgroundRequestOptions("transparent")).toEqual({
      background: "transparent",
      outputFormat: "png"
    });
    expect(imageBackgroundRequestOptions("opaque")).toEqual({ background: "opaque" });
    expect(imageBackgroundRequestOptions("auto")).toEqual({});
  });

  test("preserves background metadata when resubmitting a message", () => {
    expect(imageBackgroundRequestOptionsFromMetadata({
      background: "transparent",
      outputFormat: "webp"
    }, "auto")).toEqual({ background: "transparent", outputFormat: "webp" });
    expect(imageBackgroundRequestOptionsFromMetadata({ background: "opaque" }, "auto")).toEqual({
      background: "opaque"
    });
    expect(imageBackgroundRequestOptionsFromMetadata({ background: "opaque" }, "transparent")).toEqual({
      background: "transparent",
      outputFormat: "png"
    });
    expect(imageBackgroundRequestOptionsFromMetadata({}, "transparent")).toEqual({
      background: "transparent",
      outputFormat: "png"
    });
  });

  test("injects explicit background instructions idempotently", () => {
    const first = injectImageBackgroundInstruction("一只陶瓷杯", "transparent");
    const second = injectImageBackgroundInstruction(first, "transparent");
    const opaque = injectImageBackgroundInstruction("一只陶瓷杯", "opaque");

    expect(first).toContain(TRANSPARENT_BACKGROUND_PROMPT_INSTRUCTION);
    expect(second).toBe(first);
    expect(opaque).toContain(OPAQUE_BACKGROUND_PROMPT_INSTRUCTION);
    expect(injectImageBackgroundInstruction(opaque, "opaque")).toBe(opaque);
    expect(injectImageBackgroundInstruction("一只陶瓷杯", "auto")).toBe("一只陶瓷杯");
  });
});
