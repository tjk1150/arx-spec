// @arx/core/effects: browser-safe effect shapes, limits, preset table, resolution, and simulation.
// The validator (Ajv) is not exported here.
export type {
  AlphaCurveName,
  EffectColor,
  EffectEmission,
  EffectPreset,
  EffectPresetTable,
  EffectRange,
  EffectRangeWithDefault,
  EffectSprite,
  EffectSimulation,
  ManifestEffect,
  ParticleView,
  ResolvedEffect,
} from "./effects.types";
export { EFFECTS_EXTENSION, EFFECT_LIMITS, MAX_EFFECTS } from "./effects.constants";
export { EFFECT_PRESETS } from "./presets.constants";
export { resolveEffect } from "./resolve-effect";
export { createEffectSimulation } from "./simulate";
