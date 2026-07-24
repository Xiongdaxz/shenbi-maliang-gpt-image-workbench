import { useCallback, useEffect, useRef } from "react";
import type { ImageJobEventPayload } from "./useImageJobEvents";
import { playImageTaskSound } from "../lib/imageTaskSoundPlayer";
import {
  showImageTaskBrowserNotification,
  type ImageTaskBrowserNotificationCopy
} from "../lib/imageTaskBrowserNotifications";
import {
  imageTaskTerminalSoundStatus,
  mergeImageTaskTerminalAlert,
  type ImageTaskTerminalAlert
} from "../lib/imageTaskSoundPolicy";
import { normalizeImageTaskSoundVolume } from "../lib/imageTaskSounds";
import type { ImageTaskSound, UserPreferences } from "../types";

const SOUND_LEADER_LOCK = "gpt-image:image-task-sound-leader";
const SOUND_LEADER_CHANNEL = "gpt-image:image-task-sound-leader";
const SOUND_LEADER_STORAGE_KEY = "gpt-image.image-task-sound-leader";
const SOUND_RUNTIME_STATE_CHANNEL = "gpt-image:image-task-alert-state";
const SOUND_RUNTIME_STATE_STORAGE_KEY = "gpt-image.image-task-alert-state";
const SOUND_LEADER_LEASE_MS = 5000;
const SOUND_LEADER_HEARTBEAT_MS = 2000;
const SOUND_LEADER_PEER_STALE_MS = 6000;
const SOUND_LEADER_SETTLE_MS = 120;
const SOUND_MERGE_DELAY_MS = 700;

type SoundLeaderMessage = {
  type: "hello" | "heartbeat" | "leaving";
  tabId: string;
  userId: string;
};

type SoundPreferences = Pick<
  UserPreferences,
  | "imageTaskSoundEnabled"
  | "imageTaskBrowserNotificationEnabled"
  | "imageTaskSoundVolume"
  | "imageTaskSuccessSoundId"
  | "imageTaskFailureSoundId"
>;

type SoundRuntimeStateMessage = {
  type: "state";
  tabId: string;
  userId: string;
  updatedAt: number;
  preferences: SoundPreferences;
  browserNotificationCopy: ImageTaskBrowserNotificationCopy;
};

export function imageTaskAlertRuntimeState(value: unknown): SoundRuntimeStateMessage | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Partial<SoundRuntimeStateMessage>;
  const preferences = message.preferences as Partial<SoundPreferences> | undefined;
  const copy = message.browserNotificationCopy as Partial<ImageTaskBrowserNotificationCopy> | undefined;
  if (
    message.type !== "state"
    || typeof message.tabId !== "string"
    || !message.tabId
    || typeof message.userId !== "string"
    || !message.userId
    || typeof message.updatedAt !== "number"
    || !Number.isFinite(message.updatedAt)
    || typeof preferences?.imageTaskSoundEnabled !== "boolean"
    || typeof preferences.imageTaskBrowserNotificationEnabled !== "boolean"
    || typeof preferences.imageTaskSoundVolume !== "number"
    || !Number.isFinite(preferences.imageTaskSoundVolume)
    || typeof preferences.imageTaskSuccessSoundId !== "string"
    || preferences.imageTaskSuccessSoundId.length > 128
    || typeof preferences.imageTaskFailureSoundId !== "string"
    || preferences.imageTaskFailureSoundId.length > 128
    || typeof copy?.successTitle !== "string"
    || typeof copy.successBody !== "string"
    || typeof copy.failureTitle !== "string"
    || typeof copy.failureBody !== "string"
  ) return null;
  return {
    type: "state",
    tabId: message.tabId,
    userId: message.userId,
    updatedAt: message.updatedAt,
    preferences: {
      imageTaskSoundEnabled: preferences.imageTaskSoundEnabled,
      imageTaskBrowserNotificationEnabled: preferences.imageTaskBrowserNotificationEnabled,
      imageTaskSoundVolume: normalizeImageTaskSoundVolume(preferences.imageTaskSoundVolume),
      imageTaskSuccessSoundId: preferences.imageTaskSuccessSoundId,
      imageTaskFailureSoundId: preferences.imageTaskFailureSoundId
    },
    browserNotificationCopy: {
      successTitle: copy.successTitle,
      successBody: copy.successBody,
      failureTitle: copy.failureTitle,
      failureBody: copy.failureBody
    }
  };
}

function randomTabId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function imageTaskSoundLeaderTabId(
  peers: ReadonlyMap<string, number>,
  now: number,
  staleAfterMs = SOUND_LEADER_PEER_STALE_MS
) {
  return Array.from(peers.entries())
    .filter(([, lastSeenAt]) => now - lastSeenAt <= staleAfterMs)
    .map(([tabId]) => tabId)
    .sort()[0] ?? null;
}

export function useImageTaskSounds(
  userId: string,
  preferences: SoundPreferences,
  sounds: readonly ImageTaskSound[],
  browserNotificationCopy: ImageTaskBrowserNotificationCopy,
  onBrowserNotificationClick: (sessionId: string) => void
) {
  const preferencesRef = useRef(preferences);
  const soundsRef = useRef(sounds);
  const browserNotificationCopyRef = useRef(browserNotificationCopy);
  const browserNotificationClickRef = useRef(onBrowserNotificationClick);
  const leaderRef = useRef(false);
  const mergeTimerRef = useRef(0);
  const pendingAlertRef = useRef<ImageTaskTerminalAlert | null>(null);
  const seenEventsRef = useRef(new Set<string>());
  const tabIdRef = useRef("");
  const runtimeStateChannelRef = useRef<BroadcastChannel | null>(null);
  const runtimeStateUpdatedAtRef = useRef(0);
  if (!tabIdRef.current) tabIdRef.current = randomTabId();

  useEffect(() => {
    browserNotificationClickRef.current = onBrowserNotificationClick;
  }, [onBrowserNotificationClick]);

  useEffect(() => {
    soundsRef.current = sounds;
  }, [sounds]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    runtimeStateUpdatedAtRef.current = 0;
    const runtimeStorageKey = `${SOUND_RUNTIME_STATE_STORAGE_KEY}:${userId}`;
    const applyRuntimeState = (value: unknown) => {
      const message = imageTaskAlertRuntimeState(value);
      if (
        !message
        || message.tabId === tabIdRef.current
        || message.userId !== userId
        || message.updatedAt < runtimeStateUpdatedAtRef.current
      ) return;
      runtimeStateUpdatedAtRef.current = message.updatedAt;
      preferencesRef.current = message.preferences;
      browserNotificationCopyRef.current = message.browserNotificationCopy;
    };
    if (typeof window.BroadcastChannel === "function") {
      try {
        const channel = new window.BroadcastChannel(SOUND_RUNTIME_STATE_CHANNEL);
        runtimeStateChannelRef.current = channel;
        const handleMessage = (event: MessageEvent<unknown>) => applyRuntimeState(event.data);
        channel.addEventListener("message", handleMessage);
        return () => {
          channel.removeEventListener("message", handleMessage);
          channel.close();
          if (runtimeStateChannelRef.current === channel) runtimeStateChannelRef.current = null;
        };
      } catch {
        // Fall through to storage events when a channel cannot be created.
      }
    }
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== runtimeStorageKey || !event.newValue) return;
      try {
        applyRuntimeState(JSON.parse(event.newValue));
      } catch {
        // Ignore malformed cross-tab state.
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [userId]);

  useEffect(() => {
    preferencesRef.current = preferences;
    browserNotificationCopyRef.current = browserNotificationCopy;
    if (typeof window === "undefined") return;
    const message: SoundRuntimeStateMessage = {
      type: "state",
      tabId: tabIdRef.current,
      userId,
      updatedAt: Date.now(),
      preferences,
      browserNotificationCopy
    };
    runtimeStateUpdatedAtRef.current = message.updatedAt;
    runtimeStateChannelRef.current?.postMessage(message);
    try {
      window.localStorage.setItem(`${SOUND_RUNTIME_STATE_STORAGE_KEY}:${userId}`, JSON.stringify(message));
    } catch {
      // Ignore unavailable browser storage; BroadcastChannel may still be active.
    }
  }, [
    browserNotificationCopy.failureBody,
    browserNotificationCopy.failureTitle,
    browserNotificationCopy.successBody,
    browserNotificationCopy.successTitle,
    preferences.imageTaskBrowserNotificationEnabled,
    preferences.imageTaskFailureSoundId,
    preferences.imageTaskSoundEnabled,
    preferences.imageTaskSoundVolume,
    preferences.imageTaskSuccessSoundId,
    userId
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const lockManager = navigator.locks;
    if (lockManager?.request) {
      const controller = new AbortController();
      let releaseLock: (() => void) | null = null;
      void lockManager
        .request(`${SOUND_LEADER_LOCK}:${userId}`, { mode: "exclusive", signal: controller.signal }, async () => {
          leaderRef.current = true;
          await new Promise<void>((resolve) => {
            releaseLock = resolve;
          });
          leaderRef.current = false;
        })
        .catch((error) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            console.warn("提示音多标签页协调失败", error);
          }
        });
      return () => {
        controller.abort();
        releaseLock?.();
        leaderRef.current = false;
      };
    }

    const tabId = tabIdRef.current;
    if (typeof window.BroadcastChannel === "function") {
      try {
        const channel = new window.BroadcastChannel(SOUND_LEADER_CHANNEL);
        const peers = new Map<string, number>([[tabId, Date.now()]]);
        let settled = false;
        const updateLeader = () => {
          const currentTime = Date.now();
          for (const [peerId, lastSeenAt] of peers) {
            if (currentTime - lastSeenAt > SOUND_LEADER_PEER_STALE_MS) peers.delete(peerId);
          }
          peers.set(tabId, currentTime);
          leaderRef.current = settled && imageTaskSoundLeaderTabId(peers, currentTime) === tabId;
        };
        const announce = (type: SoundLeaderMessage["type"]) => {
          channel.postMessage({ type, tabId, userId } satisfies SoundLeaderMessage);
        };
        const handleMessage = (event: MessageEvent<unknown>) => {
          const message = event.data as Partial<SoundLeaderMessage> | null;
          if (
            !message
            || typeof message.tabId !== "string"
            || message.tabId === tabId
            || message.userId !== userId
            || (message.type !== "hello" && message.type !== "heartbeat" && message.type !== "leaving")
          ) return;
          if (message.type === "leaving") peers.delete(message.tabId);
          else peers.set(message.tabId, Date.now());
          updateLeader();
          if (message.type === "hello") announce("heartbeat");
        };
        channel.addEventListener("message", handleMessage);
        announce("hello");
        const settleTimer = window.setTimeout(() => {
          settled = true;
          updateLeader();
          announce("heartbeat");
        }, SOUND_LEADER_SETTLE_MS);
        const heartbeatTimer = window.setInterval(() => {
          updateLeader();
          announce("heartbeat");
        }, SOUND_LEADER_HEARTBEAT_MS);
        return () => {
          window.clearTimeout(settleTimer);
          window.clearInterval(heartbeatTimer);
          announce("leaving");
          channel.removeEventListener("message", handleMessage);
          channel.close();
          leaderRef.current = false;
        };
      } catch {
        // Fall back to a storage lease when BroadcastChannel cannot be created.
      }
    }

    let settled = false;
    const leaderStorageKey = `${SOUND_LEADER_STORAGE_KEY}:${userId}`;
    const refreshLease = () => {
      try {
        const now = Date.now();
        const current = JSON.parse(window.localStorage.getItem(leaderStorageKey) ?? "null") as {
          tabId?: string;
          expiresAt?: number;
        } | null;
        if (!current?.tabId || Number(current.expiresAt) <= now || current.tabId === tabId) {
          window.localStorage.setItem(leaderStorageKey, JSON.stringify({ tabId, expiresAt: now + SOUND_LEADER_LEASE_MS }));
        }
        const confirmed = JSON.parse(window.localStorage.getItem(leaderStorageKey) ?? "null") as { tabId?: string } | null;
        leaderRef.current = settled && confirmed?.tabId === tabId;
      } catch {
        leaderRef.current = true;
      }
    };
    refreshLease();
    const settleTimer = window.setTimeout(() => {
      settled = true;
      refreshLease();
    }, SOUND_LEADER_SETTLE_MS);
    const leaseTimer = window.setInterval(refreshLease, Math.floor(SOUND_LEADER_LEASE_MS / 2));
    const handleStorage = (event: StorageEvent) => {
      if (event.key === leaderStorageKey) refreshLease();
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      window.clearTimeout(settleTimer);
      window.clearInterval(leaseTimer);
      window.removeEventListener("storage", handleStorage);
      leaderRef.current = false;
      try {
        const current = JSON.parse(window.localStorage.getItem(leaderStorageKey) ?? "null") as { tabId?: string } | null;
        if (current?.tabId === tabId) window.localStorage.removeItem(leaderStorageKey);
      } catch {
        // Ignore unavailable browser storage during cleanup.
      }
    };
  }, [userId]);

  useEffect(() => {
    window.clearTimeout(mergeTimerRef.current);
    mergeTimerRef.current = 0;
    pendingAlertRef.current = null;
    seenEventsRef.current.clear();
    return () => {
      window.clearTimeout(mergeTimerRef.current);
      mergeTimerRef.current = 0;
      pendingAlertRef.current = null;
      seenEventsRef.current.clear();
    };
  }, [userId]);

  return useCallback((payload: ImageJobEventPayload) => {
    const status = imageTaskTerminalSoundStatus(payload.status);
    if (!status) return;
    const eventKey = `${payload.jobId}:${payload.status}:${payload.updatedAt}`;
    if (seenEventsRef.current.has(eventKey)) return;
    seenEventsRef.current.add(eventKey);
    if (seenEventsRef.current.size > 100) {
      const oldest = seenEventsRef.current.values().next().value;
      if (oldest) seenEventsRef.current.delete(oldest);
    }
    const currentPreferences = preferencesRef.current;
    const alertsEnabled = currentPreferences.imageTaskSoundEnabled || currentPreferences.imageTaskBrowserNotificationEnabled;
    if (!alertsEnabled) return;

    pendingAlertRef.current = mergeImageTaskTerminalAlert(pendingAlertRef.current, {
      status,
      jobId: payload.jobId,
      sessionId: payload.sessionId.trim()
    });
    window.clearTimeout(mergeTimerRef.current);
    mergeTimerRef.current = window.setTimeout(() => {
      const pendingAlert = pendingAlertRef.current;
      pendingAlertRef.current = null;
      const currentPreferences = preferencesRef.current;
      const alertsEnabled = currentPreferences.imageTaskSoundEnabled || currentPreferences.imageTaskBrowserNotificationEnabled;
      if (!pendingAlert || !alertsEnabled || !leaderRef.current) return;
      if (currentPreferences.imageTaskSoundEnabled) {
        const soundId = pendingAlert.status === "failed"
          ? currentPreferences.imageTaskFailureSoundId
          : currentPreferences.imageTaskSuccessSoundId;
        const soundUrl = soundsRef.current.find((sound) => sound.id === soundId)?.url ?? "";
        playImageTaskSound(soundUrl, currentPreferences.imageTaskSoundVolume);
      }
      if (currentPreferences.imageTaskBrowserNotificationEnabled) {
        showImageTaskBrowserNotification(pendingAlert.status, browserNotificationCopyRef.current, pendingAlert.jobId, {
          onClick: pendingAlert.sessionId
            ? () => browserNotificationClickRef.current(pendingAlert.sessionId)
            : undefined
        });
      }
    }, SOUND_MERGE_DELAY_MS);
  }, []);
}
