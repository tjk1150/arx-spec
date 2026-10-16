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

// Spec/extensions/ARX_effects.md 7.1: when the target is tracked
// again the effect restarts from T = 0, so the same particle sequence plays again from birth 0.

type ExpectedFrame = {
  readonly time: number;
  readonly restart?: boolean;
  readonly count: number;
  readonly particles: readonly { readonly slot: number; readonly index: number }[];
};
type SimulationCase = { readonly name: string; readonly expect: readonly ExpectedFrame[] };

const REPO_ROOT = path.resolve(__dirname, "../../..");
const vectors = JSON.parse(readFileSync(path.join(REPO_ROOT, "fixtures/effects/simulation.json"), "utf8")) as {
  readonly cases: readonly SimulationCase[];
};

const presetFor = (effect: ManifestEffect, overrides: Partial<EffectPreset> = {}): EffectPreset => {
  const preset = EFFECT_PRESETS[effect.preset];
  if (preset === undefined) throw new Error(`no preset ${effect.preset}`);
  return { ...preset, ...overrides };
};

const simulationOf = (effect: ManifestEffect, overrides?: Partial<EffectPreset>): EffectSimulation =>
  createEffectSimulation(resolveEffect(effect), presetFor(effect, overrides));

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
const CROWDED: Partial<EffectPreset> = { rate: 400, lifetime: [2, 2] };

describe("restart (spec 7.1: target found again)", () => {
  it("clears the live particles, as before the first advance", () => {
    const simulation = simulationOf(SPARKLE);
    simulation.advance(4.6);
    expect(simulation.particles().length).toBeGreaterThan(0);
    simulation.restart();
    expect(simulation.particles()).toHaveLength(0);
  });

  it.each([
    ["sparkle", SPARKLE],
    ["burst", BURST],
  ] as const)("replays the %s particle sequence of a fresh simulation from T = 0", (_name, effect) => {
    const restarted = simulationOf(effect);
    for (let frame = 1; frame <= 280; frame += 1) restarted.advance(frame / 60);
    restarted.restart();
    for (const time of [0, 0.05, 0.5, 1.25, 1.55, 3.05]) {
      expect(stateAt(restarted, time)).toEqual(stateAt(simulationOf(effect), time));
    }
  });

  it("starts again at birth 0 instead of continuing the stopped clock", () => {
    const simulation = simulationOf(SPARKLE);
    const continued = stateAt(simulation, 4.6);
    expect(continued[0]?.index).toBeGreaterThan(0);
    simulation.restart();
    const [first, ...others] = stateAt(simulation, 0);
    expect(first?.index).toBe(0);
    expect(others).toHaveLength(0);
  });

  it("gives the same particles on every restart (deterministic)", () => {
    const simulation = simulationOf(BURST);
    const runs = [0, 1, 2].map(() => {
      simulation.advance(2.2);
      simulation.restart();
      return [0.05, 0.9, 1.55].map((time) => stateAt(simulation, time));
    });
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
  });

  it("keeps the 256 cap across a restart and refills from the oldest births", () => {
    const simulation = simulationOf(SPARKLE, CROWDED);
    simulation.advance(3);
    expect(simulation.particles()).toHaveLength(EFFECT_LIMITS.maxParticles);
    simulation.restart();
    const early = stateAt(simulation, 0.5);
    expect(early).toHaveLength(Math.floor(0.5 * 400) + 1);
    expect(early.map((view) => view.index)).toEqual(early.map((_, slot) => slot));
    expect(stateAt(simulation, 1)).toHaveLength(EFFECT_LIMITS.maxParticles);
  });
});

describe("fixtures/effects/simulation.json restart rows", () => {
  const restartCases = vectors.cases.filter((entry) => entry.expect.some((frame) => frame.restart === true));

  it("has restart cases", () => {
    expect(restartCases.length).toBeGreaterThanOrEqual(2);
  });

  it.each(restartCases.map((entry) => [entry.name, entry] as const))(
    "%s: after the restart a row equals the row of the first run at the same time",
    (_name, entry) => {
      const restartAt = entry.expect.findIndex((frame) => frame.restart === true);
      const firstRun = entry.expect.slice(0, restartAt);
      const afterRestart = entry.expect.slice(restartAt);
      const repeated = afterRestart.filter((frame) => firstRun.some((earlier) => earlier.time === frame.time));
      expect(repeated.length).toBeGreaterThan(0);
      for (const frame of repeated) {
        const earlier = firstRun.find((row) => row.time === frame.time);
        expect({ count: frame.count, particles: frame.particles }).toEqual({
          count: earlier?.count,
          particles: earlier?.particles,
        });
      }
    },
  );
});
