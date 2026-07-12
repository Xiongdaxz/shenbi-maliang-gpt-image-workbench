import { normalizeIdList } from "./utils";

export type ImageBatchItemStatus = "updated" | "created" | "deleted" | "duplicate" | "not_found" | "failed";

export type ImageBatchItemResult = {
  imageId: string;
  status: ImageBatchItemStatus;
  targetId?: string;
  reason?: string;
};

export type ImageBatchResult = {
  requested: number;
  succeeded: number;
  skipped: number;
  failed: number;
  items: ImageBatchItemResult[];
};

export function parseImageBatchIds(value: unknown, max: number) {
  const imageIds = normalizeIdList(value);
  if (imageIds.length === 0) return { imageIds, error: "请选择图片" };
  if (imageIds.length > max) return { imageIds, error: `单次最多处理 ${max} 张图片` };
  return { imageIds, error: "" };
}

export function imageBatchResult(items: ImageBatchItemResult[]): ImageBatchResult {
  return {
    requested: items.length,
    succeeded: items.filter((item) => item.status === "updated" || item.status === "created" || item.status === "deleted").length,
    skipped: items.filter((item) => item.status === "duplicate" || item.status === "not_found").length,
    failed: items.filter((item) => item.status === "failed").length,
    items
  };
}
