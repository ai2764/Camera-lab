import { describe, expect, test } from 'vitest';
import { resolveFaceFocus } from './faceFocus';

describe('resolveFaceFocus', () => {
  test('places focus near the upper face region of a subject bounds', () => {
    const focus = resolveFaceFocus({
      min: [-1, 0, -0.5],
      max: [1, 2, 0.5],
    });

    expect(focus[0]).toBeCloseTo(0);
    expect(focus[1]).toBeCloseTo(1.64);
    expect(focus[2]).toBeCloseTo(0);
  });

  test('keeps asymmetric subject center for face focus', () => {
    const focus = resolveFaceFocus({
      min: [2, 1, -3],
      max: [4, 5, 1],
    });

    expect(focus).toEqual([3, 4.28, -1]);
  });
});
