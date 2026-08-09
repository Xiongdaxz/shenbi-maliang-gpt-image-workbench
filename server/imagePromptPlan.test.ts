import { describe, expect, test } from "bun:test";
import { parseImagePromptPlan, resolveImagePromptPlan } from "./imagePromptPlan";

const baseRequest = {
  prompt: "分别生成3张图\n图1，红色跑车\n图2，蓝色跑车\n图3，黑色跑车",
  imageCount: 3,
  taskType: "generation" as const,
  userId: "user_test",
  jobId: "job_test"
};

describe("image prompt plan parsing", () => {
  test("accepts a shared multi-image prompt", () => {
    expect(parseImagePromptPlan('{"mode":"shared","detectedGroupCount":0,"prompts":[]}', 3)).toEqual({
      version: 1,
      mode: "shared",
      requestedCount: 3,
      detectedGroupCount: 0,
      prompts: []
    });
  });

  test("accepts exactly numbered unique grouped prompts", () => {
    const plan = parseImagePromptPlan(JSON.stringify({
      mode: "grouped",
      detectedGroupCount: 3,
      prompts: [
        { index: 1, prompt: "红色跑车在山路上高速行驶" },
        { index: 2, prompt: "蓝色跑车停在现代展厅中" },
        { index: 3, prompt: "黑色跑车置于夜晚城市街道" }
      ]
    }), 3);

    expect(plan.mode).toBe("grouped");
    expect(plan.prompts).toEqual([
      "红色跑车在山路上高速行驶",
      "蓝色跑车停在现代展厅中",
      "黑色跑车置于夜晚城市街道"
    ]);
  });

  test("rejects missing, duplicate, and discontinuous groups", () => {
    expect(() => parseImagePromptPlan(JSON.stringify({
      mode: "grouped",
      prompts: [{ index: 1, prompt: "A" }, { index: 2, prompt: "B" }]
    }), 3)).toThrow("期望 3 组");
    expect(() => parseImagePromptPlan(JSON.stringify({
      mode: "grouped",
      prompts: [{ index: 1, prompt: "A" }, { index: 2, prompt: "A" }, { index: 3, prompt: "C" }]
    }), 3)).toThrow("不能重复");
    expect(() => parseImagePromptPlan(JSON.stringify({
      mode: "grouped",
      prompts: [{ index: 1, prompt: "A" }, { index: 3, prompt: "B" }, { index: 4, prompt: "C" }]
    }), 3)).toThrow("连续排列");
  });
});

describe("image prompt plan resolution", () => {
  test("repairs an invalid count once and uses the corrected grouped plan", async () => {
    const outputs = [
      JSON.stringify({ mode: "grouped", detectedGroupCount: 2, prompts: [{ index: 1, prompt: "A" }, { index: 2, prompt: "B" }] }),
      JSON.stringify({ mode: "grouped", detectedGroupCount: 2, prompts: [
        { index: 1, prompt: "A" },
        { index: 2, prompt: "B" },
        { index: 3, prompt: "C" }
      ] })
    ];
    const messages: string[][] = [];

    const plan = await resolveImagePromptPlan(baseRequest, async (requestMessages) => {
      messages.push(requestMessages.map((item) => item.content));
      return outputs.shift() ?? "";
    });

    expect(plan.mode).toBe("grouped");
    expect(plan.prompts).toEqual(["A", "B", "C"]);
    expect(messages).toHaveLength(2);
    expect(messages[1]?.at(-1)).toContain("期望 3 组");
  });

  test("falls back to the original shared request when the model fails", async () => {
    const plan = await resolveImagePromptPlan(baseRequest, async () => {
      throw new Error("model unavailable");
    });

    expect(plan.mode).toBe("fallback_shared");
    expect(plan.prompts).toEqual([]);
    expect(plan.fallbackReason).toContain("model unavailable");
  });
});
