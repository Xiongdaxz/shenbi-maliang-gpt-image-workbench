import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { initMcpSubmissions, McpSubmissionRejected, submitMcpImageOnce } from "./externalMcpSubmissions";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function database() {
  const db = new Database(":memory:"); databases.push(db);
  db.exec("pragma foreign_keys = on; create table users (id text primary key); insert into users values ('user-a'), ('user-b')");
  initMcpSubmissions(db);
  db.exec("create table image_jobs (id text, user_id text, client_request_id text, session_id text, status text, created_at text)");
  return db;
}
const input = { userId: "user-a", operation: "generation" as const, requestKey: "request-1", parameters: { prompt: "a cat", imageCount: 1 } };
function accept(db: Database, userId = input.userId) {
  return async (key: string) => {
    const jobId = `job-${userId}`;
    db.query("insert into image_jobs values (?, ?, ?, 'session-1', 'running', 'now')").run(jobId, userId, key);
    return { jobId, sessionId: "session-1", status: "running" };
  };
}

describe("MCP image submission idempotency", () => {
  test("account deletion removes only that owner's submission records", async () => {
    const db = database();
    await submitMcpImageOnce(db, input, accept(db));
    await submitMcpImageOnce(db, { ...input, userId: "user-b" }, accept(db, "user-b"));
    db.query("delete from users where id = ?").run("user-a");
    expect(db.query("select user_id from mcp_image_submissions").all()).toEqual([{ user_id: "user-b" }]);
  });
  test("concurrent retries reserve once and recover an accepted response", async () => {
    const db = database(); let release!: () => void; let calls = 0;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = submitMcpImageOnce(db, input, async (key) => { calls++; await gate; return accept(db)(key); });
    await expect(submitMcpImageOnce(db, input, accept(db))).rejects.toThrow("尚未确认");
    release(); const result = await first;
    expect(await submitMcpImageOnce(db, input, async () => { throw new Error("must not submit"); })).toEqual(result);
    expect(calls).toBe(1);
  });
  test("response loss is recovered from the persisted job without another provider call", async () => {
    const db = database();
    await expect(submitMcpImageOnce(db, input, async (key) => { await accept(db)(key); throw new Error("response lost"); })).rejects.toThrow("response lost");
    expect((await submitMcpImageOnce(db, input, async () => { throw new Error("duplicate"); })).jobId).toBe("job-user-a");
  });
  test("binds a key to its arguments and owner, and keeps deleted jobs as tombstones", async () => {
    const db = database();
    await submitMcpImageOnce(db, input, accept(db));
    await expect(submitMcpImageOnce(db, { ...input, parameters: { prompt: "different" } }, accept(db))).rejects.toThrow("不同");
    expect((await submitMcpImageOnce(db, { ...input, userId: "user-b" }, accept(db, "user-b"))).jobId).toBe("job-user-b");
    db.query("delete from image_jobs where user_id = ?").run(input.userId);
    await expect(submitMcpImageOnce(db, input, accept(db))).rejects.toThrow("已被删除");
  });
  test("only definite pre-submission rejection releases the reservation", async () => {
    const db = database();
    await expect(submitMcpImageOnce(db, input, async () => { throw new McpSubmissionRejected("invalid prompt"); })).rejects.toThrow("invalid prompt");
    expect((await submitMcpImageOnce(db, input, accept(db))).jobId).toBe("job-user-a");
    const other = { ...input, requestKey: "uncertain" };
    await expect(submitMcpImageOnce(db, other, async () => { throw new Error("uncertain"); })).rejects.toThrow("uncertain");
    await expect(submitMcpImageOnce(db, other, accept(db))).rejects.toThrow("尚未确认");
  });
});
