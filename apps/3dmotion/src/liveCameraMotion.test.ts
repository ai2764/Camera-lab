import { describe, expect, test } from 'vitest';
import { applyLiveCameraMotion, applyLiveCameraMotions, type LiveCameraMotionState } from './liveCameraMotion';

describe('applyLiveCameraMotion', () => {
  test('applies zoom motion continuously using elapsed seconds', () => {
    const state: LiveCameraMotionState = {
      position: [2, 1, 0],
      target: [0, 1, 0],
    };

    applyLiveCameraMotion(state, 'zoom_in', 1);
    const afterOneSecond = Math.hypot(state.position[0], state.position[2]);
    applyLiveCameraMotion(state, 'zoom_in', 1);

    expect(afterOneSecond).toBeLessThan(2);
    expect(Math.hypot(state.position[0], state.position[2])).toBeLessThan(afterOneSecond);
  });

  test('keeps zoom-in distance monotonic across repeated small frame steps', () => {
    const state: LiveCameraMotionState = {
      position: [3, 2, 0],
      target: [0, 1, 0],
    };
    const distances: number[] = [];

    for (let i = 0; i < 12; i += 1) {
      applyLiveCameraMotion(state, 'zoom_in', 1 / 60);
      distances.push(Math.hypot(state.position[0], state.position[1] - state.target[1], state.position[2]));
    }

    for (let i = 1; i < distances.length; i += 1) {
      expect(distances[i]).toBeLessThanOrEqual(distances[i - 1]);
    }
  });

  test('applies orbit motion continuously while preserving radius and target', () => {
    const state: LiveCameraMotionState = {
      position: [2, 1, 0],
      target: [0, 1, 0],
    };

    applyLiveCameraMotion(state, 'orbit_left', 1);

    expect(Math.hypot(state.position[0], state.position[2])).toBeCloseTo(2);
    expect(state.position[2]).toBeGreaterThan(0);
    expect(state.target).toEqual([0, 1, 0]);
  });

  test('stacks zoom and orbit motion in the same frame', () => {
    const state: LiveCameraMotionState = {
      position: [2, 1, 0],
      target: [0, 1, 0],
    };

    applyLiveCameraMotions(state, ['zoom_in', 'orbit_right'], 1);

    expect(Math.hypot(state.position[0], state.position[2])).toBeLessThan(2);
    expect(state.position[2]).toBeLessThan(0);
  });
});
