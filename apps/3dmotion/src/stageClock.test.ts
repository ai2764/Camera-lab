import { describe, expect, test } from 'vitest';
import { advanceRecordingElapsed, makeExportFrameTimes, resolveStageDelta, resolveTimelinePlayhead } from './stageClock';

describe('resolveStageDelta', () => {
  test('uses wall-clock delta during export so recorded video duration is not compressed', () => {
    expect(resolveStageDelta(1 / 60, true)).toBeCloseTo(1 / 60);
  });

  test('caps long foreground gaps without changing normal frame timing', () => {
    expect(resolveStageDelta(1 / 60, false)).toBeCloseTo(1 / 60);
    expect(resolveStageDelta(1, false)).toBeCloseTo(1 / 20);
  });

  test('makes fixed export frame times from zero through duration', () => {
    expect(makeExportFrameTimes(0.1, 10)).toEqual([0, 0.1]);
    expect(makeExportFrameTimes(0.25, 10)).toEqual([0, 0.1, 0.2, 0.25]);
  });

  test('keeps recording time monotonic even when the animation playhead loops', () => {
    expect(advanceRecordingElapsed(3.1, 1 / 24)).toBeCloseTo(3.141666, 5);
  });

  test('loops timeline playback for export without looping camera recording time', () => {
    expect(resolveTimelinePlayhead(3.25, 3, true)).toBeCloseTo(0.25);
    expect(resolveTimelinePlayhead(3.25, 3, false)).toBeCloseTo(3.25);
  });
});
