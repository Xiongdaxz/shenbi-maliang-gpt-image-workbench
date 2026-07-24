import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
  emitImageJobEvent,
  imageJobEventReplayCursor,
  replayImageJobEventsFromDb,
  streamImageJobEvents,
  type ImageJobEventPayload
} from "./imageJobEvents";

const decoder = new TextDecoder();

async function readFrame(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const result = await reader.read();
  return decoder.decode(result.value);
}

describe("image job events", () => {
  test("parses valid replay cursors and rejects malformed values", () => {
    expect(imageJobEventReplayCursor("2026-07-23T10:20:32.521|job-1")).toEqual({
      updatedAt: "2026-07-23T10:20:32.521",
      jobId: "job-1"
    });
    expect(imageJobEventReplayCursor("2026-07-23T10:20:32.521")).toEqual({
      updatedAt: "2026-07-23T10:20:32.521",
      jobId: ""
    });
    expect(imageJobEventReplayCursor("not-a-date|job-1")).toBeNull();
    expect(imageJobEventReplayCursor("")).toBeNull();
  });

  test("adds event ids to replayed and live job frames", async () => {
    const replayed: ImageJobEventPayload = {
      jobId: "job-replayed",
      sessionId: "session-1",
      status: "succeeded",
      type: "generation",
      resultImageId: "image-1",
      updatedAt: "2026-07-23T10:20:33.000"
    };
    const response = streamImageJobEvents("user-stream", {
      lastEventId: "2026-07-23T10:20:32.521|job-before",
      replay: (cursor) => {
        expect(cursor).toEqual({ updatedAt: "2026-07-23T10:20:32.521", jobId: "job-before" });
        return [replayed];
      }
    });
    const reader = response.body!.getReader();

    expect(await readFrame(reader)).toContain("event: connected");
    expect(await readFrame(reader)).toBe(
      `id: ${replayed.updatedAt}|${replayed.jobId}\nevent: job\ndata: ${JSON.stringify(replayed)}\n\n`
    );

    const live: ImageJobEventPayload = {
      jobId: "job-live",
      sessionId: "session-1",
      status: "failed",
      type: "edit",
      error: "failed",
      updatedAt: "2026-07-23T10:20:34.000"
    };
    emitImageJobEvent("user-stream", live);
    expect(await readFrame(reader)).toBe(
      `id: ${live.updatedAt}|${live.jobId}\nevent: job\ndata: ${JSON.stringify(live)}\n\n`
    );
    await reader.cancel();
  });

  test("replays only terminal jobs for the requested user", () => {
    const db = new Database(":memory:");
    db.run(`create table image_jobs (
      id text primary key,
      user_id text not null,
      session_id text not null,
      status text not null,
      type text not null,
      result_image_id text,
      error text,
      updated_at text not null
    )`);
    const insert = db.query(
      "insert into image_jobs (id, user_id, session_id, status, type, result_image_id, error, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    insert.run("job-old", "user-1", "session-1", "succeeded", "generation", "image-old", null, "2026-07-23T10:20:30.000");
    insert.run("job-same-a", "user-1", "session-1", "succeeded", "generation", "image-before", null, "2026-07-23T10:20:32.000");
    insert.run("job-same-z", "user-1", "session-1", "succeeded", "generation", "image-after", null, "2026-07-23T10:20:32.000");
    insert.run("job-running", "user-1", "session-1", "running", "generation", null, null, "2026-07-23T10:20:33.000");
    insert.run("job-other", "user-2", "session-2", "failed", "edit", null, "other", "2026-07-23T10:20:34.000");
    insert.run("job-success", "user-1", "session-1", "succeeded", "generation", "image-1", null, "2026-07-23T10:20:35.000");
    insert.run("job-failed", "user-1", "session-1", "failed", "edit", null, "failed", "2026-07-23T10:20:36.000");

    expect(replayImageJobEventsFromDb(db, "user-1", {
      updatedAt: "2026-07-23T10:20:32.000",
      jobId: "job-same-a"
    })).toEqual([
      {
        jobId: "job-same-z",
        sessionId: "session-1",
        status: "succeeded",
        type: "generation",
        resultImageId: "image-after",
        error: null,
        updatedAt: "2026-07-23T10:20:32.000"
      },
      {
        jobId: "job-success",
        sessionId: "session-1",
        status: "succeeded",
        type: "generation",
        resultImageId: "image-1",
        error: null,
        updatedAt: "2026-07-23T10:20:35.000"
      },
      {
        jobId: "job-failed",
        sessionId: "session-1",
        status: "failed",
        type: "edit",
        resultImageId: null,
        error: "failed",
        updatedAt: "2026-07-23T10:20:36.000"
      }
    ]);
    db.close();
  });
});
