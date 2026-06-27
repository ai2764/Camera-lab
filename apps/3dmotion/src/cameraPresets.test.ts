import { describe, expect, test } from 'vitest';
import { makeCameraPresetTake } from './cameraPresets';
import { sampleCameraTake } from './cameraTake';

const start = {
  time: 0,
  position: [2, 1, 0] as [number, number, number],
  target: [0, 1, 0] as [number, number, number],
};

function horizontalDistance(position: [number, number, number]) {
  return Math.hypot(position[0] - start.target[0], position[2] - start.target[2]);
}

describe('makeCameraPresetTake', () => {
  test('makes uniform zoom presets from the current camera position', () => {
    const zoomIn = makeCameraPresetTake('zoom_in', start, 4);
    const zoomOut = makeCameraPresetTake('zoom_out', start, 4);

    expect(zoomIn[0]).toEqual(start);
    expect(horizontalDistance(zoomIn[zoomIn.length - 1].position)).toBeLessThan(horizontalDistance(start.position));
    expect(horizontalDistance(zoomOut[zoomOut.length - 1].position)).toBeGreaterThan(horizontalDistance(start.position));

    const midpoint = sampleCameraTake(zoomIn, 2);
    expect(horizontalDistance(midpoint.position)).toBeCloseTo(
      (horizontalDistance(start.position) + horizontalDistance(zoomIn[zoomIn.length - 1].position)) / 2,
    );
  });

  test('makes constant-speed orbit presets that preserve camera radius and target', () => {
    const orbitLeft = makeCameraPresetTake('orbit_left', start, 4);
    const orbitRight = makeCameraPresetTake('orbit_right', start, 4);
    const leftEnd = orbitLeft[orbitLeft.length - 1].position;
    const rightEnd = orbitRight[orbitRight.length - 1].position;

    expect(horizontalDistance(leftEnd)).toBeCloseTo(horizontalDistance(start.position));
    expect(horizontalDistance(rightEnd)).toBeCloseTo(horizontalDistance(start.position));
    expect(leftEnd[2]).toBeCloseTo(-rightEnd[2]);
    expect(orbitLeft.every((frame) => frame.target === start.target || frame.target.every((value, index) => value === start.target[index]))).toBe(true);
  });
});
