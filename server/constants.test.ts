import { describe, expect, test } from "bun:test";
import { DEFAULT_MULTI_IMAGE_CONCURRENCY, requestMultiImageConcurrency } from "./constants";

describe("multi-image concurrency settings", () => {
  test("uses the default for empty or invalid values", () => {
    expect(requestMultiImageConcurrency(undefined)).toBe(DEFAULT_MULTI_IMAGE_CONCURRENCY);
    expect(requestMultiImageConcurrency("")).toBe(DEFAULT_MULTI_IMAGE_CONCURRENCY);
    expect(requestMultiImageConcurrency("invalid")).toBe(DEFAULT_MULTI_IMAGE_CONCURRENCY);
    expect(requestMultiImageConcurrency(Number.NaN)).toBe(DEFAULT_MULTI_IMAGE_CONCURRENCY);
  });

  test("clamps configured concurrency to the supported 1-10 range", () => {
    expect(requestMultiImageConcurrency(0)).toBe(1);
    expect(requestMultiImageConcurrency(1)).toBe(1);
    expect(requestMultiImageConcurrency(10)).toBe(10);
    expect(requestMultiImageConcurrency(11)).toBe(10);
  });
});
