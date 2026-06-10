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

  useEffect(() => {
    if (runningJobCount > 0) {
      hadRunningJobsRef.current = true;
      return;
    }
    if (!hadRunningJobsRef.current || !sessionId) {
      return;
    }
    hadRunningJobsRef.current = false;
    onRunningJobsSettled?.();
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
    queryClient.invalidateQueries({ queryKey: ["images"] });
    queryClient.invalidateQueries({ queryKey: ["messages", sessionId] });
  }, [onRunningJobsSettled, queryClient, runningJobCount, sessionId]);
}
