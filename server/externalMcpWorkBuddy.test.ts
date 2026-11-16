import { expect, test } from "bun:test";
// @ts-expect-error The WorkBuddy entry runs as portable JavaScript in Node.
import { createWorkBuddyImageServer } from "../scripts/maliang-workbuddy-mcp-entry.mjs";

test("WorkBuddy accepts configured private HTTPS without enabling plaintext HTTP", () => {
  const runtime = { workspaceRoots: [], allowInsecureLocal: false };
  expect(() => createWorkBuddyImageServer({ ...runtime, origin: "https://192.168.1.20:8787" })).not.toThrow();
  expect(() => createWorkBuddyImageServer({ ...runtime, origin: "http://192.168.1.20:8787" })).toThrow("必须使用 HTTPS");
  expect(() => createWorkBuddyImageServer({ ...runtime, origin: "http://192.168.1.20:8787", allowInsecureLocal: true })).not.toThrow();
  expect(() => createWorkBuddyImageServer({ ...runtime, origin: "http://maliang.example", allowInsecureLocal: true })).toThrow("必须使用 HTTPS");
});
