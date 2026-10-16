/**
 * The built-in sprite `glow-star`: a bright core, a soft round glow and four
 * thin rays that fade toward the tips, the default sprite of the `float` preset. The file follows the rules of
 * spec/extensions/ARX_effects.md section 8 (64x64, white RGB, straight alpha, the generator writes the same bytes),
 * and adding it leaves the bytes of the three earlier sprites as they were.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { unzlibSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EFFECT_PRESETS, resolveEffect } from "../src/effects/index";
import { EFFECT_SPRITES } from "../src/effects/effects.constants";
import { checkPresets } from "../src/effects/utils/check-presets";

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
const SIZE = 64;
const CENTER = SIZE / 2;
/** SHA-256 of the three sprites before `glow-star` was added; adding a sprite must not change them. */
const EARLIER_SPRITES: Readonly<Record<string, string>> = {
  "dot.png": "7fd230a209dc312344ece744343ad15b4f7bc72ecd7294fdca7299511a3b4c2d",
  "soft.png": "ba26906f07cb83ae6295f5264beeb3232655c26d21bcd07b0a86f87a92095dce",
  "star.png": "36ec236788d3cf85628514822c0ab5faa7ebc6b132014c48f90850b280805fe0",
};

const readText = (relative: string) => readFileSync(path.join(REPO_ROOT, relative), "utf8");
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const extensionDoc = readText("spec/extensions/ARX_effects.md");

const docSection = (heading: string): string => {
  const start = extensionDoc.indexOf(`\n${heading}`);
  if (start < 0) throw new Error(`ARX_effects.md has no heading ${heading}`);
  const end = extensionDoc.indexOf("\n## ", start + 1);
  return extensionDoc.slice(start, end < 0 ? undefined : end);
};

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

/** Decodes a non-interlaced 8-bit RGBA PNG into straight RGBA bytes; other formats come back without pixels. */
const decodePng = (bytes: Uint8Array): DecodedPng => {
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

// ------------------------------------------------------------------ the file

const pngBytes = new Uint8Array(readFileSync(path.join(SPRITES_DIR, "glow-star.png")));
const png = decodePng(pngBytes);
const alphaAt = (x: number, y: number) => png.pixels[(y * SIZE + x) * 4 + 3] ?? -1;
/** Alpha of the pixel `step` pixels right of the center, in the row just above the horizontal ray's axis. */
const axisAlpha = (step: number) => alphaAt(CENTER + step, CENTER - 1);
/** Alpha of the pixel `step` pixels down and right of the center, on the diagonal. */
const diagonalAlpha = (step: number) => alphaAt(CENTER + step, CENTER + step);
/** Distance in pixels from the sprite center to the center of the axis or diagonal pixel at `step`. */
const axisDistance = (step: number) => Math.hypot(step + 0.5, 0.5);
const diagonalDistance = (step: number) => (step + 0.5) * Math.SQRT2;

describe("schema/ext/sprites/glow-star.png", () => {
  it("is a 64x64 8-bit RGBA PNG, white in every pixel, with the shape in straight alpha", () => {
    expect([png.width, png.height, png.bitDepth, png.colorType]).toEqual([SIZE, SIZE, 8, 6]);
    const colors = png.pixels.filter((_, index) => index % 4 !== 3);
    expect(colors.length).toBe(SIZE * SIZE * 3);
    expect(colors.every((value) => value === 255)).toBe(true);
    expect([alphaAt(0, 0), alphaAt(SIZE - 1, 0), alphaAt(0, SIZE - 1), alphaAt(SIZE - 1, SIZE - 1)]).toEqual([0, 0, 0, 0]);
  });

  it("is brightest at the center: the four center pixels hold the largest alpha, at least 250", () => {
    const alphas = png.pixels.filter((_, index) => index % 4 === 3);
    const center = [alphaAt(CENTER - 1, CENTER - 1), alphaAt(CENTER, CENTER - 1), alphaAt(CENTER - 1, CENTER), alphaAt(CENTER, CENTER)];
    expect(Math.max(...alphas)).toBe(Math.max(...center));
    expect(Math.min(...center)).toBeGreaterThanOrEqual(250);
  });

  it("fades outward along the rays and along the diagonals", () => {
    const axis = Array.from({ length: CENTER }, (_, step) => axisAlpha(step));
    const diagonal = Array.from({ length: CENTER }, (_, step) => diagonalAlpha(step));
    axis.slice(1).forEach((alpha, index) => expect(alpha, `axis step ${index + 1}`).toBeLessThanOrEqual(axis[index]!));
    diagonal.slice(1).forEach((alpha, index) => expect(alpha, `diagonal step ${index + 1}`).toBeLessThanOrEqual(diagonal[index]!));
    expect(axis[CENTER - 1]).toBe(0);
  });

  it("is stronger along the four rays than along the diagonals at the same or a smaller distance", () => {
    for (let step = 6; step < CENTER - 2; step++) {
      // The diagonal pixel no farther from the center than the axis pixel.
      const diagonalStep = Math.floor(axisDistance(step) / Math.SQRT2 - 0.5);
      expect(diagonalDistance(diagonalStep)).toBeLessThanOrEqual(axisDistance(step));
      expect(axisAlpha(step), `axis ${step} vs diagonal ${diagonalStep}`).toBeGreaterThan(diagonalAlpha(diagonalStep));
    }
  });

  it("has a glow between the rays: alpha above 0 on the diagonal 0.3 sprite widths from the center", () => {
    const step = Math.round((0.3 * SIZE) / Math.SQRT2 - 0.5);
    expect(diagonalDistance(step)).toBeGreaterThanOrEqual(0.3 * SIZE - 0.5);
    expect(diagonalAlpha(step)).toBeGreaterThan(0);
  });

  it.each(["vertical", "horizontal"])("is symmetric about the %s axis", (axis) => {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const mirrored = axis === "vertical" ? alphaAt(SIZE - 1 - x, y) : alphaAt(x, SIZE - 1 - y);
        expect(mirrored).toBe(alphaAt(x, y));
      }
    }
  });
});

describe("tools/generate_effect_sprites.py and glow-star", () => {
  const runs = [mkdtempSync(path.join(tmpdir(), "arx-glow-star-")), mkdtempSync(path.join(tmpdir(), "arx-glow-star-"))];
  // Both runs exist before any test reads them, so the tests below pass in any order (--sequence.shuffle).
  beforeAll(() => runs.forEach((dir) => execFileSync("python3", [GENERATOR, "--out", dir], { stdio: "ignore" })));
  afterAll(() => runs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  // A new run matches the checked-in file by pixels: the compressed bytes depend on the zlib build and the CPU.
  it("writes glow-star.png with the same bytes on two runs and the same pixels as the checked-in file", () => {
    const [first, second] = runs.map((dir) => readFileSync(path.join(dir, "glow-star.png")));
    expect(first!.equals(second!)).toBe(true);
    expect(decodePng(first!)).toEqual(decodePng(pngBytes));
  });

  it.each(Object.keys(EARLIER_SPRITES))("leaves %s with its earlier bytes in the repository and its pixels in a new run", (name) => {
    const checkedIn = readFileSync(path.join(SPRITES_DIR, name));
    expect(sha256(checkedIn)).toBe(EARLIER_SPRITES[name]);
    expect(decodePng(readFileSync(path.join(runs[0]!, name)))).toEqual(decodePng(checkedIn));
  });
});

describe("glow-star as a known sprite", () => {
  it("is in EFFECT_SPRITES after the three earlier ones", () => {
    expect(EFFECT_SPRITES).toEqual(["dot", "soft", "star", "glow-star"]);
  });

  it("is a row of the spec's section 8 table and a value section 2 defines", () => {
    expect(docSection("## 8.")).toMatch(/^\| `glow-star` \| [^\n]*빛[^\n]*네 갈래[^\n]*\|$/m);
    expect(docSection("## 2.")).toMatch(/이 문서가 정한 값은 `dot`, `soft`, `star`, `glow-star`/);
  });

  it("schema/ext/ARX_effects.schema.json states glow-star as a known sprite", () => {
    expect(readText("schema/ext/ARX_effects.schema.json")).toContain("Known values: dot, soft, star, glow-star.");
  });

  it("is the float preset's default sprite, and checkPresets accepts it", () => {
    expect(EFFECT_PRESETS.float?.sprite).toBe("glow-star");
    expect(resolveEffect({ id: "mint", preset: "float", colors: ["#36F4B8", "#36F4B8"] }).sprite).toBe("glow-star");
    expect(() => checkPresets(JSON.parse(readText("schema/ext/ARX_effects.presets.json")))).not.toThrow();
  });

  it("section 5 says a Viewer draws its own table's default sprite and drops only an effect whose sprite it lacks", () => {
    const section = docSection("## 5.");
    expect(section).toMatch(/그 값을 모르는 구현은 그 효과만 뺀다\(`ARX_EFFECT_UNSUPPORTED`\)/);
    expect(section).toMatch(/프리셋의 기본 `sprite`[^\n]*자기 프리셋 표/);
  });
});
