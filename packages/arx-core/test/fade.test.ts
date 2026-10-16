import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FADE_SECONDS, fadeOpacity } from "../src/fade/index";

type FadeSample = { readonly name: string; readonly elapsedSeconds: number; readonly opacity: number };
type FadeVectors = {
  readonly durationSeconds: number;
  readonly curve: string;
  readonly tolerance: number;
  readonly samples: readonly FadeSample[];
};

const REPO_ROOT = path.resolve(__dirname, "../../..");
const vectors = JSON.parse(readFileSync(path.join(REPO_ROOT, "fixtures/viewer/fade.json"), "utf8")) as FadeVectors;
const packageExports = (
  JSON.parse(readFileSync(path.resolve(__dirname, "../package.json"), "utf8")) as {
    exports: Record<string, unknown>;
  }
).exports;

describe("fixtures/viewer/fade.json", () => {
  it("describes the linear 0.4 s fade with a 1e-9 tolerance", () => {
    expect(vectors.curve).toBe("linear");
    expect(vectors.durationSeconds).toBe(0.4);
    expect(vectors.tolerance).toBe(1e-9);
  });

  it("covers the clamp below 0, the start, the middle, the end, and past the end", () => {
    expect(vectors.samples.map((sample) => sample.elapsedSeconds)).toEqual([-0.1, 0, 0.2, 0.4, 0.6]);
  });
});

describe("FADE_SECONDS", () => {
  it("equals the vector file's durationSeconds", () => {
    expect(FADE_SECONDS).toBe(vectors.durationSeconds);
  });
});

describe("fadeOpacity", () => {
  it.each(vectors.samples)("$name: $elapsedSeconds s -> $opacity", ({ elapsedSeconds, opacity }) => {
    expect(Math.abs(fadeOpacity(elapsedSeconds) - opacity)).toBeLessThanOrEqual(vectors.tolerance);
  });

  it("stays inside [0, 1] far outside the duration", () => {
    expect(fadeOpacity(-1_000)).toBe(0);
    expect(fadeOpacity(1_000)).toBe(1);
  });

  it("grows linearly inside the duration", () => {
    const quarter = FADE_SECONDS / 4;
    expect(fadeOpacity(quarter)).toBeCloseTo(0.25, 9);
    expect(fadeOpacity(3 * quarter)).toBeCloseTo(0.75, 9);
  });
});

describe("@arx/core/fade entry", () => {
  it("is exported from package.json at ./fade", () => {
    expect(packageExports["./fade"]).toBe("./src/fade/index.ts");
  });

  it("exports exactly FADE_SECONDS and fadeOpacity", async () => {
    expect(Object.keys(await import("../src/fade/index")).sort()).toEqual(["FADE_SECONDS", "fadeOpacity"]);
  });
});
