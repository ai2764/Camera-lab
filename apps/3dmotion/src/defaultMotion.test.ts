import { describe, expect, it } from 'vitest';
import { makeDefaultIdleTimeline } from './defaultMotion';

describe('makeDefaultIdleTimeline', () => {
  it('starts with a single idle action only', () => {
    expect(makeDefaultIdleTimeline()).toEqual([
      { id: expect.any(String), clip: 'idle', start: 0, duration: 2, intensity: 1 },
    ]);
  });
});
