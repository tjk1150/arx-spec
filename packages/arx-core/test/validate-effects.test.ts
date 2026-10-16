import { describe, expect, it } from "vitest";
import { EFFECTS_EXTENSION, MAX_EFFECTS } from "../src/effects/index";
import { createRemoteSource, validateExperience } from "../src/index";
import { hasErrors, type Issue } from "../src/issues";
import { validateManifest, type ManifestOptions } from "../src/semantic";

// Effect stage of the TS validator (spec/extensions/ARX_effects.md section 4): bad
// effect data drops that effect (or all effects) with a warning, and the manifest stays valid.

const BASE = "https://example.com/experience/";
const MANIFEST_URL = `${BASE}manifest.json`;
const ROOT = "/extensions/ARX_effects";
const SUPPORTED: ManifestOptions = { supportedExtensions: [EFFECTS_EXTENSION] };

type Json = Record<string, unknown>;

const effect = (overrides: Json = {}): Json => ({
  id: "fx",
  preset: "sparkle",
  colors: ["#FF0071", "#18004A"],
  ...overrides,
});

const manifestWith = (arxEffects: unknown, overrides: Json = {}): Json => ({
  spec: "arx/0.1",
  anchor: { type: "image", src: "target.png" },
  layers: [{ id: "planet", type: "image", src: "planet.png" }],
  extensionsUsed: [EFFECTS_EXTENSION],
  extensions: { [EFFECTS_EXTENSION]: arxEffects },
  ...overrides,
});

const withEffects = (...effects: unknown[]): Json => manifestWith({ effects });

const describeIssues = (issues: readonly Issue[]) =>
  issues.map((issue) => `${issue.severity} ${issue.code} ${issue.path}`);

const check = (input: unknown, options: ManifestOptions = SUPPORTED) => {
  const result = validateManifest(input, MANIFEST_URL, options);
  return {
    valid: result.manifest !== undefined && !hasErrors(result.issues),
    issues: describeIssues(result.issues),
    effectIds: (result.manifest?.effects ?? []).map((resolved) => resolved.id),
    layerIds: (result.manifest?.layers ?? []).map((layer) => layer.id),
    manifest: result.manifest,
  };
};

describe("validateEffects: well-formed effects", () => {
  it("resolves an effect with the defaults filled and no issues", () => {
    const result = check(withEffects(effect()));
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.manifest?.effects).toEqual([
      {
        id: "fx",
        preset: "sparkle",
        colors: ["#FF0071", "#18004A"],
        amount: 1,
        size: 0.03,
        speed: 1,
        sprite: "star",
        transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
    ]);
  });

  it("keeps up to MAX_EFFECTS effects in order", () => {
    const effects = Array.from({ length: MAX_EFFECTS }, (_, index) =>
      effect({ id: `fx-${index}`, preset: "snow", amount: 4 }),
    );
    const result = check(withEffects(...effects));
    expect(result.issues).toEqual([]);
    expect(result.effectIds).toEqual(effects.map((item) => item.id));
  });

  it("gives an empty effect list when the manifest has no effects", () => {
    const plain = manifestWith(undefined, { extensionsUsed: undefined, extensions: undefined });
    const result = check(plain);
    expect(result.issues).toEqual([]);
    expect(result.manifest?.effects).toEqual([]);
  });

  it("gives an empty effect list without a warning when ARX_effects is declared but absent", () => {
    const result = check(manifestWith(undefined, { extensions: {} }));
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.manifest?.effects).toEqual([]);
  });

  it("does not read ARX_effects placed in a layer's extensions", () => {
    const layered = manifestWith(undefined, {
      extensions: undefined,
      layers: [
        { id: "planet", type: "image", src: "planet.png", extensions: { ARX_effects: { effects: [effect()] } } },
      ],
    });
    const result = check(layered);
    expect(result.issues).toEqual([]);
    expect(result.manifest?.effects).toEqual([]);
  });
});

describe("validateEffects: the whole extension object is bad", () => {
  const cases: ReadonlyArray<readonly [string, unknown]> = [
    ["an array", []],
    ["a string", "sparkle"],
    ["null", null],
    ["effects not an array", { effects: { id: "a" } }],
    ["effects missing", {}],
    ["zero effects", { effects: [] }],
    [
      "more than MAX_EFFECTS effects",
      { effects: Array.from({ length: MAX_EFFECTS + 1 }, (_, index) => effect({ id: `fx-${index}` })) },
    ],
    ["an unknown field on the extension object", { effects: [effect()], version: 2 }],
  ];

  it.each(cases)("drops every effect when ARX_effects is %s", (_label, arxEffects) => {
    const result = check(manifestWith(arxEffects));
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([`warning ARX_EFFECT_INVALID ${ROOT}`]);
    expect(result.effectIds).toEqual([]);
    expect(result.layerIds).toEqual(["planet"]);
  });
});

describe("validateEffects: one effect is bad", () => {
  const cases: ReadonlyArray<readonly [string, unknown, string]> = [
    ["amount above 4", effect({ id: "b", amount: 5 }), "/effects/1/amount"],
    ["amount below 0.1", effect({ id: "b", amount: 0.05 }), "/effects/1/amount"],
    ["size above 0.2", effect({ id: "b", size: 0.3 }), "/effects/1/size"],
    ["negative speed", effect({ id: "b", speed: -1 }), "/effects/1/speed"],
    ["a short color", effect({ id: "b", colors: ["#FFF", "#18004A"] }), "/effects/1/colors/0"],
    ["one color", effect({ id: "b", colors: ["#FFFFFF"] }), "/effects/1/colors"],
    ["an unknown field", effect({ id: "b", opacity: 1 }), "/effects/1"],
    ["no colors", { id: "b", preset: "rise" }, "/effects/1"],
    ["an empty id", effect({ id: "" }), "/effects/1/id"],
    ["a preset that is not a name", effect({ id: "b", preset: "Sparkle" }), "/effects/1/preset"],
    ["an unknown transform field", effect({ id: "b", transform: { skew: 1 } }), "/effects/1/transform"],
    ["a non-object entry", 5, "/effects/1"],
    [
      "a rotation component above 1",
      effect({ id: "b", transform: { rotation: [0, 0, 0, 1.05] } }),
      "/effects/1/transform/rotation/3",
    ],
    [
      "a rotation norm off by more than 0.01",
      effect({ id: "b", transform: { rotation: [0.3, 0, 0, 1] } }),
      "/effects/1/transform/rotation",
    ],
  ];

  it.each(cases)("drops only the effect with %s", (_label, bad, pointer) => {
    const result = check(withEffects(effect({ id: "a" }), bad));
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([`warning ARX_EFFECT_INVALID ${ROOT}${pointer}`]);
    expect(result.effectIds).toEqual(["a"]);
    expect(result.layerIds).toEqual(["planet"]);
  });

  it("reports each bad effect once, in effect order", () => {
    const result = check(
      withEffects(
        effect({ id: "a", amount: 9, size: 9, speed: 9 }),
        effect({ id: "b" }),
        effect({ id: "c", preset: "firefly" }),
      ),
    );
    expect(result.issues).toEqual([
      `warning ARX_EFFECT_INVALID ${ROOT}/effects/0/amount`,
      `warning ARX_EFFECT_UNSUPPORTED ${ROOT}/effects/2/preset`,
    ]);
    expect(result.effectIds).toEqual(["b"]);
  });
});

describe("validateEffects: ids", () => {
  it("drops an effect whose id is a layer id", () => {
    const result = check(withEffects(effect({ id: "planet" }), effect({ id: "b" })));
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([`warning ARX_EFFECT_INVALID ${ROOT}/effects/0/id`]);
    expect(result.effectIds).toEqual(["b"]);
  });

  it("drops the later of two effects with the same id", () => {
    const result = check(withEffects(effect({ id: "a", preset: "rise" }), effect({ id: "a", preset: "snow" })));
    expect(result.issues).toEqual([`warning ARX_EFFECT_INVALID ${ROOT}/effects/1/id`]);
    expect(result.manifest?.effects.map((resolved) => resolved.preset)).toEqual(["rise"]);
  });

  it("does not reserve the id of an effect that was dropped", () => {
    const result = check(withEffects(effect({ id: "a", preset: "firefly" }), effect({ id: "a" })));
    expect(result.issues).toEqual([`warning ARX_EFFECT_UNSUPPORTED ${ROOT}/effects/0/preset`]);
    expect(result.effectIds).toEqual(["a"]);
  });
});

describe("validateEffects: unknown preset and sprite values", () => {
  it("drops an effect with an unknown preset and keeps the rest", () => {
    const result = check(withEffects(effect({ id: "a", preset: "firefly" }), effect({ id: "b" })));
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([`warning ARX_EFFECT_UNSUPPORTED ${ROOT}/effects/0/preset`]);
    expect(result.effectIds).toEqual(["b"]);
  });

  it("drops an effect with an unknown sprite", () => {
    const result = check(withEffects(effect({ id: "a", sprite: "heart" }), effect({ id: "b", sprite: "dot" })));
    expect(result.issues).toEqual([`warning ARX_EFFECT_UNSUPPORTED ${ROOT}/effects/0/sprite`]);
    expect(result.effectIds).toEqual(["b"]);
  });

  it("does not take inherited object keys for presets", () => {
    const result = check(withEffects(effect({ preset: "constructor" })));
    expect(result.issues).toEqual([`warning ARX_EFFECT_UNSUPPORTED ${ROOT}/effects/0/preset`]);
  });
});

describe("validateEffects: first problem order (schema, rotation, id, preset, sprite)", () => {
  const cases: ReadonlyArray<readonly [string, Json, string]> = [
    [
      "schema before the rest",
      effect({ id: "planet", amount: 9, preset: "firefly", sprite: "heart", transform: { rotation: [0.3, 0, 0, 1] } }),
      "warning ARX_EFFECT_INVALID /effects/0/amount",
    ],
    [
      "rotation before id",
      effect({ id: "planet", preset: "firefly", sprite: "heart", transform: { rotation: [0.3, 0, 0, 1] } }),
      "warning ARX_EFFECT_INVALID /effects/0/transform/rotation",
    ],
    [
      "id before preset",
      effect({ id: "planet", preset: "firefly", sprite: "heart" }),
      "warning ARX_EFFECT_INVALID /effects/0/id",
    ],
    [
      "preset before sprite",
      effect({ preset: "firefly", sprite: "heart" }),
      "warning ARX_EFFECT_UNSUPPORTED /effects/0/preset",
    ],
    [
      "a drifted rotation is not reported for a dropped effect",
      effect({ preset: "firefly", transform: { rotation: [0, 0, 0.1, 1] } }),
      "warning ARX_EFFECT_UNSUPPORTED /effects/0/preset",
    ],
  ];

  it.each(cases)("%s", (_label, bad, expected) => {
    const result = check(withEffects(bad));
    const [severity, code, pointer] = expected.split(" ");
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([`${severity} ${code} ${ROOT}${pointer}`]);
    expect(result.effectIds).toEqual([]);
  });
});

describe("validateEffects: rotation drift", () => {
  const expectNormalized = (actual: readonly number[] | undefined, authored: readonly number[]) => {
    const length = Math.hypot(...authored);
    expect(actual).toBeDefined();
    actual?.forEach((value, index) => expect(value).toBeCloseTo((authored[index] ?? 0) / length, 12));
    expect(Math.hypot(...(actual ?? []))).toBeCloseTo(1, 12);
  };

  it("normalizes a rotation off by 1e-4 to 0.01 and warns ARX_QUATERNION_DRIFT", () => {
    const result = check(withEffects(effect({ transform: { rotation: [0, 0, 0.1, 1] } })));
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([`warning ARX_QUATERNION_DRIFT ${ROOT}/effects/0/transform/rotation`]);
    expectNormalized(result.manifest?.effects[0]?.transform.rotation, [0, 0, 0.1, 1]);
  });

  it("does not warn below 1e-4 and still normalizes", () => {
    const result = check(withEffects(effect({ transform: { rotation: [0, 0, 0.01, 1] } })));
    expect(result.issues).toEqual([]);
    expectNormalized(result.manifest?.effects[0]?.transform.rotation, [0, 0, 0.01, 1]);
  });
});

describe("validateEffects: when effects are not read", () => {
  const badData = { effects: Array.from({ length: MAX_EFFECTS + 1 }, () => effect({ preset: "firefly" })) };

  it("only warns ARX_EXTENSION_UNDECLARED when extensionsUsed lacks ARX_effects", () => {
    const result = check(manifestWith(badData, { extensionsUsed: undefined }));
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([`warning ARX_EXTENSION_UNDECLARED ${ROOT}`]);
    expect(result.effectIds).toEqual([]);
  });

  it.each([
    ["no options (an implementation without ARX_effects support)", undefined],
    ["an empty supported list", { supportedExtensions: [] }],
    ["another supported extension", { supportedExtensions: ["ARX_other"] }],
  ] as const)("ignores good and bad effect data with %s, zero warnings", (_label, options) => {
    for (const input of [withEffects(effect()), manifestWith(badData), manifestWith("not an object")]) {
      const result = validateManifest(input, MANIFEST_URL, options);
      expect(result.issues).toEqual([]);
      expect(result.manifest?.effects).toEqual([]);
      expect(result.manifest?.layers.map((layer) => layer.id)).toEqual(["planet"]);
    }
  });
});

describe("validateEffects through validateExperience", () => {
  const u32 = (value: number) => [value >>> 24, (value >> 16) & 255, (value >> 8) & 255, value & 255];
  const chunk = (type: string, data: number[]) => [
    ...u32(data.length),
    ...Array.from(type, (char) => char.charCodeAt(0)),
    ...data,
    ...u32(0),
  ];
  const png = (size: number) =>
    new Uint8Array([
      ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      ...chunk("IHDR", [...u32(size), ...u32(size), 8, 2, 0, 0, 0]),
      ...chunk("IDAT", []),
      ...chunk("IEND", []),
    ]);

  it("is valid with the bad effect dropped and the good one on the experience", async () => {
    const manifest = withEffects(effect({ id: "a", preset: "firefly" }), effect({ id: "b", preset: "rise" }));
    const served: Record<string, Uint8Array> = {
      [MANIFEST_URL]: new TextEncoder().encode(JSON.stringify(manifest)),
      [`${BASE}target.png`]: png(400),
      [`${BASE}planet.png`]: png(64),
    };
    const result = await validateExperience(
      createRemoteSource(MANIFEST_URL, async (url) => served[url]),
      SUPPORTED,
    );
    expect(result.valid).toBe(true);
    expect(describeIssues(result.issues)).toEqual([`warning ARX_EFFECT_UNSUPPORTED ${ROOT}/effects/0/preset`]);
    const kept = result.experience?.manifest.effects.map((resolved) => [resolved.id, resolved.sprite]);
    expect(kept).toEqual([["b", "dot"]]);
    expect(result.experience?.layers.map((layer) => layer.id)).toEqual(["planet"]);
  });
});
