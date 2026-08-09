import { describe, expect, test } from "bun:test";
import { resolvePromptImageCount, resolveSelectedImageCount } from "./imagePromptCount";

describe("prompt-first image count resolution", () => {
  test("uses an explicit prompt image count before the page selection", () => {
    expect(resolvePromptImageCount("请分别生成3张图，构图各不相同", 1)).toBe(3);
    expect(resolvePromptImageCount("Generate 4 images of the same product", 2)).toBe(4);
    expect(resolvePromptImageCount("只生成一张图片", 6)).toBe(1);
    expect(resolvePromptImageCount("生成十二张图片", 1)).toBe(10);
  });

  test("recognizes image-labelled prompt groups without confusing object counts", () => {
    expect(resolvePromptImageCount("图1：白猫\n图2：黑猫\n图3：橘猫", 1)).toBe(3);
    expect(resolvePromptImageCount("分别生成：\n1. 白猫\n2. 黑猫", 1)).toBe(2);
    expect(resolvePromptImageCount("生成两只狗在草地上奔跑", 1)).toBe(1);
  });

  test("does not treat reference image counts as requested output counts", () => {
    expect(resolvePromptImageCount("使用2张图片作为参考，生成1张产品海报", 4)).toBe(1);
    expect(resolvePromptImageCount("基于两张图片生成三张不同角度的产品图", 1)).toBe(3);
    expect(resolvePromptImageCount("请生成2张参考图片", 1)).toBe(2);
  });

  test("uses the selected count for an unspecified multi-image request and otherwise keeps the selection", () => {
    expect(resolvePromptImageCount("生成多张猫咪图片", 1)).toBe(2);
    expect(resolvePromptImageCount("生成多张猫咪图片", 5)).toBe(5);
    expect(resolvePromptImageCount("一只猫坐在窗边", 4)).toBe(4);
    expect(resolvePromptImageCount("使用多张图片作为参考，重新设计这个产品", 1)).toBe(1);
  });

  test("can preserve the selected count when numbered annotation text must not be interpreted", () => {
    const annotationPrompt = "分别修改：\n1. (x: 20.0%, y: 30.0%) 改成白色\n2. (x: 40.0%, y: 50.0%) 删除文字";
    expect(resolvePromptImageCount(annotationPrompt, 1)).toBe(2);
    expect(resolveSelectedImageCount(1)).toBe(1);
  });
});
