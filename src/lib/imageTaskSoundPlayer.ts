import { normalizeImageTaskSoundVolume } from "./imageTaskSounds";

type PlaybackEndReason = "ended" | "stopped" | "error";
type PlaybackEndHandler = (reason: PlaybackEndReason) => void;

type ActivePlayback = {
  audio: HTMLAudioElement;
  finish: (reason: PlaybackEndReason) => void;
};

let activePlayback: ActivePlayback | null = null;

export function stopImageTaskSoundPlayback() {
  activePlayback?.finish("stopped");
}

export function setImageTaskSoundPlaybackVolume(volume: number) {
  if (activePlayback) activePlayback.audio.volume = normalizeImageTaskSoundVolume(volume) / 100;
}

export function playImageTaskSound(soundUrl: string, volume: number, onEnd?: PlaybackEndHandler) {
  if (typeof window === "undefined" || typeof window.Audio !== "function") return false;
  if (!soundUrl.trim()) return false;

  stopImageTaskSoundPlayback();
  const audio = new window.Audio(soundUrl);
  audio.preload = "auto";
  audio.volume = normalizeImageTaskSoundVolume(volume) / 100;
  let finished = false;
  const finish = (reason: PlaybackEndReason) => {
    if (finished) return;
    finished = true;
    audio.removeEventListener("ended", handleEnded);
    audio.removeEventListener("error", handleError);
    if (reason === "stopped") {
      audio.pause();
      audio.currentTime = 0;
    }
    if (activePlayback?.audio === audio) activePlayback = null;
    onEnd?.(reason);
  };
  const handleEnded = () => finish("ended");
  const handleError = () => finish("error");
  activePlayback = { audio, finish };
  audio.addEventListener("ended", handleEnded, { once: true });
  audio.addEventListener("error", handleError, { once: true });
  void audio.play().catch(() => finish("error"));
  return true;
}
