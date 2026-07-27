import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { appDb, getAll, getOne, run } from "./db";
import { suggestAssetCategoryIds } from "./assetSuggestions";
import { now, parseJsonArray } from "./utils";

type CaseAssetSuggestionCacheRow = {
  source_fingerprint: string;
  category_ids_json: string;
};

type CaseAssetSuggestionServiceOptions = {
  db?: Database;
  generate?: (prompt: string) => Promise<string[]>;
  nowMs?: () => number;
  rateLimitMaxMisses?: number;
  rateLimitWindowMs?: number;
};

type CaseAssetSuggestionInput = {
  caseItemId: string;
  sourceFingerprintInput: string;
  prompt: string;
  userId: string;
};

export class CaseAssetSuggestionRateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("标签推荐请求过于频繁，请稍后再试");
    this.name = "CaseAssetSuggestionRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function normalizedCategoryIds(value: unknown) {
  const ids = Array.isArray(value)
    ? value.map(String)
    : parseJsonArray(typeof value === "string" ? value : "", []);
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean))).slice(0, 3);
}

function sourceFingerprint(db: Database, sourceFingerprintInput: string) {
  const categories = getAll<{ id: string; name: string; slug: string }>(
    db,
    "select id, name, slug from case_categories where type = 'asset' order by sort_order asc, id asc"
  );
  return createHash("sha256")
    .update(JSON.stringify({ source: sourceFingerprintInput, categories }))
    .digest("hex");
}

export function createCaseAssetSuggestionService(options: CaseAssetSuggestionServiceOptions = {}) {
  const db = options.db ?? appDb;
  const generate = options.generate ?? suggestAssetCategoryIds;
  const currentTimeMs = options.nowMs ?? Date.now;
  const rateLimitMaxMisses = options.rateLimitMaxMisses ?? 20;
  const rateLimitWindowMs = options.rateLimitWindowMs ?? 60_000;
  const inFlight = new Map<string, Promise<string[]>>();
  const missesByUser = new Map<string, number[]>();

  function consumeMiss(userId: string) {
    const timestamp = currentTimeMs();
    const recent = (missesByUser.get(userId) ?? []).filter((value) => timestamp - value < rateLimitWindowMs);
    if (recent.length >= rateLimitMaxMisses) {
      const retryAfterMs = Math.max(1000, recent[0] + rateLimitWindowMs - timestamp);
      missesByUser.set(userId, recent);
      throw new CaseAssetSuggestionRateLimitError(Math.ceil(retryAfterMs / 1000));
    }
    recent.push(timestamp);
    missesByUser.set(userId, recent);
  }

  async function suggest(input: CaseAssetSuggestionInput) {
    const caseItemId = input.caseItemId.trim();
    const prompt = input.prompt.trim();
    const userId = input.userId.trim();
    const fingerprint = sourceFingerprint(db, input.sourceFingerprintInput);
    const cached = getOne<CaseAssetSuggestionCacheRow>(
      db,
      "select source_fingerprint, category_ids_json from case_asset_suggestion_cache where case_item_id = ?",
      caseItemId
    );
    if (cached?.source_fingerprint === fingerprint) {
      return { categoryIds: normalizedCategoryIds(cached.category_ids_json), generated: false };
    }

    const requestKey = `${caseItemId}:${fingerprint}`;
    const pending = inFlight.get(requestKey);
    if (pending) return { categoryIds: await pending, generated: false };

    consumeMiss(userId);
    const request = generate(prompt)
      .then((categoryIds) => {
        const normalized = normalizedCategoryIds(categoryIds);
        if (normalized.length > 0) {
          run(
            db,
            `insert into case_asset_suggestion_cache (
               case_item_id, source_fingerprint, category_ids_json, updated_at
             ) values (?, ?, ?, ?)
             on conflict(case_item_id) do update set
               source_fingerprint = excluded.source_fingerprint,
               category_ids_json = excluded.category_ids_json,
               updated_at = excluded.updated_at`,
            caseItemId,
            fingerprint,
            JSON.stringify(normalized),
            now()
          );
        } else {
          run(db, "delete from case_asset_suggestion_cache where case_item_id = ?", caseItemId);
        }
        return normalized;
      })
      .finally(() => {
        inFlight.delete(requestKey);
      });
    inFlight.set(requestKey, request);
    return { categoryIds: await request, generated: true };
  }

  return { suggest };
}

export const caseAssetSuggestionService = createCaseAssetSuggestionService();
