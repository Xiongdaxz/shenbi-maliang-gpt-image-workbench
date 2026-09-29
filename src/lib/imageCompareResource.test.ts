import { describe, expect, test } from "bun:test";
import { compareDisplayedResource } from "./imageCompareResource";
import { compareScale } from "./imageCompare";
import type { ImageDownloadOption, WorkImage } from "../types";

const image = {
  id: "a", url: "/api/files/images/a", originalUrl: "/api/files/images/a", previewUrl: "/api/files/images/a?variant=preview",
  imageWidth: 2048, imageHeight: 3072, imageFileSize: 3_500_000
} as WorkImage;
const preview = { src: image.previewUrl, width: 1067, height: 1600 };
const original = { status: "ready" as const, src: "blob:original-a", width: 2048, height: 3072, fileSize: 3_510_000 };
const options = [{ variant: "preview", url: image.previewUrl, width: 1067, height: 1600, fileSize: 118_400 }] as ImageDownloadOption[];

describe("displayed comparison resource metadata", () => {
  test("switching bitmap changes URL, dimensions and bytes without changing the view", () => {
    const view = Object.freeze({ mode: "actual" as const, zoom: 1.3, u: .6, v: .4 });
    const geometry = { width: image.imageWidth, height: image.imageHeight, viewportWidth: 600, viewportHeight: 900 };
    const scale = compareScale(view, geometry);
    const full = compareDisplayedResource(image, true, original, preview, options)!;
    const small = compareDisplayedResource(image, false, original, preview, options)!;
    expect(full).toEqual({ source: "original", src: "blob:original-a", width: 2048, height: 3072, fileSize: 3_510_000 });
    expect(small).toEqual({ source: "preview", src: image.previewUrl, width: 1067, height: 1600, fileSize: 118_400 });
    expect(compareScale(view, geometry)).toBe(scale);
    expect(compareDisplayedResource(image, true, original, preview, options)).toEqual(full);
  });
  test("loading or failed originals keep the preview metadata until the original is ready", () => {
    for (const status of ["loading", "error"] as const) {
      const result = compareDisplayedResource(image, true, { status }, preview, options)!;
      expect(result.source).toBe("preview");
      expect(result.src).toBe(image.previewUrl);
      expect(result.fileSize).toBe(118_400);
    }
  });
  test("small images can have equal pixel dimensions but different encoded file sizes", () => {
    const smallImage = { ...image, imageWidth: 1086, imageHeight: 1448 };
    const decoded = { src: image.previewUrl, width: 1086, height: 1448 };
    const result = compareDisplayedResource(smallImage, false, undefined, decoded, options)!;
    expect(result.width).toBe(1086);
    expect(result.height).toBe(1448);
    expect(result.fileSize).toBe(118_400);
  });
  test("missing or mismatched preview metadata never displays original file size", () => {
    expect(compareDisplayedResource(image, false, original, preview)?.fileSize).toBe(0);
    const wrongUrl = [{ ...options[0], url: "/api/files/images/b?variant=preview" }];
    expect(compareDisplayedResource(image, false, original, preview, wrongUrl)?.fileSize).toBe(0);
    const beforeLoad = compareDisplayedResource(image, false, original, { src: "", width: 0, height: 0 });
    expect(beforeLoad?.width).toBe(0);
    expect(beforeLoad?.height).toBe(0);
  });
  test("an original URL fallback is accurately labeled as original", () => {
    const result = compareDisplayedResource({ ...image, previewUrl: "" }, false, undefined, { ...preview, src: image.url });
    expect(result?.source).toBe("original");
    expect(result?.fileSize).toBe(image.imageFileSize);
  });
});
