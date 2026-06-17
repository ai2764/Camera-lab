import { describe, expect, it } from 'vitest';
import { buildScailPrompt, makeScailFrameCount } from './scailWorkflow';

describe('makeScailFrameCount', () => {
  it('rounds a duration to the SCAIL 4n+1 frame count at 24fps', () => {
    expect(makeScailFrameCount(5.04, 24)).toBe(121);
  });

  it('keeps a minimum short clip valid for SCAIL', () => {
    expect(makeScailFrameCount(0.1, 24)).toBe(5);
  });
});

describe('buildScailPrompt', () => {
  it('injects uploaded media and output settings into the SCAIL2 workflow', () => {
    const prompt = buildScailPrompt({
      referenceImage: '3dmotion-scail/ref.png',
      driveVideo: '3dmotion-scail/drive.webm',
      positivePrompt: 'pirate motion',
      negativePrompt: 'bad',
      width: 320,
      height: 576,
      fps: 24,
      frameCount: 121,
      seed: 42,
      steps: 12,
      poseStrength: 0.72,
      outputPrefix: 'scail/3dmotion_test',
    });

    expect(prompt['5'].inputs.text).toBe('pirate motion');
    expect(prompt['6'].inputs.text).toBe('bad');
    expect(prompt['9'].inputs.image).toBe('3dmotion-scail/ref.png');
    expect(prompt['11'].inputs.file).toBe('3dmotion-scail/drive.webm');
    expect(prompt['13'].inputs.width).toBe(320);
    expect(prompt['13'].inputs.height).toBe(576);
    expect(prompt['13'].inputs.length).toBe(121);
    expect(prompt['13'].inputs.pose_strength).toBe(0.72);
    expect(prompt['14'].inputs.seed).toBe(42);
    expect(prompt['14'].inputs.steps).toBe(12);
    expect(prompt['16'].inputs.fps).toBe(24);
    expect(prompt['17'].inputs.filename_prefix).toBe('scail/3dmotion_test');
  });
});
