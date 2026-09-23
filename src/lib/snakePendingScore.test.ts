import { describe, expect, test } from "bun:test";
import { clearPendingSnakeScore, discardPendingSnakeScoreBeforeRevision, pendingSnakeScore, rememberPendingSnakeScore } from "./snakePendingScore";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  };
}

describe("pending snake score", () => {
  test("keeps an unsaved score for the same account and reset revision", () => {
    const storage = memoryStorage();
    rememberPendingSnakeScore("a", 5, 2, storage);
    rememberPendingSnakeScore("a", 3, 2, storage);
    rememberPendingSnakeScore("b", 8, 2, storage);
    expect(pendingSnakeScore("a", storage)).toEqual({ score: 5, revision: 2 });
    expect(pendingSnakeScore("b", storage)).toEqual({ score: 8, revision: 2 });
    clearPendingSnakeScore("a", { score: 3, revision: 2 }, storage);
    expect(pendingSnakeScore("a", storage)?.score).toBe(5);
    clearPendingSnakeScore("a", { score: 5, revision: 2 }, storage);
    expect(pendingSnakeScore("a", storage)).toBeNull();
    expect(pendingSnakeScore("b", storage)?.score).toBe(8);
  });

  test("does not carry a pending score across a reset revision", () => {
    const storage = memoryStorage();
    rememberPendingSnakeScore("a", 10, 0, storage);
    rememberPendingSnakeScore("a", 1, 1, storage);
    expect(pendingSnakeScore("a", storage)).toEqual({ score: 1, revision: 1 });
    rememberPendingSnakeScore("a", 20, 0, storage);
    expect(pendingSnakeScore("a", storage)).toEqual({ score: 1, revision: 1 });
    clearPendingSnakeScore("a", { score: 20, revision: 0 }, storage);
    expect(pendingSnakeScore("a", storage)?.revision).toBe(1);
    discardPendingSnakeScoreBeforeRevision("a", 1, storage);
    expect(pendingSnakeScore("a", storage)?.revision).toBe(1);
    discardPendingSnakeScoreBeforeRevision("a", 2, storage);
    expect(pendingSnakeScore("a", storage)).toBeNull();
  });
});
