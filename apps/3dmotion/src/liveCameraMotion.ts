import type { Vec3Tuple } from './cameraTake';
import type { CameraPreset } from './cameraPresets';

export type LiveCameraMotionState = {
  position: Vec3Tuple;
  target: Vec3Tuple;
};

const zoomRatePerSecond = 0.28;
const minDistance = 0.55;
const maxDistance = 12;
const orbitRadiansPerSecond = Math.PI / 8;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function applyLiveCameraMotion(state: LiveCameraMotionState, preset: CameraPreset, deltaSeconds: number) {
  const dx = state.position[0] - state.target[0];
  const dy = state.position[1] - state.target[1];
  const dz = state.position[2] - state.target[2];

  if (preset === 'zoom_in' || preset === 'zoom_out') {
    const distance = Math.max(0.001, Math.hypot(dx, dy, dz));
    const direction = preset === 'zoom_in' ? -1 : 1;
    const nextDistance = clamp(distance * (1 + direction * zoomRatePerSecond * deltaSeconds), minDistance, maxDistance);
    const factor = nextDistance / distance;
    state.position = [
      state.target[0] + dx * factor,
      state.target[1] + dy * factor,
      state.target[2] + dz * factor,
    ];
    return;
  }

  const direction = preset === 'orbit_left' ? 1 : -1;
  const angle = direction * orbitRadiansPerSecond * deltaSeconds;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  state.position = [
    state.target[0] + dx * cos - dz * sin,
    state.position[1],
    state.target[2] + dx * sin + dz * cos,
  ];
}

export function applyLiveCameraMotions(state: LiveCameraMotionState, presets: CameraPreset[], deltaSeconds: number) {
  for (const preset of presets) {
    applyLiveCameraMotion(state, preset, deltaSeconds);
  }
}
