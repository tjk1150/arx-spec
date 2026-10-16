import type { Mat4, Quat, Transform, Vec2, Vec3 } from "./types";

/** Absolute deviation of |q| from 1. */
export const quatNormDeviation = (q: Quat): number => Math.abs(Math.hypot(...q) - 1);

export const normalizeQuat = (q: Quat): Quat => {
  const length = Math.hypot(...q);
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
};

/**
 * M = T * R * S, column-major (glTF convention). A vertex is scaled first,
 * then rotated, then translated.
 */
export const composeTrs = ({ position, rotation, scale }: Transform): Mat4 => {
  const [x, y, z, w] = rotation;
  const [sx, sy, sz] = scale;
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    position[0],
    position[1],
    position[2],
    1,
  ];
};

export const transformPoint = (matrix: Mat4, point: Vec3): Vec3 => {
  const [x, y, z] = point;
  const at = (index: number) => matrix[index] ?? 0;
  return [
    at(0) * x + at(4) * y + at(8) * z + at(12),
    at(1) * x + at(5) * y + at(9) * z + at(13),
    at(2) * x + at(6) * y + at(10) * z + at(14),
  ];
};

/**
 * Identity-scale size of a target or 2D layer in target-width units: the
 * width is always 1 and the height follows the media aspect ratio.
 */
export const layerSize = (pixelSize: Vec2): Vec2 => [1, pixelSize[1] / pixelSize[0]];
