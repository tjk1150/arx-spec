import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { unzlibSync } from "fflate";
import { afterAll, describe, expect, it } from "vitest";
import { AJV_OPTIONS, SCHEMA_FORMATS } from "../src/schema.constants";

type JsonObject = Record<string, unknown>;
type Preset = { readonly sprite: string; readonly alphaCurve: string } & JsonObject;
type PresetFile = { readonly extension: string; readonly presets: Record<string, Preset> };
type DecodedPng = {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  readonly pixels: Uint8Array;
};

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SPRITES_DIR = path.join(REPO_ROOT, "schema/ext/sprites");
const GENERATOR = path.join(REPO_ROOT, "tools/generate_effect_sprites.py");
const SPRITE_NAMES = ["dot", "glow-star", "soft", "star"] as const;
const PRESET_NAMES = ["burst", "float", "rise", "snow", "sparkle"] as const;
const ALPHA_CURVES = ["constant", "easeFadeOut", "gradualFadeInOut", "linearFadeOut", "quickFadeInOut"] as const;
const TRANSFORM_DEFS = ["position", "rotation", "scale", "transform"] as const;
const SPRITE_SIZE = 64;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const readText = (relative: string) => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const readJson = <T>(relative: string) => JSON.parse(readText(relative)) as T;

const coreSchema = readJson<JsonObject & { $defs: JsonObject }>("schema/arx-0.1.schema.json");
const extensionSchema = readJson<JsonObject & { $defs: JsonObject }>("schema/ext/ARX_effects.schema.json");
const presetFile = readJson<PresetFile>("schema/ext/ARX_effects.presets.json");
const extensionDoc = readText("spec/extensions/ARX_effects.md");
const coreSpec = readText("spec/0.1.md");

const newAjv = () => {
  const ajv = new Ajv2020(AJV_OPTIONS);
  addFormats(ajv, SCHEMA_FORMATS);
  return ajv;
};
const validateExtension = newAjv().compile(extensionSchema);
const validateCore = newAjv().compile(coreSchema);

/** JSON Pointers of the schema errors, relative to the ARX_effects object. */
const errorPaths = (data: unknown): string[] => {
  if (validateExtension(data)) return [];
  return [...new Set((validateExtension.errors ?? []).map((detail) => detail.instancePath || "/"))];
};

const specSection = (heading: string): string => {
  const start = coreSpec.indexOf(`\n${heading}`);
  if (start < 0) throw new Error(`spec/0.1.md has no heading ${heading}`);
  const end = coreSpec.indexOf("\n## ", start + 1);
  return coreSpec.slice(start, end < 0 ? undefined : end);
};

const effect = (overrides: JsonObject = {}): JsonObject => ({
  id: "sparkle-1",
  preset: "sparkle",
  colors: ["#FF0071", "#18004A"],
  ...overrides,
});
const effects = (...list: JsonObject[]) => ({ effects: list });

// ------------------------------------------------------------------ PNG reading

const u32 = (bytes: Uint8Array, offset: number) =>
  ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
const chunkType = (bytes: Uint8Array, offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));

const paeth = (left: number, up: number, upLeft: number) => {
  const estimate = left + up - upLeft;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toUpLeft = Math.abs(estimate - upLeft);
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
};

/** Decodes a non-interlaced 8-bit RGBA PNG into straight RGBA bytes. */
const decodePng = (bytes: Uint8Array): DecodedPng => {
  expect([...bytes.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
  expect(chunkType(bytes, 12)).toBe("IHDR");
  const width = u32(bytes, 16);
  const height = u32(bytes, 20);
  const bitDepth = bytes[24]!;
  const colorType = bytes[25]!;
  const interlace = bytes[28]!;
  const data: Uint8Array[] = [];
  for (let offset = 8; offset + 8 <= bytes.length; ) {
    const length = u32(bytes, offset);
    const type = chunkType(bytes, offset + 4);
    if (type === "IDAT") data.push(bytes.subarray(offset + 8, offset + 8 + length));
    if (type === "IEND") break;
    offset += 12 + length;
  }
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    return { width, height, bitDepth, colorType, pixels: new Uint8Array() };
  }
  const joined = new Uint8Array(data.reduce((sum, part) => sum + part.length, 0));
  data.reduce((offset, part) => (joined.set(part, offset), offset + part.length), 0);
  const raw = unzlibSync(joined);
  const stride = width * 4;
  const pixels = new Uint8Array(stride * height);
  for (let row = 0; row < height; row++) {
    const filter = raw[row * (stride + 1)]!;
    const source = row * (stride + 1) + 1;
    const target = row * stride;
    for (let column = 0; column < stride; column++) {
      const left = column >= 4 ? pixels[target + column - 4]! : 0;
      const up = row > 0 ? pixels[target - stride + column]! : 0;
      const upLeft = row > 0 && column >= 4 ? pixels[target - stride + column - 4]! : 0;
      const predictor = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter];
      if (predictor === undefined) throw new Error(`unknown PNG filter ${filter}`);
      pixels[target + column] = (raw[source + column]! + predictor) & 255;
    }
  }
  return { width, height, bitDepth, colorType, pixels };
};

// ------------------------------------------------------------------ extension schema

describe("schema/ext/ARX_effects.schema.json", () => {
  it("compiles with Ajv in the same strict Draft 2020-12 mode as the core schema", () => {
    expect(extensionSchema.$schema).toBe(coreSchema.$schema);
    expect(typeof validateExtension).toBe("function");
  });

  it.each(TRANSFORM_DEFS)("copies $defs.%s from arx-0.1.schema.json unchanged", (name) => {
    expect(extensionSchema.$defs[name]).toBeDefined();
    expect(extensionSchema.$defs[name]).toEqual(coreSchema.$defs[name]);
  });

  it("allows 1 to 8 effects", () => {
    const list = Array.from({ length: 8 }, (_, index) => effect({ id: `effect-${index}` }));
    expect(errorPaths(effects(effect()))).toEqual([]);
    expect(errorPaths(effects(...list))).toEqual([]);
    expect(errorPaths(effects())).toEqual(["/effects"]);
    expect(errorPaths(effects(...list, effect({ id: "effect-8" })))).toEqual(["/effects"]);
  });

  it("accepts every optional field at both ends of its range", () => {
    const full = effect({
      transform: { position: [0.1, 0.2, 0.03], rotation: [0, 0, 0, 1], scale: [0.2, 0.2, 1] },
      amount: 0.1,
      size: 0.002,
      speed: 0,
      sprite: "star",
    });
    const upper = effect({ id: "b", amount: 4, size: 0.2, speed: 4, sprite: "dot", colors: ["#ffffff", "#FFFFFF"] });
    expect(errorPaths(effects(full, upper))).toEqual([]);
  });

  it("leaves unknown preset and sprite names to the validator (ARX_EFFECT_UNSUPPORTED)", () => {
    expect(errorPaths(effects(effect({ preset: "firefly", sprite: "heart" })))).toEqual([]);
  });

  it.each([
    ["not an object", [], "/"],
    ["effects not an array", { effects: { id: "a" } }, "/effects"],
    ["missing effects", {}, "/"],
    ["unknown field on the extension object", { ...effects(effect()), version: 2 }, "/"],
    ["unknown field on an effect", effects(effect({ opacity: 1 })), "/effects/0"],
    ["missing id", effects({ preset: "sparkle", colors: ["#FFFFFF", "#FFFFFF"] }), "/effects/0"],
    ["empty id", effects(effect({ id: "" })), "/effects/0/id"],
    ["id over 128 characters", effects(effect({ id: "x".repeat(129) })), "/effects/0/id"],
    ["missing preset", effects({ id: "a", colors: ["#FFFFFF", "#FFFFFF"] }), "/effects/0"],
    ["preset not a name", effects(effect({ preset: "Sparkle" })), "/effects/0/preset"],
    ["missing colors", effects({ id: "a", preset: "rise" }), "/effects/0"],
    ["one color", effects(effect({ colors: ["#FFFFFF"] })), "/effects/0/colors"],
    ["three colors", effects(effect({ colors: ["#FFFFFF", "#FFFFFF", "#FFFFFF"] })), "/effects/0/colors"],
    ["short hex color", effects(effect({ colors: ["#FFF", "#FFFFFF"] })), "/effects/0/colors/0"],
    ["color with alpha", effects(effect({ colors: ["#FFFFFF", "#FFFFFF80"] })), "/effects/0/colors/1"],
    ["amount below 0.1", effects(effect({ amount: 0.05 })), "/effects/0/amount"],
    ["amount above 4", effects(effect({ amount: 4.5 })), "/effects/0/amount"],
    ["size below 0.002", effects(effect({ size: 0.001 })), "/effects/0/size"],
    ["size above 0.2", effects(effect({ size: 0.3 })), "/effects/0/size"],
    ["negative speed", effects(effect({ speed: -1 })), "/effects/0/speed"],
    ["speed above 4", effects(effect({ speed: 5 })), "/effects/0/speed"],
    ["sprite not a name", effects(effect({ sprite: "Star.png" })), "/effects/0/sprite"],
    ["rotation component above 1", effects(effect({ transform: { rotation: [0, 0, 1.5, 1] } })), "/effects/0/transform/rotation/2"],
    ["zero scale", effects(effect({ transform: { scale: [0, 1, 1] } })), "/effects/0/transform/scale/0"],
    ["unknown transform field", effects(effect({ transform: { skew: [0, 0] } })), "/effects/0/transform"],
  ])("rejects %s", (_name, data, pointer) => {
    expect(errorPaths(data)).toContain(pointer);
  });

  it("points an invalid effect's errors at that effect only", () => {
    const paths = errorPaths(effects(effect(), effect({ id: "b", amount: 9 }), effect({ id: "c" })));
    expect(paths).toEqual(["/effects/1/amount"]);
  });
});

// ------------------------------------------------------------------ preset table

describe("schema/ext/ARX_effects.presets.json", () => {
  it("names the extension and holds exactly sparkle, rise, burst, snow and float", () => {
    expect(presetFile.extension).toBe("ARX_effects");
    expect(Object.keys(presetFile.presets).sort()).toEqual([...PRESET_NAMES]);
  });

  it.each(PRESET_NAMES)("%s passes the schema's preset name rule and uses a known sprite and curve", (name) => {
    const preset = presetFile.presets[name]!;
    expect(errorPaths(effects(effect({ preset: name, sprite: preset.sprite })))).toEqual([]);
    expect(SPRITE_NAMES).toContain(preset.sprite);
    expect(ALPHA_CURVES).toContain(preset.alphaCurve);
  });
});

// ------------------------------------------------------------------ normative text

describe("spec/extensions/ARX_effects.md", () => {
  const example = /```json\n([\s\S]*?)\n```/.exec(extensionDoc)?.[1];

  it("has a manifest example that stays arx/0.1 and declares the extension only in extensionsUsed", () => {
    expect(example).toBeDefined();
    const manifest = JSON.parse(example ?? "{}") as JsonObject & { extensions?: JsonObject };
    expect(manifest.spec).toBe("arx/0.1");
    expect(manifest.extensionsUsed).toEqual(["ARX_effects"]);
    expect(manifest).not.toHaveProperty("extensionsRequired");
    expect(validateCore(manifest)).toBe(true);
    expect(errorPaths(manifest.extensions?.ARX_effects)).toEqual([]);
  });

  it("forbids extensionsRequired and points at the preset file and the sprite generator", () => {
    expect(extensionDoc).toMatch(/`extensionsRequired`[^\n]*MUST NOT/);
    expect(extensionDoc).toContain("../../schema/ext/ARX_effects.presets.json");
    expect(extensionDoc).toContain("../../schema/ext/ARX_effects.schema.json");
    expect(extensionDoc).toContain("../../tools/generate_effect_sprites.py");
  });

  it.each(ALPHA_CURVES)("defines the alpha curve %s", (name) => {
    expect(extensionDoc).toMatch(new RegExp(`\`${name}\`[^\\n]*=`));
  });

  it("defines both warning codes", () => {
    expect(extensionDoc).toContain("`ARX_EFFECT_INVALID`");
    expect(extensionDoc).toContain("`ARX_EFFECT_UNSUPPORTED`");
  });
});

describe("spec/0.1.md registration", () => {
  it("lists ARX_effects as a registered extension at the end of section 10", () => {
    expect(specSection("## 10.")).toMatch(/등록된 확장: \[`ARX_effects`\]\(extensions\/ARX_effects\.md\)/);
  });

  it.each(["ARX_EFFECT_INVALID", "ARX_EFFECT_UNSUPPORTED"])("lists %s as a warning in section 13", (code) => {
    expect(specSection("## 13.")).toMatch(new RegExp(`^\\| \`${code}\` \\| warning \\|`, "m"));
  });
});

// ------------------------------------------------------------------ sprites

describe("schema/ext/sprites", () => {
  it("holds exactly dot, glow-star, soft and star", () => {
    expect(readdirSync(SPRITES_DIR).sort()).toEqual(SPRITE_NAMES.map((name) => `${name}.png`));
  });

  it.each(SPRITE_NAMES)("%s.png is a 64x64 white RGBA PNG with straight alpha", (name) => {
    const png = decodePng(new Uint8Array(readFileSync(path.join(SPRITES_DIR, `${name}.png`))));
    expect([png.width, png.height, png.bitDepth, png.colorType]).toEqual([SPRITE_SIZE, SPRITE_SIZE, 8, 6]);
    const alphas = png.pixels.filter((_, index) => index % 4 === 3);
    const colors = png.pixels.filter((_, index) => index % 4 !== 3);
    expect(colors.every((value) => value === 255)).toBe(true);
    expect(alphas[0]).toBe(0);
    expect(Math.max(...alphas)).toBeGreaterThanOrEqual(250);
  });
});

describe("tools/generate_effect_sprites.py", () => {
  const runs = [mkdtempSync(path.join(tmpdir(), "arx-sprites-")), mkdtempSync(path.join(tmpdir(), "arx-sprites-"))];
  afterAll(() => runs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  // The compressed bytes depend on the zlib build and the CPU (zlib-ng picks its deflate code per architecture), so a new
  // run is compared with the checked-in sprite by its pixels; two runs on one machine still match byte for byte.
  it("writes the same bytes on every run and the same pixels as the checked-in sprites", () => {
    runs.forEach((dir) => execFileSync("python3", [GENERATOR, "--out", dir], { stdio: "ignore" }));
    for (const name of SPRITE_NAMES) {
      const file = `${name}.png`;
      const [first, second] = runs.map((dir) => readFileSync(path.join(dir, file)));
      expect(first!.equals(second!), `${file} differs between runs`).toBe(true);
      expect(decodePng(first!), `${file} pixels differ from the repository`).toEqual(decodePng(readFileSync(path.join(SPRITES_DIR, file))));
    }
  });
});
