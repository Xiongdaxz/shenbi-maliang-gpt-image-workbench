import { useEffect, useRef, type RefObject } from "react";

type UseInfinitePageLoaderOptions = {
  fetchNextPage: () => Promise<unknown>;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  rootRef?: RefObject<Element | null>;
  rootMargin?: string;
};

export function useInfinitePageLoader({
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
  rootRef,
  rootMargin = "720px"
}: UseInfinitePageLoaderOptions) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage) return;
    const root = rootRef?.current ?? null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { root, rootMargin }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, rootMargin, rootRef]);

  return sentinelRef;
}
