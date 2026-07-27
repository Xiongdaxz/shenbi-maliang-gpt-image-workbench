import { describe, expect, test } from "bun:test";
import {
  starterCopyRequestError,
  starterCopyRequestTimeoutMs,
  starterCopyThinkingMode
} from "./starterCopyRequestTimeout";

describe("starter copy model request timeout", () => {
  test("uses the provider thinking setting only for DeepSeek requests", () => {
    expect(starterCopyThinkingMode({ name: "DeepSeek", model: "deepseek-v4-pro", thinking_enabled: 1 })).toBe("enabled");
    expect(starterCopyThinkingMode({ name: "DeepSeek", model: "deepseek-v4-pro", thinking_enabled: 0 })).toBe("disabled");
    expect(starterCopyThinkingMode({ name: "Other", model: "text-model", thinking_enabled: 1 })).toBeNull();
  });

  test("allows thinking models more time to finish", () => {
    expect(starterCopyRequestTimeoutMs(false)).toBe(60_000);
    expect(starterCopyRequestTimeoutMs(true)).toBe(300_000);
  });

  test("turns an internal abort into a clear timeout error", () => {
    const original = new Error("The operation was aborted.");

    expect(starterCopyRequestError(original, false, 60_000)).toBe(original);
    expect(starterCopyRequestError(original, true, 300_000)).toEqual(
      new Error("每日文案模型请求超时（已等待 300 秒），请稍后重试")
    );
  });
});
