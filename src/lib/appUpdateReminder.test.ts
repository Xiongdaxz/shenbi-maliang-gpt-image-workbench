import { describe, expect, test } from "bun:test";
import {
  APP_UPDATE_PENDING_STORAGE_KEY,
  consumeCompletedAppUpdate,
  markAppUpdateRefreshPending,
  shouldPresentAppUpdate
} from "./appUpdateReminder";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  };
}

describe("app update reminder state", () => {
  test("keeps every valid update available until the client refreshes", () => {
    expect(shouldPresentAppUpdate(true, "0.1.79")).toBe(true);
    expect(shouldPresentAppUpdate(true, "0.1.80")).toBe(true);
  });

  test("keeps refresh pending until the client reaches the target", () => {
    const storage = memoryStorage();
    markAppUpdateRefreshPending(storage, "0.1.79");
    expect(storage.getItem(APP_UPDATE_PENDING_STORAGE_KEY)).toBe("0.1.79");
    expect(consumeCompletedAppUpdate(storage, "0.1.78")).toBeNull();
    expect(consumeCompletedAppUpdate(storage, "0.1.79")).toBe("0.1.79");
    expect(storage.getItem(APP_UPDATE_PENDING_STORAGE_KEY)).toBeNull();
  });

  test("does not present invalid or unavailable updates", () => {
    expect(shouldPresentAppUpdate(false, "0.1.79")).toBe(false);
    expect(shouldPresentAppUpdate(true, "development")).toBe(false);
  });
});
