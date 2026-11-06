import type { ImageSet, ImageSetItem, WorkImage } from "../types";

export function imageSetStep(set: ImageSet | undefined) {
  if (!set?.confirmed) return 0;
  return set.anchorCurrent ? 2 : 1;
}

export function imageSetGuidance(set: ImageSet | undefined, dirty: boolean) {
  if (set?.archived) return "archived";
  if (set?.activeCount) return set.anchorCurrent ? "generating" : "generatingStyle";
  if (!set?.confirmed) return "brief";
  if (dirty) return "unsaved";
  if (!set.anchorCurrent) return "pickStyle";
  const action = imageSetNextAction(set, false);
  return action === "generate" ? "generateRest" : action === "review" ? "review" : action === "finalize" ? "ready" : "done";
}

export function imageSetNextAction(set: ImageSet | undefined, dirty: boolean) {
  if (set?.activeCount) return "stop";
  if (!set?.confirmed) return "confirm";
  if (dirty) return "save";
  if (!set.anchorCurrent) return "anchor";
  if (set.finalized) return "export";
  if (set.selectedCount === set.items.length) return "finalize";
  const missing = set.items.some(item => item.id !== set.anchorItemId && !item.selectionCurrent &&
    !item.runs.some(run => run.contextRevision === set.contextRevision && run.itemRevision === item.revision && run.images.length));
  return missing ? "generate" : "review";
}

export function imageSetPlacementStatus(item: ImageSetItem | undefined) {
  const active = item?.runs.find(run => run.status === "queued" || run.status === "running");
  if (active) return active.status;
  const latest = item?.runs[0];
  if (latest?.status === "failed") return "failed";
  if (item?.selectedImageId) return item.selectionCurrent ? "adopted" : "stale";
  if (latest?.status === "cancelled") return "cancelled";
  return item?.runs.some(run => run.images.length) ? "pendingAdoption" : "waiting";
}

export function imageSetPreview(images: WorkImage[], preferredId?: string, adoptedId?: string) {
  return images.find(image => image.id === preferredId) || images.find(image => image.id === adoptedId) || images[0];
}

export function profileColorSwatches(value: string) {
  return [...new Set(value.match(/#[\da-f]{6}\b|#[\da-f]{3}\b/gi) || [])].slice(0, 6);
}
