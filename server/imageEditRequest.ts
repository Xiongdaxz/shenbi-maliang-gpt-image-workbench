import {
  REMOVE_SELECTED_AREA_PROMPT,
  formatImageAnnotationPrompt,
  parseImageAnnotations,
  type ImageAnnotation,
  type ImageEditIntent
} from "../src/lib/imageAnnotations";

const MASK_EDIT_INSTRUCTION =
  "严格只在遮罩选区内修改，新增或替换内容必须与选区位置对齐，并符合原图透视、光影、材质和风格，自然融合到画面中，不得移到选区外；未选区域保持原图不变。遮罩不是画面内容，不要生成遮罩颜色、边框或涂抹痕迹。";

export type NormalizedImageEditRequest = {
  editIntent: ImageEditIntent;
  imageAnnotations: ImageAnnotation[];
  prompt: string;
  extraPrompt: string;
};

export function normalizeImageEditRequest(
  body: Record<string, unknown>,
  options: { hasMask: boolean; canRestoreMask?: boolean }
): NormalizedImageEditRequest | { error: string } {
  const rawIntent = body.editIntent ?? "standard";
  if (rawIntent !== "standard" && rawIntent !== "annotation" && rawIntent !== "remove") {
    return { error: "图片编辑模式无效" };
  }
  const editIntent = rawIntent as ImageEditIntent;
  const parsedAnnotations = parseImageAnnotations(body.imageAnnotations);
  if (parsedAnnotations.error) return { error: parsedAnnotations.error };
  const extraPrompt = String(body.prompt ?? "").trim();

  if (editIntent === "annotation") {
    if (options.hasMask) return { error: "评论模式不能同时提交移除选区" };
    if (parsedAnnotations.annotations.length === 0) return { error: "请至少添加一条图片评论" };
    return {
      editIntent,
      imageAnnotations: parsedAnnotations.annotations,
      prompt: formatImageAnnotationPrompt(parsedAnnotations.annotations, extraPrompt),
      extraPrompt
    };
  }

  if (parsedAnnotations.provided) {
    return { error: editIntent === "remove" ? "移除模式不能同时提交图片评论" : "普通编辑不能提交图片评论" };
  }
  if (editIntent === "remove") {
    if (!options.hasMask && !options.canRestoreMask) return { error: "请先涂抹需要移除的区域" };
    return {
      editIntent,
      imageAnnotations: [],
      prompt: REMOVE_SELECTED_AREA_PROMPT,
      extraPrompt: ""
    };
  }
  if (!extraPrompt) return { error: "请输入编辑描述" };
  return {
    editIntent,
    imageAnnotations: [],
    prompt: extraPrompt,
    extraPrompt
  };
}

export function finalizeProviderEditPrompt(options: {
  basePrompt: string;
  editIntent: ImageEditIntent;
  hasMask: boolean;
}) {
  if (options.editIntent === "remove") {
    return options.hasMask
      ? [REMOVE_SELECTED_AREA_PROMPT, "", MASK_EDIT_INSTRUCTION].join("\n")
      : REMOVE_SELECTED_AREA_PROMPT;
  }
  if (!options.hasMask) return options.basePrompt;
  return [options.basePrompt, "", MASK_EDIT_INSTRUCTION].join("\n");
}
