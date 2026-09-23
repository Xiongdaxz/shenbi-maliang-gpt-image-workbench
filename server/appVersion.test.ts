import { describe, expect, test } from "bun:test";
import { resolveApplicationVersion } from "./appVersion";

describe("application version resolution", () => {
  test("uses the package version during normal startup", () => {
    expect(resolveApplicationVersion("0.1.78", "0.1.79")).toBe("0.1.78");
  });

  test("uses an explicit valid preview override", () => {
    expect(resolveApplicationVersion("0.1.78", "v0.1.79", true)).toBe("0.1.79");
  });

  test("ignores an invalid preview override", () => {
    expect(resolveApplicationVersion("0.1.78", "next-version", true)).toBe("0.1.78");
  });
});
