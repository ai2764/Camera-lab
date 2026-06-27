const maxFrameDelta = 1 / 20;

export function resolveStageDelta(rawDelta: number, _exporting: boolean) {
  return Math.min(rawDelta, maxFrameDelta);
}

export function makeExportFrameTimes(duration: number, fps: number) {
  const safeDuration = Math.max(0, duration);
  const safeFps = Math.max(1, Math.round(fps));
  const step = 1 / safeFps;
  const frameCount = Math.max(1, Math.ceil(safeDuration * safeFps));
  const times = Array.from({ length: frameCount }, (_, index) => Number((index * step).toFixed(6)));
  const last = times[times.length - 1];
  if (safeDuration > 0 && Math.abs(last - safeDuration) > 0.000001) {
    times.push(Number(safeDuration.toFixed(6)));
  }
  return times;
}

export function advanceRecordingElapsed(elapsed: number, deltaSeconds: number) {
  return Math.max(0, elapsed) + Math.max(0, deltaSeconds);
}

export function resolveTimelinePlayhead(recordingTime: number, timelineDuration: number, loop: boolean) {
  const safeTime = Math.max(0, recordingTime);
  const safeDuration = Math.max(0, timelineDuration);
  if (!loop || safeDuration <= 0.000001) return safeTime;
  return safeTime % safeDuration;
}
