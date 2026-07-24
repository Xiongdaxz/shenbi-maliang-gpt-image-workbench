import { describe, expect, test } from "bun:test";
import {
  imageJobEventStreamHeaders,
  nextImageJobEventCursor,
  parseStreamFrame
} from "./useImageJobEvents";

describe("image job fetch event stream", () => {
  test("parses event ids alongside event names and JSON data", () => {
    expect(parseStreamFrame('id: 2026-07-24T08:00:00.000|job-1\nevent: job\ndata: {"jobId":"job-1"}')).toEqual({
      id: "2026-07-24T08:00:00.000|job-1",
      event: "job",
      data: { jobId: "job-1" }
    });
  });

  test("keeps the previous cursor when a frame has no id", () => {
    const connected = parseStreamFrame("event: connected\ndata: {}")!;
    expect(nextImageJobEventCursor("cursor-1", connected)).toBe("cursor-1");
  });

  test("adds the last event id only to reconnect requests that have a cursor", () => {
    expect(imageJobEventStreamHeaders("")).toEqual({ Accept: "text/event-stream" });
    expect(imageJobEventStreamHeaders("cursor-1")).toEqual({
      Accept: "text/event-stream",
      "Last-Event-ID": "cursor-1"
    });
  });
});
