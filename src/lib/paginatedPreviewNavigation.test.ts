import { describe, expect, test } from "bun:test";
import { resolvePendingPreviewRequest, type PendingPreviewRequest } from "./paginatedPreviewNavigation";

const pending: PendingPreviewRequest = { index: 20, sourceKey: "source-a", errorUpdateCount: 2 };

describe("paginated preview navigation", () => {
  test("navigates only after the requested item is available", () => {
    expect(resolvePendingPreviewRequest(pending, {
      sourceKey: "source-a",
      itemCount: 20,
      hasNextPage: true,
      isFetchingNextPage: true,
      isFetchNextPageError: false,
      errorUpdateCount: 2
    })).toBeUndefined();
    expect(resolvePendingPreviewRequest(pending, {
      sourceKey: "source-a",
      itemCount: 21,
      hasNextPage: true,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      errorUpdateCount: 2
    })).toBe(20);
  });

  test("cancels stale requests after source changes or pagination fails", () => {
    expect(resolvePendingPreviewRequest(pending, {
      sourceKey: "source-b",
      itemCount: 21,
      hasNextPage: true,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      errorUpdateCount: 2
    })).toBeNull();
    expect(resolvePendingPreviewRequest(pending, {
      sourceKey: "source-a",
      itemCount: 20,
      hasNextPage: true,
      isFetchingNextPage: false,
      isFetchNextPageError: true,
      errorUpdateCount: 2
    })).toBeUndefined();
    expect(resolvePendingPreviewRequest(pending, {
      sourceKey: "source-a",
      itemCount: 20,
      hasNextPage: true,
      isFetchingNextPage: false,
      isFetchNextPageError: true,
      errorUpdateCount: 3
    })).toBeNull();
    expect(resolvePendingPreviewRequest(pending, {
      sourceKey: "source-a",
      itemCount: 20,
      hasNextPage: false,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      errorUpdateCount: 2
    })).toBeNull();
  });
});
