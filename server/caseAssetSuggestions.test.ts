import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  CaseAssetSuggestionRateLimitError,
  createCaseAssetSuggestionService
} from "./caseAssetSuggestions";

function testDatabase() {
  const db = new Database(":memory:");
  db.run("create table case_categories (id text primary key, type text not null, name text not null, slug text not null, sort_order integer not null)");
  db.run("create table case_asset_suggestion_cache (case_item_id text primary key, source_fingerprint text not null, category_ids_json text not null, updated_at text not null)");
  db.run("insert into case_categories values ('assetcat-1', 'asset', '人物', 'person', 10)");
  return db;
}

describe("case asset suggestion service", () => {
  test("does not cache empty results", async () => {
    const db = testDatabase();
    let calls = 0;
    const service = createCaseAssetSuggestionService({
      db,
      generate: async () => {
        calls += 1;
        return [];
      }
    });
    try {
      expect(await service.suggest({
        caseItemId: "case-1",
        sourceFingerprintInput: "image:image-1:prompt",
        prompt: "prompt",
        userId: "user-1"
      })).toEqual({ categoryIds: [], generated: true });
      expect(await service.suggest({
        caseItemId: "case-1",
        sourceFingerprintInput: "image:image-1:prompt",
        prompt: "prompt",
        userId: "user-1"
      })).toEqual({ categoryIds: [], generated: true });
      expect(calls).toBe(2);
    } finally {
      db.close();
    }
  });

  test("deduplicates concurrent generation and invalidates when the source changes", async () => {
    const db = testDatabase();
    let calls = 0;
    const service = createCaseAssetSuggestionService({
      db,
      generate: async () => {
        calls += 1;
        await Promise.resolve();
        return ["assetcat-1"];
      }
    });
    const input = {
      caseItemId: "case-1",
      sourceFingerprintInput: "asset:asset-1:prompt",
      prompt: "prompt",
      userId: "user-1"
    };
    try {
      const [first, second] = await Promise.all([service.suggest(input), service.suggest(input)]);
      expect(first.categoryIds).toEqual(["assetcat-1"]);
      expect(second.categoryIds).toEqual(["assetcat-1"]);
      expect(calls).toBe(1);
      await service.suggest({ ...input, sourceFingerprintInput: "asset:asset-1:changed", prompt: "changed" });
      expect(calls).toBe(2);
    } finally {
      db.close();
    }
  });

  test("rate limits cache misses per user", async () => {
    const db = testDatabase();
    let timestamp = 1_000;
    const service = createCaseAssetSuggestionService({
      db,
      generate: async () => [],
      nowMs: () => timestamp,
      rateLimitMaxMisses: 2,
      rateLimitWindowMs: 60_000
    });
    try {
      await service.suggest({ caseItemId: "case-1", sourceFingerprintInput: "one", prompt: "one", userId: "user-1" });
      await service.suggest({ caseItemId: "case-2", sourceFingerprintInput: "two", prompt: "two", userId: "user-1" });
      await expect(service.suggest({
        caseItemId: "case-3",
        sourceFingerprintInput: "three",
        prompt: "three",
        userId: "user-1"
      })).rejects.toBeInstanceOf(CaseAssetSuggestionRateLimitError);
      timestamp += 60_000;
      await expect(service.suggest({
        caseItemId: "case-3",
        sourceFingerprintInput: "three",
        prompt: "three",
        userId: "user-1"
      })).resolves.toEqual({ categoryIds: [], generated: true });
    } finally {
      db.close();
    }
  });
});
