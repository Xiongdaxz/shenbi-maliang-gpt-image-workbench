import { describe, expect, test } from "bun:test";
import { imageDateSearchConditions } from "./imageSearch";

describe("localized image date search", () => {
  test("ignores an empty search term", () => {
    expect(imageDateSearchConditions("", "created_at")).toEqual({ clauses: [], params: [] });
  });

  test.each([
    ["周一", "1"],
    ["週一", "1"],
    ["Monday", "1"],
    ["friday", "5"]
  ])("matches the displayed weekday label %s", (keyword, weekday) => {
    const result = imageDateSearchConditions(keyword, "images.created_at");

    expect(result.clauses).toEqual(["strftime('%w', images.created_at) in (?)"]);
    expect(result.params).toEqual([weekday]);
  });

  test.each([
    ["2026年7月21日", "%2026-07-21%"],
    ["2026-7-21", "%2026-07-21%"],
    ["2026/07/21", "%2026-07-21%"]
  ])("normalizes the displayed date label %s", (keyword, expected) => {
    const result = imageDateSearchConditions(keyword, "created_at");

    expect(result.clauses).toEqual(["created_at like ?"]);
    expect(result.params).toEqual([expected]);
  });
});
