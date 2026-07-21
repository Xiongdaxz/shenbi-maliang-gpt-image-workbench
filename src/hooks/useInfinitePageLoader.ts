import { useEffect, useRef, type RefObject } from "react";

type UseInfinitePageLoaderOptions = {
  fetchNextPage: () => Promise<unknown>;
  hasNextPage: boolean;
  isFetchNextPageError?: boolean;
  isFetchingNextPage: boolean;
  rootRef?: RefObject<Element | null>;
  rootMargin?: string;
};

export function useInfinitePageLoader({
  fetchNextPage,
  hasNextPage,
  isFetchNextPageError = false,
  isFetchingNextPage,
  rootRef,
  rootMargin = "720px"
}: UseInfinitePageLoaderOptions) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const retryArmedRef = useRef(false);

  useEffect(() => {
    if (isFetchNextPageError) retryArmedRef.current = false;
  }, [isFetchNextPageError]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage) return;
    const root = rootRef?.current ?? null;
    const observer = new IntersectionObserver(
      (entries) => {
        const intersects = entries.some((entry) => entry.isIntersecting);
        if (!intersects) {
          if (isFetchNextPageError) retryArmedRef.current = true;
          return;
        }
        if (!isFetchingNextPage && (!isFetchNextPageError || retryArmedRef.current)) {
          retryArmedRef.current = false;
          void fetchNextPage();
        }
      },
      { root, rootMargin }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage, rootMargin, rootRef]);

  return sentinelRef;
}
