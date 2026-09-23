import { describe, expect, test } from "bun:test";
import { buildAppUpdatePayload } from "./appUpdate";

const entries = [
  { version: "v0.1.80", content: "80" },
  { version: "v0.1.79", content: "79" },
  { version: "not-a-version", content: "ignored" },
  { version: "v0.1.78", content: "78" }
];

describe("app update payload", () => {
  test("returns every deployed changelog newer than the client", () => {
    expect(buildAppUpdatePayload(entries, "0.1.78", "0.1.80")).toEqual({
      serverVersion: "0.1.80",
      updateAvailable: true,
      entries: [entries[0], entries[1]],
      hasMore: false
    });
  });

  test("does not prompt equal or newer clients", () => {
    expect(buildAppUpdatePayload(entries, "v0.1.80", "0.1.80").updateAvailable).toBe(false);
    expect(buildAppUpdatePayload(entries, "0.1.81", "0.1.80").updateAvailable).toBe(false);
  });

  test("does not prompt on an invalid client version", () => {
    expect(buildAppUpdatePayload(entries, "development", "0.1.80")).toEqual({
      serverVersion: "0.1.80",
      updateAvailable: false,
      entries: [],
      hasMore: false
    });
  });

  test("still prompts when the matching changelog has not been synced", () => {
    expect(buildAppUpdatePayload([], "0.1.78", "0.1.79")).toEqual({
      serverVersion: "0.1.79",
      updateAvailable: true,
      entries: [],
      hasMore: false
    });
  });

  test("caps long histories while keeping the refresh available", () => {
    const longHistory = Array.from({ length: 24 }, (_, index) => ({
      version: `0.2.${23 - index}`,
      content: String(index)
    }));
    const result = buildAppUpdatePayload(longHistory, "0.1.99", "0.2.23");
    expect(result.updateAvailable).toBe(true);
    expect(result.entries).toHaveLength(20);
    expect(result.entries[0]?.version).toBe("0.2.23");
    expect(result.hasMore).toBe(true);
  });
});
