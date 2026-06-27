import { describe, expect, it } from 'vitest';
import { getCameraTakeDuration, sampleCameraTake, sanitizeCameraTake } from './cameraTake';

describe('sampleCameraTake', () => {
  it('interpolates position and target between keyframes', () => {
    const sample = sampleCameraTake(
      [
        { time: 0, position: [0, 1, 4], target: [0, 1, 0] },
        { time: 2, position: [2, 3, 6], target: [0, 2, 0] },
      ],
      1,
    );

    expect(sample).toEqual({
      position: [1, 2, 5],
      target: [0, 1.5, 0],
    });
  });

  it('clamps outside the recorded range', () => {
    const sample = sampleCameraTake([{ time: 1, position: [1, 2, 3], target: [0, 1, 0] }], 99);

    expect(sample.position).toEqual([1, 2, 3]);
  });
});

describe('sanitizeCameraTake', () => {
  it('merges repeated or near-repeated frame times using the latest camera pose', () => {
    const sanitized = sanitizeCameraTake([
      { time: 0, position: [0, 1, 4], target: [0, 1, 0] },
      { time: 0, position: [0, 1, 3], target: [0, 1.1, 0] },
      { time: 0.0004, position: [0, 1, 2], target: [0, 1.2, 0] },
      { time: 0.05, position: [0, 1, 1], target: [0, 1.3, 0] },
    ]);

    expect(sanitized).toEqual([
      { time: 0, position: [0, 1, 2], target: [0, 1.2, 0] },
      { time: 0.05, position: [0, 1, 1], target: [0, 1.3, 0] },
    ]);
  });
});

describe('getCameraTakeDuration', () => {
  it('uses the latest recorded keyframe time instead of the timeline fallback', () => {
    expect(
      getCameraTakeDuration(
        [
          { time: 0, position: [0, 1, 4], target: [0, 1, 0] },
          { time: 1.25, position: [0, 1, 3], target: [0, 1.1, 0] },
        ],
        4,
      ),
    ).toBe(1.25);
  });

  it('falls back to timeline duration when there is no usable camera take duration', () => {
    expect(getCameraTakeDuration([], 4)).toBe(4);
    expect(getCameraTakeDuration([{ time: 0, position: [0, 1, 4], target: [0, 1, 0] }], 4)).toBe(4);
  });
});
