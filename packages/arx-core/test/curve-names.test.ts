import { describe, expect, it } from "vitest";
import type { AlphaCurveName } from "../src/effects/effects.types";
import { alphaCurve } from "../src/effects/utils/curves";

// Pins the alpha curve samples (spec/extensions/ARX_effects.md section 6) across the
// rename of the life fraction parameter, so a rename that changes a value fails here.
const samples: ReadonlyArray<readonly [AlphaCurveName, number, number]> = [
  ["linearFadeOut", 0, 1],
  ["linearFadeOut", 0.25, 0.75],
  ["linearFadeOut", 0.6, 0.4],
  ["linearFadeOut", 1, 0],
  ["easeFadeOut", 0, 1],
  ["easeFadeOut", 0.5, 0.75],
  ["easeFadeOut", 0.9, 0.19],
  ["easeFadeOut", 1, 0],
  ["quickFadeInOut", 0, 0],
  ["quickFadeInOut", 0.02, 0.2],
  ["quickFadeInOut", 0.05, 0.5],
  ["quickFadeInOut", 0.1, 1],
  ["quickFadeInOut", 0.5, 1],
  ["quickFadeInOut", 0.95, 0.5],
  ["quickFadeInOut", 0.98, 0.2],
  ["quickFadeInOut", 1, 0],
  ["gradualFadeInOut", 0, 0],
  ["gradualFadeInOut", 0.06, 0.2],
  ["gradualFadeInOut", 0.15, 0.5],
  ["gradualFadeInOut", 0.3, 1],
  ["gradualFadeInOut", 0.5, 1],
  ["gradualFadeInOut", 0.85, 0.5],
  ["gradualFadeInOut", 0.94, 0.2],
  ["gradualFadeInOut", 1, 0],
  ["constant", 0, 1],
  ["constant", 0.5, 1],
  ["constant", 1, 1],
];

describe("alpha curves keep their values after the parameter rename", () => {
  it.each(samples)("%s at life fraction %s is %s", (name, lifeFraction, expected) => {
    expect(alphaCurve(name, lifeFraction)).toBeCloseTo(expected, 12);
  });

  it("the fade-in and fade-out edges of a symmetric curve mirror each other", () => {
    const fractions = [0, 0.03, 0.07, 0.12, 0.2, 0.29];
    (["quickFadeInOut", "gradualFadeInOut"] as const).forEach((name) => {
      fractions.forEach((lifeFraction) => {
        expect(alphaCurve(name, 1 - lifeFraction)).toBeCloseTo(alphaCurve(name, lifeFraction), 12);
      });
    });
  });
});
