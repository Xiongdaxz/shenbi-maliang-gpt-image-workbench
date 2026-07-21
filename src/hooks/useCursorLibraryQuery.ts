import { infiniteQueryOptions, useInfiniteQuery, type QueryKey } from "@tanstack/react-query";
import type { LibraryPage } from "../types";

const LIBRARY_STALE_TIME_MS = 30_000;
const LIBRARY_GC_TIME_MS = 10 * 60_000;

type CursorLibraryQueryOptions<T> = {
  queryKey: QueryKey;
  queryFn: (input: { cursor: string | null; signal: AbortSignal }) => Promise<LibraryPage<T>>;
  enabled?: boolean;
};

export function cursorLibraryQueryOptions<T>({
  queryKey,
  queryFn,
  enabled = true
}: CursorLibraryQueryOptions<T>) {
  return infiniteQueryOptions({
    queryKey,
    queryFn: ({ pageParam, signal }) => queryFn({ cursor: String(pageParam ?? "") || null, signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.pageInfo.nextCursor ?? undefined,
    enabled,
    staleTime: LIBRARY_STALE_TIME_MS,
    gcTime: LIBRARY_GC_TIME_MS
  });
}

export function useCursorLibraryQuery<T>(options: CursorLibraryQueryOptions<T>) {
  return useInfiniteQuery(cursorLibraryQueryOptions(options));
}
