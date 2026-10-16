import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EFFECT_LIMITS, EFFECT_PRESETS, resolveEffect } from "../src/effects/index";
import { EFFECT_NAME_PATTERN } from "../src/effects/effects.constants";

type JsonObject = Record<string, unknown>;
type PresetFile = { readonly presets: Readonly<Record<string, JsonObject>> };
type SimulationCase = {
  readonly effect: { readonly preset: string };
  readonly presetOverrides?: JsonObject;
  readonly expect: readonly { readonly count: number }[];
};
type FixtureEffect = { readonly id: string; readonly preset: string; readonly sprite?: string };

const REPO_ROOT = path.resolve(__dirname, "../../..");
const readText = (relative: string) => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const readJson = <T>(relative: string) => JSON.parse(readText(relative)) as T;

const presetFile = readJson<PresetFile>("schema/ext/ARX_effects.presets.json");
const extensionDoc = readText("spec/extensions/ARX_effects.md");

const docSection = (heading: string): string => {
  const start = extensionDoc.indexOf(`\n${heading}`);
  if (start < 0) throw new Error(`ARX_effects.md has no heading ${heading}`);
  const end = extensionDoc.indexOf("\n## ", start + 1);
  return extensionDoc.slice(start, end < 0 ? undefined : end);
};

/**
 * The `float` preset: slow mint stars. Starting values were tuned on a device later. The default
 * sprite is the glowing star `glow-star`.
 */
const FLOAT = {
  shapeSize: [0.25, 0.25, 0.02],
  direction: [0, 0, 1],
  spreadDegrees: 180,
  emission: { kind: "continuous" },
  rate: 12,
  lifetime: [3, 3],
  speed: 0.03,
  speedVariation: 0.5,
  acceleration: [0, 0, 0],
  size: 0.05,
  sizeVariation: 0.1,
  endSizeScale: 1,
  angleDegrees: [0, 0],
  angularSpeedDegrees: [0, 0],
  alphaCurve: "constant",
  sprite: "glow-star",
};

describe("preset float", () => {
  it("is a row of the root preset file with the decided values, field for field", () => {
    expect(presetFile.presets.float).toEqual(FLOAT);
  });

  it("is the fifth preset, after the four existing ones in their order", () => {
    expect(Object.keys(presetFile.presets)).toEqual(["sparkle", "rise", "burst", "snow", "float"]);
    expect(Object.keys(EFFECT_PRESETS)).toEqual(Object.keys(presetFile.presets));
  });

  it("is what the core reads from the table", () => {
    expect(JSON.parse(JSON.stringify(EFFECT_PRESETS.float))).toEqual(FLOAT);
  });

  it("keeps at most 256 live particles at amount 4: rate x 4 x lifetime[1] = 144", () => {
    const float = EFFECT_PRESETS.float;
    if (float === undefined) throw new Error("no preset float");
    const alive = Math.ceil(float.rate * EFFECT_LIMITS.amount.max * float.lifetime[1]);
    expect(alive).toBe(144);
    expect(alive).toBeLessThanOrEqual(EFFECT_LIMITS.maxParticles);
  });

  it("fits the schema's preset name rule", () => {
    expect(EFFECT_NAME_PATTERN.test("float")).toBe(true);
  });

  it("resolves an effect without size or sprite to the preset's 0.05 and glow-star ", () => {
    const resolved = resolveEffect({ id: "float-1", preset: "float", colors: ["#36F4B8", "#36F4B8"] });
    expect([resolved.size, resolved.sprite, resolved.amount, resolved.speed]).toEqual([0.05, "glow-star", 1, 1]);
  });
});

describe("float in the spec and the two schema descriptions", () => {
  it("section 1 names float among the presets", () => {
    expect(docSection("## 1.")).toMatch(/`float` 떠다님/);
  });

  it("section 2 lists float as a value the document defines", () => {
    expect(docSection("## 2.")).toMatch(/이 문서가 정한 값은 `sparkle`, `rise`, `burst`, `snow`, `float`/);
  });

  it("section 5 keeps the rule that an unknown preset drops only that effect (older Viewer)", () => {
    expect(docSection("## 5.")).toMatch(/그 값을 모르는 구현은 그 효과만 뺀다\(`ARX_EFFECT_UNSUPPORTED`\)/);
  });

  it("schema/ext/ARX_effects.schema.json states float as a known preset", () => {
    expect(readText("schema/ext/ARX_effects.schema.json")).toContain("Known values: sparkle, rise, burst, snow, float.");
  });
});

describe("float in the fixtures", () => {
  it("simulation.json has a float case on the bundled row, without overrides", () => {
    const vectors = readJson<{ readonly cases: readonly SimulationCase[] }>("fixtures/effects/simulation.json");
    const floats = vectors.cases.filter((entry) => entry.effect.preset === "float");
    expect(floats).toHaveLength(1);
    expect(floats[0]?.presetOverrides).toBeUndefined();
    expect(Math.max(...(floats[0]?.expect ?? []).map((frame) => frame.count))).toBeGreaterThan(30);
  });

  it("E002 carries a float effect that validates with no warning", () => {
    const manifest = readJson<{ readonly extensions: { readonly ARX_effects: { readonly effects: readonly FixtureEffect[] } } }>(
      "fixtures/effects/E002-all-presets/manifest.json",
    );
    const expected = readJson<{ readonly warnings: readonly unknown[]; readonly effects: readonly FixtureEffect[] }>(
      "fixtures/effects/E002-all-presets/expected.json",
    );
    expect(manifest.extensions.ARX_effects.effects.map((effect) => effect.preset)).toContain("float");
    expect(expected.effects.map((effect) => effect.preset)).toContain("float");
    expect(expected.effects.find((effect) => effect.preset === "float")?.sprite).toBe("glow-star");
    expect(expected.warnings).toEqual([]);
  });
});
