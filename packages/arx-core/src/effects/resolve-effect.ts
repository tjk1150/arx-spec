import { composeTrs, normalizeQuat, quatNormDeviation } from "../math";
import type { Transform } from "../types";
import { DEFAULT_EFFECT_TRANSFORM, EFFECT_LIMITS } from "./effects.constants";
import type { EffectPreset, ManifestEffect, ResolvedEffect } from "./effects.types";
import { EFFECT_PRESETS } from "./presets.constants";

const presetOf = (name: string): EffectPreset => {
  const preset = Object.hasOwn(EFFECT_PRESETS, name) ? EFFECT_PRESETS[name] : undefined;
  if (preset === undefined) throw new Error(`resolveEffect: unknown preset ${name}`);
  return preset;
};

/** Layer transform rules: field defaults, and a drifted rotation normalized. */
const resolveTransform = (effect: ManifestEffect): Transform => {
  const rotation = effect.transform?.rotation ?? DEFAULT_EFFECT_TRANSFORM.rotation;
  return {
    position: effect.transform?.position ?? DEFAULT_EFFECT_TRANSFORM.position,
    rotation: quatNormDeviation(rotation) === 0 ? rotation : normalizeQuat(rotation),
    scale: effect.transform?.scale ?? DEFAULT_EFFECT_TRANSFORM.scale,
  };
};

/**
 * Fills an effect's defaults (amount, speed, and the preset's size and sprite), normalizes its
 * rotation, and builds the emitter matrix E = composeTrs(transform) (spec section 4.3). It does no
 * schema checks: the validator calls it on effects that passed them, and preview renderers on
 * values already in range. Throws for a preset outside the table.
 */
export const resolveEffect = (effect: ManifestEffect): ResolvedEffect => {
  const preset = presetOf(effect.preset);
  const transform = resolveTransform(effect);
  return {
    id: effect.id,
    preset: effect.preset,
    colors: effect.colors,
    amount: effect.amount ?? EFFECT_LIMITS.amount.default,
    size: effect.size ?? preset.size,
    speed: effect.speed ?? EFFECT_LIMITS.speed.default,
    sprite: effect.sprite ?? preset.sprite,
    transform,
    matrix: composeTrs(transform),
  };
};
