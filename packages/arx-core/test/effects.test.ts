import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EFFECTS_EXTENSION,
  EFFECT_LIMITS,
  EFFECT_PRESETS,
  MAX_EFFECTS,
  resolveEffect,
  type ManifestEffect,
} from "../src/effects/index";
import {
  ALPHA_CURVE_NAMES,
  DEFAULT_EFFECT_TRANSFORM,
  EFFECT_NAME_PATTERN,
  EFFECT_SPRITES,
} from "../src/effects/effects.constants";
import { composeTrs, transformPoint } from "../src/math";

type JsonObject = Record<string, unknown>;
type NumberField = { readonly minimum?: number; readonly maximum?: number; readonly default?: number };
type ExtensionSchema = {
  readonly title: string;
  readonly properties: { readonly effects: { readonly minItems: number; readonly maxItems: number } };
  readonly $defs: {
    readonly effect: { readonly properties: Record<string, NumberField> };
    readonly effectId: { readonly minLength: number; readonly maxLength: number };
    readonly presetName: { readonly pattern: string };
    readonly spriteName: { readonly pattern: string };
    readonly transform: { readonly properties: Record<string, { readonly default: unknown }> };
  };
};

const REPO_ROOT = path.resolve(__dirname, "../../..");
const readJson = <T>(relative: string) => JSON.parse(readFileSync(path.join(REPO_ROOT, relative), "utf8")) as T;

const extensionSchema = readJson<ExtensionSchema>("schema/ext/ARX_effects.schema.json");
const presetFile = readJson<{ readonly extension: string; readonly presets: JsonObject }>(
  "schema/ext/ARX_effects.presets.json",
);
const effectFields = extensionSchema.$defs.effect.properties;
const spriteFiles = readdirSync(path.join(REPO_ROOT, "schema/ext/sprites"))
  .filter((name) => name.endsWith(".png"))
  .map((name) => name.replace(/\.png$/, ""))
  .sort();

const sparkle: ManifestEffect = { id: "sparkle-1", preset: "sparkle", colors: ["#FF0071", "#18004A"] };

const extensionDoc = readFileSync(path.join(REPO_ROOT, "spec/extensions/ARX_effects.md"), "utf8");

/** The text of the extension doc from `heading` up to the next heading of the same or a higher level. */
const docSection = (heading: string): string => {
  const start = extensionDoc.indexOf(`${heading} `);
  if (start < 0) throw new Error(`no section ${heading}`);
  const level = heading.split(" ")[0] ?? "##";
  const rest = extensionDoc.slice(start + heading.length);
  const next = rest.search(new RegExp(`\\n#{2,${level.length}} `));
  return next < 0 ? rest : rest.slice(0, next);
};

const expectClose = (actual: readonly number[], expected: readonly number[], digits = 12) => {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index] ?? Number.NaN, digits));
};

describe("effect constants match the extension schema", () => {
  it("MAX_EFFECTS is the extension schema's effects.maxItems", () => {
    expect(MAX_EFFECTS).toBe(8);
    expect(MAX_EFFECTS).toBe(extensionSchema.properties.effects.maxItems);
    expect(extensionSchema.properties.effects.minItems).toBe(1);
  });

  it("EFFECT_LIMITS ranges and defaults are the schema's", () => {
    expect(EFFECT_LIMITS.amount).toEqual({
      min: effectFields.amount?.minimum,
      max: effectFields.amount?.maximum,
      default: effectFields.amount?.default,
    });
    expect(EFFECT_LIMITS.speed).toEqual({
      min: effectFields.speed?.minimum,
      max: effectFields.speed?.maximum,
      default: effectFields.speed?.default,
    });
    expect(EFFECT_LIMITS.size).toEqual({ min: effectFields.size?.minimum, max: effectFields.size?.maximum });
    expect(EFFECT_LIMITS.idLength).toEqual({
      min: extensionSchema.$defs.effectId.minLength,
      max: extensionSchema.$defs.effectId.maxLength,
    });
    expect(EFFECT_LIMITS.maxParticles).toBe(256);
  });

  it("EFFECTS_EXTENSION is the extension name of the schema and the preset table", () => {
    expect(EFFECTS_EXTENSION).toBe("ARX_effects");
    expect(presetFile.extension).toBe(EFFECTS_EXTENSION);
    expect(extensionSchema.title).toContain(`extensions.${EFFECTS_EXTENSION}`);
  });

  it("preset and sprite names are the table's and the bundled files', and fit the schema patterns", () => {
    const presetPattern = new RegExp(extensionSchema.$defs.presetName.pattern);
    const spritePattern = new RegExp(extensionSchema.$defs.spriteName.pattern);
    expect(Object.keys(EFFECT_PRESETS).sort()).toEqual(Object.keys(presetFile.presets).sort());
    expect(Object.keys(EFFECT_PRESETS).every((name) => presetPattern.test(name))).toBe(true);
    expect([...EFFECT_SPRITES].sort()).toEqual(spriteFiles);
    expect(EFFECT_SPRITES.every((name) => spritePattern.test(name))).toBe(true);
  });

  it("EFFECT_NAME_PATTERN is the schema's preset and sprite name pattern", () => {
    expect(EFFECT_NAME_PATTERN.source).toBe(extensionSchema.$defs.presetName.pattern);
    expect(EFFECT_NAME_PATTERN.source).toBe(extensionSchema.$defs.spriteName.pattern);
  });

  it("the default emitter transform is the schema's transform defaults", () => {
    const defaults = extensionSchema.$defs.transform.properties;
    expect(DEFAULT_EFFECT_TRANSFORM).toEqual({
      position: defaults.position?.default,
      rotation: defaults.rotation?.default,
      scale: defaults.scale?.default,
    });
  });
});

describe("spec/extensions/ARX_effects.md states the rules of the code", () => {
  it("section 6 defines exactly the curves of ALPHA_CURVE_NAMES, constant = 1 among them", () => {
    const curves = docSection("## 6.");
    const defined = [...curves.matchAll(/^- `([A-Za-z]+)` = /gm)].map((match) => match[1]).sort();
    expect(defined).toEqual([...ALPHA_CURVE_NAMES].sort());
    expect(curves).toMatch(/^- `constant` = `1`/m);
  });

  it("section 6 explains why a new curve name cannot break an older Viewer (section 4.2)", () => {
    const curves = docSection("## 6.");
    expect(curves).toMatch(/4\.2절의 규칙/);
    expect(curves).toMatch(/manifest[^\n]*프리셋 표/);
  });

  it("section 7.1 restarts the effect clock at 0 when the target is tracked again", () => {
    const clock = docSection("### 7.1");
    expect(clock).toMatch(/다시 Tracking이 되면[^\n]*0부터 다시 시작[^\n]*\(SHOULD\)/);
    expect(clock).not.toMatch(/이어 간다/);
  });
});

describe("resolveEffect", () => {
  it("fills amount 1, speed 1, and the sparkle preset's size and sprite when the optional fields are absent", () => {
    const resolved = resolveEffect(sparkle);
    expect(resolved).toEqual({
      id: "sparkle-1",
      preset: "sparkle",
      colors: ["#FF0071", "#18004A"],
      amount: 1,
      size: 0.03,
      speed: 1,
      sprite: "star",
      transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    });
  });

  it("takes each preset's own size and sprite as the defaults", () => {
    const defaults = Object.keys(presetFile.presets)
      .sort()
      .map((preset) => {
        const { size, sprite } = resolveEffect({ ...sparkle, preset });
        return [preset, size, sprite];
      });
    expect(defaults).toEqual([
      ["burst", 0.02, "soft"],
      ["float", 0.05, "glow-star"],
      ["rise", 0.015, "dot"],
      ["snow", 0.012, "soft"],
      ["sparkle", 0.03, "star"],
    ]);
  });

  it("keeps authored values, including speed 0", () => {
    const resolved = resolveEffect({ ...sparkle, amount: 4, size: 0.05, speed: 0, sprite: "dot" });
    expect([resolved.amount, resolved.size, resolved.speed, resolved.sprite]).toEqual([4, 0.05, 0, "dot"]);
  });

  it("normalizes a drifted rotation and keeps an exact one as authored", () => {
    const drifted: readonly [number, number, number, number] = [0, 0, 0.7071 * 1.005, 0.7071 * 1.005];
    const resolved = resolveEffect({ ...sparkle, transform: { rotation: drifted } });
    expect(Math.hypot(...resolved.transform.rotation)).toBeCloseTo(1, 12);
    expectClose(resolved.transform.rotation, [0, 0, Math.SQRT1_2, Math.SQRT1_2]);

    const exact: readonly [number, number, number, number] = [0, 0, 0, 1];
    expect(resolveEffect({ ...sparkle, transform: { rotation: exact } }).transform.rotation).toBe(exact);
  });

  it("builds the emitter matrix as composeTrs(transform), E = T x R x S", () => {
    const quarterTurnZ: readonly [number, number, number, number] = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
    const resolved = resolveEffect({
      ...sparkle,
      transform: { position: [0.1, 0.2, 0.03], rotation: quarterTurnZ, scale: [0.2, 0.5, 1] },
    });
    expect(resolved.transform.position).toEqual([0.1, 0.2, 0.03]);
    expect(resolved.transform.scale).toEqual([0.2, 0.5, 1]);
    expectClose(resolved.transform.rotation, quarterTurnZ);
    expect(resolved.matrix).toEqual(composeTrs(resolved.transform));
    // The +X corner of the sparkle birth box: scaled to 0.2 * 0.1, turned onto +Y, then moved.
    expectClose(transformPoint(resolved.matrix, [0.1, 0, 0]), [0.1, 0.22, 0.03]);
    // +Y is scaled by 0.5 and turned onto -X.
    expectClose(transformPoint(resolved.matrix, [0, 0.1, 0]), [0.05, 0.2, 0.03]);
  });

  it("fills a partial transform field by field", () => {
    const resolved = resolveEffect({ ...sparkle, transform: { scale: [2, 2, 2] } });
    expect(resolved.transform).toEqual({ position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [2, 2, 2] });
  });

  it("leaves its input unchanged", () => {
    const input: ManifestEffect = {
      ...sparkle,
      transform: { rotation: [0, 0, 0, 1.002] },
    };
    const snapshot = structuredClone(input);
    resolveEffect(input);
    expect(input).toEqual(snapshot);
  });

  it("throws for a preset outside the table, including Object prototype keys", () => {
    expect(() => resolveEffect({ ...sparkle, preset: "fireworks" })).toThrow(/fireworks/);
    expect(() => resolveEffect({ ...sparkle, preset: "constructor" })).toThrow(/constructor/);
  });
});
