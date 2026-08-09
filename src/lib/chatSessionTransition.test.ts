import { describe, expect, test } from "bun:test";
import { resolveChatSessionTransition } from "./chatSessionTransition";

describe("resolveChatSessionTransition", () => {
  test("reports no session change when the image editor opens or closes in the same chat", () => {
    expect(resolveChatSessionTransition("chat-1", "chat-1")).toEqual({
      sessionKey: "chat-1",
      changed: false
    });
  });

  test("reports a session change when navigating to another chat", () => {
    expect(resolveChatSessionTransition("chat-1", "chat-2")).toEqual({
      sessionKey: "chat-2",
      changed: true
    });
  });

  test("treats entering and leaving a persisted chat as session changes", () => {
    expect(resolveChatSessionTransition("", "chat-1").changed).toBe(true);
    expect(resolveChatSessionTransition("chat-1", null).changed).toBe(true);
  });
});
