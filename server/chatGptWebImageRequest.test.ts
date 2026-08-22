import { describe, expect, test } from "bun:test";
import {
  CHATGPT_WEB_TRANSPARENT_BACKGROUND_QUOTA_ERROR,
  resolveChatGptWebImageQuotaOrder
} from "./chatGptWebImageRequest";

describe("ChatGPT Web image quota routing", () => {
  test("keeps the configured quota order for ordinary requests", () => {
    expect(resolveChatGptWebImageQuotaOrder("codex_first", { background: "auto" })).toEqual(["codex", "official"]);
    expect(resolveChatGptWebImageQuotaOrder("official_first", { background: "opaque" })).toEqual(["official", "codex"]);
  });

  test("routes transparent requests directly to the official conversation quota", () => {
    expect(resolveChatGptWebImageQuotaOrder("codex_first", { background: "transparent" })).toEqual(["official"]);
    expect(resolveChatGptWebImageQuotaOrder("official_only", { background: "transparent" })).toEqual(["official"]);
  });

  test("rejects transparent requests in codex-only mode with an actionable error", () => {
    expect(resolveChatGptWebImageQuotaOrder("codex_only", { background: "transparent" })).toEqual([]);
    expect(CHATGPT_WEB_TRANSPARENT_BACKGROUND_QUOTA_ERROR).toContain("只走官网");
  });
});
