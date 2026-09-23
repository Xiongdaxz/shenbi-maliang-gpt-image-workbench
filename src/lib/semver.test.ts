import { describe, expect, test } from "bun:test";
import { compareSemver, displayVersion, normalizeSemver } from "./semver";

describe("app SemVer", () => {
  test("normalizes display prefixes and build metadata", () => {
    expect(normalizeSemver(" v0.1.79 ")).toBe("0.1.79");
    expect(normalizeSemver("1.2.3+build.4")).toBe("1.2.3+build.4");
    expect(displayVersion("0.1.79")).toBe("v0.1.79");
  });

  test("compares stable and prerelease versions", () => {
    expect(compareSemver("0.1.78", "0.1.79")).toBe(-1);
    expect(compareSemver("v1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("1.0.0-beta.10", "1.0.0-beta.2")).toBe(1);
    expect(compareSemver("1.0.0", "1.0.0-rc.1")).toBe(1);
    expect(compareSemver("1.0.0+build.2", "1.0.0+build.1")).toBe(0);
  });

  test("rejects invalid versions without throwing", () => {
    expect(normalizeSemver("1.2")).toBeNull();
    expect(compareSemver("dev", "1.0.0")).toBeNull();
  });
});
