import { useCallback, useEffect, useState } from "react";

export const GUIDE_KEYS = {
  appIntro: "gpt-image.guide.appIntro.v2",
  chatComposer: "gpt-image.guide.chatComposer.v2",
  editorTopbar: "gpt-image.guide.editorTopbar.v2"
} as const;

function readGuideSeen(guideKey: string) {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(guideKey) === "seen";
  } catch {
    return false;
  }
}

function writeGuideSeen(guideKey: string, seen: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (seen) {
      window.localStorage.setItem(guideKey, "seen");
      return;
    }
    window.localStorage.removeItem(guideKey);
  } catch {
    // Local storage can be unavailable in restricted browser modes; keep the UI usable.
  }
}

export function useGuideSeen(guideKey: string) {
  const [seen, setSeen] = useState(() => readGuideSeen(guideKey));

  useEffect(() => {
    setSeen(readGuideSeen(guideKey));
  }, [guideKey]);

  const markSeen = useCallback(() => {
    writeGuideSeen(guideKey, true);
    setSeen(true);
  }, [guideKey]);

  const resetGuide = useCallback(() => {
    writeGuideSeen(guideKey, false);
    setSeen(false);
  }, [guideKey]);

  return { markSeen, resetGuide, seen };
}
