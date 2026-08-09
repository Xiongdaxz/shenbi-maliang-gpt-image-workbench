import { describe, expect, test } from "bun:test";
import {
  formatImageAnnotationDisplayText,
  formatImageAnnotationMessageDisplayText,
  formatImageAnnotationPrompt,
  imageAnnotationEditorPosition,
  moveEditableImageAnnotation,
  parseImageAnnotations,
  removeEditableImageAnnotation,
  resolveImageAnnotationMessageEdit,
  upsertEditableImageAnnotation,
  type EditableImageAnnotation
} from "./imageAnnotations";

describe("image annotations", () => {
  test("validates coordinates and non-empty instructions", () => {
    expect(parseImageAnnotations([{ xPercent: 69.24, yPercent: 31.68, instruction: " 变化 " }])).toEqual({
      provided: true,
      annotations: [{ xPercent: 69.24, yPercent: 31.68, instruction: "变化" }]
    });
    expect(parseImageAnnotations([{ xPercent: 101, yPercent: 20, instruction: "变化" }]).error).toContain("0% 到 100%");
    expect(parseImageAnnotations([{ xPercent: 20, yPercent: 20, instruction: " " }]).error).toContain("不能为空");
  });

  test("serializes one-decimal coordinates and appends optional extra instructions", () => {
    const annotations = [
      { xPercent: 69.24, yPercent: 31.68, instruction: "变化" },
      { xPercent: 79.44, yPercent: 45.36, instruction: "改成黑色" }
    ];
    expect(formatImageAnnotationPrompt(annotations)).toBe(
      "1. (x: 69.2%, y: 31.7%) 变化\n2. (x: 79.4%, y: 45.4%) 改成黑色"
    );
    expect(formatImageAnnotationPrompt(annotations, "整体保持原构图")).toEndWith("\n整体保持原构图");
  });

  test("hides coordinates only in annotation display text", () => {
    expect(
      formatImageAnnotationDisplayText(
        "1. (x: 50.1%, y: 55.2%) 改成黑色\n2. (x: 82.8%, y: 7.4%) 加一副画\n\n整体保持原构图"
      )
    ).toBe("1. 改成黑色\n2. 加一副画\n整体保持原构图");
    expect(formatImageAnnotationDisplayText("生成一个铠甲勇士")).toBe("生成一个铠甲勇士");
  });

  test("hides coordinates from legacy edited messages that lost annotation metadata", () => {
    const content = "1. (x: 33.6%, y: 21.8%) 改成黄色\n2. (x: 74.0%, y: 9.6%) 改成绿色";
    expect(formatImageAnnotationMessageDisplayText(content, { mode: "edit" })).toBe("1. 改成黄色\n2. 改成绿色");
    expect(formatImageAnnotationMessageDisplayText(content, { mode: "generation" })).toBe(content);
  });

  test("preserves annotation coordinates when a displayed message is edited again", () => {
    const annotations = [
      { xPercent: 33.6, yPercent: 21.8, instruction: "改成黄色" },
      { xPercent: 74, yPercent: 9.6, instruction: "改成绿色" },
      { xPercent: 84.3, yPercent: 40.9, instruction: "白色" }
    ];
    expect(resolveImageAnnotationMessageEdit(
      "1. 改成蓝色\n2. 改成绿色\n3. 白色\n整体保持原构图",
      annotations
    )).toEqual({
      annotations: [
        { xPercent: 33.6, yPercent: 21.8, instruction: "改成蓝色" },
        { xPercent: 74, yPercent: 9.6, instruction: "改成绿色" },
        { xPercent: 84.3, yPercent: 40.9, instruction: "白色" }
      ],
      extraInstruction: "整体保持原构图"
    });
    expect(resolveImageAnnotationMessageEdit(
      "1. (x: 33.6%, y: 21.8%) 改成黄色\n2. (x: 74.0%, y: 9.6%) 改成绿色\n3. (x: 84.3%, y: 40.9%) 白色",
      annotations
    ).extraInstruction).toBe("");
  });

  test("keeps numbered overall requirements separate from edited annotations", () => {
    const annotations = [
      { xPercent: 33.6, yPercent: 21.8, instruction: "改成黄色" },
      { xPercent: 74, yPercent: 9.6, instruction: "改成绿色" }
    ];

    expect(resolveImageAnnotationMessageEdit(
      "1. 改成蓝色\n2. 改成绿色\n整体要求：\n1. 保持原构图\n2. 不要改变人物",
      annotations
    )).toEqual({
      annotations: [
        { xPercent: 33.6, yPercent: 21.8, instruction: "改成蓝色" },
        { xPercent: 74, yPercent: 9.6, instruction: "改成绿色" }
      ],
      extraInstruction: "整体要求：\n1. 保持原构图\n2. 不要改变人物"
    });
  });

  test("keeps marker lifecycle ordered so numbering remains continuous", () => {
    let annotations: EditableImageAnnotation[] = [];
    annotations = upsertEditableImageAnnotation(
      annotations,
      { xPercent: 20, yPercent: 30, instruction: "第一条" },
      () => "annotation-1"
    );
    annotations = upsertEditableImageAnnotation(
      annotations,
      { xPercent: 40, yPercent: 50, instruction: "第二条" },
      () => "annotation-2"
    );
    annotations = moveEditableImageAnnotation(annotations, "annotation-2", 120, -4);
    annotations = upsertEditableImageAnnotation(
      annotations,
      { id: "annotation-1", xPercent: 21, yPercent: 31, instruction: "已修改" },
      () => "unused"
    );
    annotations = removeEditableImageAnnotation(annotations, "annotation-1");
    expect(annotations).toEqual([
      { id: "annotation-2", xPercent: 100, yPercent: 0, instruction: "第二条" }
    ]);
    expect(formatImageAnnotationPrompt(annotations)).toStartWith("1. ");
  });

  test("keeps the inline editor aligned beside its marker and allows overflow", () => {
    expect(imageAnnotationEditorPosition(2, 2, 800, 600)).toEqual({ left: 40, top: -12, width: 292 });
    expect(imageAnnotationEditorPosition(98, 98, 800, 600)).toEqual({ left: 808, top: 564, width: 292 });
  });
});
