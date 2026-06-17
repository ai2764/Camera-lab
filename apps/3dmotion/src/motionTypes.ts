export type ClipName =
  | 'idle'
  | 'walk_forward'
  | 'walk_backward'
  | 'run_forward'
  | 'turn_left'
  | 'turn_right'
  | 'step_left'
  | 'step_right'
  | 'wave_right'
  | 'point_forward'
  | 'point_left'
  | 'point_right'
  | 'raise_hands'
  | 'crouch';

export type MotionClipId = ClipName | ImportedClipId;

export type TimelineAction = {
  id: string;
  clip: MotionClipId;
  start: number;
  duration: number;
  intensity: number;
};

export const clipDurations: Record<ClipName, number> = {
  idle: 1.0,
  walk_forward: 1.8,
  walk_backward: 1.4,
  run_forward: 1.2,
  turn_left: 0.9,
  turn_right: 0.9,
  step_left: 0.8,
  step_right: 0.8,
  wave_right: 1.6,
  point_forward: 1.2,
  point_left: 1.2,
  point_right: 1.2,
  raise_hands: 1.2,
  crouch: 1.1,
};
import type { ImportedClipId } from './importedClips';
