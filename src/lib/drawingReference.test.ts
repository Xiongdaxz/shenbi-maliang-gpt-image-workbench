import { describe, expect, test } from "bun:test";
import {
  DRAWING_REFERENCE_PROMPT_INSTRUCTION,
  appendDrawingReferenceInstruction,
  isDrawingReferenceName
} from "./drawingReference";

describe("drawing reference semantics", () => {
  test("recognizes current and localized drawing material names", () => {
    expect(isDrawingReferenceName("绘图素材-123.png")).toBe(true);
    expect(isDrawingReferenceName("Drawing material-123.png")).toBe(true);
    expect(isDrawingReferenceName("ChatGPT 草图 9月14日.png")).toBe(true);
    expect(isDrawingReferenceName("普通素材.png")).toBe(false);
  });

  test("adds the hidden drawing constraint exactly once", () => {
    const first = appendDrawingReferenceInstruction("生成一个女生", true);
    expect(first).toContain("生成一个女生");
    expect(first).toContain(DRAWING_REFERENCE_PROMPT_INSTRUCTION);
    expect(appendDrawingReferenceInstruction(first, true)).toBe(first);
    expect(appendDrawingReferenceInstruction("生成一个女生", false)).toBe("生成一个女生");
  });

  test("adapts structural correction to the drawing subject type", () => {
    expect(DRAWING_REFERENCE_PROMPT_INSTRUCTION).toContain("低精度构图草图");
    expect(DRAWING_REFERENCE_PROMPT_INSTRUCTION).toContain("应先识别草图的主体类型");
    expect(DRAWING_REFERENCE_PROMPT_INSTRUCTION).toContain("人物和动物遵循自然解剖与比例");
    expect(DRAWING_REFERENCE_PROMPT_INSTRUCTION).toContain("产品、建筑和机械遵循几何、透视与物理关系");
    expect(DRAWING_REFERENCE_PROMPT_INSTRUCTION).toContain("图标、版式和抽象图形保留关键形状、对齐与空间关系");
    expect(DRAWING_REFERENCE_PROMPT_INSTRUCTION).not.toContain("保留主体数量、相对位置、姿态与朝向、轮廓、比例");
  });
});
