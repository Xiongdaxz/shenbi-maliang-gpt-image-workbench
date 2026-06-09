import { useCallback, useEffect, useState } from "react";
import {
  APPEARANCE_STORAGE_KEY,
  applyAppearanceMode,
  clearAppearanceMode,
  normalizeAppearanceMode,
  readAppearanceMode,
  resolveAppearanceMode,
  subscribeSystemAppearance,
  writeAppearanceMode
} from "../lib/appearance";
import type { AppearanceMode, ResolvedAppearance } from "../lib/appearance";

type UseAppearanceModeOptions = {
  enabled?: boolean;
  clearOnDisable?: boolean;
  preferredMode?: AppearanceMode | null;
};

export function useAppearanceMode({ enabled = true, clearOnDisable = false, preferredMode }: UseAppearanceModeOptions = {}) {
  const [mode, setModeState] = useState<AppearanceMode>(() => readAppearanceMode());
  const [resolvedMode, setResolvedMode] = useState<ResolvedAppearance>(() => resolveAppearanceMode());

  const syncAppearance = useCallback(
    (nextMode = readAppearanceMode()) => {
      setModeState(nextMode);
      setResolvedMode(enabled ? applyAppearanceMode(nextMode) : resolveAppearanceMode(nextMode));
    },
    [enabled]
  );

  useEffect(() => {
    if (!enabled) {
      setModeState(readAppearanceMode());
      setResolvedMode(resolveAppearanceMode());
      if (clearOnDisable) clearAppearanceMode();
      return undefined;
    }

    syncAppearance();
    const unsubscribeSystem = subscribeSystemAppearance(() => {
      const nextMode = readAppearanceMode();
      if (nextMode === "system") syncAppearance(nextMode);
    });
    const handleStorage = (event: StorageEvent) => {
      if (event.key === APPEARANCE_STORAGE_KEY) syncAppearance(readAppearanceMode());
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      unsubscribeSystem();
      window.removeEventListener("storage", handleStorage);
      if (clearOnDisable) clearAppearanceMode();
    };
  }, [clearOnDisable, enabled, syncAppearance]);

  useEffect(() => {
    if (!enabled || !preferredMode) return;
    const nextMode = normalizeAppearanceMode(preferredMode);
    writeAppearanceMode(nextMode);
    syncAppearance(nextMode);
  }, [enabled, preferredMode, syncAppearance]);

  const setMode = useCallback(
    (nextMode: AppearanceMode) => {
      writeAppearanceMode(nextMode);
      setModeState(nextMode);
      setResolvedMode(enabled ? applyAppearanceMode(nextMode) : resolveAppearanceMode(nextMode));
    },
    [enabled]
  );

  return { mode, resolvedMode, setMode };
}
