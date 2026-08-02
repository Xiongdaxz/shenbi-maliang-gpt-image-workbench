import { describe, expect, test } from "bun:test";
import { translateConfigCopy } from "./configCopy";

describe("config copy locale fallback", () => {
  test("keeps native localized terms when they are available", () => {
    expect(translateConfigCopy("场景分配", "ja-JP")).toBe("シナリオ割り当て");
  });

  test("falls back to English instead of Chinese for untranslated admin copy", () => {
    expect(translateConfigCopy("创作增强", "ja-JP")).toBe("Creative enhancement");
    expect(translateConfigCopy("每天生成空白页中文互动文案。", "de-DE"))
      .toBe("Generate Chinese interactive copy for the blank page each day.");
    expect(translateConfigCopy("插件 / MCP Access Token（天）", "de-DE"))
      .toBe("Plugin / MCP Access Token (days)");
  });
});
