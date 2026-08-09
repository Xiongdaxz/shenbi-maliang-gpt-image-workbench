import { describe, expect, test } from "bun:test";
import { selectAvailableChatGptWebAccount } from "./chatGptWebAccountPool";

const accounts = [{ id: "account-1" }, { id: "account-2" }, { id: "account-3" }];

describe("ChatGPT Web account selection", () => {
  test("round robin skips accounts that are already in use", () => {
    expect(
      selectAvailableChatGptWebAccount(accounts, "round_robin", 0, new Set(["account-1"]))
    ).toEqual({ account: { id: "account-2" }, nextCursor: 2 });
    expect(
      selectAvailableChatGptWebAccount(accounts, "round_robin", 2, new Set(["account-1", "account-3"]))
    ).toEqual({ account: { id: "account-2" }, nextCursor: 2 });
  });

  test("random selection samples only from accounts that are not in use", () => {
    expect(
      selectAvailableChatGptWebAccount(accounts, "random", 0, new Set(["account-1"]), 0)
    ).toEqual({ account: { id: "account-2" }, nextCursor: 0 });
    expect(
      selectAvailableChatGptWebAccount(accounts, "random", 0, new Set(["account-1"]), 0.99)
    ).toEqual({ account: { id: "account-3" }, nextCursor: 0 });
  });

  test("returns no account when every candidate is busy", () => {
    expect(
      selectAvailableChatGptWebAccount(accounts, "priority", 0, new Set(accounts.map((account) => account.id)))
    ).toEqual({ account: null, nextCursor: 0 });
  });
});
