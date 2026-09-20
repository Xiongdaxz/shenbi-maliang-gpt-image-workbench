import { describe, expect, test } from "bun:test";
import {
  DEFAULT_OPAQUE_BACKGROUND_PROMPT_INSTRUCTION,
  OPAQUE_BACKGROUND_PROMPT_INSTRUCTION,
  REMOVE_IMAGE_BACKGROUND_PROMPT,
  TRANSPARENT_BACKGROUND_PROMPT_INSTRUCTION,
  imageBackgroundRequestOptions,
  imageBackgroundRequestOptionsFromMetadata,
  imagePromptRequestsTransparentBackground,
  injectImageBackgroundInstruction,
  isImageBackgroundOption,
  normalizeImageBackgroundOption,
  resolveImageBackgroundOption
} from "./imageBackground";

describe("image background options", () => {
  test("keeps the one-click background removal prompt fixed", () => {
    expect(REMOVE_IMAGE_BACKGROUND_PROMPT).toBe(
      "移除此图像的背景。保持所有前景主体不变且完整无损，边缘干净平滑。将背景设为透明。"
    );
  });

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

  test("requires an explicit transparent prompt and defaults every other auto request to opaque", () => {
    expect(imagePromptRequestsTransparentBackground("生成透明背景素材")).toBe(true);
    expect(imagePromptRequestsTransparentBackground("无背景产品图")).toBe(true);
    expect(imagePromptRequestsTransparentBackground("Add a transparent background")).toBe(true);
    expect(imagePromptRequestsTransparentBackground("不要透明图片，改成白底")).toBe(false);
    expect(imagePromptRequestsTransparentBackground("生成不透明背景图片")).toBe(false);
    expect(imagePromptRequestsTransparentBackground("非透明画布")).toBe(false);
    expect(imagePromptRequestsTransparentBackground("普通产品图")).toBe(false);
    expect(resolveImageBackgroundOption("auto", "生成透明背景素材")).toBe("transparent");
    expect(resolveImageBackgroundOption("auto", "普通产品图")).toBe("opaque");
    expect(resolveImageBackgroundOption("opaque", "生成透明背景素材")).toBe("opaque");
    expect(resolveImageBackgroundOption("transparent", "普通产品图")).toBe("transparent");
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
    expect(first).not.toContain(DEFAULT_OPAQUE_BACKGROUND_PROMPT_INSTRUCTION);
    expect(second).toBe(first);
    expect(opaque).toContain(OPAQUE_BACKGROUND_PROMPT_INSTRUCTION);
    expect(injectImageBackgroundInstruction(opaque, "opaque")).toBe(opaque);
    const automatic = injectImageBackgroundInstruction("一只陶瓷杯", "auto");
    expect(automatic).toContain(DEFAULT_OPAQUE_BACKGROUND_PROMPT_INSTRUCTION);
    expect(injectImageBackgroundInstruction(automatic, "auto")).toBe(automatic);
    const switchedToTransparent = injectImageBackgroundInstruction(automatic, "transparent");
    expect(switchedToTransparent).toContain(TRANSPARENT_BACKGROUND_PROMPT_INSTRUCTION);
    expect(switchedToTransparent).not.toContain(DEFAULT_OPAQUE_BACKGROUND_PROMPT_INSTRUCTION);
    const promptRequestedTransparent = injectImageBackgroundInstruction("生成透明背景素材", "auto");
    expect(promptRequestedTransparent).toContain(TRANSPARENT_BACKGROUND_PROMPT_INSTRUCTION);
    expect(promptRequestedTransparent).not.toContain(DEFAULT_OPAQUE_BACKGROUND_PROMPT_INSTRUCTION);
    expect(injectImageBackgroundInstruction("修改尾巴颜色", "transparent")).toContain(
      TRANSPARENT_BACKGROUND_PROMPT_INSTRUCTION
    );
  });
});
