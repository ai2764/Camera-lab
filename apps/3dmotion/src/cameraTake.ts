export type Vec3Tuple = [number, number, number];

export type CameraKeyframe = {
  time: number;
  position: Vec3Tuple;
  target: Vec3Tuple;
};

export type CameraSample = {
  position: Vec3Tuple;
  target: Vec3Tuple;
};

const FRAME_TIME_EPSILON = 0.001;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpVec3(a: Vec3Tuple, b: Vec3Tuple, t: number): Vec3Tuple {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function sanitizeCameraTake(keyframes: CameraKeyframe[], epsilon = FRAME_TIME_EPSILON): CameraKeyframe[] {
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  const sanitized: CameraKeyframe[] = [];

  for (const keyframe of sorted) {
    const normalized: CameraKeyframe = {
      time: Math.max(0, keyframe.time),
      position: keyframe.position,
      target: keyframe.target,
    };
    const last = sanitized[sanitized.length - 1];
    if (last && Math.abs(normalized.time - last.time) <= epsilon) {
      sanitized[sanitized.length - 1] = { ...normalized, time: last.time };
    } else {
      sanitized.push(normalized);
    }
  }

  return sanitized;
}

export function getCameraTakeDuration(keyframes: CameraKeyframe[], fallbackDuration: number) {
  const sanitized = sanitizeCameraTake(keyframes);
  const lastTime = sanitized.reduce((maxTime, keyframe) => Math.max(maxTime, keyframe.time), 0);
  return lastTime > FRAME_TIME_EPSILON ? lastTime : Math.max(0.1, fallbackDuration);
}

export function sampleCameraTake(keyframes: CameraKeyframe[], time: number): CameraSample {
  if (keyframes.length === 0) {
    return { position: [2.6, 1.7, 3.2], target: [0, 1.1, 0] };
  }

  const sorted = sanitizeCameraTake(keyframes);
  if (time <= sorted[0].time || sorted.length === 1) {
    return { position: sorted[0].position, target: sorted[0].target };
  }

  const last = sorted[sorted.length - 1];
  if (time >= last.time) {
    return { position: last.position, target: last.target };
  }

  for (let index = 0; index < sorted.length - 1; index += 1) {
    const from = sorted[index];
    const to = sorted[index + 1];
    if (time >= from.time && time <= to.time) {
      const span = Math.max(0.0001, to.time - from.time);
      const local = (time - from.time) / span;
      return {
        position: lerpVec3(from.position, to.position, local),
        target: lerpVec3(from.target, to.target, local),
      };
    }
  }

  return { position: last.position, target: last.target };
}
