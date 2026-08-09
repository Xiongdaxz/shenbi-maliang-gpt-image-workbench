import type { ImageJob } from "../types";

export type ImageResultPlaceholderState = "hidden" | "rendering" | "failed" | "unavailable";

export function imageResultPlaceholderState(
  hasImage: boolean,
  jobStatus?: ImageJob["status"]
): ImageResultPlaceholderState {
  if (hasImage) return "hidden";
  if (jobStatus === "running") return "rendering";
  if (jobStatus === "failed" || jobStatus === "cancelled") return "failed";
  return "unavailable";
}
