import { describe, expect, test } from "bun:test";
import type { ImageSet, ImageSetItem, WorkImage } from "../types";
import { imageSetGuidance, imageSetNextAction, imageSetPlacementStatus, imageSetPreview, imageSetStep, profileColorSwatches } from "./imageSetWorkspace";

const image = (id: string) => ({ id } as WorkImage);
function item(overrides: Partial<ImageSetItem> = {}): ImageSetItem {
  return { id: "other", name: "Banner", purpose: "", copy: "", size: "1024x1024", composition: "", revision: 2,
    selectedImageId: "", selectionCurrent: false, runs: [], ...overrides };
}
const run = (overrides: Partial<ImageSetItem["runs"][number]> = {}): ImageSetItem["runs"][number] => ({
  id: "run", itemId: "other", jobId: "job", status: "succeeded", error: "", contextRevision: 3, itemRevision: 2,
  createdAt: "2026-10-16", images: [image("candidate")], ...overrides
});
function project(overrides: Partial<ImageSet> = {}): ImageSet {
  return { id: "set", ownerId: "user", name: "Campaign", brief: "Brief", commonStyle: "", profileSelection: {}, assetIds: [],
    providerId: "", model: "gpt-image-2", quality: "high", anchorItemId: "anchor", revision: 1, contextRevision: 3,
    confirmed: true, archived: false, stopped: false, finalized: false, anchorImageId: "anchor-image", anchorCurrent: true,
    items: [item({ id: "anchor", selectedImageId: "anchor-image", selectionCurrent: true }), item()],
    stage: "review", selectedCount: 1, activeCount: 0, snapshot: null, createdAt: "", updatedAt: "", ...overrides };
}

describe("image set workspace workflow", () => {
  test("keeps three task-oriented stages while distinguishing the next required action", () => {
    expect(imageSetStep(undefined)).toBe(0);
    expect(imageSetStep(project({ confirmed: false }))).toBe(0);
    expect(imageSetStep(project({ anchorCurrent: false, activeCount: 2 }))).toBe(1);
    expect(imageSetStep(project())).toBe(2);
    expect(imageSetStep(project({ finalized: true }))).toBe(2);
    expect(imageSetGuidance(project({ anchorCurrent: false, activeCount: 2 }), false)).toBe("generatingStyle");
    expect(imageSetGuidance(project({ selectedCount: 2 }), false)).toBe("ready");
    expect(imageSetGuidance(project({ selectedCount: 2, finalized: true }), false)).toBe("done");
    expect(imageSetGuidance(project({ finalized: true }), true)).toBe("unsaved");
    expect(imageSetGuidance(project({ archived: true }), false)).toBe("archived");
  });
  test("saves pending changes before using the persisted baseline or exporting a finalized set", () => {
    expect(imageSetNextAction(project({ finalized: true }), true)).toBe("save");
    expect(imageSetNextAction(project({ anchorCurrent: false }), true)).toBe("save");
    expect(imageSetNextAction(project({ confirmed: false }), true)).toBe("confirm");
    expect(imageSetNextAction(project({ activeCount: 1 }), false)).toBe("stop");
  });
  test("only offers a batch generation when a current candidate is missing", () => {
    expect(imageSetNextAction(project(), false)).toBe("generate");
    const withCandidates = project({ items: [item({ id: "anchor", selectionCurrent: true }), item({ runs: [run()] })] });
    expect(imageSetNextAction(withCandidates, false)).toBe("review");
    withCandidates.items[1].runs[0].contextRevision = 2;
    expect(imageSetNextAction(withCandidates, false)).toBe("generate");
  });
  test("finalization and export become available at the appropriate time", () => {
    expect(imageSetNextAction(project({ selectedCount: 2 }), false)).toBe("finalize");
    expect(imageSetNextAction(project({ finalized: true, selectedCount: 2 }), false)).toBe("export");
    expect(imageSetNextAction(project({ anchorCurrent: false }), false)).toBe("anchor");
  });
});
describe("image set preview and placement state", () => {
  test("new tasks stay visible while an adopted image is retained", () => {
    const placement = item({ selectedImageId: "adopted", selectionCurrent: true, runs: [run({ status: "running", images: [] }), run({ images: [image("adopted")] })] });
    expect(imageSetPlacementStatus(placement)).toBe("running");
    expect(imageSetPreview(placement.runs.flatMap(value => value.images), undefined, placement.selectedImageId)?.id).toBe("adopted");
  });
  test("a failed new attempt remains visible beside a retained adoption, while stopping keeps its adopted status", () => {
    const placement = item({ selectedImageId: "adopted", selectionCurrent: true, runs: [run({ status: "failed", images: [] }), run({ images: [image("adopted")] })] });
    expect(imageSetPlacementStatus(placement)).toBe("failed");
    expect(imageSetPreview(placement.runs.flatMap(value => value.images), undefined, placement.selectedImageId)?.id).toBe("adopted");
    placement.runs[0].status = "cancelled";
    expect(imageSetPlacementStatus(placement)).toBe("adopted");
  });
  test("explicitly previewing a candidate does not change adoption or reset on a refresh", () => {
    const images = [image("new"), image("adopted"), image("inspected")];
    expect(imageSetPreview(images, "inspected", "adopted")?.id).toBe("inspected");
    expect(imageSetPreview([image("newer"), ...images], "inspected", "adopted")?.id).toBe("inspected");
    expect(imageSetPreview(images, "deleted", "adopted")?.id).toBe("adopted");
    expect(imageSetPreview(images, "deleted", "deleted")?.id).toBe("new");
    expect(imageSetPreview([], "deleted")).toBeUndefined();
  });
  test("shows review requirements, failed attempts, and initial placements distinctly", () => {
    expect(imageSetPlacementStatus(item({ selectedImageId: "old", selectionCurrent: false }))).toBe("stale");
    expect(imageSetPlacementStatus(item({ runs: [run({ status: "failed", images: [] })] }))).toBe("failed");
    expect(imageSetPlacementStatus(item({ runs: [run()] }))).toBe("pendingAdoption");
    expect(imageSetPlacementStatus(undefined)).toBe("waiting");
  });
  test("uses only real saved hex colors for brand swatches", () => {
    expect(profileColorSwatches("#aabbcc、#123、#aabbcc, #12gg34 and #12345678")).toEqual(["#aabbcc", "#123"]);
    expect(profileColorSwatches("柔和的绿色和白色")).toEqual([]);
  });
});
