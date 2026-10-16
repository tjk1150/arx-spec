import type { Transform } from "../types";
import type { AlphaCurveName, EffectRange, EffectRangeWithDefault, EffectSprite } from "./effects.types";

/** Extension name in `extensionsUsed` and the `extensions` key. */
export const EFFECTS_EXTENSION = "ARX_effects";

/**
 * Most effects per manifest, the one place of this limit. The extension schema's
 * `effects.maxItems` of every schema that bounds effects must equal it; tests tie them together.
 */
export const MAX_EFFECTS = 8;

/** Ranges and defaults of the effect fields (schema/ext/ARX_effects.schema.json `$defs.effect`). */
export const EFFECT_LIMITS: {
  readonly amount: EffectRangeWithDefault;
  readonly size: EffectRange;
  readonly speed: EffectRangeWithDefault;
  readonly idLength: EffectRange;
  /** Per-emitter cap on live particles. The preset table never reaches it at amount 4. */
  readonly maxParticles: number;
} = Object.freeze({
  amount: Object.freeze({ min: 0.1, max: 4, default: 1 }),
  size: Object.freeze({ min: 0.002, max: 0.2 }),
  speed: Object.freeze({ min: 0, max: 4, default: 1 }),
  idLength: Object.freeze({ min: 1, max: 128 }),
  maxParticles: 256,
});

/** Emitter transform defaults, the same as a layer's. */
export const DEFAULT_EFFECT_TRANSFORM: Transform = Object.freeze({
  position: Object.freeze([0, 0, 0] as const),
  rotation: Object.freeze([0, 0, 0, 1] as const),
  scale: Object.freeze([1, 1, 1] as const),
});

/** Built-in sprites, one PNG each under schema/ext/sprites/. */
export const EFFECT_SPRITES: readonly EffectSprite[] = Object.freeze(["dot", "soft", "star", "glow-star"] as const);

export const ALPHA_CURVE_NAMES: readonly AlphaCurveName[] = Object.freeze([
  "linearFadeOut",
  "easeFadeOut",
  "quickFadeInOut",
  "gradualFadeInOut",
  "constant",
] as const);

/** Life fraction of the fade-in and of the fade-out of the two in-out alpha curves. */
export const ALPHA_CURVE_EDGES = Object.freeze({ quickFadeInOut: 0.1, gradualFadeInOut: 0.3 });

/** Preset and sprite name pattern of the extension schema. */
export const EFFECT_NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

/** Field names of one preset row, in table order. */
export const PRESET_FIELDS: readonly string[] = Object.freeze([
  "shapeSize",
  "direction",
  "spreadDegrees",
  "emission",
  "rate",
  "lifetime",
  "speed",
  "speedVariation",
  "acceleration",
  "size",
  "sizeVariation",
  "endSizeScale",
  "angleDegrees",
  "angularSpeedDegrees",
  "alphaCurve",
  "sprite",
]);

/** Largest |norm(direction) - 1| a preset direction may have. */
export const DIRECTION_TOLERANCE = 1e-9;
