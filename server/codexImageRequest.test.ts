import { describe, expect, test } from "bun:test";
import { buildCodexNativeImageRequest, codexNativeImageHeaders, codexNativeImageResult, useCodexNativeImages } from "./codexImageRequest";
import { STUDIO_CODEX_USER_AGENT } from "./constants";

describe("Codex native image routing", () => {
  test("CPA-compatible native routes include masks and output formats; explicit Responses is retained", () => {
    expect(useCodexNativeImages("images_api", {})).toBe(true);
    expect(useCodexNativeImages("auto", {})).toBe(true);
    expect(useCodexNativeImages("responses", {})).toBe(false);
    expect(useCodexNativeImages("images_api", {mask:"data:image/png;base64,mask"})).toBe(true);
    expect(useCodexNativeImages("images_api", {output_format:"webp"})).toBe(true);
  });
  test("the failed job's Sunburst/auto options do not acquire a medium reasoning or complexity parameter", () => {
    const request = buildCodexNativeImageRequest("generation", {prompt:"fixture",model:"gpt-image-2.5-sunburst",quality:"auto",size:"auto",n:1,reasoning:{effort:"medium"},complexity:"medium",sourceReference:{private:"metadata"}}, "gpt-image-2");
    expect(request.path).toBe("/codex/images/generations");
    expect(request.body).toEqual({prompt:"fixture",model:"gpt-image-2.5-sunburst",quality:"auto",size:"auto",n:1});
  });
  test("reference images and file IDs use the JSON edit endpoint", () => {
    const request = buildCodexNativeImageRequest("generation", {prompt:"edit",images:["data:image/png;base64,fixture",{file_id:"file-fixture"}]}, "gpt-image-2");
    expect(request.path).toBe("/codex/images/edits");
    expect(request.body.images).toEqual([{image_url:"data:image/png;base64,fixture"},{file_id:"file-fixture"}]);
    expect(()=>buildCodexNativeImageRequest("edit",{images:[]},"gpt-image-2")).toThrow("缺少参考图片");
    expect(()=>buildCodexNativeImageRequest("edit",{images:["image"],mask:{}},"gpt-image-2")).toThrow("蒙版");
  });
  test("CPA 8.0.55 image options preserve 2.5 quality, format, compression and moderation", () => {
    for (const quality of ["auto","low","medium","high","xhigh","max"]) {
      const request=buildCodexNativeImageRequest("generation",{prompt:"fixture",model:"gpt-image-2.5-sunburst",quality,n:1,size:"1024x1024",background:"opaque",output_format:"jpeg",output_compression:70,moderation:"low"},"gpt-image-2");
      expect(request.body).toEqual({prompt:"fixture",model:"gpt-image-2.5-sunburst",quality,n:1,size:"1024x1024",background:"opaque",output_format:"jpeg",output_compression:70,moderation:"low"});
    }
  });
  test("CPA JSON edits preserve mask references and numeric zero values", () => {
    const request=buildCodexNativeImageRequest("edit",{prompt:"fixture",images:[{file_id:"file-source"}],mask:{file_id:"file-mask"},quality:"max",output_format:"webp",output_compression:0,partial_images:0,input_fidelity:"high"},"gpt-image-2.5-flare");
    expect(request.path).toBe("/codex/images/edits");
    expect(request.body.mask).toEqual({file_id:"file-mask"});
    expect(request.body.output_format).toBe("webp");expect(request.body.output_compression).toBe(0);expect(request.body.partial_images).toBe(0);expect(request.body.input_fidelity).toBe("high");
    expect(buildCodexNativeImageRequest("edit",{images:["source"],mask:"data:image/png;base64,mask"},"gpt-image-2").body.mask).toEqual({image_url:"data:image/png;base64,mask"});
  });
  test("direct-image headers use Codex identity, canonical session header and JSON without website cookies", () => {
    const options={accessToken:"fixture-token",accountId:"fixture-account",sessionId:"fixture-session",requestId:"fixture-request",userAgent:"browser-agent",cookies:"website-cookie"};
    const headers=codexNativeImageHeaders(options);
    expect(headers.Authorization).toBe("Bearer fixture-token");expect(headers["Chatgpt-Account-Id"]).toBe("fixture-account");
    expect(headers["User-Agent"]).toBe(STUDIO_CODEX_USER_AGENT);expect(headers.Originator).toBe("codex-tui");
    expect(headers["Session-Id"]).toBe("fixture-session");expect(headers["X-Client-Request-Id"]).toBe("fixture-request");
    expect(headers.Accept).toBe("application/json");expect(headers.Cookie).toBeUndefined();expect(headers["OpenAI-Beta"]).toBeUndefined();
  });
  test("unreported model identity is represented as automatic, and generation IDs survive normalization", () => {
    const result=codexNativeImageResult({quality:"low",data:[{b64_json:"fixture",generation_id:"gen-fixture"}]});
    expect(result.actualModel).toBe("chatgpt-codex-auto");
    expect(result.actualQuality).toBe("low");
    expect(result.modelFallbackReason).toContain("未提供实际模型标识");
    expect(result.response.data).toEqual([{b64_json:"fixture",generation_id:"gen-fixture",gen_id:"gen-fixture"}]);
    expect(codexNativeImageResult({model:"gpt-image-2-codex"}).actualModel).toBe("gpt-image-2-codex");
  });
});
