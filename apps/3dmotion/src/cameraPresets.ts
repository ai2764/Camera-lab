import type { CameraKeyframe, Vec3Tuple } from './cameraTake';

export type CameraPreset = 'zoom_in' | 'zoom_out' | 'orbit_left' | 'orbit_right';

const presetFps = 24;
const zoomInScale = 0.62;
const zoomOutScale = 1.38;
const orbitAngle = Math.PI / 3;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function makeZoomFrame(start: CameraKeyframe, time: number, progress: number, scale: number): CameraKeyframe {
  const factor = lerp(1, scale, progress);
  return {
    time,
    position: [
      start.target[0] + (start.position[0] - start.target[0]) * factor,
      start.target[1] + (start.position[1] - start.target[1]) * factor,
      start.target[2] + (start.position[2] - start.target[2]) * factor,
    ],
    target: [...start.target] as Vec3Tuple,
  };
}

function makeOrbitFrame(start: CameraKeyframe, time: number, progress: number, direction: 1 | -1): CameraKeyframe {
  const dx = start.position[0] - start.target[0];
  const dz = start.position[2] - start.target[2];
  const angle = direction * orbitAngle * progress;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    time,
    position: [
      start.target[0] + dx * cos - dz * sin,
      start.position[1],
      start.target[2] + dx * sin + dz * cos,
    ],
    target: [...start.target] as Vec3Tuple,
  };
}

export function makeCameraPresetTake(preset: CameraPreset, start: CameraKeyframe, duration: number): CameraKeyframe[] {
  const safeDuration = Math.max(0.1, duration);
  const frameCount = Math.max(2, Math.ceil(safeDuration * presetFps) + 1);
  return Array.from({ length: frameCount }, (_, index) => {
    const progress = index / (frameCount - 1);
    const time = safeDuration * progress;
    if (preset === 'zoom_in') return makeZoomFrame(start, time, progress, zoomInScale);
    if (preset === 'zoom_out') return makeZoomFrame(start, time, progress, zoomOutScale);
    return makeOrbitFrame(start, time, progress, preset === 'orbit_left' ? 1 : -1);
  });
}
