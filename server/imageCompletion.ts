import type { ImagePromptPlan } from "./imagePromptPlan";

export type ImageCompletionBatchRequest = {
  prompt: string;
  imageCount: number;
  imageIndexStart: number;
  imageIndexes: number[];
  roundIndex: number;
  grouped: boolean;
};

export type ImageCompletionBatch<TItem, TResult> = {
  items: TItem[];
  result: TResult;
};

export type ImageCompletionBatchCommit<TItem, TResult> = ImageCompletionBatchRequest & {
  items: TItem[];
  result: TResult;
};

async function runWithConcurrency<TInput, TResult>(
  inputs: TInput[],
  concurrency: number,
  worker: (input: TInput) => Promise<TResult>
) {
  const settled: PromiseSettledResult<TResult>[] = new Array(inputs.length);
  let cursor = 0;
  const normalizedConcurrency = Math.trunc(Number(concurrency));
  const workerCount = Math.min(
    inputs.length,
    Number.isFinite(normalizedConcurrency) ? Math.max(1, normalizedConcurrency) : 1
  );
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (cursor < inputs.length) {
      const index = cursor;
      cursor += 1;
      try {
        settled[index] = { status: "fulfilled", value: await worker(inputs[index]!) };
      } catch (reason) {
        settled[index] = { status: "rejected", reason };
      }
    }
  }));
  return settled;
}

function normalizedCompletedIndexes(requestedCount: number, existingImageCount: number, existingImageIndexes?: number[]) {
  if (existingImageIndexes) {
    return new Set(existingImageIndexes
      .map((value) => Math.trunc(Number(value)))
      .filter((value) => Number.isSafeInteger(value) && value >= 1));
  }
  const completedCount = Math.max(0, Math.min(requestedCount, Math.trunc(existingImageCount)));
  return new Set(Array.from({ length: completedCount }, (_, index) => index + 1));
}

export async function runImageCompletion<TItem, TResult>({
  plan,
  originalPrompt,
  existingImageCount = 0,
  existingImageIndexes,
  concurrency = 1,
  requestBatch,
  commitBatch,
  discardItems
}: {
  plan: ImagePromptPlan;
  originalPrompt: string;
  existingImageCount?: number;
  existingImageIndexes?: number[];
  concurrency?: number;
  requestBatch: (request: ImageCompletionBatchRequest) => Promise<ImageCompletionBatch<TItem, TResult>>;
  commitBatch: (batch: ImageCompletionBatchCommit<TItem, TResult>) => Promise<void>;
  discardItems?: (items: TItem[]) => Promise<void>;
}) {
  const requestedCount = Math.max(1, Math.trunc(plan.requestedCount));
  const normalizedExistingIndexes = (existingImageIndexes ?? [])
    .map((value) => Math.trunc(Number(value)))
    .filter((value) => Number.isSafeInteger(value) && value >= 1);
  const completedIndexes = normalizedCompletedIndexes(
    requestedCount,
    existingImageCount,
    existingImageIndexes === undefined ? undefined : normalizedExistingIndexes
  );
  let nextExtraIndex = Math.max(requestedCount, ...normalizedExistingIndexes) + 1;
  let roundIndex = 0;
  const results: TResult[] = [];
  const normalizedConcurrency = Math.trunc(Number(concurrency));
  const configuredConcurrency = Number.isFinite(normalizedConcurrency) ? Math.max(1, normalizedConcurrency) : 1;
  const missingIndexes = () => Array.from({ length: requestedCount }, (_, index) => index + 1)
    .filter((index) => !completedIndexes.has(index));

  const executeRequest = async (request: ImageCompletionBatchRequest) => {
    const batch = await requestBatch(request);
    if (batch.items.length === 0) {
      throw new Error(`图片补全没有取得新结果：请求槽位 ${request.imageIndexes.join(", ")}`);
    }
    const requestedItemCount = Math.min(batch.items.length, request.imageCount);
    const acceptedIndexes = request.imageIndexes.slice(0, requestedItemCount);
    while (acceptedIndexes.length < batch.items.length) {
      acceptedIndexes.push(nextExtraIndex);
      nextExtraIndex += 1;
    }
    try {
      await commitBatch({ ...request, imageIndexes: acceptedIndexes, items: batch.items, result: batch.result });
    } catch (error) {
      await discardItems?.(batch.items);
      throw error;
    }
    return { completedIndexes: acceptedIndexes, result: batch.result };
  };

  const acceptResult = (result: Awaited<ReturnType<typeof executeRequest>>) => {
    result.completedIndexes.forEach((index) => completedIndexes.add(index));
    results.push(result.result);
  };

  if (plan.mode !== "grouped") {
    const initialMissingIndexes = missingIndexes();
    if (initialMissingIndexes.length > 0) {
      roundIndex += 1;
      const prompt = originalPrompt.trim();
      if (!prompt) throw new Error("多图任务缺少可执行提示词");
      acceptResult(await executeRequest({
        prompt,
        imageCount: initialMissingIndexes.length,
        imageIndexStart: initialMissingIndexes[0]!,
        imageIndexes: initialMissingIndexes,
        roundIndex,
        grouped: false
      }));
    }
  }

  const requests = missingIndexes().map((imageIndex) => {
    roundIndex += 1;
    const grouped = plan.mode === "grouped";
    const prompt = grouped ? String(plan.prompts[imageIndex - 1] ?? "").trim() : originalPrompt.trim();
    if (!prompt) throw new Error(`第 ${imageIndex} 张图片缺少可执行提示词`);
    return {
      prompt,
      imageCount: 1,
      imageIndexStart: imageIndex,
      imageIndexes: [imageIndex],
      roundIndex,
      grouped
    } satisfies ImageCompletionBatchRequest;
  });
  const settled = await runWithConcurrency(requests, configuredConcurrency, executeRequest);
  let firstError: unknown = null;
  for (const result of settled) {
    if (result.status === "fulfilled") acceptResult(result.value);
    else if (!firstError) firstError = result.reason;
  }
  if (firstError) throw firstError;

  return {
    requestedCount,
    completedCount: completedIndexes.size,
    roundCount: roundIndex,
    results
  };
}
