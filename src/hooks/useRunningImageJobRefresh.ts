import { useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";

type UseRunningImageJobRefreshOptions = {
  onRunningJobsSettled?: () => void;
  queryClient: QueryClient;
  runningJobCount: number;
  sessionId?: string;
};

export function useRunningImageJobRefresh({ onRunningJobsSettled, queryClient, runningJobCount, sessionId }: UseRunningImageJobRefreshOptions) {
  const hadRunningJobsRef = useRef(false);
  const currentSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const normalizedSessionId = sessionId?.trim() || null;
    if (currentSessionIdRef.current !== normalizedSessionId) {
      currentSessionIdRef.current = normalizedSessionId;
      hadRunningJobsRef.current = runningJobCount > 0;
      return;
    }
    if (runningJobCount > 0) {
      hadRunningJobsRef.current = true;
      return;
    }
    if (!hadRunningJobsRef.current || !normalizedSessionId) {
      return;
    }
    hadRunningJobsRef.current = false;
    onRunningJobsSettled?.();
    queryClient.invalidateQueries({ queryKey: ["sessions"] }, { cancelRefetch: false });
    queryClient.invalidateQueries({ queryKey: ["images"] });
    queryClient.invalidateQueries({ queryKey: ["messages", normalizedSessionId] });
  }, [onRunningJobsSettled, queryClient, runningJobCount, sessionId]);
}
