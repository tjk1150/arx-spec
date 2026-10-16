import type { ManifestTransform, Mat4, Transform, Vec2, Vec3 } from "../types";

/** sRGB color as `#RRGGBB`. */
export type EffectColor = string;

/** Built-in sprite names (spec/extensions/ARX_effects.md section 8). */
export type EffectSprite = "dot" | "soft" | "star" | "glow-star";

/** Alpha curve names of the preset table (spec section 6). */
export type AlphaCurveName = "linearFadeOut" | "easeFadeOut" | "quickFadeInOut" | "gradualFadeInOut" | "constant";

/** One entry of `extensions.ARX_effects.effects[]` as authored; optional fields may be absent. */
export interface ManifestEffect {
  readonly id: string;
  readonly transform?: ManifestTransform;
  /** A preset name of the table. Unknown well-formed names are dropped by the validator. */
  readonly preset: string;
  /** Birth color, then death color. */
  readonly colors: readonly [EffectColor, EffectColor];
  readonly amount?: number;
  readonly size?: number;
  readonly speed?: number;
  /** A built-in sprite name. Unknown well-formed names are dropped by the validator. */
  readonly sprite?: string;
}

/** An effect with its defaults filled, its rotation normalized, and its emitter matrix. */
export interface ResolvedEffect {
  readonly id: string;
  readonly preset: string;
  readonly colors: readonly [EffectColor, EffectColor];
  readonly amount: number;
  readonly size: number;
  readonly speed: number;
  readonly sprite: string;
  readonly transform: Transform;
  /** Emitter-to-content-root matrix E = T x R x S, column-major. */
  readonly matrix: Mat4;
}

export type EffectEmission =
  | { readonly kind: "continuous" }
  | { readonly kind: "burst"; readonly emitSeconds: number; readonly pauseSeconds: number };

/** One row of schema/ext/ARX_effects.presets.json. Field meanings: spec section 5. */
export interface EffectPreset {
  readonly shapeSize: Vec3;
  readonly direction: Vec3;
  readonly spreadDegrees: number;
  readonly emission: EffectEmission;
  readonly rate: number;
  readonly lifetime: Vec2;
  readonly speed: number;
  readonly speedVariation: number;
  readonly acceleration: Vec3;
  readonly size: number;
  readonly sizeVariation: number;
  readonly endSizeScale: number;
  readonly angleDegrees: Vec2;
  readonly angularSpeedDegrees: Vec2;
  readonly alphaCurve: AlphaCurveName;
  readonly sprite: EffectSprite;
}

/** Preset name to preset. Built with a null prototype, so only table names resolve. */
export type EffectPresetTable = Readonly<Record<string, EffectPreset>>;

export interface EffectRange {
  readonly min: number;
  readonly max: number;
}

export interface EffectRangeWithDefault extends EffectRange {
  readonly default: number;
}

/** A parsed JSON object whose fields are not yet checked (preset table input). */
export type JsonObject = Readonly<Record<string, unknown>>;

/**
 * One live particle after the last `advance`, read from the simulation's buffer: valid until the
 * next `advance`. Position is in content-root space (target-width units, spec section 3).
 */
export interface ParticleView {
  /** Birth number, from 0 (spec section 7.3). */
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Side length of the billboard, target-width units. */
  readonly size: number;
  /** Rotation of the billboard in degrees; positive is counterclockwise to the viewer. */
  readonly angleDegrees: number;
  /** sRGB channels, 0..1. */
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

/** Deterministic particle state of one effect (spec section 7), computed from the effect clock. */
export interface EffectSimulation {
  /**
   * Computes the live particles at effect time `timeSeconds` (spec 7.1: starts at 0 when the effect
   * is first shown, hidden while the target is not tracked, and starts again at 0 when the target
   * is tracked again). The state depends only on this time, never on earlier calls.
   */
  readonly advance: (timeSeconds: number) => void;
  /**
   * Starts the effect again from time 0 (spec 7.1, the target is tracked again): clears the live
   * particles, as before the first `advance`. The caller restarts its effect clock at 0, so the
   * next `advance(T)` gives the particles of a fresh simulation at T, from birth number 0.
   */
  readonly restart: () => void;
  /** Live particles of the last `advance`, oldest first; empty before the first call. */
  readonly particles: () => ReadonlyArray<ParticleView>;
}
