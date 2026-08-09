import { describe, expect, test } from "bun:test";
import { runImageCompletion, type ImageCompletionBatchRequest } from "./imageCompletion";
import type { ImagePromptPlan } from "./imagePromptPlan";

function sharedPlan(count: number): ImagePromptPlan {
  return { version: 1, mode: "shared", requestedCount: count, detectedGroupCount: 0, prompts: [] };
}

function groupedPlan(prompts: string[]): ImagePromptPlan {
  return { version: 1, mode: "grouped", requestedCount: prompts.length, detectedGroupCount: prompts.length, prompts };
}

describe("image completion scheduling", () => {
  test("requests only the remaining shared image count until full", async () => {
    const requests: ImageCompletionBatchRequest[] = [];
    const committed: string[] = [];
    const batches = [["img-1"], ["img-2"], ["img-3"], ["img-4"]];

    const result = await runImageCompletion({
      plan: sharedPlan(4),
      originalPrompt: "同一主题的不同变体",
      requestBatch: async (request) => {
        requests.push(request);
        return { items: batches.shift() ?? [], result: request.roundIndex };
      },
      commitBatch: async (batch) => {
        committed.push(...batch.items);
      }
    });

    expect(requests.map((item) => item.imageCount)).toEqual([4, 1, 1, 1]);
    expect(requests.map((item) => item.prompt)).toEqual([
      "同一主题的不同变体",
      "同一主题的不同变体",
      "同一主题的不同变体",
      "同一主题的不同变体"
    ]);
    expect(committed).toEqual(["img-1", "img-2", "img-3", "img-4"]);
    expect(result.completedCount).toBe(4);
  });

  test("runs grouped prompts sequentially with n=1 and resumes from existing images", async () => {
    const requests: ImageCompletionBatchRequest[] = [];

    await runImageCompletion({
      plan: groupedPlan(["图一提示词", "图二提示词", "图三提示词"]),
      originalPrompt: "原始分组提示词",
      existingImageCount: 1,
      requestBatch: async (request) => {
        requests.push(request);
        return { items: [`img-${request.imageIndexStart}`], result: request.roundIndex };
      },
      commitBatch: async () => undefined
    });

    expect(requests.map((item) => ({ prompt: item.prompt, n: item.imageCount, index: item.imageIndexStart }))).toEqual([
      { prompt: "图二提示词", n: 1, index: 2 },
      { prompt: "图三提示词", n: 1, index: 3 }
    ]);
  });

  test("runs grouped prompts with bounded concurrency and keeps fixed image indexes", async () => {
    const requests: ImageCompletionBatchRequest[] = [];
    const committedIndexes: number[] = [];
    let active = 0;
    let maxActive = 0;

    await runImageCompletion({
      plan: groupedPlan(["图一", "图二", "图三", "图四"]),
      originalPrompt: "分组任务",
      concurrency: 2,
      requestBatch: async (request) => {
        requests.push(request);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, request.imageIndexStart % 2 === 0 ? 2 : 8));
        active -= 1;
        return { items: [`img-${request.imageIndexStart}`], result: request.roundIndex };
      },
      commitBatch: async (batch) => {
        committedIndexes.push(...batch.imageIndexes);
      }
    });

    expect(maxActive).toBe(2);
    expect(requests.map((item) => item.imageCount)).toEqual([1, 1, 1, 1]);
    expect([...committedIndexes].sort((left, right) => left - right)).toEqual([1, 2, 3, 4]);
  });

  test("falls back to serial execution when concurrency is not finite", async () => {
    const requestedIndexes: number[] = [];

    const result = await runImageCompletion({
      plan: groupedPlan(["图一", "图二", "图三"]),
      originalPrompt: "分组任务",
      concurrency: Number.NaN,
      requestBatch: async (request) => {
        requestedIndexes.push(request.imageIndexStart);
        return { items: [`img-${request.imageIndexStart}`], result: request.roundIndex };
      },
      commitBatch: async () => undefined
    });

    expect(requestedIndexes).toEqual([1, 2, 3]);
    expect(result.completedCount).toBe(3);
  });

  test("retries only missing grouped slots after out-of-order partial completion", async () => {
    const requests: ImageCompletionBatchRequest[] = [];

    await runImageCompletion({
      plan: groupedPlan(["图一", "图二", "图三"]),
      originalPrompt: "分组任务",
      existingImageIndexes: [1, 3],
      concurrency: 2,
      requestBatch: async (request) => {
        requests.push(request);
        return { items: ["img-2"], result: request.roundIndex };
      },
      commitBatch: async () => undefined
    });

    expect(requests.map((item) => ({ prompt: item.prompt, indexes: item.imageIndexes }))).toEqual([
      { prompt: "图二", indexes: [2] }
    ]);
  });

  test("preserves extra slots while retrying a missing grouped slot", async () => {
    const requests: ImageCompletionBatchRequest[] = [];
    const committedIndexes: number[] = [];

    const result = await runImageCompletion({
      plan: groupedPlan(["图一", "图二"]),
      originalPrompt: "分组任务",
      existingImageCount: 2,
      existingImageIndexes: [1, 3],
      requestBatch: async (request) => {
        requests.push(request);
        return { items: ["img-2", "img-extra"], result: request.roundIndex };
      },
      commitBatch: async (batch) => {
        committedIndexes.push(...batch.imageIndexes);
      }
    });

    expect(requests.map((item) => ({ prompt: item.prompt, indexes: item.imageIndexes }))).toEqual([
      { prompt: "图二", indexes: [2] }
    ]);
    expect(committedIndexes).toEqual([2, 4]);
    expect(result.completedCount).toBe(4);
  });

  test("keeps provider results beyond the requested count", async () => {
    const discarded: string[] = [];
    const committed: string[] = [];
    const committedIndexes: number[] = [];

    await runImageCompletion({
      plan: sharedPlan(2),
      originalPrompt: "两张图片",
      requestBatch: async () => ({ items: ["img-1", "img-2", "img-extra"], result: "ok" }),
      commitBatch: async (batch) => {
        committed.push(...batch.items);
        committedIndexes.push(...batch.imageIndexes);
      },
      discardItems: async (items) => {
        discarded.push(...items);
      }
    });

    expect(committed).toEqual(["img-1", "img-2", "img-extra"]);
    expect(committedIndexes).toEqual([1, 2, 3]);
    expect(discarded).toEqual([]);
  });

  test("assigns unique slots to extra results from concurrent grouped requests", async () => {
    const committedIndexes: number[] = [];

    const result = await runImageCompletion({
      plan: groupedPlan(["图一", "图二"]),
      originalPrompt: "分组任务",
      concurrency: 2,
      requestBatch: async (request) => {
        await new Promise((resolve) => setTimeout(resolve, request.imageIndexStart === 1 ? 8 : 2));
        return {
          items: [`img-${request.imageIndexStart}`, `img-${request.imageIndexStart}-extra`],
          result: request.roundIndex
        };
      },
      commitBatch: async (batch) => {
        committedIndexes.push(...batch.imageIndexes);
      }
    });

    expect(new Set(committedIndexes).size).toBe(4);
    expect([...committedIndexes].sort((left, right) => left - right)).toEqual([1, 2, 3, 4]);
    expect(result.completedCount).toBe(4);
  });

  test("keeps committed partial batches when a later request fails", async () => {
    const committed: string[] = [];
    let round = 0;

    await expect(runImageCompletion({
      plan: sharedPlan(3),
      originalPrompt: "三张图片",
      requestBatch: async () => {
        round += 1;
        if (round === 1) return { items: ["img-1"], result: round };
        throw new Error("provider failed");
      },
      commitBatch: async (batch) => {
        committed.push(...batch.items);
      }
    })).rejects.toThrow("provider failed");

    expect(committed).toEqual(["img-1"]);
  });
});
