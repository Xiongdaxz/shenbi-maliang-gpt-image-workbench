import { describe, expect, test } from "bun:test";
import { storedImageCompletionState, storedImageSlotIndexes } from "./imageSlots";

describe("stored image slot recovery", () => {
  test("preserves an extra slot instead of compressing it into a missing requested slot", () => {
    const images = [
      { id: "image-1", job_image_index: 1 },
      { id: "image-extra", job_image_index: 3 }
    ];

    expect(Array.from(storedImageSlotIndexes(images, 2).entries())).toEqual([
      ["image-1", 1],
      ["image-extra", 3]
    ]);
    expect(storedImageCompletionState(images, 2)).toEqual({
      slotIndexes: [1, 3],
      completedRequestedSlotCount: 1,
      totalStoredImageCount: 2,
      remainingRequestedSlotCount: 1
    });
  });

  test("fills missing legacy indexes without accepting an implausibly large stored slot", () => {
    const images = [
      { id: "image-1", job_image_index: 1 },
      { id: "image-legacy", job_image_index: null },
      { id: "image-corrupt", job_image_index: 999_999 },
      { id: "image-invalid", job_image_index: "invalid" }
    ];

    expect(Array.from(storedImageSlotIndexes(images, 2).values())).toEqual([1, 2, 3, 4]);
  });
});
