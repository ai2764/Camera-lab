import { describe, expect, it } from 'vitest';
import { waitForRecordingWarmup } from './recordingWarmup';

describe('waitForRecordingWarmup', () => {
  it('waits for the requested animation frames before resolving', async () => {
    const callbacks: FrameRequestCallback[] = [];
    const requestFrame = (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    };

    let resolved = false;
    const promise = waitForRecordingWarmup(requestFrame, 2).then(() => {
      resolved = true;
    });

    expect(callbacks).toHaveLength(1);
    callbacks.shift()?.(0);
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(callbacks).toHaveLength(1);

    callbacks.shift()?.(16);
    await promise;
    expect(resolved).toBe(true);
  });

  it('resolves immediately when no warmup frames are requested', async () => {
    await expect(waitForRecordingWarmup(() => 1, 0)).resolves.toBeUndefined();
  });
});
