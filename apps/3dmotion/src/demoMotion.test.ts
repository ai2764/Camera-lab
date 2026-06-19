import { describe, expect, it } from 'vitest';
import { makeDemoMotionTimeline } from './demoMotion';

describe('makeDemoMotionTimeline', () => {
  it('uses the first imported clip as a timeline action', () => {
    const timeline = makeDemoMotionTimeline([{ id: 'imported:walk', name: 'Walk', duration: 2.4 }]);

    expect(timeline).toEqual([{ id: expect.any(String), clip: 'imported:walk', start: 0, duration: 2.4, intensity: 1 }]);
  });

  it('prefers a stable mesh2motion idle clip over the first imported clip', () => {
    const timeline = makeDemoMotionTimeline([
      { id: 'imported:chest-open', name: 'Chest_Open', duration: 1.7 },
      { id: 'imported:idle-loop', name: 'Idle_Loop', duration: 3.1 },
      { id: 'imported:walk-loop', name: 'Walk_Loop', duration: 1.2 },
    ]);

    expect(timeline).toEqual([
      { id: expect.any(String), clip: 'imported:idle-loop', start: 0, duration: 3.1, intensity: 1 },
    ]);
  });

  it('returns an empty timeline when no imported clips exist', () => {
    expect(makeDemoMotionTimeline([])).toEqual([]);
  });
});
