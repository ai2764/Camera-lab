import type { TimelineAction } from './motionTypes';
import { isImportedClipId, type ImportedClipId } from './importedClips';

function getTimelineEnd(timeline: TimelineAction[]) {
  return Math.max(0, ...timeline.map((item) => item.start + item.duration));
}

function isIdleClip(clip: TimelineAction['clip']) {
  return clip === 'idle' || clip.toLowerCase().includes('idle');
}

function makeContiguous(timeline: TimelineAction[]) {
  let nextStart = 0;
  return timeline.map((action) => {
    const updated = { ...action, start: nextStart };
    nextStart += action.duration;
    return updated;
  });
}

export function appendTimelineAction(
  timeline: TimelineAction[],
  clip: TimelineAction['clip'],
  duration: number,
  id: string,
): TimelineAction[] {
  const nextAction = { id, clip, start: 0, duration, intensity: 1 };
  const shouldReplaceStarterIdle = timeline.length === 1 && isIdleClip(timeline[0].clip) && !isIdleClip(clip);

  if (shouldReplaceStarterIdle) return [nextAction];

  return [...timeline, { ...nextAction, start: getTimelineEnd(timeline) }];
}

export function removeTimelineAction(timeline: TimelineAction[], id: string): TimelineAction[] {
  return makeContiguous(timeline.filter((action) => action.id !== id));
}

export function findActiveImportedTimelineAction(
  timeline: TimelineAction[],
  time: number,
): { action: TimelineAction & { clip: ImportedClipId }; localTime: number } | null {
  const action = timeline.find(
    (item) => isImportedClipId(item.clip) && time >= item.start && time < item.start + item.duration,
  );
  if (!action || !isImportedClipId(action.clip)) return null;
  return { action: { ...action, clip: action.clip }, localTime: Number((time - action.start).toFixed(6)) };
}

export function updateTimelineActionDuration(timeline: TimelineAction[], id: string, duration: number): TimelineAction[] {
  return makeContiguous(timeline.map((action) => {
    const nextDuration = action.id === id ? Math.max(0.1, duration) : action.duration;
    return { ...action, duration: nextDuration };
  }));
}
