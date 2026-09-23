import { compareSemver, normalizeSemver } from "./semver";

export const APP_UPDATE_PENDING_STORAGE_KEY = "gpt-image.app-update.pending-version";
export const APP_UPDATE_PULL_DURATION_MS = 760;
export const APP_UPDATE_RETRACT_DURATION_MS = 520;
export const APP_UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;

export type AppUpdateReminderStage = "hidden" | "mascot" | "pulling" | "card" | "retracting";

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem" | "removeItem">;

function safeStorageRead(storage: StorageReader | null | undefined, key: string) {
  try {
    return storage?.getItem(key)?.trim() ?? "";
  } catch {
    return "";
  }
}

function safeStorageWrite(storage: StorageWriter | null | undefined, key: string, value: string) {
  try {
    storage?.setItem(key, value);
  } catch {
    // The reminder can remain in memory when browser storage is unavailable.
  }
}

export function shouldPresentAppUpdate(updateAvailable: boolean, serverVersion: unknown) {
  if (!updateAvailable) return false;
  return Boolean(normalizeSemver(serverVersion));
}

export function markAppUpdateRefreshPending(storage: StorageWriter | null | undefined, version: unknown) {
  const normalized = normalizeSemver(version);
  if (normalized) safeStorageWrite(storage, APP_UPDATE_PENDING_STORAGE_KEY, normalized);
}

export function consumeCompletedAppUpdate(storage: StorageReader & StorageWriter, clientVersion: unknown) {
  const pending = normalizeSemver(safeStorageRead(storage, APP_UPDATE_PENDING_STORAGE_KEY));
  const current = normalizeSemver(clientVersion);
  if (!pending || !current) return null;
  const comparison = compareSemver(current, pending);
  if (comparison === null || comparison < 0) return null;
  try {
    storage.removeItem(APP_UPDATE_PENDING_STORAGE_KEY);
  } catch {
    // A duplicate success toast is preferable to losing the update state.
  }
  return pending;
}
