import { describe, expect, it } from "vitest";
import {
  composeTrs,
  layerSize,
  normalizeQuat,
  quatNormDeviation,
  transformPoint,
} from "../src/math";
import { toArCore, toArFoundation } from "../src/basis";
import type { Mat4, Quat, Transform, Vec3 } from "../src/types";

const H = Math.SQRT1_2;

const multiply = (left: Mat4, right: Mat4): number[] => {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += left[k * 4 + row]! * right[column * 4 + k]!;
      out[column * 4 + row] = sum;
    }
  }
  return out;
};

/** Column-major basis matrix from the images of the ARX unit axes. */
const basis = (xAxis: Vec3, yAxis: Vec3, zAxis: Vec3): number[] => [
  ...xAxis, 0, ...yAxis, 0, ...zAxis, 0, 0, 0, 0, 1,
];

// ARX (x, y, z) -> AR Foundation tracked image (x, z, y); a reflection.
const AR_FOUNDATION = basis([1, 0, 0], [0, 0, 1], [0, 1, 0]);
// ARX (x, y, z) -> ARCore augmented image (x, z, -y); a proper rotation.
const ARCORE = basis([1, 0, 0], [0, 0, -1], [0, 1, 0]);
const ARCORE_INVERSE = basis([1, 0, 0], [0, 0, 1], [0, -1, 0]);

const expectMatrix = (actual: Mat4, expected: Mat4) => {
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, 9));
};

const randomTransform = (random: () => number): Transform => {
  const axis: Vec3 = [random() - 0.5, random() - 0.5, random() - 0.5];
  const length = Math.hypot(...axis);
  const angle = random() * Math.PI * 2;
  const sin = Math.sin(angle / 2);
  return {
    position: [random() - 0.5, random() - 0.5, random() * 0.1],
    rotation: [
      (axis[0] / length) * sin,
      (axis[1] / length) * sin,
      (axis[2] / length) * sin,
      Math.cos(angle / 2),
    ],
    scale: [0.1 + random(), 0.1 + random(), 0.1 + random()],
  };
};

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

describe("composeTrs", () => {
  it("applies scale, then rotation, then translation to a point", () => {
    const matrix = composeTrs({
      position: [0.1, 0.2, 0.3],
      rotation: [0, 0, H, H],
      scale: [0.5, 0.25, 1],
    });
    // (1, 0, 0) -> scale (0.5, 0, 0) -> rotate +90 about Z (0, 0.5, 0) -> translate.
    const point = transformPoint(matrix, [1, 0, 0]);
    expect(point[0]).toBeCloseTo(0.1, 12);
    expect(point[1]).toBeCloseTo(0.7, 12);
    expect(point[2]).toBeCloseTo(0.3, 12);
  });

  it("returns identity for the default transform", () => {
    expectMatrix(
      composeTrs({ position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }),
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    );
  });
});

describe("quaternions", () => {
  it("measures deviation from unit length", () => {
    expect(quatNormDeviation([0, 0, 0, 1])).toBe(0);
    expect(quatNormDeviation([0, 0, 0.5, 0.5])).toBeCloseTo(1 - Math.SQRT1_2, 12);
  });

  it("normalizes to unit length", () => {
    const normalized = normalizeQuat([0, 0, 0.705, 0.705]);
    expect(normalized[2]).toBeCloseTo(H, 12);
    expect(normalized[3]).toBeCloseTo(H, 12);
  });
});

describe("layerSize", () => {
  it("is one target width wide and keeps the media aspect ratio", () => {
    expect(layerSize([1920, 1080])).toEqual([1, 0.5625]);
    expect(layerSize([300, 400])).toEqual([1, 4 / 3]);
  });
});

describe("platform basis adapters", () => {
  const random = seeded(42);
  const transforms = Array.from({ length: 50 }, () => randomTransform(random));

  it("AR Foundation: TRS of the adapted transform equals P * M * P", () => {
    for (const transform of transforms) {
      const expected = multiply(multiply(AR_FOUNDATION, composeTrs(transform)), AR_FOUNDATION);
      expectMatrix(composeTrs(toArFoundation(transform)), expected);
    }
  });

  it("ARCore: TRS of the adapted transform equals C * M * C^-1", () => {
    for (const transform of transforms) {
      const expected = multiply(multiply(ARCORE, composeTrs(transform)), ARCORE_INVERSE);
      expectMatrix(composeTrs(toArCore(transform)), expected);
    }
  });

  it("maps the ARX image axes onto each platform's image axes", () => {
    const identity: Transform = {
      position: [0.1, 0.2, 0.3],
      rotation: [0, 0, 0, 1] as Quat,
      scale: [1, 1, 1],
    };
    // right stays X; image-up is +Z in AR Foundation and -Z in ARCore; out is +Y in both.
    expect(toArFoundation(identity).position).toEqual([0.1, 0.3, 0.2]);
    expect(toArCore(identity).position).toEqual([0.1, 0.3, -0.2]);
  });
});
