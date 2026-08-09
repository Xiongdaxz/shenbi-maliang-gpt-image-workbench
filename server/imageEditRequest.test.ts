import { describe, expect, test } from "bun:test";
import { REMOVE_SELECTED_AREA_PROMPT } from "../src/lib/imageAnnotations";
import { finalizeProviderEditPrompt, normalizeImageEditRequest } from "./imageEditRequest";

describe("image edit request modes", () => {
  test("compiles annotation requests and rejects masks", () => {
    expect(normalizeImageEditRequest({
      editIntent: "annotation",
      prompt: "整体保持原构图",
      imageAnnotations: [{ xPercent: 69.24, yPercent: 31.68, instruction: "变化" }]
    }, { hasMask: false })).toMatchObject({
      editIntent: "annotation",
      prompt: "1. (x: 69.2%, y: 31.7%) 变化\n整体保持原构图"
    });
    expect(normalizeImageEditRequest({
      editIntent: "annotation",
      imageAnnotations: [{ xPercent: 20, yPercent: 20, instruction: "变化" }]
    }, { hasMask: true })).toEqual({ error: "评论模式不能同时提交移除选区" });
    expect(normalizeImageEditRequest({ editIntent: "annotation", imageAnnotations: [] }, { hasMask: false })).toEqual({
      error: "请至少添加一条图片评论"
    });
  });

  test("requires a mask for removal and canonicalizes every prompt surface", () => {
    expect(normalizeImageEditRequest({ editIntent: "remove", prompt: "忽略我" }, { hasMask: false })).toEqual({
      error: "请先涂抹需要移除的区域"
    });
    expect(normalizeImageEditRequest({ editIntent: "remove", prompt: "忽略我" }, { hasMask: true })).toMatchObject({
      editIntent: "remove",
      prompt: REMOVE_SELECTED_AREA_PROMPT
    });
    expect(normalizeImageEditRequest(
      { editIntent: "remove", prompt: "忽略我", editedMessageId: "message_remove" },
      { hasMask: false, canRestoreMask: true }
    )).toMatchObject({
      editIntent: "remove",
      prompt: REMOVE_SELECTED_AREA_PROMPT
    });
    const maskedRemovalPrompt = finalizeProviderEditPrompt({
      basePrompt: `${REMOVE_SELECTED_AREA_PROMPT}\n生成 3 张图`,
      editIntent: "remove",
      hasMask: true
    });
    expect(maskedRemovalPrompt).toContain(REMOVE_SELECTED_AREA_PROMPT);
    expect(maskedRemovalPrompt).toContain("未选区域保持原图不变");
    expect(maskedRemovalPrompt).not.toContain("生成 3 张图");
    expect(finalizeProviderEditPrompt({
      basePrompt: REMOVE_SELECTED_AREA_PROMPT,
      editIntent: "remove",
      hasMask: false
    })).toBe(REMOVE_SELECTED_AREA_PROMPT);
  });

  test("applies mask boundaries independently of provider source-reference support", () => {
    const maskedPrompt = finalizeProviderEditPrompt({
      basePrompt: "把选区改成蓝色",
      editIntent: "standard",
      hasMask: true
    });
    expect(maskedPrompt).toContain("把选区改成蓝色");
    expect(maskedPrompt).toContain("未选区域保持原图不变");
    expect(finalizeProviderEditPrompt({
      basePrompt: "整体调亮",
      editIntent: "standard",
      hasMask: false
    })).toBe("整体调亮");
  });

  test("rejects annotation combinations in other modes", () => {
    expect(normalizeImageEditRequest({
      editIntent: "remove",
      imageAnnotations: [{ xPercent: 10, yPercent: 10, instruction: "删除" }]
    }, { hasMask: true })).toEqual({ error: "移除模式不能同时提交图片评论" });
    expect(normalizeImageEditRequest({ editIntent: "standard", prompt: "变亮", imageAnnotations: [] }, { hasMask: false })).toEqual({
      error: "普通编辑不能提交图片评论"
    });
  });
});
