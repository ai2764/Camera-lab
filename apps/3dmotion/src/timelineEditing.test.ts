import { describe, expect, it } from 'vitest';
import {
  appendTimelineAction,
  findActiveImportedTimelineAction,
  removeTimelineAction,
  updateTimelineActionDuration,
} from './timelineEditing';

describe('updateTimelineActionDuration', () => {
  it('updates the selected action duration and keeps following actions contiguous', () => {
    const timeline = updateTimelineActionDuration(
      [
        { id: 'a', clip: 'idle', start: 0, duration: 1, intensity: 1 },
        { id: 'b', clip: 'walk_forward', start: 1, duration: 2, intensity: 1 },
        { id: 'c', clip: 'wave_right', start: 3, duration: 1.5, intensity: 1 },
      ],
      'b',
      3,
    );

    expect(timeline).toEqual([
      { id: 'a', clip: 'idle', start: 0, duration: 1, intensity: 1 },
      { id: 'b', clip: 'walk_forward', start: 1, duration: 3, intensity: 1 },
      { id: 'c', clip: 'wave_right', start: 4, duration: 1.5, intensity: 1 },
    ]);
  });

  it('clamps tiny durations to a usable minimum', () => {
    const timeline = updateTimelineActionDuration(
      [{ id: 'a', clip: 'idle', start: 0, duration: 1, intensity: 1 }],
      'a',
      0,
    );

    expect(timeline[0].duration).toBe(0.1);
  });
});

describe('appendTimelineAction', () => {
  it('replaces a starter idle when the first selected action is not idle', () => {
    const timeline = appendTimelineAction(
      [{ id: 'idle-1', clip: 'imported:idle-loop', start: 0, duration: 3.13, intensity: 1 }],
      'imported:walk-loop',
      1.8,
      'new-action',
    );

    expect(timeline).toEqual([{ id: 'new-action', clip: 'imported:walk-loop', start: 0, duration: 1.8, intensity: 1 }]);
  });

  it('appends after real actions are already on the timeline', () => {
    const timeline = appendTimelineAction(
      [{ id: 'walk-1', clip: 'imported:walk-loop', start: 0, duration: 1.8, intensity: 1 }],
      'imported:greeting',
      2.2,
      'greeting-1',
    );

    expect(timeline).toEqual([
      { id: 'walk-1', clip: 'imported:walk-loop', start: 0, duration: 1.8, intensity: 1 },
      { id: 'greeting-1', clip: 'imported:greeting', start: 1.8, duration: 2.2, intensity: 1 },
    ]);
  });
});

describe('findActiveImportedTimelineAction', () => {
  it('returns the imported clip and local time for the active segment', () => {
    const active = findActiveImportedTimelineAction(
      [
        { id: 'walk-1', clip: 'imported:walk-loop', start: 0, duration: 1.8, intensity: 1 },
        { id: 'dance-1', clip: 'imported:dance-loop', start: 1.8, duration: 1.25, intensity: 1 },
      ],
      2.3,
    );

    expect(active).toEqual({
      action: { id: 'dance-1', clip: 'imported:dance-loop', start: 1.8, duration: 1.25, intensity: 1 },
      localTime: 0.5,
    });
  });
});

describe('removeTimelineAction', () => {
  it('removes the selected action and keeps remaining actions contiguous', () => {
    const timeline = removeTimelineAction(
      [
        { id: 'a', clip: 'imported:walk-loop', start: 0, duration: 1.8, intensity: 1 },
        { id: 'b', clip: 'imported:dance-loop', start: 1.8, duration: 1.25, intensity: 1 },
        { id: 'c', clip: 'imported:greeting', start: 3.05, duration: 2.2, intensity: 1 },
      ],
      'b',
    );

    expect(timeline).toEqual([
      { id: 'a', clip: 'imported:walk-loop', start: 0, duration: 1.8, intensity: 1 },
      { id: 'c', clip: 'imported:greeting', start: 1.8, duration: 2.2, intensity: 1 },
    ]);
  });
});
