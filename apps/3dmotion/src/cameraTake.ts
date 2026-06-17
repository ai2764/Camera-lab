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

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function lerpVec3(a: Vec3Tuple, b: Vec3Tuple, t: number): Vec3Tuple {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function sampleCameraTake(keyframes: CameraKeyframe[], time: number): CameraSample {
  if (keyframes.length === 0) {
    return { position: [2.6, 1.7, 3.2], target: [0, 1.1, 0] };
  }

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
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
