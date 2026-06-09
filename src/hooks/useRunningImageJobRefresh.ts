import { useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";

type UseRunningImageJobRefreshOptions = {
  queryClient: QueryClient;
  runningJobCount: number;
  sessionId?: string;
};

export function useRunningImageJobRefresh({ queryClient, runningJobCount, sessionId }: UseRunningImageJobRefreshOptions) {
  const hadRunningJobsRef = useRef(false);

  useEffect(() => {
    if (runningJobCount > 0) {
      hadRunningJobsRef.current = true;
      if (!sessionId) return;
      const interval = window.setInterval(() => {
        queryClient.invalidateQueries({ queryKey: ["images"] });
        queryClient.invalidateQueries({ queryKey: ["messages", sessionId] });
      }, 1200);
      return () => window.clearInterval(interval);
    }
    if (!hadRunningJobsRef.current || !sessionId) {
      return;
    }
    hadRunningJobsRef.current = false;
    queryClient.invalidateQueries({ queryKey: ["sessions"] });
    queryClient.invalidateQueries({ queryKey: ["images"] });
    queryClient.invalidateQueries({ queryKey: ["messages", sessionId] });
  }, [queryClient, runningJobCount, sessionId]);
}
