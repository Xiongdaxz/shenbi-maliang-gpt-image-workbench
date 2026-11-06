import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CHATGPT_WEB_IMAGE_MODEL,
  DEFAULT_EDIT_IMAGE_MODEL,
  DEFAULT_GENERATION_IMAGE_MODEL,
  DEFAULT_IMAGE_QUALITY,
  IMAGE_MODEL_IDS,
  IMAGE_MODEL_OPTIONS,
  fallbackImageQuality,
  imageModelDisplayName,
  imageModelQualities,
  isImageModelId,
  latestConversationImageSelection,
  normalizeImageComplexity,
  normalizeImageModel,
  normalizeImageQuality
} from "./imageModels";

describe("image model selection", () => {
  test("adds both 2.6 models without removing the earlier model IDs", () => {
    expect(isImageModelId("gpt-image-2.5-flare")).toBe(true);
    expect(isImageModelId("gpt-image-2.5-sunburst")).toBe(true);
    expect(isImageModelId("gpt-image-2")).toBe(true);
    expect(isImageModelId("gpt-image-2.6-flare")).toBe(true);
    expect(isImageModelId("gpt-image-2.6-sunburst")).toBe(true);
    expect(isImageModelId("gpt-image-2.6")).toBe(false);
    expect(isImageModelId("gpt-image-2.5")).toBe(false);
  });

  test("stores and restores optional image complexity for 2.6 only", () => {
    expect(normalizeImageComplexity("gpt-image-2.6-sunburst", "Medium")).toBe("medium");
    expect(normalizeImageComplexity("gpt-image-2.6-flare", "auto")).toBeUndefined();
    expect(normalizeImageComplexity("gpt-image-2.5-sunburst", "medium")).toBeUndefined();
    expect(latestConversationImageSelection([{role:"user",metadata:{model:"gpt-image-2.6-flare",quality:"auto",complexity:"low"}}]))
      .toEqual({imageModel:"gpt-image-2.6-flare",quality:"auto",complexity:"low"});
  });

  test("lists 2.6 Flare first and retains Sunburst defaults", () => {
    expect(IMAGE_MODEL_OPTIONS.map(option => option.value)).toEqual([...IMAGE_MODEL_IDS]);
    expect(IMAGE_MODEL_IDS.slice(0, 2)).toEqual(["gpt-image-2.6-flare", "gpt-image-2.6-sunburst"]);
    expect(normalizeImageModel(undefined, DEFAULT_GENERATION_IMAGE_MODEL)).toBe("gpt-image-2.6-sunburst");
    expect(normalizeImageModel(undefined, DEFAULT_EDIT_IMAGE_MODEL)).toBe("gpt-image-2.6-sunburst");
    expect(DEFAULT_CHATGPT_WEB_IMAGE_MODEL).toBe("gpt-image-2.6-sunburst");
    expect(DEFAULT_IMAGE_QUALITY).toBe("auto");
    expect(normalizeImageQuality("gpt-image-2.5-flare", undefined)).toBe("auto");
  });

  test("restores the latest image selection from conversation requests", () => {
    expect(latestConversationImageSelection([
      { role: "user", metadata: { model: "gpt-image-2.5-flare", quality: "low" } },
      { role: "assistant", metadata: { actualModel: "gpt-image-2.5-flare", actualQuality: "low" } },
      { role: "user", metadata: { model: "gpt-image-2.5-sunburst", quality: "max" } }
    ])).toEqual({ imageModel: "gpt-image-2.5-sunburst", quality: "max" });
    expect(latestConversationImageSelection([{ role: "assistant", metadata: { actualModel: "gpt-image-2" } }])).toBeNull();
  });

  test("uses consistent product-style display names", () => {
    expect(imageModelDisplayName("gpt-image-2.5-flare")).toBe("GPT Image 2.5 Flare");
    expect(imageModelDisplayName("gpt-image-2.5-sunburst")).toBe("GPT Image 2.5 Sunburst");
    expect(imageModelDisplayName("gpt-image-2")).toBe("GPT Image 2");
  });

  test("supports the same extended quality settings on GPT Image 2.5 and 2.6", () => {
    for (const model of ["gpt-image-2.5-flare", "gpt-image-2.5-sunburst", "gpt-image-2.6-flare", "gpt-image-2.6-sunburst"] as const) {
      expect(imageModelQualities(model)).toEqual(["low", "medium", "high", "xhigh", "max"]);
      expect(normalizeImageQuality(model, "xhigh")).toBe("xhigh");
      expect(normalizeImageQuality(model, "max")).toBe("max");
    }
    expect(imageModelQualities("gpt-image-2")).toEqual(["low", "medium", "high"]);
    expect(fallbackImageQuality("max")).toBe("high");
    expect(fallbackImageQuality("medium")).toBe("medium");
    expect(fallbackImageQuality("auto")).toBe("auto");
    expect(normalizeImageQuality("gpt-image-2.5-flare", "auto")).toBe("auto");
    expect(normalizeImageQuality("gpt-image-2", "max")).toBe("auto");
  });
});
