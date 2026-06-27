import { describe, expect, test } from 'vitest';
import { toggleCameraPreset } from './cameraPresetSelection';

describe('toggleCameraPreset', () => {
  test('stacks zoom and orbit presets', () => {
    expect(toggleCameraPreset(['zoom_in'], 'orbit_right')).toEqual(['zoom_in', 'orbit_right']);
  });

  test('keeps opposite presets mutually exclusive', () => {
    expect(toggleCameraPreset(['zoom_in', 'orbit_left'], 'zoom_out')).toEqual(['orbit_left', 'zoom_out']);
    expect(toggleCameraPreset(['zoom_in', 'orbit_left'], 'orbit_right')).toEqual(['zoom_in', 'orbit_right']);
  });

  test('clicking an active preset removes it', () => {
    expect(toggleCameraPreset(['zoom_in', 'orbit_right'], 'zoom_in')).toEqual(['orbit_right']);
  });
});
