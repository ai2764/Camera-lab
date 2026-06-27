import type { Vec3Tuple } from './cameraTake';

export type SubjectBounds = {
  min: Vec3Tuple;
  max: Vec3Tuple;
};

const faceDropFromTop = 0.18;

export function resolveFaceFocus(bounds: SubjectBounds): Vec3Tuple {
  const height = Math.max(0, bounds.max[1] - bounds.min[1]);
  return [
    (bounds.min[0] + bounds.max[0]) / 2,
    bounds.max[1] - height * faceDropFromTop,
    (bounds.min[2] + bounds.max[2]) / 2,
  ];
}
