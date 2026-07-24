import { describe, expect, test } from "bun:test";
import { imageTaskAlertRuntimeState, imageTaskSoundLeaderTabId } from "./useImageTaskSounds";

describe("image task alert leader election", () => {
  test("selects one deterministic active tab and ignores stale peers", () => {
    const now = 10_000;
    const peers = new Map([
      ["tab-c", now],
      ["tab-a", now - 1_000],
      ["tab-b", now - 7_000]
    ]);

    expect(imageTaskSoundLeaderTabId(peers, now)).toBe("tab-a");
    expect(imageTaskSoundLeaderTabId(new Map(), now)).toBeNull();
  });

  test("accepts only complete cross-tab alert state", () => {
    const message = imageTaskAlertRuntimeState({
      type: "state",
      tabId: "tab-a",
      userId: "user-a",
      updatedAt: 10_000,
      preferences: {
        imageTaskSoundEnabled: false,
        imageTaskBrowserNotificationEnabled: true,
        imageTaskSoundVolume: 120,
        imageTaskSuccessSoundId: "maliang-003",
        imageTaskFailureSoundId: "maliang-004"
      },
      browserNotificationCopy: {
        successTitle: "success",
        successBody: "done",
        failureTitle: "failure",
        failureBody: "failed"
      }
    });

    expect(message?.preferences.imageTaskSoundVolume).toBe(100);
    expect(message?.preferences.imageTaskSuccessSoundId).toBe("maliang-003");
    expect(imageTaskAlertRuntimeState({ type: "state", tabId: "tab-a" })).toBeNull();
  });
});
