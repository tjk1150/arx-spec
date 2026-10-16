import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toArCore, toArFoundation, toArKit } from "../src/basis";
import { createRemoteSource, validateExperience, validatePackage } from "../src/index";
import { createDirectorySource } from "../src/node/index";
import { EFFECTS_EXTENSION, MAX_EFFECTS, type ResolvedEffect } from "../src/effects/index";
import type { Issue } from "../src/issues";
import type { ValidateOptions } from "../src/validate";
import type { Experience, Transform } from "../src/types";

const FIXTURES = path.resolve(__dirname, "../../../fixtures");
const TOLERANCE = 1e-6;

interface ExpectedLayer {
  id: string;
  size: number[];
  matrix: number[];
  arFoundation: Transform;
  arcore: Transform;
  arkit: Transform;
  playback?: { autoplay: boolean; loop: boolean };
}

interface ExpectedEffect {
  id: string;
  preset: string;
  colors: string[];
  amount: number;
  size: number;
  speed: number;
  sprite: string;
  matrix: number[];
}

interface ExpectedIssue {
  code: string;
  path: string;
}

interface Expected {
  valid: boolean;
  /** Codes for positive fixtures; code and path for effects fixtures. */
  warnings?: (string | ExpectedIssue)[];
  errors?: { code: string; path: string }[];
  package?: string;
  manifestUrl?: string;
  serve?: Record<string, string>;
  resolved?: Record<string, string>;
  target?: { size: number[]; physicalWidth: number | null };
  layers?: ExpectedLayer[];
  effects?: ExpectedEffect[];
}

/** Effects fixtures run as an implementation that reads ARX_effects (spec/extensions/ARX_effects.md 4.1). */
const EFFECTS_OPTIONS: ValidateOptions = { supportedExtensions: [EFFECTS_EXTENSION] };

/** Every effects fixture the generator writes (viewer conformance fixture table). */
const EFFECTS_FIXTURES = [
  "D001-unknown-preset",
  "D002-amount-range",
  "D003-bad-color",
  "D004-extra-field",
  "D005-duplicate-id",
  "D006-not-array",
  "D007-too-many",
  "D008-quaternion",
  "D009-undeclared",
  "E001-sparkle-defaults",
  "E002-all-presets",
  "E003-white-cone",
  "E004-pink-sparkle",
  "E009-worst-case",
];

const fixtures = (kind: string) =>
  readdirSync(path.join(FIXTURES, kind))
    .filter((name) => existsSync(path.join(FIXTURES, kind, name, "expected.json")))
    .map((name) => ({ name, directory: path.join(FIXTURES, kind, name) }));

const readExpected = (directory: string): Expected =>
  JSON.parse(readFileSync(path.join(directory, "expected.json"), "utf8"));

const run = async (directory: string, expected: Expected, options: ValidateOptions = {}) => {
  if (expected.package) {
    return validatePackage(readFileSync(path.join(directory, expected.package)), options);
  }
  if (expected.manifestUrl && expected.serve) {
    const serve = expected.serve;
    const source = createRemoteSource(expected.manifestUrl, async (url) => {
      const file = serve[url];
      return file ? new Uint8Array(readFileSync(path.join(directory, file))) : undefined;
    });
    return validateExperience(source, options);
  }
  return validateExperience(createDirectorySource(directory), options);
};

const expectClose = (actual: readonly number[], expected: readonly number[], label: string) => {
  expect(actual.length, label).toBe(expected.length);
  actual.forEach((value, index) => {
    expect(Math.abs(value - expected[index]!), `${label}[${index}]`).toBeLessThan(TOLERANCE);
  });
};

const expectTransform = (actual: Transform, expected: Transform, label: string) => {
  expectClose(actual.position, expected.position, `${label}.position`);
  expectClose(actual.rotation, expected.rotation, `${label}.rotation`);
  expectClose(actual.scale, expected.scale, `${label}.scale`);
};

const describeIssues = (issues: readonly Issue[]) =>
  issues.map((issue) => `${issue.severity} ${issue.code} ${issue.path}: ${issue.message}`).join("\n");

/** Target size and every layer's geometry, adapters, and playback against expected.json. */
const expectExperience = (experience: Experience, expected: Expected) => {
  expectClose(experience.target.size, expected.target!.size, "target.size");
  expect(experience.target.physicalWidth ?? null).toBe(expected.target!.physicalWidth);
  expect(experience.layers.map((layer) => layer.id)).toEqual(expected.layers!.map((layer) => layer.id));

  experience.layers.forEach((layer, index) => {
    const want = expected.layers![index]!;
    expectClose(layer.size, want.size, `${layer.id}.size`);
    expectClose(layer.matrix, want.matrix, `${layer.id}.matrix`);
    expectTransform(toArFoundation(layer.transform), want.arFoundation, `${layer.id}.arFoundation`);
    expectTransform(toArCore(layer.transform), want.arcore, `${layer.id}.arcore`);
    expectTransform(toArKit(layer.transform), want.arkit, `${layer.id}.arkit`);
    expect(layer.playback).toEqual(want.playback);
  });
};

/** Resolved effects (spec/extensions/ARX_effects.md 4.3) against expected.json, in order. */
const expectEffects = (actual: readonly ResolvedEffect[], expected: readonly ExpectedEffect[]) => {
  expect(actual.map((effect) => effect.id)).toEqual(expected.map((effect) => effect.id));
  actual.forEach((effect, index) => {
    const want = expected[index]!;
    const label = `effect ${effect.id}`;
    expect(effect.preset, `${label}.preset`).toBe(want.preset);
    expect(effect.colors, `${label}.colors`).toEqual(want.colors);
    expect(effect.sprite, `${label}.sprite`).toBe(want.sprite);
    expectClose(
      [effect.amount, effect.size, effect.speed],
      [want.amount, want.size, want.speed],
      `${label}.amount,size,speed`,
    );
    expectClose(effect.matrix, want.matrix, `${label}.matrix`);
  });
};

const issueKey = ({ code, path: pointer }: ExpectedIssue) => `${code} ${pointer}`;

describe("positive fixtures", () => {
  it.each(fixtures("positive"))("$name", async ({ directory }) => {
    const expected = readExpected(directory);
    const result = await run(directory, expected);
    const errors = result.issues.filter((issue) => issue.severity === "error");
    expect(errors, describeIssues(errors)).toEqual([]);
    expect(result.valid).toBe(true);

    const warnings = result.issues.filter((issue) => issue.severity === "warning");
    expect(warnings.map((issue) => issue.code).sort(), describeIssues(warnings)).toEqual(
      [...((expected.warnings ?? []) as string[])].sort(),
    );

    const experience = result.experience as Experience;
    expectExperience(experience, expected);
    if (expected.effects !== undefined) expectEffects(experience.manifest.effects, expected.effects);

    for (const [pointer, url] of Object.entries(expected.resolved ?? {})) {
      const actual =
        pointer === "/anchor/src"
          ? experience.target.url
          : experience.layers[Number(pointer.split("/")[2])]!.url;
      expect(actual, pointer).toBe(url);
    }
  });

  // An implementation that does not read ARX_effects passes no supported extensions (spec section 10).
  it("C019 carries declared effect data, yet opens like C001 without options", () => {
    const directory = path.join(FIXTURES, "positive", "C019-unknown-extension-ignored");
    const manifest = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8"));
    expect(manifest.extensionsUsed).toEqual([EFFECTS_EXTENSION]);
    expect(manifest.extensions[EFFECTS_EXTENSION].effects.length).toBeGreaterThan(0);

    const expected = readExpected(directory);
    const c001 = readExpected(path.join(FIXTURES, "positive", "C001-minimal-image"));
    expect(expected.warnings).toEqual([]);
    expect(expected.effects).toEqual([]);
    expect(expected.target).toEqual(c001.target);
    expect(expected.layers).toEqual(c001.layers);
  });
});

describe("negative fixtures", () => {
  it.each(fixtures("negative"))("$name", async ({ directory }) => {
    const expected = readExpected(directory);
    const result = await run(directory, expected);
    expect(result.valid).toBe(false);
    expect(result.experience).toBeUndefined();
    const reported = result.issues
      .filter((issue) => issue.severity === "error")
      .map(({ code, path: pointer }) => ({ code, path: pointer }));
    for (const want of expected.errors ?? []) {
      expect(reported, describeIssues(result.issues)).toContainEqual(want);
    }
  });
});

// Effect data never fails a manifest (spec/extensions/ARX_effects.md 4.2): every D
// fixture is valid, keeps its layers, and drops only the bad effects with a warning each.
describe("effects fixtures", () => {
  it("covers every E and D fixture of the conformance table (spec section 12.2)", () => {
    expect(fixtures("effects").map(({ name }) => name).sort()).toEqual(EFFECTS_FIXTURES);
  });

  it.each(fixtures("effects"))("$name", async ({ name, directory }) => {
    const expected = readExpected(directory);
    expect(expected.valid, `${name}: every effects fixture is valid`).toBe(true);
    const result = await run(directory, expected, EFFECTS_OPTIONS);
    const errors = result.issues.filter((issue) => issue.severity === "error");
    expect(errors, describeIssues(errors)).toEqual([]);
    expect(result.valid).toBe(true);

    const warnings = result.issues
      .filter((issue) => issue.severity === "warning")
      .map(({ code, path: pointer }) => ({ code, path: pointer }));
    expect(warnings.map(issueKey).sort(), describeIssues(result.issues)).toEqual(
      ((expected.warnings ?? []) as ExpectedIssue[]).map(issueKey).sort(),
    );

    const experience = result.experience as Experience;
    expectExperience(experience, expected);
    expectEffects(experience.manifest.effects, expected.effects!);
  });

  it("E009 is the worst case: the most effects, all snow at amount 4", () => {
    const expected = readExpected(path.join(FIXTURES, "effects", "E009-worst-case"));
    expect(expected.warnings).toEqual([]);
    expect(expected.effects).toHaveLength(MAX_EFFECTS);
    for (const effect of expected.effects!) {
      expect([effect.preset, effect.amount]).toEqual(["snow", 4]);
    }
  });
});
