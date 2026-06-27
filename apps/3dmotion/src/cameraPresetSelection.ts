import type { CameraPreset } from './cameraPresets';

export type ActiveCameraPresets = CameraPreset[];

const presetGroups: Record<CameraPreset, CameraPreset[]> = {
  zoom_in: ['zoom_in', 'zoom_out'],
  zoom_out: ['zoom_in', 'zoom_out'],
  orbit_left: ['orbit_left', 'orbit_right'],
  orbit_right: ['orbit_left', 'orbit_right'],
};

export function toggleCameraPreset(active: ActiveCameraPresets, preset: CameraPreset): ActiveCameraPresets {
  if (active.includes(preset)) return active.filter((item) => item !== preset);
  const group = new Set(presetGroups[preset]);
  return [...active.filter((item) => !group.has(item)), preset];
}
