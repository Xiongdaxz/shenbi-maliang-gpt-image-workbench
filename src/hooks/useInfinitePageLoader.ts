import { useEffect, useRef, useState, type RefObject } from "react";

type UseInfinitePageLoaderOptions = {
  fetchNextPage: () => Promise<unknown>;
  hasNextPage: boolean;
  isFetchNextPageError?: boolean;
  isFetchingNextPage: boolean;
  autoLoad?: boolean;
  rootRef?: RefObject<Element | null>;
  rootMargin?: string;
  scrollIdleDelayMs?: number;
};

export function shouldFetchNextInfinitePage({
  hasNextPage,
  isFetchNextPageError,
  isFetchingNextPage,
  retryArmed = false
}: {
  hasNextPage: boolean;
  isFetchNextPageError: boolean;
  isFetchingNextPage: boolean;
  retryArmed?: boolean;
}) {
  return hasNextPage && !isFetchingNextPage && (!isFetchNextPageError || retryArmed);
}

type InfinitePageLoadSchedulerOptions = {
  canFetch: () => boolean;
  cancelTimer?: (timerId: number) => void;
  delayMs: number;
  fetchNextPage: () => Promise<unknown>;
  onFetch?: () => void;
  onLeave?: () => void;
  scheduleTimer?: (callback: () => void, delayMs: number) => number;
};

export function createInfinitePageLoadScheduler({
  canFetch,
  cancelTimer = (timerId) => window.clearTimeout(timerId),
  delayMs,
  fetchNextPage,
  onFetch,
  onLeave,
  scheduleTimer = (callback, timeoutMs) => window.setTimeout(callback, timeoutMs)
}: InfinitePageLoadSchedulerOptions) {
  let activeRequest: Promise<unknown> | null = null;
  let disposed = false;
  let intersects = false;
  let loadTimer = 0;
  let userPointerActive = false;

  const clearLoadTimer = () => {
    if (loadTimer) cancelTimer(loadTimer);
    loadTimer = 0;
  };
  const fetchWhenReady = () => {
    loadTimer = 0;
    if (disposed || !intersects || userPointerActive || activeRequest || !canFetch()) return;
    onFetch?.();
    const request = fetchNextPage();
    activeRequest = request;
    void request.then(
      () => {
        if (activeRequest === request) activeRequest = null;
      },
      () => {
        if (activeRequest === request) activeRequest = null;
      }
    );
  };
  const scheduleFetch = () => {
    clearLoadTimer();
    if (disposed || !intersects || userPointerActive) return;
    if (delayMs <= 0) {
      fetchWhenReady();
      return;
    }
    loadTimer = scheduleTimer(fetchWhenReady, delayMs);
  };

  return {
    dispose() {
      disposed = true;
      intersects = false;
      userPointerActive = false;
      clearLoadTimer();
    },
    handlePointerEnd() {
      if (disposed || delayMs <= 0 || !userPointerActive) return;
      userPointerActive = false;
      scheduleFetch();
    },
    handlePointerStart() {
      if (disposed || delayMs <= 0) return;
      userPointerActive = true;
      clearLoadTimer();
    },
    handleScroll() {
      if (disposed || delayMs <= 0) return;
      scheduleFetch();
    },
    setIntersecting(nextIntersects: boolean) {
      if (disposed) return;
      intersects = nextIntersects;
      if (!intersects) {
        clearLoadTimer();
        onLeave?.();
        return;
      }
      scheduleFetch();
    }
  };
}

type InfiniteAutoLoadRequest = {
  fetchNextPage: () => Promise<unknown>;
  hasNextPage: boolean;
  isFetchNextPageError: boolean;
  isFetchingNextPage: boolean;
};

export function createInfiniteAutoLoadController(onRequestSettled: () => void) {
  let activeRequest: Promise<unknown> | null = null;
  let enabled = false;
  let retryArmed = true;

  return {
    requestNextPage({ fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage }: InfiniteAutoLoadRequest) {
      if (
        !enabled
        || activeRequest
        || !shouldFetchNextInfinitePage({ hasNextPage, isFetchNextPageError, isFetchingNextPage, retryArmed })
      ) return false;

      retryArmed = false;
      const request = fetchNextPage();
      activeRequest = request;
      const settle = () => {
        if (activeRequest !== request) return;
        activeRequest = null;
        if (enabled) onRequestSettled();
      };
      void request.then(settle, settle);
      return true;
    },
    setEnabled(nextEnabled: boolean) {
      enabled = nextEnabled;
      if (!enabled) retryArmed = true;
    }
  };
}

export function useInfinitePageLoader({
  fetchNextPage,
  hasNextPage,
  isFetchNextPageError = false,
  isFetchingNextPage,
  autoLoad = false,
  rootRef,
  rootMargin = "720px",
  scrollIdleDelayMs = 0
}: UseInfinitePageLoaderOptions) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const retryArmedRef = useRef(false);
  const [autoLoadCompletion, setAutoLoadCompletion] = useState(0);
  const autoLoadControllerRef = useRef<ReturnType<typeof createInfiniteAutoLoadController> | null>(null);
  if (!autoLoadControllerRef.current) {
    autoLoadControllerRef.current = createInfiniteAutoLoadController(() => {
      setAutoLoadCompletion((value) => value + 1);
    });
  }
  const autoLoadController = autoLoadControllerRef.current;

  useEffect(() => {
    if (isFetchNextPageError) retryArmedRef.current = false;
  }, [isFetchNextPageError]);

  useEffect(() => () => autoLoadController.setEnabled(false), [autoLoadController]);

  useEffect(() => {
    autoLoadController.setEnabled(autoLoad);
    if (!autoLoad) return;
    autoLoadController.requestNextPage({
      fetchNextPage,
      hasNextPage,
      isFetchNextPageError,
      isFetchingNextPage
    });
  }, [autoLoad, autoLoadCompletion, autoLoadController, fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (autoLoad || !sentinel || !hasNextPage) return;
    const root = rootRef?.current ?? null;
    const scrollTarget = root ?? window;
    const scheduler = createInfinitePageLoadScheduler({
      delayMs: scrollIdleDelayMs,
      fetchNextPage,
      canFetch: () => shouldFetchNextInfinitePage({
        hasNextPage,
        isFetchNextPageError,
        isFetchingNextPage,
        retryArmed: retryArmedRef.current
      }),
      onFetch: () => {
        retryArmedRef.current = false;
      },
      onLeave: () => {
        if (isFetchNextPageError) retryArmedRef.current = true;
      }
    });
    const observer = new IntersectionObserver(
      (entries) => {
        const intersects = entries.some((entry) => entry.isIntersecting);
        scheduler.setIntersecting(intersects);
      },
      { root, rootMargin }
    );
    observer.observe(sentinel);
    if (scrollIdleDelayMs > 0) {
      scrollTarget.addEventListener("scroll", scheduler.handleScroll, { passive: true });
      window.addEventListener("pointerdown", scheduler.handlePointerStart, { capture: true, passive: true });
      window.addEventListener("pointerup", scheduler.handlePointerEnd, { capture: true, passive: true });
      window.addEventListener("pointercancel", scheduler.handlePointerEnd, { capture: true, passive: true });
    }
    return () => {
      scheduler.dispose();
      observer.disconnect();
      if (scrollIdleDelayMs > 0) {
        scrollTarget.removeEventListener("scroll", scheduler.handleScroll);
        window.removeEventListener("pointerdown", scheduler.handlePointerStart, true);
        window.removeEventListener("pointerup", scheduler.handlePointerEnd, true);
        window.removeEventListener("pointercancel", scheduler.handlePointerEnd, true);
      }
    };
  }, [autoLoad, fetchNextPage, hasNextPage, isFetchNextPageError, isFetchingNextPage, rootMargin, rootRef, scrollIdleDelayMs]);

  return sentinelRef;
}
