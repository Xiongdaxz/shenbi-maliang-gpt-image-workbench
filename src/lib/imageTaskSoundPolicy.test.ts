import { describe, expect, test } from "bun:test";
import {
  imageTaskTerminalSoundStatus,
  mergeImageTaskTerminalAlert,
  mergeImageTaskTerminalSoundStatus
} from "./imageTaskSoundPolicy";

describe("image task sound policy", () => {
  test("plays only success and failure terminal events", () => {
    expect(imageTaskTerminalSoundStatus("succeeded")).toBe("succeeded");
    expect(imageTaskTerminalSoundStatus("failed")).toBe("failed");
    expect(imageTaskTerminalSoundStatus("running")).toBeNull();
    expect(imageTaskTerminalSoundStatus("cancelled")).toBeNull();
  });

  test("gives failure priority when terminal events are merged", () => {
    expect(mergeImageTaskTerminalSoundStatus(null, "succeeded")).toBe("succeeded");
    expect(mergeImageTaskTerminalSoundStatus("succeeded", "failed")).toBe("failed");
    expect(mergeImageTaskTerminalSoundStatus("failed", "succeeded")).toBe("failed");
  });

  test("keeps the notification target aligned with the merged status", () => {
    const success = { status: "succeeded", jobId: "job-success", sessionId: "session-success" } as const;
    const failure = { status: "failed", jobId: "job-failure", sessionId: "session-failure" } as const;

    expect(mergeImageTaskTerminalAlert(success, failure)).toEqual(failure);
    expect(mergeImageTaskTerminalAlert(failure, success)).toEqual(failure);
    expect(mergeImageTaskTerminalAlert(success, {
      status: "succeeded",
      jobId: "job-success-latest",
      sessionId: "session-success-latest"
    })).toEqual({
      status: "succeeded",
      jobId: "job-success-latest",
      sessionId: "session-success-latest"
    });
  });
});
