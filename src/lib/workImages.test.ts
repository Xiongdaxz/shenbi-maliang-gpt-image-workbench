import { describe, expect, test } from "bun:test";
import type { WorkImage } from "../types";
import { chronologicalWorkImages, orderedWorkImages } from "./workImages";

function workImage(id: string, createdAt: string) {
  return { id, createdAt } as WorkImage;
}

describe("editor image ordering", () => {
  test("keeps thumbnails in chronological conversation order without mutating the source", () => {
    const images = [
      workImage("later", "2026-07-20T10:02:00.000Z"),
      workImage("same-b", "2026-07-20T10:01:00.000Z"),
      workImage("earlier", "2026-07-20T10:00:00.000Z"),
      workImage("same-a", "2026-07-20T10:01:00.000Z")
    ];

    expect(chronologicalWorkImages(images).map((image) => image.id)).toEqual([
      "earlier",
      "same-a",
      "same-b",
      "later"
    ]);
    expect(images.map((image) => image.id)).toEqual(["later", "same-b", "earlier", "same-a"]);
  });

  test("puts the newest thumbnail first for the my-images editor entry", () => {
    const images = [
      workImage("earlier", "2026-07-20T10:00:00.000Z"),
      workImage("later", "2026-07-20T10:02:00.000Z"),
      workImage("middle", "2026-07-20T10:01:00.000Z")
    ];

    expect(orderedWorkImages(images, "desc").map((image) => image.id)).toEqual([
      "later",
      "middle",
      "earlier"
    ]);
  });
});
