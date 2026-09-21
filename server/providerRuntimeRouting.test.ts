import { describe, expect, test } from "bun:test";
import {
  AUTOMATIC_PROVIDER_ROUTE_ORDER,
  executeAutomaticProviderRoutes,
  shouldRetryResponsesAsStream
} from "./providerRuntime";

describe("provider automatic routing", () => {
  test("tries Responses before falling back to Images API", () => {
    expect([...AUTOMATIC_PROVIDER_ROUTE_ORDER]).toEqual(["responses", "images_api"]);
  });

  test("falls back when a Responses result cannot be accepted after an HTTP success", async () => {
    const attempts: string[] = [];
    const result = await executeAutomaticProviderRoutes(async (route) => {
      attempts.push(route);
      if (route === "responses") throw new Error("渠道没有返回可保存的图片");
      return "saved-image";
    });

    expect(result).toBe("saved-image");
    expect(attempts).toEqual(["responses", "images_api"]);
  });

  test("reports both route failures", async () => {
    expect(executeAutomaticProviderRoutes(async (route) => {
      throw new Error(`${route} unavailable`);
    })).rejects.toThrow("Responses 接口失败：responses unavailable; 图片接口回退失败：images_api unavailable");
  });

  test("retries as a stream only when the upstream explicitly requires streaming", () => {
    expect(shouldRetryResponsesAsStream(new Error("stream_required: set stream=true"))).toBe(true);
    expect(shouldRetryResponsesAsStream(new Error("HTTP 404: endpoint not found"))).toBe(false);
    expect(shouldRetryResponsesAsStream(new Error("HTTP 429: usage limit reached"))).toBe(false);
  });
});
