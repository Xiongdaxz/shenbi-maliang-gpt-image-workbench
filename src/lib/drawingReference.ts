export const DRAWING_REFERENCE_REQUEST_KEY = "_drawingReference" as const;

export const DRAWING_REFERENCE_PROMPT_INSTRUCTION =
  "绘图参考要求：附件中由绘图功能生成的简笔线稿或几何草图是用户提供的低精度构图草图，不是普通风格素材，也不是需要逐线复刻的成品。优先参考主体数量、粗略位置、姿态与朝向意图、功能或内容区域、主要配色、文字内容及整体空间关系。不要机械照搬草图中的线条长度、局部比例、透视误差或不规则轮廓。应先识别草图的主体类型，再采用相应的合理结构：人物和动物遵循自然解剖与比例，产品、建筑和机械遵循几何、透视与物理关系，图标、版式和抽象图形保留关键形状、对齐与空间关系。可以为修正明显的绘制误差而适当调整局部轮廓与细节，同时保留整体构图意图。草图线条和几何图形默认只表示结构与占位，不要直接生成成品中的黑色描边。请依据用户提示补全主体、场景、材质、色彩、光影和细节。";

const DRAWING_REFERENCE_NAME_PATTERN =
  /^(?:绘图素材|繪圖素材|drawing material|描画素材|그림 소재|chatgpt 草图)/i;

export function isDrawingReferenceName(value: unknown) {
  return DRAWING_REFERENCE_NAME_PATTERN.test(String(value ?? "").trim());
}

export function appendDrawingReferenceInstruction(prompt: string, drawingReference: boolean) {
  if (!drawingReference || prompt.includes(DRAWING_REFERENCE_PROMPT_INSTRUCTION)) return prompt;
  return [prompt, "", DRAWING_REFERENCE_PROMPT_INSTRUCTION].join("\n");
}
