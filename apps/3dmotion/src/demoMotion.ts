import { makeId } from './id';
import type { ImportedClipId } from './importedClips';
import type { TimelineAction } from './motionTypes';

export type DemoClipMeta = {
  id: ImportedClipId;
  name: string;
  duration: number;
};

const preferredStarterClips = [
  'Idle_Loop',
  'Walk_Loop',
  'Jog_Fwd_Loop',
  'Greeting',
  'Victory',
  'Rest Pose',
];

function normalizeClipName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function findStarterClip(clips: DemoClipMeta[]) {
  for (const preferred of preferredStarterClips) {
    const normalized = normalizeClipName(preferred);
    const match = clips.find((clip) => normalizeClipName(clip.name) === normalized);
    if (match) return match;
  }
  return clips[0];
}

export function makeDemoMotionTimeline(clips: DemoClipMeta[]): TimelineAction[] {
  const first = findStarterClip(clips);
  if (!first) return [];
  return [
    {
      id: makeId(),
      clip: first.id,
      start: 0,
      duration: Math.max(0.5, first.duration),
      intensity: 1,
    },
  ];
}
