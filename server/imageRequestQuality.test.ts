import { describe, expect, test } from "bun:test";
import { DEFAULT_REQUEST_QUALITY, requestImageQuality } from "./constants";

describe("image request quality", () => {
  test("uses the provider default when the request is empty or auto", () => {
    expect(requestImageQuality(undefined, "high")).toBe("high");
    expect(requestImageQuality("", "medium")).toBe("medium");
    expect(requestImageQuality("auto", "high")).toBe("high");
    expect(requestImageQuality("AUTO", "medium")).toBe("medium");
  });

  test("falls back to high when the provider has no concrete default", () => {
    expect(requestImageQuality(undefined, undefined)).toBe(DEFAULT_REQUEST_QUALITY);
    expect(requestImageQuality("auto", "")).toBe(DEFAULT_REQUEST_QUALITY);
    expect(requestImageQuality("auto", "auto")).toBe(DEFAULT_REQUEST_QUALITY);
  });

  test("preserves an explicitly requested quality", () => {
    expect(requestImageQuality("low", "high")).toBe("low");
    expect(requestImageQuality("medium", "high")).toBe("medium");
    expect(requestImageQuality("high", "low")).toBe("high");
  });
});
