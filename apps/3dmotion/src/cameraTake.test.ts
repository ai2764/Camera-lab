import { describe, expect, it } from 'vitest';
import { sampleCameraTake } from './cameraTake';

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
