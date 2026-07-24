export type ImageTaskTerminalSoundStatus = "succeeded" | "failed";

export type ImageTaskTerminalAlert = {
  status: ImageTaskTerminalSoundStatus;
  jobId: string;
  sessionId: string;
};

export function imageTaskTerminalSoundStatus(status: string): ImageTaskTerminalSoundStatus | null {
  return status === "succeeded" || status === "failed" ? status : null;
}

export function mergeImageTaskTerminalSoundStatus(
  current: ImageTaskTerminalSoundStatus | null,
  next: ImageTaskTerminalSoundStatus
): ImageTaskTerminalSoundStatus {
  return current === "failed" || next === "failed" ? "failed" : "succeeded";
}

export function mergeImageTaskTerminalAlert(
  current: ImageTaskTerminalAlert | null,
  next: ImageTaskTerminalAlert
): ImageTaskTerminalAlert {
  const status = mergeImageTaskTerminalSoundStatus(current?.status ?? null, next.status);
  const target = !current || next.status === "failed" || current.status !== "failed" ? next : current;
  return { ...target, status };
}
