export function waitForRecordingWarmup(
  requestFrame: (callback: FrameRequestCallback) => number = requestAnimationFrame,
  frameCount = 2,
) {
  const frames = Math.max(0, Math.floor(frameCount));
  if (frames === 0) return Promise.resolve();

  return new Promise<void>((resolve) => {
    let remaining = frames;
    const tick: FrameRequestCallback = () => {
      remaining -= 1;
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestFrame(tick);
    };
    requestFrame(tick);
  });
}
