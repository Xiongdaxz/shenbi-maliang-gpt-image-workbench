import { describe, expect, test } from "bun:test";
import { imageJobHasVisibleResult, resolveActiveImageRequestCount } from "./useChatViewState";
import type { ImageJob, Message } from "../types";

function message(overrides: Partial<Message>): Message {
  return {
    id: "message-1",
    role: "assistant",
    content: "",
    imageId: null,
    imageUrl: null,
    imagePrompt: null,
    imageKind: null,
    imageSize: null,
    imageQuality: null,
    imageProviderId: null,
    parentImageId: null,
    metadata: {},
    createdAt: "2026-08-06T00:00:00.000Z",
    ...overrides
  };
}

function imageJob(overrides: Partial<ImageJob>): ImageJob {
  return {
    id: "job-1",
    type: "generation",
    status: "running",
    prompt: "生成四张图片",
    providerId: "provider-1",
    error: null,
    resultImageId: null,
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
    ...overrides
  };
}

describe("imageJobHasVisibleResult", () => {
  test("recognizes a completed assistant image for the running job", () => {
    expect(imageJobHasVisibleResult("job-1", [message({
      imageId: "image-1",
      imageUrl: "/api/images/image-1/file",
      metadata: { jobId: "job-1" }
    })])).toBe(true);
  });

  test("ignores source images and results from another job", () => {
    expect(imageJobHasVisibleResult("job-1", [
      message({
        role: "user",
        imageId: "source-1",
        imageUrl: "/api/images/source-1/file",
        metadata: { jobId: "job-1" }
      }),
      message({
        id: "message-2",
        imageId: "image-2",
        imageUrl: "/api/images/image-2/file",
        metadata: { jobId: "job-2" }
      })
    ])).toBe(false);
  });

  test("does not treat an assistant text message as an image result", () => {
    expect(imageJobHasVisibleResult("job-1", [message({ metadata: { jobId: "job-1" } })])).toBe(false);
  });
});

describe("resolveActiveImageRequestCount", () => {
  test("keeps the pending multi-image count before the server echo", () => {
    expect(resolveActiveImageRequestCount({
      activeBranchId: "main",
      activeClientRequestId: "submit-1",
      pendingUserMessage: message({
        role: "user",
        metadata: { clientRequestId: "submit-1", n: 4 }
      }),
      runningImageJobs: [],
      serverMessages: []
    })).toBe(4);
  });

  test("keeps the multi-image count after the server echo and before the running job arrives", () => {
    expect(resolveActiveImageRequestCount({
      activeBranchId: "main",
      activeClientRequestId: "submit-1",
      pendingUserMessage: null,
      runningImageJobs: [],
      serverMessages: [message({
        role: "user",
        metadata: { clientRequestId: "submit-1", jobId: "job-1", n: 4 }
      })]
    })).toBe(4);
  });

  test("keeps the count when the running job is visible", () => {
    expect(resolveActiveImageRequestCount({
      activeBranchId: "main",
      activeClientRequestId: null,
      pendingUserMessage: null,
      runningImageJobs: [imageJob({ id: "job-1" })],
      serverMessages: [message({
        role: "user",
        metadata: { jobId: "job-1", n: 4 }
      })]
    })).toBe(4);
  });

  test("does not retain a historical multi-image count after the request completes", () => {
    expect(resolveActiveImageRequestCount({
      activeBranchId: "main",
      activeClientRequestId: null,
      pendingUserMessage: null,
      runningImageJobs: [],
      serverMessages: [message({
        role: "user",
        metadata: { clientRequestId: "submit-old", jobId: "job-old", n: 4 }
      })]
    })).toBe(0);
  });

  test("ignores an active request on another branch", () => {
    expect(resolveActiveImageRequestCount({
      activeBranchId: "main",
      activeClientRequestId: "submit-branch",
      pendingUserMessage: null,
      runningImageJobs: [],
      serverMessages: [message({
        role: "user",
        metadata: { branchId: "branch-1", clientRequestId: "submit-branch", n: 4 }
      })]
    })).toBe(0);
  });
});
