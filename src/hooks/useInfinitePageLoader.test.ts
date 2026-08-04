import { describe, expect, test } from "bun:test";
import {
  createInfiniteAutoLoadController,
  createInfinitePageLoadScheduler,
  shouldFetchNextInfinitePage
} from "./useInfinitePageLoader";

function createDeferredRequest() {
  let reject = (_reason?: unknown) => {};
  let resolve = () => {};
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createManualTimer() {
  let nextId = 1;
  const callbacks = new Map<number, () => void>();
  return {
    cancelTimer(timerId: number) {
      callbacks.delete(timerId);
    },
    pendingCount() {
      return callbacks.size;
    },
    runPending() {
      const pending = Array.from(callbacks.values());
      callbacks.clear();
      pending.forEach((callback) => callback());
    },
    scheduleTimer(callback: () => void) {
      const timerId = nextId;
      nextId += 1;
      callbacks.set(timerId, callback);
      return timerId;
    }
  };
}

describe("infinite page loading", () => {
  test("fetches only when another page is available and no request is running", () => {
    expect(shouldFetchNextInfinitePage({
      hasNextPage: true,
      isFetchNextPageError: false,
      isFetchingNextPage: false
    })).toBe(true);
    expect(shouldFetchNextInfinitePage({
      hasNextPage: false,
      isFetchNextPageError: false,
      isFetchingNextPage: false
    })).toBe(false);
    expect(shouldFetchNextInfinitePage({
      hasNextPage: true,
      isFetchNextPageError: false,
      isFetchingNextPage: true
    })).toBe(false);
  });

  test("requires an explicit retry after a failed page", () => {
    expect(shouldFetchNextInfinitePage({
      hasNextPage: true,
      isFetchNextPageError: true,
      isFetchingNextPage: false
    })).toBe(false);
    expect(shouldFetchNextInfinitePage({
      hasNextPage: true,
      isFetchNextPageError: true,
      isFetchingNextPage: false,
      retryArmed: true
    })).toBe(true);
  });

  test("keeps the default observer path single-flight without scroll listeners", async () => {
    let fetchCount = 0;
    let releaseRequest = () => {};
    const scheduler = createInfinitePageLoadScheduler({
      canFetch: () => true,
      delayMs: 0,
      fetchNextPage: () => {
        fetchCount += 1;
        return new Promise<void>((resolve) => {
          releaseRequest = resolve;
        });
      }
    });

    scheduler.setIntersecting(true);
    scheduler.handleScroll();
    scheduler.handleScroll();
    scheduler.setIntersecting(true);
    expect(fetchCount).toBe(1);

    releaseRequest();
    await Promise.resolve();
    scheduler.setIntersecting(false);
    scheduler.setIntersecting(true);
    expect(fetchCount).toBe(2);
    scheduler.dispose();
  });

  test("loads once after scrolling and pointer dragging become idle", () => {
    const timer = createManualTimer();
    let fetchCount = 0;
    const scheduler = createInfinitePageLoadScheduler({
      canFetch: () => true,
      cancelTimer: timer.cancelTimer,
      delayMs: 260,
      fetchNextPage: () => {
        fetchCount += 1;
        return Promise.resolve();
      },
      scheduleTimer: timer.scheduleTimer
    });

    scheduler.setIntersecting(true);
    expect(timer.pendingCount()).toBe(1);
    scheduler.handleScroll();
    scheduler.handleScroll();
    expect(timer.pendingCount()).toBe(1);

    scheduler.handlePointerStart();
    scheduler.handleScroll();
    expect(timer.pendingCount()).toBe(0);
    timer.runPending();
    expect(fetchCount).toBe(0);

    scheduler.handlePointerEnd();
    expect(timer.pendingCount()).toBe(1);
    timer.runPending();
    expect(fetchCount).toBe(1);
    scheduler.dispose();
  });

  test("does not schedule or fetch after the observer scheduler is disposed", () => {
    const timer = createManualTimer();
    let fetchCount = 0;
    const scheduler = createInfinitePageLoadScheduler({
      canFetch: () => true,
      cancelTimer: timer.cancelTimer,
      delayMs: 260,
      fetchNextPage: () => {
        fetchCount += 1;
        return Promise.resolve();
      },
      scheduleTimer: timer.scheduleTimer
    });

    scheduler.setIntersecting(true);
    expect(timer.pendingCount()).toBe(1);
    scheduler.dispose();
    expect(timer.pendingCount()).toBe(0);

    scheduler.setIntersecting(true);
    scheduler.handleScroll();
    scheduler.handlePointerStart();
    scheduler.handlePointerEnd();
    timer.runPending();
    expect(fetchCount).toBe(0);
  });

  test("serializes automatic loading and stops when no next page remains", async () => {
    const requests: ReturnType<typeof createDeferredRequest>[] = [];
    let completionCount = 0;
    let hasNextPage = true;
    const controller = createInfiniteAutoLoadController(() => {
      completionCount += 1;
    });
    const fetchNextPage = () => {
      const request = createDeferredRequest();
      requests.push(request);
      return request.promise;
    };
    const requestNextPage = () => controller.requestNextPage({
      fetchNextPage,
      hasNextPage,
      isFetchNextPageError: false,
      isFetchingNextPage: false
    });

    controller.setEnabled(true);
    expect(requestNextPage()).toBe(true);
    expect(requestNextPage()).toBe(false);
    expect(requests).toHaveLength(1);

    requests[0].resolve();
    await Promise.resolve();
    expect(completionCount).toBe(1);
    expect(requestNextPage()).toBe(true);
    expect(requests).toHaveLength(2);

    hasNextPage = false;
    requests[1].resolve();
    await Promise.resolve();
    expect(completionCount).toBe(2);
    expect(requestNextPage()).toBe(false);
    expect(requests).toHaveLength(2);
  });

  test("stops automatic loading after failure and supports cancel and explicit retry", async () => {
    const requests: ReturnType<typeof createDeferredRequest>[] = [];
    let completionCount = 0;
    let isFetchNextPageError = false;
    const controller = createInfiniteAutoLoadController(() => {
      completionCount += 1;
    });
    const fetchNextPage = () => {
      const request = createDeferredRequest();
      requests.push(request);
      return request.promise;
    };
    const requestNextPage = () => controller.requestNextPage({
      fetchNextPage,
      hasNextPage: true,
      isFetchNextPageError,
      isFetchingNextPage: false
    });

    controller.setEnabled(true);
    expect(requestNextPage()).toBe(true);
    isFetchNextPageError = true;
    requests[0].reject(new Error("page failed"));
    await Promise.resolve();
    expect(completionCount).toBe(1);
    expect(requestNextPage()).toBe(false);

    controller.setEnabled(false);
    controller.setEnabled(true);
    expect(requestNextPage()).toBe(true);
    controller.setEnabled(false);
    requests[1].resolve();
    await Promise.resolve();
    expect(completionCount).toBe(1);

    controller.setEnabled(true);
    expect(requestNextPage()).toBe(true);
    expect(requests).toHaveLength(3);
  });
});
