import { describe, expect, it } from 'vitest';
import { getRecordTakeControl } from './takeControls';

describe('getRecordTakeControl', () => {
  it('starts a unified take when idle', () => {
    expect(getRecordTakeControl({ isRecordingTake: false, isExporting: false })).toEqual({
      icon: 'video',
      label: 'Record Take',
      disabled: false,
    });
  });

  it('stops and renders a unified take while recording', () => {
    expect(getRecordTakeControl({ isRecordingTake: true, isExporting: false })).toEqual({
      icon: 'square',
      label: 'Stop & Render',
      disabled: false,
    });
  });

  it('prevents duplicate take work while rendering', () => {
    expect(getRecordTakeControl({ isRecordingTake: false, isExporting: true })).toEqual({
      icon: 'square',
      label: 'Rendering',
      disabled: true,
    });
  });
});
