import { makeId } from './id';
import type { TimelineAction } from './motionTypes';

export function makeDefaultIdleTimeline(): TimelineAction[] {
  return [{ id: makeId(), clip: 'idle', start: 0, duration: 2, intensity: 1 }];
}
