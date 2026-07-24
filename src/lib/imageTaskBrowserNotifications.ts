import type { ImageTaskTerminalSoundStatus } from "./imageTaskSoundPolicy";

export type ImageTaskBrowserNotificationCopy = {
  successTitle: string;
  successBody: string;
  failureTitle: string;
  failureBody: string;
};

export type BrowserNotificationPermissionResult = NotificationPermission | "unsupported" | "insecure-context" | "error";

export function imageTaskBrowserNotificationPermissionToastKey(
  permission: BrowserNotificationPermissionResult
) {
  if (permission === "granted") return null;
  if (permission === "denied") return "toast.imageTaskBrowserNotificationPermissionBlocked";
  if (permission === "insecure-context") return "toast.imageTaskBrowserNotificationInsecureContext";
  if (permission === "unsupported") return "toast.imageTaskBrowserNotificationUnsupported";
  return "toast.imageTaskBrowserNotificationPermissionDenied";
}

export type ImageTaskBrowserNotificationSettingState = "disabled" | "active" | "permission-blocked";

export type BrowserNotificationInstance = {
  onclick: ((event: Event) => void) | null;
  close: () => void;
};

export type BrowserNotificationApi = {
  isSecureContext: () => boolean;
  getPermission: () => NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  create: (title: string, options: NotificationOptions) => BrowserNotificationInstance;
  focusWindow: () => void;
};

export type ImageTaskBrowserNotificationActions = {
  onClick?: () => void;
};

export function imageTaskBrowserNotificationSettingState(
  preferenceEnabled: boolean,
  permission: BrowserNotificationPermissionResult
): ImageTaskBrowserNotificationSettingState {
  if (!preferenceEnabled) return "disabled";
  return permission === "granted" ? "active" : "permission-blocked";
}

export function imageTaskBrowserNotificationPath(sessionId: string) {
  const normalizedSessionId = sessionId.trim();
  return normalizedSessionId ? `/chat/${encodeURIComponent(normalizedSessionId)}` : null;
}

function currentBrowserNotificationApi(): BrowserNotificationApi | null {
  if (
    typeof window === "undefined"
    || typeof window.Notification !== "function"
    || typeof window.Notification.requestPermission !== "function"
  ) return null;
  return {
    isSecureContext: () => window.isSecureContext,
    getPermission: () => window.Notification.permission,
    requestPermission: () => window.Notification.requestPermission(),
    create: (title, options) => new window.Notification(title, options),
    focusWindow: () => window.focus()
  };
}

export function isImageTaskBrowserNotificationSupported(api = currentBrowserNotificationApi()) {
  return api !== null;
}

export function getImageTaskBrowserNotificationPermission(
  api = currentBrowserNotificationApi()
): BrowserNotificationPermissionResult {
  if (!api) return "unsupported";
  if (!api.isSecureContext()) return "insecure-context";
  try {
    return api.getPermission();
  } catch {
    return "error";
  }
}

export async function requestImageTaskBrowserNotificationPermission(
  api = currentBrowserNotificationApi()
): Promise<BrowserNotificationPermissionResult> {
  if (!api) return "unsupported";
  const permission = getImageTaskBrowserNotificationPermission(api);
  if (permission === "granted" || permission === "denied") return permission;
  if (permission !== "default") return permission;
  try {
    return await api.requestPermission();
  } catch {
    return "error";
  }
}

export function showImageTaskBrowserNotification(
  status: ImageTaskTerminalSoundStatus,
  copy: ImageTaskBrowserNotificationCopy,
  notificationId: string,
  actions: ImageTaskBrowserNotificationActions = {},
  api = currentBrowserNotificationApi()
) {
  if (!api || getImageTaskBrowserNotificationPermission(api) !== "granted") return false;
  const failed = status === "failed";
  try {
    const notification = api.create(failed ? copy.failureTitle : copy.successTitle, {
      body: failed ? copy.failureBody : copy.successBody,
      tag: `gpt-image:image-task-result:${notificationId}`,
      silent: true
    });
    notification.onclick = () => {
      try {
        api.focusWindow();
      } finally {
        try {
          actions.onClick?.();
        } finally {
          notification.close();
        }
      }
    };
    return true;
  } catch {
    return false;
  }
}
