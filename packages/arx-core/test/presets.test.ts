import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EFFECT_LIMITS, EFFECT_PRESETS, type EffectPreset } from "../src/effects/index";
import { ALPHA_CURVE_NAMES } from "../src/effects/effects.constants";
import { checkPresets } from "../src/effects/utils/check-presets";
import { alphaCurve } from "../src/effects/utils/curves";

type JsonObject = Record<string, unknown>;
type PresetFile = { readonly extension: string; readonly description: string; readonly presets: JsonObject };

const REPO_ROOT = path.resolve(__dirname, "../../..");
const presetText = readFileSync(path.join(REPO_ROOT, "schema/ext/ARX_effects.presets.json"), "utf8");
const presetFile = JSON.parse(presetText) as PresetFile;
const MAX_AMOUNT = EFFECT_LIMITS.amount.max;

/**
 * Most particles alive at once (spec/extensions/ARX_effects.md section 5). A continuous emitter
 * born every 1/n seconds keeps at most ceil(n * maxLifetime) alive. A burst window emits
 * N = max(1, round(emitSeconds * n)), and windows overlap only when the longest life outlasts
 * the period.
 */
const maxAlive = (preset: EffectPreset, amount: number): number => {
  const perSecond = preset.rate * amount;
  const longestLife = preset.lifetime[1];
  if (preset.emission.kind === "continuous") return Math.ceil(perSecond * longestLife);
  const { emitSeconds, pauseSeconds } = preset.emission;
  const perWindow = Math.max(1, Math.round(emitSeconds * perSecond));
  const overlappingWindows = Math.floor(longestLife / (emitSeconds + pauseSeconds)) + 1;
  return perWindow * overlappingWindows;
};

const presetNamed = (name: string): EffectPreset => {
  const preset = EFFECT_PRESETS[name];
  if (preset === undefined) throw new Error(`no preset ${name}`);
  return preset;
};

/** A deep copy of the preset file with one preset field replaced or removed. */
const withPresetField = (name: string, field: string, value: unknown): PresetFile => {
  const copy = JSON.parse(presetText) as PresetFile;
  const preset = copy.presets[name] as JsonObject;
  const entries = Object.entries(preset).filter(([key]) => key !== field);
  const next = value === undefined ? Object.fromEntries(entries) : { ...Object.fromEntries(entries), [field]: value };
  return { ...copy, presets: { ...copy.presets, [name]: next } };
};

describe("EFFECT_PRESETS", () => {
  it("is the root preset file, value for value", () => {
    expect(JSON.parse(JSON.stringify(EFFECT_PRESETS))).toEqual(presetFile.presets);
  });

  it("is frozen and has no Object prototype keys", () => {
    expect(Object.isFrozen(EFFECT_PRESETS)).toBe(true);
    expect(Object.isFrozen(presetNamed("sparkle"))).toBe(true);
    expect(EFFECT_PRESETS.constructor).toBeUndefined();
    expect(EFFECT_PRESETS.toString).toBeUndefined();
  });
});

describe("preset table invariant: at most 256 live particles per emitter at amount 4", () => {
  it.each(Object.keys(presetFile.presets).sort())("%s stays at or under 256", (name) => {
    expect(maxAlive(presetNamed(name), MAX_AMOUNT)).toBeLessThanOrEqual(EFFECT_LIMITS.maxParticles);
  });

  it("counts the table as the design does: 80, 144, 24, 240, 72", () => {
    const counts = ["burst", "float", "rise", "snow", "sparkle"].map((name) => maxAlive(presetNamed(name), MAX_AMOUNT));
    expect(counts).toEqual([80, 144, 24, 240, 72]);
  });

  it("burst lives shorter than its period, so one window is the whole count", () => {
    const burst = presetNamed("burst");
    if (burst.emission.kind !== "burst") throw new Error("burst is not a burst emitter");
    expect(burst.lifetime[1]).toBeLessThan(burst.emission.emitSeconds + burst.emission.pauseSeconds);
  });

  it("would catch a table edit that breaks the limit", () => {
    const denser = checkPresets(withPresetField("snow", "rate", 11));
    expect(maxAlive(denser.snow as EffectPreset, MAX_AMOUNT)).toBe(264);
    const longerBurst = checkPresets(withPresetField("burst", "lifetime", [0.6, 4.6]));
    expect(maxAlive(longerBurst.burst as EffectPreset, MAX_AMOUNT)).toBe(320);
  });
});

describe("alpha curves", () => {
  it("every preset names a curve in the alphaCurve table", () => {
    Object.values(EFFECT_PRESETS).forEach((preset) => {
      expect(ALPHA_CURVE_NAMES).toContain(preset.alphaCurve);
      expect(Number.isFinite(alphaCurve(preset.alphaCurve, 0.5))).toBe(true);
    });
  });

  it("the table has exactly the five curves of the spec", () => {
    expect([...ALPHA_CURVE_NAMES].sort()).toEqual([
      "constant",
      "easeFadeOut",
      "gradualFadeInOut",
      "linearFadeOut",
      "quickFadeInOut",
    ]);
  });

  const samples: ReadonlyArray<readonly [(typeof ALPHA_CURVE_NAMES)[number], number, number]> = [
    ["linearFadeOut", 0, 1],
    ["linearFadeOut", 0.25, 0.75],
    ["linearFadeOut", 1, 0],
    ["easeFadeOut", 0, 1],
    ["easeFadeOut", 0.5, 0.75],
    ["easeFadeOut", 1, 0],
    ["quickFadeInOut", 0, 0],
    ["quickFadeInOut", 0.05, 0.5],
    ["quickFadeInOut", 0.1, 1],
    ["quickFadeInOut", 0.5, 1],
    ["quickFadeInOut", 0.95, 0.5],
    ["quickFadeInOut", 1, 0],
    ["gradualFadeInOut", 0, 0],
    ["gradualFadeInOut", 0.15, 0.5],
    ["gradualFadeInOut", 0.3, 1],
    ["gradualFadeInOut", 0.5, 1],
    ["gradualFadeInOut", 0.85, 0.5],
    ["gradualFadeInOut", 1, 0],
    ["constant", 0, 1],
    ["constant", 0.05, 1],
    ["constant", 0.5, 1],
    ["constant", 0.999, 1],
    ["constant", 1, 1],
  ];

  it.each(samples)("%s(%s) = %s", (name, t, expected) => {
    expect(alphaCurve(name, t)).toBeCloseTo(expected, 12);
  });

  it("constant has no fade at either end of life: alpha 1 at every sampled t", () => {
    const steps = Array.from({ length: 101 }, (_, step) => step / 100);
    expect(steps.map((t) => alphaCurve("constant", t))).toEqual(steps.map(() => 1));
  });

  it("checkPresets accepts a preset row on the constant curve", () => {
    const table = checkPresets(withPresetField("sparkle", "alphaCurve", "constant"));
    expect(table.sparkle?.alphaCurve).toBe("constant");
  });

  it("throws for a name outside the table", () => {
    expect(() => alphaCurve("fadeSideways" as (typeof ALPHA_CURVE_NAMES)[number], 0.5)).toThrow(/fadeSideways/);
  });
});

describe("preset sprites", () => {
  it("float draws glow-star and the other presets keep their sprites", () => {
    const sprites = Object.fromEntries(Object.keys(presetFile.presets).map((name) => [name, presetNamed(name).sprite]));
    expect(sprites).toEqual({ sparkle: "star", rise: "dot", burst: "soft", snow: "soft", float: "glow-star" });
  });
});

describe("checkPresets", () => {
  it("accepts the root preset file", () => {
    expect(() => checkPresets(presetFile)).not.toThrow();
  });

  it("accepts glow-star as a preset row's sprite", () => {
    expect(() => checkPresets(withPresetField("rise", "sprite", "glow-star"))).not.toThrow();
  });

  const rejected: ReadonlyArray<readonly [string, () => unknown, RegExp]> = [
    ["a non-object", () => "presets", /object/],
    ["another extension's table", () => ({ ...presetFile, extension: "ARX_other" }), /extension/],
    ["a malformed preset name", () => ({ ...presetFile, presets: { Sparkle: presetFile.presets.sparkle } }), /Sparkle/],
    ["an unknown alpha curve", () => withPresetField("rise", "alphaCurve", "fadeSideways"), /rise.*alphaCurve/],
    ["an unknown sprite", () => withPresetField("rise", "sprite", "heart"), /rise.*sprite/],
    ["a missing field", () => withPresetField("snow", "rate", undefined), /snow.*rate/],
    ["an extra field", () => withPresetField("snow", "gravity", 1), /snow.*gravity/],
    ["a direction that is not a unit vector", () => withPresetField("burst", "direction", [0, 0, 2]), /burst.*direction/],
    ["a spread over 180 degrees", () => withPresetField("burst", "spreadDegrees", 200), /burst.*spreadDegrees/],
    ["a lifetime range turned around", () => withPresetField("sparkle", "lifetime", [2, 1]), /sparkle.*lifetime/],
    ["a short vector", () => withPresetField("sparkle", "shapeSize", [0.1, 0.1]), /sparkle.*shapeSize/],
    ["a size outside the schema range", () => withPresetField("sparkle", "size", 0.5), /sparkle.*size/],
    ["a zero rate", () => withPresetField("sparkle", "rate", 0), /sparkle.*rate/],
    ["an unknown emission kind", () => withPresetField("sparkle", "emission", { kind: "pulse" }), /sparkle.*emission/],
    [
      "a burst without its pause",
      () => withPresetField("burst", "emission", { kind: "burst", emitSeconds: 0.1 }),
      /burst.*emission/,
    ],
  ];

  it.each(rejected)("rejects %s", (_label, build, message) => {
    expect(() => checkPresets(build())).toThrow(message);
  });
});
