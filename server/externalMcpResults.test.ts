import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  createMcpImageResultPresentationWithSecret,
  createMcpImageResultToken,
  MCP_IMAGE_RESULT_CACHE_CONTROL,
  mcpImageResultFromToken,
  mcpImageResultGrantIsActive,
  readMcpImageResultOriginal
} from "./externalMcpResults";

describe("external MCP image result links", () => {
  const secret = "test-signing-secret";
  const nowMs = Date.parse("2026-07-29T08:00:00.000Z");
  const expiresAtMs = Date.parse("2026-08-28T08:00:00.000Z");

  test("does not cache authorization-bound image responses", () => {
    expect(MCP_IMAGE_RESULT_CACHE_CONTROL).toBe("private, no-store");
  });

  test("round trips a scoped expiring image token", () => {
    const token = createMcpImageResultToken(
      { imageId: "img_test", userId: "user_test", grantId: "grant_test", grantVersion: 1 },
      secret,
      expiresAtMs
    );

    expect(mcpImageResultFromToken(token, secret, nowMs)).toEqual({
      imageId: "img_test",
      userId: "user_test",
      grantId: "grant_test",
      grantVersion: 1,
      expiresAt: Math.floor(expiresAtMs / 1000)
    });
  });

  test("rejects tampered, expired, and wrong-secret tokens", () => {
    const token = createMcpImageResultToken(
      { imageId: "img_test", userId: "user_test", grantId: "grant_test", grantVersion: 1 },
      secret,
      expiresAtMs
    );
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

    expect(mcpImageResultFromToken(tampered, secret, nowMs)).toBeNull();
    expect(mcpImageResultFromToken(token, "different-secret", nowMs)).toBeNull();
    expect(mcpImageResultFromToken(token, secret, expiresAtMs)).toBeNull();
  });

  test("publishes an original download URL while retaining the legacy preview field", () => {
    const result = createMcpImageResultPresentationWithSecret({
      imageId: "img_test",
      userId: "user_test",
      grantId: "grant_test",
      grantVersion: 1,
      publicBaseUrl: "https://maliang.example/",
      expiresAtMs
    }, secret);

    expect(result.downloadUrl).toMatch(/^https:\/\/maliang\.example\/mcp\/image-result\//);
    expect(result.previewUrl).toBe(result.downloadUrl);
    expect(result.expiresAt).toBe("2026-08-28T08:00:00.000Z");
  });

  test("reads the stored original bytes directly", async () => {
    const source = Buffer.from("original-image-bytes");
    const result = await readMcpImageResultOriginal(
      { path: "secure/original.gimg", mime_type: "image/webp" },
      async (sourcePath) => {
        expect(sourcePath).toBe("secure/original.gimg");
        return source;
      }
    );

    expect(result).toEqual({ buffer: source, mimeType: "image/webp" });
  });

  test("invalidates result links when the bound OAuth grant is revoked", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`
        create table oauth_grants (id text primary key, user_id text not null, credential_version integer not null, revoked_at text);
        insert into oauth_grants values ('grant_test', 'user_test', 1, null);
      `);
      expect(mcpImageResultGrantIsActive(db, "grant_test", 1, "user_test")).toBe(true);
      db.query("update oauth_grants set revoked_at = '2026-07-30T00:00:00.000Z' where id = 'grant_test'").run();
      expect(mcpImageResultGrantIsActive(db, "grant_test", 1, "user_test")).toBe(false);
      db.query("update oauth_grants set revoked_at = null, credential_version = 2 where id = 'grant_test'").run();
      expect(mcpImageResultGrantIsActive(db, "grant_test", 1, "user_test")).toBe(false);
      expect(mcpImageResultGrantIsActive(db, "grant_test", 2, "user_test")).toBe(true);
    } finally {
      db.close();
    }
  });
});
