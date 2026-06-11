export const RENDERING_MOTION_PAUSE_EVENT = "gpt-image:pause-rendering-motion";

let renderingMotionResumeTimer = 0;
let renderingMotionPauseUntil = 0;

export function getRenderingMotionPauseUntil() {
  if (typeof performance === "undefined") return 0;
  return renderingMotionPauseUntil > performance.now() ? renderingMotionPauseUntil : 0;
}

export function pauseRenderingMotion(durationMs = 800) {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") return;
  const now = performance.now();
  const until = now + durationMs;
  renderingMotionPauseUntil = Math.max(renderingMotionPauseUntil, until);
  document.documentElement.dataset.renderingMotionPaused = "true";
  window.clearTimeout(renderingMotionResumeTimer);
  renderingMotionResumeTimer = window.setTimeout(() => {
    if (performance.now() >= renderingMotionPauseUntil - 1) {
      delete document.documentElement.dataset.renderingMotionPaused;
    }
  }, Math.max(0, renderingMotionPauseUntil - now));
  window.dispatchEvent(
    new CustomEvent<{ until: number }>(RENDERING_MOTION_PAUSE_EVENT, {
      detail: { until: renderingMotionPauseUntil }
    })
  );
}
