import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import sharp from "sharp";
import { cleanupMcpImageUploads } from "./externalMcpUploads";
import { InvalidUploadedImageError, validateUploadedImage } from "./imageValidation";
import { requestWithLimitedBody } from "./limitedRequestBody";

describe("external MCP request boundaries", () => {
  test("rejects declared and streamed bodies above the application limit", async () => {
    const declared = new Request("https://maliang.example/mcp", {
      method: "POST",
      headers: { "content-length": "10" },
      body: "x"
    });
    await expect(requestWithLimitedBody(declared, 4)).rejects.toEqual(
      expect.objectContaining({ code: "body_too_large" })
    );

    const streamed = new Request("https://maliang.example/mcp", {
      method: "POST",
      body: new Blob(["12345"])
    });
    await expect(requestWithLimitedBody(streamed, 4)).rejects.toEqual(
      expect.objectContaining({ code: "body_too_large" })
    );
  });

  test("returns a replayable request after bounded reading", async () => {
    const limited = await requestWithLimitedBody(new Request("https://maliang.example/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0" })
    }), 1024);
    expect(await limited.json()).toEqual({ jsonrpc: "2.0" });
  });
});

describe("external MCP image validation", () => {
  test("accepts a decodable image only when the declared and detected formats match", async () => {
    const png = await sharp({
      create: { width: 2, height: 3, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    }).png().toBuffer();
    expect(await validateUploadedImage(png, "image/png")).toEqual({
      mimeType: "image/png",
      width: 2,
      height: 3
    });
    await expect(validateUploadedImage(png, "image/jpeg")).rejects.toBeInstanceOf(InvalidUploadedImageError);
  });

  test("rejects a signature-only fake image before it reaches storage", async () => {
    const fake = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    await expect(validateUploadedImage(fake, "image/png")).rejects.toBeInstanceOf(InvalidUploadedImageError);
  });
});

describe("external MCP upload record retention", () => {
  test("deletes expired and old completed records in a bounded cleanup pass", () => {
    const db = new Database(":memory:");
    try {
      db.exec(`
        create table mcp_image_uploads (
          id text primary key,
          status text not null,
          expires_at text not null,
          used_at text,
          updated_at text not null
        );
        insert into mcp_image_uploads values
          ('expired', 'pending', '2026-07-28T00:00:00.000Z', null, '2026-07-28T00:00:00.000Z'),
          ('completed-old', 'uploaded', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
          ('recent', 'pending', '2026-07-30T01:00:00.000Z', null, '2026-07-30T00:00:00.000Z');
      `);
      expect(cleanupMcpImageUploads(db, "2026-07-30T00:00:00.000Z")).toBe(2);
      expect(db.query("select id from mcp_image_uploads order by id").all()).toEqual([{ id: "recent" }]);
    } finally {
      db.close();
    }
  });
});
