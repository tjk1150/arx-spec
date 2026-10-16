import { composeTrs, transformPoint } from "../math";
import type { Vec3 } from "../types";
import { EFFECT_LIMITS } from "./effects.constants";
import type { EffectColor, EffectPreset, EffectSimulation, ParticleView, ResolvedEffect } from "./effects.types";
import { alphaCurve } from "./utils/curves";
import { fnv1a32, mulberry32At } from "./utils/random";

const lerp = (from: number, to: number, share: number): number => from + (to - from) * share;

const cross = (left: Vec3, right: Vec3): Vec3 => [
  left[1] * right[2] - left[2] * right[1],
  left[2] * right[0] - left[0] * right[2],
  left[0] * right[1] - left[1] * right[0],
];

const normalize = (vector: Vec3): Vec3 => {
  const length = Math.sqrt(vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
};

/** e1, e2 around the cone axis (spec 7.4): the helper is +Y unless the axis is near it, then +Z. */
const coneFrame = (axis: Vec3): readonly [Vec3, Vec3] => {
  const helper: Vec3 = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [0, 0, 1];
  const first = normalize(cross(helper, axis));
  return [first, cross(axis, first)];
};

/** `#RRGGBB` as sRGB channels 0..1. */
const channels = (color: EffectColor): Vec3 => [
  Number.parseInt(color.slice(1, 3), 16) / 255,
  Number.parseInt(color.slice(3, 5), 16) / 255,
  Number.parseInt(color.slice(5, 7), 16) / 255,
];

/**
 * One frozen read-only view per buffer slot, created once so a frame allocates no particle
 * objects. Slot layout: index, x, y, z, size, angleDegrees, red, green, blue, alpha.
 */
const bufferViews = (buffer: Float64Array, capacity: number, stride: number): readonly ParticleView[] => {
  const read = (offset: number): number => buffer[offset] ?? 0;
  return Array.from({ length: capacity }, (_, slot) => {
    const base = slot * stride;
    return Object.freeze({
      get index() { return read(base); },
      get x() { return read(base + 1); },
      get y() { return read(base + 2); },
      get z() { return read(base + 3); },
      get size() { return read(base + 4); },
      get angleDegrees() { return read(base + 5); },
      get red() { return read(base + 6); },
      get green() { return read(base + 7); },
      get blue() { return read(base + 8); },
      get alpha() { return read(base + 9); },
    });
  });
};

/**
 * The deterministic particle simulation of one effect (spec/extensions/ARX_effects.md section 7).
 * Each `advance` recomputes the live particles from their birth times, so equal effect times give
 * equal particles whatever the frame cadence. Particle state lives in one fixed Float64Array that
 * is overwritten in place (an exception to immutable updates, so a frame allocates no particle
 * objects); `particles()` returns read-only views over it, oldest first, at most
 * EFFECT_LIMITS.maxParticles. `restart` empties the live list for a clock that starts again at 0
 * (spec 7.1). Throws a RangeError for a preset and amount that never emit.
 */
export const createEffectSimulation = (effect: ResolvedEffect, preset: EffectPreset): EffectSimulation => {
  const perSecond = preset.rate * effect.amount;
  if (!(Number.isFinite(perSecond) && perSecond > 0)) {
    throw new RangeError(`createEffectSimulation: ${effect.id} emits ${perSecond} particles per second`);
  }
  const { emission } = preset;
  const period = emission.kind === "burst" ? emission.emitSeconds + emission.pauseSeconds : 0;
  if (emission.kind === "burst" && !(period > 0)) {
    throw new RangeError(`createEffectSimulation: ${effect.id} has a burst period of ${period} s`);
  }
  // Burst window size N = max(1, round half away from zero of emitSeconds * n) (spec 7.3).
  const perWindow = emission.kind === "burst" ? Math.max(1, Math.floor(emission.emitSeconds * perSecond + 0.5)) : 0;
  const longestLife = Math.max(preset.lifetime[0], preset.lifetime[1]);

  const seed = fnv1a32(effect.id);
  // Ten draws per particle in birth order: region x, y, z, cone cos(phi), cone alpha, speed,
  // lifetime, size, first angle, angular speed (spec 7.4).
  const drawsPerParticle = 10;
  const draw = (index: number, which: number): number => mulberry32At(seed, index * drawsPerParticle + which);

  const rotation = composeTrs({ position: [0, 0, 0], rotation: effect.transform.rotation, scale: [1, 1, 1] });
  const gravity = transformPoint(rotation, preset.acceleration);
  const axis = preset.direction;
  const [sideAxis, upAxis] = coneFrame(axis);
  const spreadCos = Math.cos(preset.spreadDegrees * (Math.PI / 180));
  const birthColor = channels(effect.colors[0]);
  const deathColor = channels(effect.colors[1]);

  // Buffer layout per slot: index, x, y, z, size, angleDegrees, red, green, blue, alpha.
  const stride = 10;
  const capacity = EFFECT_LIMITS.maxParticles;
  const buffer = new Float64Array(capacity * stride);
  const views = bufferViews(buffer, capacity, stride);

  /** Writes particle `index` into `slot` when it is alive at `time`; returns whether it was. */
  const writeParticle = (slot: number, index: number, birth: number, time: number): boolean => {
    const lifetime = lerp(preset.lifetime[0], preset.lifetime[1], draw(index, 6));
    if (!(birth <= time && time < birth + lifetime)) return false;
    const region: Vec3 = [
      preset.shapeSize[0] * (2 * draw(index, 0) - 1),
      preset.shapeSize[1] * (2 * draw(index, 1) - 1),
      preset.shapeSize[2] * (2 * draw(index, 2) - 1),
    ];
    const start = transformPoint(effect.matrix, region);
    const cosPhi = 1 - draw(index, 3) * (1 - spreadCos);
    const alpha = 2 * Math.PI * draw(index, 4);
    const speed = preset.speed * effect.speed * (1 + preset.speedVariation * (2 * draw(index, 5) - 1));
    const size = effect.size * (1 + preset.sizeVariation * (2 * draw(index, 7) - 1));
    const angle = lerp(preset.angleDegrees[0], preset.angleDegrees[1], draw(index, 8));
    const spin = lerp(preset.angularSpeedDegrees[0], preset.angularSpeedDegrees[1], draw(index, 9));
    const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
    const across = sinPhi * Math.cos(alpha);
    const around = sinPhi * Math.sin(alpha);
    const local: Vec3 = [
      across * sideAxis[0] + around * upAxis[0] + cosPhi * axis[0],
      across * sideAxis[1] + around * upAxis[1] + cosPhi * axis[1],
      across * sideAxis[2] + around * upAxis[2] + cosPhi * axis[2],
    ];
    const turned = transformPoint(rotation, local);
    const age = time - birth;
    const life = age / lifetime;
    const base = slot * stride;
    buffer[base] = index;
    buffer[base + 1] = start[0] + speed * turned[0] * age + 0.5 * gravity[0] * age * age;
    buffer[base + 2] = start[1] + speed * turned[1] * age + 0.5 * gravity[1] * age * age;
    buffer[base + 3] = start[2] + speed * turned[2] * age + 0.5 * gravity[2] * age * age;
    buffer[base + 4] = size * (1 + (preset.endSizeScale - 1) * life);
    buffer[base + 5] = angle + spin * age;
    buffer[base + 6] = birthColor[0] + (deathColor[0] - birthColor[0]) * life;
    buffer[base + 7] = birthColor[1] + (deathColor[1] - birthColor[1]) * life;
    buffer[base + 8] = birthColor[2] + (deathColor[2] - birthColor[2]) * life;
    buffer[base + 9] = alphaCurve(preset.alphaCurve, life);
    return true;
  };

  /** Fills the buffer with the live particles at `time` in birth order; returns their count. */
  const collect = (time: number): number => {
    let count = 0;
    const visit = (index: number, birth: number): boolean => {
      if (writeParticle(count, index, birth, time)) count += 1;
      return count < capacity;
    };
    if (emission.kind === "continuous") {
      // Start one birth early so rounding in the estimate never skips a live particle.
      const first = Math.max(0, Math.floor((time - longestLife) * perSecond) - 1);
      for (let index = first; index / perSecond <= time; index += 1) {
        if (!visit(index, index / perSecond)) break;
      }
      return count;
    }
    const lastOffset = (perWindow - 1) / perSecond;
    const firstWindow = Math.max(0, Math.floor((time - longestLife - lastOffset) / period) - 1);
    for (let windowIndex = firstWindow; windowIndex * period <= time; windowIndex += 1) {
      for (let slotInWindow = 0; slotInWindow < perWindow; slotInWindow += 1) {
        const birth = windowIndex * period + slotInWindow / perSecond;
        if (!visit(windowIndex * perWindow + slotInWindow, birth)) return count;
      }
    }
    return count;
  };

  let live: readonly ParticleView[] = Object.freeze([]);
  return {
    advance: (timeSeconds: number) => {
      if (!Number.isFinite(timeSeconds)) {
        throw new RangeError(`createEffectSimulation: effect time ${timeSeconds} is not a finite number`);
      }
      live = Object.freeze(views.slice(0, collect(timeSeconds)));
    },
    restart: () => {
      live = Object.freeze([]);
    },
    particles: () => live,
  };
};
