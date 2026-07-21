import { describe, expect, test } from "bun:test";
import {
  decodeLibraryCursor,
  encodeLibraryCursor,
  libraryCursorWhere,
  libraryFilterSignature,
  libraryLimit,
  libraryPageInfo
} from "./libraryCursor";

describe("library cursor", () => {
  test("round trips only within the same kind, filters and sort", () => {
    const signature = libraryFilterSignature("images", { keyword: "海报", favoriteOnly: false });
    const cursor = encodeLibraryCursor({ kind: "images", signature, sort: "desc", createdAt: "2026-07-20 10:00:00", id: "img_2" });
    expect(decodeLibraryCursor(cursor, { kind: "images", signature, sort: "desc" })?.id).toBe("img_2");
    expect(() => decodeLibraryCursor(cursor, { kind: "assets", signature, sort: "desc" })).toThrow();
  });

  test("uses a stable composite boundary and limit plus one", () => {
    const signature = libraryFilterSignature("assets", { space: "all" });
    const cursor = decodeLibraryCursor(
      encodeLibraryCursor({ kind: "assets", signature, sort: "desc", createdAt: "2026-07-20", id: "asset_2" }),
      { kind: "assets", signature, sort: "desc" }
    );
    expect(libraryCursorWhere(cursor, { createdAt: "created_at", id: "id" }, "desc")).toEqual({
      sql: " and (created_at < ? or (created_at = ? and id < ?))",
      params: ["2026-07-20", "2026-07-20", "asset_2"]
    });
    const page = libraryPageInfo(
      [
        { id: "3", createdAt: "3" },
        { id: "2", createdAt: "2" },
        { id: "1", createdAt: "1" }
      ],
      2,
      { kind: "assets", signature, sort: "desc" }
    );
    expect(page.items.map((item) => item.id)).toEqual(["3", "2"]);
    expect(page.pageInfo.hasMore).toBe(true);
    expect(page.pageInfo.nextCursor).toBeTruthy();
  });

  test("keeps bidirectional anchor cursors isolated by direction and anchor", () => {
    const filters = { keyword: "", favoriteOnly: false, sessionId: "session_1", anchorId: "image_2", sort: "asc" };
    const signature = libraryFilterSignature("images", filters);
    const encoded = encodeLibraryCursor({
      kind: "images",
      signature,
      sort: "asc",
      createdAt: "2026-07-20 10:00:00",
      id: "image_3"
    });
    const cursor = decodeLibraryCursor(encoded, { kind: "images", signature, sort: "asc" });
    expect(libraryCursorWhere(cursor, { createdAt: "created_at", id: "id" }, "asc")).toEqual({
      sql: " and (created_at > ? or (created_at = ? and id > ?))",
      params: ["2026-07-20 10:00:00", "2026-07-20 10:00:00", "image_3"]
    });
    const differentAnchorSignature = libraryFilterSignature("images", { ...filters, anchorId: "image_4" });
    expect(() => decodeLibraryCursor(encoded, { kind: "images", signature: differentAnchorSignature, sort: "asc" })).toThrow();
    expect(() => decodeLibraryCursor(encoded, { kind: "images", signature, sort: "desc" })).toThrow();
  });

  test("caps page sizes", () => {
    expect(libraryLimit(undefined)).toBe(30);
    expect(libraryLimit(0)).toBe(30);
    expect(libraryLimit(500)).toBe(60);
  });
});
