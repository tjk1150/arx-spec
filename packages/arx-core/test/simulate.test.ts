import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EFFECT_LIMITS,
  EFFECT_PRESETS,
  createEffectSimulation,
  resolveEffect,
  type EffectPreset,
  type EffectSimulation,
  type ManifestEffect,
  type ParticleView,
} from "../src/effects/index";
import { fnv1a32, mulberry32, mulberry32At } from "../src/effects/utils/random";

type ExpectedParticle = {
  readonly slot: number;
  readonly index: number;
  readonly position: readonly number[];
  readonly size: number;
  readonly angleDegrees: number;
  readonly color: readonly number[];
  readonly alpha: number;
};
type ExpectedFrame = {
  readonly time: number;
  /** True when the effect restarts (spec 7.1, target found again) right before this frame. */
  readonly restart?: boolean;
  readonly count: number;
  readonly particles: readonly ExpectedParticle[];
};
type SimulationCase = {
  readonly name: string;
  readonly effect: ManifestEffect;
  readonly presetOverrides?: Partial<EffectPreset>;
  readonly times: readonly number[];
  readonly expect: readonly ExpectedFrame[];
};
type SimulationVectors = {
  readonly tolerance: number;
  readonly maxParticles: number;
  readonly checks: {
    readonly seeds: Readonly<Record<string, number>>;
    readonly sequence: { readonly seed: number; readonly values: readonly number[] };
  };
  readonly cases: readonly SimulationCase[];
};

const REPO_ROOT = path.resolve(__dirname, "../../..");
const vectors = JSON.parse(
  readFileSync(path.join(REPO_ROOT, "fixtures/effects/simulation.json"), "utf8"),
) as SimulationVectors;

const presetFor = (effect: ManifestEffect, overrides: Partial<EffectPreset> = {}): EffectPreset => {
  const preset = EFFECT_PRESETS[effect.preset];
  if (preset === undefined) throw new Error(`no preset ${effect.preset}`);
  return { ...preset, ...overrides };
};

const simulationOf = (effect: ManifestEffect, overrides?: Partial<EffectPreset>): EffectSimulation =>
  createEffectSimulation(resolveEffect(effect), presetFor(effect, overrides));

/** A plain copy of a view, so a later advance cannot change what a test compares. */
const snapshot = (view: ParticleView) => ({
  index: view.index,
  x: view.x,
  y: view.y,
  z: view.z,
  size: view.size,
  angleDegrees: view.angleDegrees,
  red: view.red,
  green: view.green,
  blue: view.blue,
  alpha: view.alpha,
});

const stateAt = (simulation: EffectSimulation, time: number) => {
  simulation.advance(time);
  return simulation.particles().map(snapshot);
};

const SPARKLE: ManifestEffect = { id: "sparkle-1", preset: "sparkle", colors: ["#FF0071", "#18004A"] };
const BURST: ManifestEffect = {
  id: "burst-a",
  preset: "burst",
  colors: ["#FFD700", "#FF4500"],
  transform: { rotation: [0.2, -0.1, 0.3, 0.9] },
  amount: 0.7,
};

describe("seed and random sequence (spec 7.2)", () => {
  it("hashes the spec's check strings to the spec's seeds", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("sparkle-1")).toBe(0xdf005efb);
  });

  it("hashes the UTF-8 bytes, not the UTF-16 code units", () => {
    // Values from tools/effects_reference.py: e-acute is bytes C3 A9, the emoji a surrogate pair in UTF-16.
    expect(fnv1a32("é")).toBe(0x1e9de8c1);
    expect(fnv1a32("\u{1F600}")).toBe(0x33a29608);
  });

  it("matches the reference generator's seeds", () => {
    for (const [text, seed] of Object.entries(vectors.checks.seeds)) expect(fnv1a32(text)).toBe(seed);
  });

  it("starts seed 0xDF005EFB with the spec's three values", () => {
    const next = mulberry32(0xdf005efb);
    expect([next(), next(), next()]).toEqual([0.7602949764113873, 0.79540013987571, 0.5259187174960971]);
    expect(vectors.checks.sequence.values).toEqual([0.7602949764113873, 0.79540013987571, 0.5259187174960971]);
  });

  it("reads any position of the sequence directly, including past 2^32 draws", () => {
    const next = mulberry32(fnv1a32("sparkle-1"));
    const sequence = Array.from({ length: 50 }, () => next());
    sequence.forEach((value, position) => expect(mulberry32At(fnv1a32("sparkle-1"), position)).toBe(value));
    expect(mulberry32At(7, 2 ** 32 + 5)).toBe(mulberry32At(7, 5));
  });
});

describe("fixtures/effects/simulation.json", () => {
  it("compares at 1e-9 with the per-effect cap of the limits table", () => {
    expect(vectors.tolerance).toBe(1e-9);
    expect(vectors.maxParticles).toBe(EFFECT_LIMITS.maxParticles);
  });

  it("covers every preset of the table and a case past the cap", () => {
    const presets = new Set(vectors.cases.map((entry) => entry.effect.preset));
    expect([...presets].sort()).toEqual(Object.keys(EFFECT_PRESETS).sort());
    const counts = vectors.cases.flatMap((entry) => entry.expect.map((frame) => frame.count));
    expect(Math.max(...counts)).toBe(EFFECT_LIMITS.maxParticles);
  });

  it("covers the constant curve, whose sampled particles all have alpha 1", () => {
    const constant = vectors.cases.filter((entry) => entry.presetOverrides?.alphaCurve === "constant");
    expect(constant).toHaveLength(1);
    const alphas = constant.flatMap((entry) => entry.expect.flatMap((frame) => frame.particles.map((view) => view.alpha)));
    expect(alphas.length).toBeGreaterThan(4);
    expect(alphas.every((alpha) => alpha === 1)).toBe(true);
  });

  it("covers a restart, including one from a capped emitter", () => {
    const restarted = vectors.cases.filter((entry) => entry.expect.some((frame) => frame.restart === true));
    expect(restarted.length).toBeGreaterThanOrEqual(2);
    const before = restarted.flatMap((entry) => {
      const at = entry.expect.findIndex((frame) => frame.restart === true);
      return entry.expect.slice(0, at).map((frame) => frame.count);
    });
    expect(Math.max(...before)).toBe(EFFECT_LIMITS.maxParticles);
  });
});

describe("createEffectSimulation matches the reference vectors", () => {
  describe.each(vectors.cases)("$name", (entry) => {
    const simulation = simulationOf(entry.effect, entry.presetOverrides);
    it.each(entry.expect)("at $time s (restart first: $restart)", (frame) => {
      if (frame.restart === true) simulation.restart();
      simulation.advance(frame.time);
      const live = simulation.particles();
      expect(live.length).toBe(frame.count);
      for (const expected of frame.particles) {
        const view = live[expected.slot];
        if (view === undefined) throw new Error(`no particle in slot ${expected.slot}`);
        expect(view.index).toBe(expected.index);
        const actual = [view.x, view.y, view.z, view.size, view.angleDegrees];
        const wanted = [...expected.position, expected.size, expected.angleDegrees];
        actual.push(view.red, view.green, view.blue, view.alpha);
        wanted.push(...expected.color, expected.alpha);
        expect(wanted).toHaveLength(actual.length);
        actual.forEach((value, field) => {
          expect(Math.abs(value - (wanted[field] ?? Number.NaN))).toBeLessThanOrEqual(vectors.tolerance);
        });
      }
    });
  });
});

describe("state depends only on the effect time", () => {
  it("gives the same particles after one large step as after many small ones", () => {
    const oneStep = stateAt(simulationOf(SPARKLE), 2.75);
    const stepped = simulationOf(SPARKLE);
    for (let frame = 1; frame < 165; frame += 1) stepped.advance(frame / 60);
    expect(stateAt(stepped, 2.75)).toEqual(oneStep);
    expect(oneStep.length).toBeGreaterThan(0);
  });

  it("keeps burst windows the same across an uneven frame cadence", () => {
    const oneStep = stateAt(simulationOf(BURST), 3.05);
    const uneven = simulationOf(BURST);
    for (const time of [0.01, 0.4, 0.41, 1.49, 1.5, 2.9, 3.0]) uneven.advance(time);
    expect(stateAt(uneven, 3.05)).toEqual(oneStep);
    expect(oneStep.length).toBeGreaterThan(0);
  });

  it("holds the particles at one effect time and forgets earlier calls", () => {
    const paused = simulationOf(SPARKLE);
    const atStop = stateAt(paused, 1.2);
    for (let frame = 0; frame < 30; frame += 1) expect(stateAt(paused, 1.2)).toEqual(atStop);
    expect(stateAt(paused, 1.2 + 0.5)).toEqual(stateAt(simulationOf(SPARKLE), 1.7));
  });

  it("gives two simulations of one effect the same particles", () => {
    expect(stateAt(simulationOf(BURST), 0.08)).toEqual(stateAt(simulationOf(BURST), 0.08));
  });
});

describe("limits and edges", () => {
  const crowded: Partial<EffectPreset> = { rate: 400, lifetime: [2, 2] };

  it("keeps at most 256 live particles, the oldest ones", () => {
    const simulation = simulationOf(SPARKLE, crowded);
    for (const time of [0.5, 0.7, 1.0, 1.9, 4.0]) {
      simulation.advance(time);
      const live = simulation.particles();
      expect(live.length).toBe(Math.min(EFFECT_LIMITS.maxParticles, Math.floor(time * 400) + 1));
      expect(live.length).toBeLessThanOrEqual(EFFECT_LIMITS.maxParticles);
      const indexes = live.map((view) => view.index);
      expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
    }
  });

  it("has no particles before the first advance or before time 0", () => {
    const simulation = simulationOf(SPARKLE);
    expect(simulation.particles()).toHaveLength(0);
    simulation.advance(-0.5);
    expect(simulation.particles()).toHaveLength(0);
  });

  it("gives particle 0 its birth state at time 0", () => {
    const [first] = stateAt(simulationOf(SPARKLE), 0);
    expect(first?.index).toBe(0);
    expect([first?.red, first?.green, first?.blue]).toEqual([1, 0, 0x71 / 255]);
    expect(first?.alpha).toBe(0);
  });

  it("rejects a time that is not a finite number", () => {
    const simulation = simulationOf(SPARKLE);
    expect(() => simulation.advance(Number.NaN)).toThrow(RangeError);
    expect(() => simulation.advance(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });

  it("rejects a preset that never emits", () => {
    expect(() => simulationOf(SPARKLE, { rate: 0 })).toThrow(RangeError);
  });
});
