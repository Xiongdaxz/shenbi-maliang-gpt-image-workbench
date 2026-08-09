export const REMOVE_SELECTED_AREA_PROMPT = "移除选定区域";

export type ImageEditIntent = "standard" | "annotation" | "remove";

export type ImageAnnotation = {
  xPercent: number;
  yPercent: number;
  instruction: string;
};

export type EditableImageAnnotation = ImageAnnotation & {
  id: string;
};

export type ImageAnnotationDraft = {
  id?: string;
  xPercent: number;
  yPercent: number;
  instruction: string;
};

export const MAX_IMAGE_ANNOTATION_LENGTH = 2000;

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function normalizedInstruction(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function parseImageAnnotations(value: unknown): {
  annotations: ImageAnnotation[];
  provided: boolean;
  error?: string;
} {
  if (value === undefined || value === null) return { annotations: [], provided: false };
  if (!Array.isArray(value)) return { annotations: [], provided: true, error: "图片评论格式无效" };

  const annotations: ImageAnnotation[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return { annotations: [], provided: true, error: "图片评论格式无效" };
    }
    const record = item as Record<string, unknown>;
    const xPercent = record.xPercent;
    const yPercent = record.yPercent;
    const instruction = normalizedInstruction(record.instruction);
    if (
      typeof xPercent !== "number"
      || !Number.isFinite(xPercent)
      || xPercent < 0
      || xPercent > 100
      || typeof yPercent !== "number"
      || !Number.isFinite(yPercent)
      || yPercent < 0
      || yPercent > 100
    ) {
      return { annotations: [], provided: true, error: "图片评论坐标必须在 0% 到 100% 之间" };
    }
    if (!instruction) return { annotations: [], provided: true, error: "图片评论内容不能为空" };
    if (instruction.length > MAX_IMAGE_ANNOTATION_LENGTH) {
      return { annotations: [], provided: true, error: `单条图片评论不能超过 ${MAX_IMAGE_ANNOTATION_LENGTH} 个字符` };
    }
    annotations.push({
      xPercent: clampPercent(xPercent),
      yPercent: clampPercent(yPercent),
      instruction
    });
  }
  return { annotations, provided: true };
}

export function formatImageAnnotationPrompt(annotations: ImageAnnotation[], extraInstruction = "") {
  const lines = annotations.map(
    (annotation, index) =>
      `${index + 1}. (x: ${annotation.xPercent.toFixed(1)}%, y: ${annotation.yPercent.toFixed(1)}%) ${normalizedInstruction(annotation.instruction)}`
  );
  const extra = extraInstruction.trim();
  return extra ? `${lines.join("\n")}\n${extra}` : lines.join("\n");
}

export function formatImageAnnotationDisplayText(value: string) {
  return value
    .replace(
      /^(\s*\d+\.)\s*\(x:\s*-?\d+(?:\.\d+)?%,\s*y:\s*-?\d+(?:\.\d+)?%\)\s*/gim,
      "$1 "
    )
    .replace(/(^|\n)(\d+\.[^\n]*)\n{2,}(?=\S)/g, "$1$2\n");
}

export function formatImageAnnotationMessageDisplayText(
  value: string,
  metadata?: { editIntent?: unknown; mode?: unknown } | null
) {
  const displayText = formatImageAnnotationDisplayText(value);
  const annotationMessage = metadata?.editIntent === "annotation";
  const legacyAnnotationMessage = metadata?.mode === "edit" && displayText !== value;
  return annotationMessage || legacyAnnotationMessage ? displayText : value;
}

export function resolveImageAnnotationMessageEdit(value: string, annotations: ImageAnnotation[]) {
  const editedInstructions = new Map<number, string>();
  const extraLines: string[] = [];
  const displayText = formatImageAnnotationDisplayText(value);
  let readingAnnotations = true;
  let expectedAnnotationIndex = 0;

  for (const line of displayText.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    if (readingAnnotations && expectedAnnotationIndex < annotations.length) {
      const match = line.match(/^\s*(\d+)\.\s*(.*?)\s*$/);
      const annotationIndex = match ? Number(match[1]) - 1 : -1;
      const instruction = match ? normalizedInstruction(match[2]) : "";
      if (annotationIndex === expectedAnnotationIndex && instruction) {
        editedInstructions.set(annotationIndex, instruction);
        expectedAnnotationIndex += 1;
        continue;
      }
    }

    readingAnnotations = false;
    if (trimmedLine) {
      extraLines.push(line.trim());
    }
  }

  return {
    annotations: annotations.map((annotation, index) => ({
      ...annotation,
      instruction: editedInstructions.get(index) ?? annotation.instruction
    })),
    extraInstruction: extraLines.join("\n")
  };
}

export function upsertEditableImageAnnotation(
  annotations: EditableImageAnnotation[],
  draft: ImageAnnotationDraft,
  createId: () => string
) {
  const instruction = normalizedInstruction(draft.instruction);
  const nextAnnotation = {
    id: draft.id ?? createId(),
    xPercent: clampPercent(draft.xPercent),
    yPercent: clampPercent(draft.yPercent),
    instruction
  };
  if (!draft.id) return [...annotations, nextAnnotation];
  return annotations.map((annotation) => (annotation.id === draft.id ? nextAnnotation : annotation));
}

export function moveEditableImageAnnotation(
  annotations: EditableImageAnnotation[],
  id: string,
  xPercent: number,
  yPercent: number
) {
  return annotations.map((annotation) =>
    annotation.id === id
      ? { ...annotation, xPercent: clampPercent(xPercent), yPercent: clampPercent(yPercent) }
      : annotation
  );
}

export function removeEditableImageAnnotation(annotations: EditableImageAnnotation[], id: string) {
  return annotations.filter((annotation) => annotation.id !== id);
}

export function imageAnnotationEditorPosition(
  xPercent: number,
  yPercent: number,
  canvasWidth: number,
  canvasHeight: number,
  editorWidth = 292,
  editorHeight = 48
) {
  const markerRadius = 14;
  const gap = 10;
  const anchorX = (clampPercent(xPercent) / 100) * canvasWidth;
  const anchorY = (clampPercent(yPercent) / 100) * canvasHeight;
  return {
    left: anchorX + markerRadius + gap,
    top: anchorY - editorHeight / 2,
    width: editorWidth
  };
}
