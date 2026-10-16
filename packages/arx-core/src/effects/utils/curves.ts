import { ALPHA_CURVE_EDGES } from "../effects.constants";
import type { AlphaCurveName } from "../effects.types";

/** Rises over the first `edge` of life, holds 1, and falls over the last `edge`. */
const fadeInOut = (lifeFraction: number, edge: number): number =>
  Math.min(1, lifeFraction / edge, (1 - lifeFraction) / edge);

/**
 * Particle alpha at life fraction `lifeFraction` (0..1) for a named curve
 * (spec/extensions/ARX_effects.md section 6). Throws for a name outside the table, which
 * checkPresets already rules out.
 */
export const alphaCurve = (name: AlphaCurveName, lifeFraction: number): number => {
  switch (name) {
    case "linearFadeOut":
      return 1 - lifeFraction;
    case "easeFadeOut":
      return 1 - lifeFraction * lifeFraction;
    case "quickFadeInOut":
      return fadeInOut(lifeFraction, ALPHA_CURVE_EDGES.quickFadeInOut);
    case "gradualFadeInOut":
      return fadeInOut(lifeFraction, ALPHA_CURVE_EDGES.gradualFadeInOut);
    case "constant":
      return 1;
    default:
      throw new Error(`unknown alpha curve ${String(name satisfies never)}`);
  }
};
