import { describe, expect, test } from "bun:test";
import { isServerEchoOfPending, messageThreadRenderKey } from "./chatRender";
import type { Message } from "../types";

function userMessage(id: string, metadata: Record<string, unknown> = {}): Message {
  return {
    id,
    role: "user",
    content: "生成四张图片",
    imageId: null,
    imageUrl: null,
    imagePrompt: null,
    imageKind: null,
    imageSize: null,
    imageQuality: null,
    imageProviderId: null,
    parentImageId: null,
    metadata,
    createdAt: "2026-08-08T00:00:00.000Z"
  };
}

describe("messageThreadRenderKey", () => {
  test("stays stable when a pending message is replaced by its server echo", () => {
    const pending = userMessage("pending-1", { clientRequestId: "submit-1", pending: true });
    const serverEcho = userMessage("msg-1", { clientRequestId: "submit-1", jobId: "job-1" });

    expect(messageThreadRenderKey("main", pending.id, pending)).toBe("main:request:submit-1");
    expect(messageThreadRenderKey("main", serverEcho.id, serverEcho)).toBe("main:request:submit-1");
  });

  test("falls back to the existing branch and root identity for historical messages", () => {
    expect(messageThreadRenderKey("main", "msg-old", userMessage("msg-old"))).toBe("main:msg-old");
  });

  test("keeps identical request ids isolated across branches", () => {
    const message = userMessage("msg-1", { clientRequestId: "submit-1" });
    expect(messageThreadRenderKey("main", message.id, message)).not.toBe(
      messageThreadRenderKey("branch-1", message.id, message)
    );
  });
});

describe("isServerEchoOfPending", () => {
  test("matches the server echo by client request id", () => {
    const pending = userMessage("pending-1", { clientRequestId: "submit-1", pending: true });
    const serverEcho = userMessage("msg-1", { clientRequestId: "submit-1", jobId: "job-1" });
    expect(isServerEchoOfPending(serverEcho, pending)).toBe(true);
  });

  test("keeps the request-id match when the server normalizes display content", () => {
    const pending = userMessage("pending-1", { clientRequestId: "submit-1", pending: true });
    const serverEcho = {
      ...userMessage("msg-1", { clientRequestId: "submit-1", jobId: "job-1" }),
      content: "服务端规范化后的提示词"
    };
    expect(isServerEchoOfPending(serverEcho, pending)).toBe(true);
  });

  test("does not consume another identical prompt with a different request id", () => {
    const pending = userMessage("pending-1", { clientRequestId: "submit-2", pending: true });
    const otherRequest = userMessage("msg-1", { clientRequestId: "submit-1", jobId: "job-1" });
    expect(isServerEchoOfPending(otherRequest, pending)).toBe(false);
  });
});
