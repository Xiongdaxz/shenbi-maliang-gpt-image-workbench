import { describe, expect, test } from "bun:test";
import { changelogContentForSync } from "./changelog";

describe("changelog sync content", () => {
  const bilingualContent = [
    "### 中文",
    "",
    "- 中文更新",
    "",
    "### English",
    "",
    "- English update"
  ].join("\n");

  test("keeps language headings when two languages are synced", () => {
    expect(changelogContentForSync(bilingualContent, true)).toBe(bilingualContent);
  });

  test("removes the English section and Chinese heading when only Chinese is synced", () => {
    expect(changelogContentForSync(bilingualContent, false)).toBe("- 中文更新");
  });

  test("supports a Chinese English-section heading and preserves later peer sections", () => {
    const content = [
      "### 中文",
      "- 中文更新",
      "### 英文",
      "- English update",
      "#### Details",
      "- More English details",
      "### 其他",
      "- 保留内容"
    ].join("\r\n");

    expect(changelogContentForSync(content, false)).toBe(
      ["- 中文更新", "### 其他", "- 保留内容"].join("\n")
    );
  });

  test("removes a lone language heading", () => {
    expect(changelogContentForSync("### English\n\n- English update", true)).toBe("- English update");
  });

  test("does not remove ordinary text that mentions English", () => {
    const content = "- 支持 English 提示词\n- 继续显示";
    expect(changelogContentForSync(content, false)).toBe(content);
  });
});
