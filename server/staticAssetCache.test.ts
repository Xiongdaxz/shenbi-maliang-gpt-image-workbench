import { describe, expect, test } from "bun:test";
import { staticAssetCacheControl } from "./staticAssetCache";

describe("static asset cache policy", () => {
  test("never persists the application shell", () => {
    expect(staticAssetCacheControl("D:\\app\\dist\\index.html")).toBe("no-store");
    expect(staticAssetCacheControl("index.html")).toBe("no-store");
  });

  test("keeps hashed build assets immutable", () => {
    expect(staticAssetCacheControl("D:\\app\\dist\\assets\\index-abc123.js"))
      .toBe("public, max-age=31536000, immutable");
  });

  test("leaves ordinary public images on the default policy", () => {
    expect(staticAssetCacheControl("D:\\app\\dist\\image\\logo.png")).toBe("");
  });
});
