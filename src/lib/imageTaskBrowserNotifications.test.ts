import { describe, expect, test } from "bun:test";
import {
  getImageTaskBrowserNotificationPermission,
  imageTaskBrowserNotificationPath,
  imageTaskBrowserNotificationSettingState,
  isImageTaskBrowserNotificationSupported,
  requestImageTaskBrowserNotificationPermission,
  showImageTaskBrowserNotification,
  type BrowserNotificationApi,
  type BrowserNotificationInstance
} from "./imageTaskBrowserNotifications";

const copy = {
  successTitle: "Image task completed",
  successBody: "Your image is ready.",
  failureTitle: "Image task failed",
  failureBody: "Return to review the error."
};

function fakeApi(permission: NotificationPermission = "granted", secureContext = true) {
  const created: Array<{ title: string; options: NotificationOptions; notification: BrowserNotificationInstance }> = [];
  let focused = 0;
  const api: BrowserNotificationApi = {
    isSecureContext: () => secureContext,
    getPermission: () => permission,
    requestPermission: async () => "granted",
    create: (title, options) => {
      const notification: BrowserNotificationInstance = { onclick: null, close: () => undefined };
      created.push({ title, options, notification });
      return notification;
    },
    focusWindow: () => {
      focused += 1;
    }
  };
  return { api, created, focused: () => focused };
}

describe("image task browser notifications", () => {
  test("keeps the saved setting distinct from local browser permission", () => {
    expect(imageTaskBrowserNotificationSettingState(false, "granted")).toBe("disabled");
    expect(imageTaskBrowserNotificationSettingState(true, "granted")).toBe("active");
    expect(imageTaskBrowserNotificationSettingState(true, "denied")).toBe("permission-blocked");
    expect(imageTaskBrowserNotificationSettingState(true, "unsupported")).toBe("permission-blocked");
  });

  test("builds an encoded conversation path for notification clicks", () => {
    expect(imageTaskBrowserNotificationPath(" chat/with space ")).toBe("/chat/chat%2Fwith%20space");
    expect(imageTaskBrowserNotificationPath("   ")).toBeNull();
  });

  test("reports unsupported environments and requests permission only when needed", async () => {
    expect(isImageTaskBrowserNotificationSupported(null)).toBe(false);
    expect(getImageTaskBrowserNotificationPermission(null)).toBe("unsupported");
    expect(await requestImageTaskBrowserNotificationPermission(null)).toBe("unsupported");

    const granted = fakeApi("granted");
    let requests = 0;
    granted.api.requestPermission = async () => {
      requests += 1;
      return "granted";
    };
    expect(await requestImageTaskBrowserNotificationPermission(granted.api)).toBe("granted");
    expect(requests).toBe(0);

    const pending = fakeApi("default");
    pending.api.requestPermission = async () => {
      requests += 1;
      return "granted";
    };
    expect(await requestImageTaskBrowserNotificationPermission(pending.api)).toBe("granted");
    expect(requests).toBe(1);
  });

  test("reports insecure contexts without requesting permission", async () => {
    const insecure = fakeApi("default", false);
    let requests = 0;
    insecure.api.requestPermission = async () => {
      requests += 1;
      return "granted";
    };

    expect(getImageTaskBrowserNotificationPermission(insecure.api)).toBe("insecure-context");
    expect(await requestImageTaskBrowserNotificationPermission(insecure.api)).toBe("insecure-context");
    expect(requests).toBe(0);
    expect(showImageTaskBrowserNotification("succeeded", copy, "job-insecure", {}, insecure.api)).toBe(false);
    expect(insecure.created).toHaveLength(0);
  });

  test("shows localized success and failure notifications and focuses on click", () => {
    const success = fakeApi();
    let clicked = 0;
    expect(showImageTaskBrowserNotification("succeeded", copy, "job-success", {
      onClick: () => {
        clicked += 1;
      }
    }, success.api)).toBe(true);
    expect(success.created[0]?.title).toBe(copy.successTitle);
    expect(success.created[0]?.options).toMatchObject({
      body: copy.successBody,
      tag: "gpt-image:image-task-result:job-success",
      silent: true
    });
    success.created[0]?.notification.onclick?.(new Event("click"));
    expect(success.focused()).toBe(1);
    expect(clicked).toBe(1);

    const failure = fakeApi();
    expect(showImageTaskBrowserNotification("failed", copy, "job-failure", {}, failure.api)).toBe(true);
    expect(failure.created[0]?.title).toBe(copy.failureTitle);
    expect(failure.created[0]?.options.body).toBe(copy.failureBody);
    expect(failure.created[0]?.options.tag).toBe("gpt-image:image-task-result:job-failure");
  });

  test("skips notifications without permission", () => {
    const denied = fakeApi("denied");
    expect(showImageTaskBrowserNotification("failed", copy, "job-denied", {}, denied.api)).toBe(false);
    expect(denied.created).toHaveLength(0);
  });
});
