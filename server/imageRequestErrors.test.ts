import { describe, expect, test } from "bun:test";
import { canRetryImageRequest, canRetryImageStatus, ImageRequestError, imageRequestErrors } from "./imageRequestErrors";

describe("image request retry policy", () => {
  test("rejected parameters and unavailable endpoints stop retrying, rate limits and server errors retain recovery", () => {
    for(const status of [400,401,403,404,405,413,415,422,501]) expect(canRetryImageStatus(status)).toBe(false);
    for(const status of [408,429,500,502,503]) expect(canRetryImageStatus(status)).toBe(true);
  });
  test("non-retryable native failures survive quota and provider error aggregation", () => {
    const native=new ImageRequestError("invalid parameter",false,400);
    const quota=imageRequestErrors([native.message],[native],"quota failed");
    const provider=imageRequestErrors([quota.message],[quota],"provider failed");
    expect(canRetryImageRequest(provider)).toBe(false);
    expect(provider.message).toContain("invalid parameter");
    expect(canRetryImageRequest(imageRequestErrors(["temporary"],[native,new Error("temporary")],"failed"))).toBe(true);
    expect(canRetryImageRequest(new Error("legacy request failure"))).toBe(true);
    const unknown=new ImageRequestError("unknown result",false,undefined,true);
    expect(imageRequestErrors([unknown.message],[unknown],"failed").haltFallback).toBe(true);
  });
});
