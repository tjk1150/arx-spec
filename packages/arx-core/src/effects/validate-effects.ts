import type { ErrorObject } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";
import extensionSchema from "../../../../schema/ext/ARX_effects.schema.json";
import { warning, type Issue } from "../issues";
import { quatNormDeviation } from "../math";
import { AJV_OPTIONS } from "../schema.constants";
import { QUATERNION_AUTHORING_TOLERANCE, QUATERNION_TOLERANCE } from "../semantic.constants";
import type { ManifestOptions } from "../semantic.types";
import type { Manifest } from "../types";
import { EFFECTS_EXTENSION, EFFECT_SPRITES } from "./effects.constants";
import type { ManifestEffect, ResolvedEffect } from "./effects.types";
import { EFFECT_PRESETS } from "./presets.constants";
import { resolveEffect } from "./resolve-effect";

// Not exported from ./effects/index: this module compiles the extension schema with Ajv.
const ajv = new Ajv2020(AJV_OPTIONS);
const validateExtension = ajv.compile(extensionSchema);

const describeError = (detail: ErrorObject): string => `${detail.message ?? "invalid"} (${detail.schemaPath})`;

/** Index of the effect an Ajv error is inside, or undefined for an error on the extension object itself. */
const effectIndexOf = (detail: ErrorObject): number | undefined => {
  const [, field, index] = detail.instancePath.split("/");
  return field === "effects" && index !== undefined ? Number(index) : undefined;
};

/** First schema error per effect index, in Ajv's order. */
const firstErrorPerEffect = (errors: readonly ErrorObject[]): ReadonlyMap<number, ErrorObject> =>
  errors.reduce((byIndex, detail) => {
    const index = effectIndexOf(detail);
    return index === undefined || byIndex.has(index) ? byIndex : new Map([...byIndex, [index, detail]]);
  }, new Map<number, ErrorObject>());

const rotationDeviation = (effect: ManifestEffect): number =>
  effect.transform?.rotation ? quatNormDeviation(effect.transform.rotation) : 0;

/**
 * The first problem that drops a schema-valid effect, in the spec order after the schema:
 * rotation, id, preset, sprite (spec/extensions/ARX_effects.md section 4.2).
 */
const dropReason = (effect: ManifestEffect, pointer: string, takenIds: ReadonlySet<string>): Issue | undefined => {
  const deviation = rotationDeviation(effect);
  if (deviation > QUATERNION_TOLERANCE) {
    return warning(
      "ARX_EFFECT_INVALID",
      `${pointer}/transform/rotation`,
      `|q| deviates from 1 by ${deviation.toFixed(4)}; effect dropped`,
    );
  }
  if (takenIds.has(effect.id)) {
    return warning(
      "ARX_EFFECT_INVALID",
      `${pointer}/id`,
      `id ${effect.id} is already a layer or effect id; effect dropped`,
    );
  }
  if (!Object.hasOwn(EFFECT_PRESETS, effect.preset)) {
    return warning("ARX_EFFECT_UNSUPPORTED", `${pointer}/preset`, `unknown preset ${effect.preset}; effect dropped`);
  }
  if (effect.sprite !== undefined && !EFFECT_SPRITES.some((sprite) => sprite === effect.sprite)) {
    return warning("ARX_EFFECT_UNSUPPORTED", `${pointer}/sprite`, `unknown sprite ${effect.sprite}; effect dropped`);
  }
  return undefined;
};

/** ARX_QUATERNION_DRIFT for a kept effect whose rotation is normalized on resolution. */
const driftIssues = (effect: ManifestEffect, pointer: string): Issue[] => {
  const deviation = rotationDeviation(effect);
  return deviation > QUATERNION_AUTHORING_TOLERANCE
    ? [
        warning(
          "ARX_QUATERNION_DRIFT",
          `${pointer}/transform/rotation`,
          `|q| deviates from 1 by ${deviation.toFixed(6)}; normalized`,
        ),
      ]
    : [];
};

/**
 * Effect stage of manifest validation (spec/extensions/ARX_effects.md section 4).
 * Reads `extensions.ARX_effects` only when the implementation supports ARX_effects and the
 * manifest lists it in `extensionsUsed`; an undeclared object is already reported as
 * ARX_EXTENSION_UNDECLARED by the extension check. Bad data never fails the manifest: a bad
 * extension object drops every effect, a bad effect drops only itself, each with one warning
 * (the first problem in the order schema, rotation, id, preset, sprite). A kept effect with a
 * drifted rotation also gets ARX_QUATERNION_DRIFT. Kept effects are resolved by resolveEffect.
 * Runs after the layers are known, since an effect id must not repeat a layer id.
 */
export const validateEffects = (
  manifest: Manifest,
  options: ManifestOptions,
): { readonly effects: readonly ResolvedEffect[]; readonly issues: readonly Issue[] } => {
  const read =
    (options.supportedExtensions ?? []).includes(EFFECTS_EXTENSION) &&
    (manifest.extensionsUsed ?? []).includes(EFFECTS_EXTENSION) &&
    Object.hasOwn(manifest.extensions ?? {}, EFFECTS_EXTENSION);
  if (!read) return { effects: [], issues: [] };

  const root = `/extensions/${EFFECTS_EXTENSION}`;
  const data = manifest.extensions?.[EFFECTS_EXTENSION];
  const errors = validateExtension(data) ? [] : (validateExtension.errors ?? []);
  const rootError = errors.find((detail) => effectIndexOf(detail) === undefined);
  if (rootError !== undefined) {
    return {
      effects: [],
      issues: [warning("ARX_EFFECT_INVALID", root, `${describeError(rootError)}; every effect dropped`)],
    };
  }

  const schemaErrors = firstErrorPerEffect(errors);
  const authored = (data as { readonly effects: readonly unknown[] }).effects;
  const effects: ResolvedEffect[] = [];
  const issues: Issue[] = [];
  authored.forEach((value, index) => {
    const pointer = `${root}/effects/${index}`;
    const schemaError = schemaErrors.get(index);
    if (schemaError !== undefined) {
      issues.push(
        warning(
          "ARX_EFFECT_INVALID",
          `${root}${schemaError.instancePath}`,
          `${describeError(schemaError)}; effect dropped`,
        ),
      );
      return;
    }
    const effect = value as ManifestEffect;
    const takenIds = new Set([...manifest.layers.map((layer) => layer.id), ...effects.map((kept) => kept.id)]);
    const reason = dropReason(effect, pointer, takenIds);
    if (reason !== undefined) {
      issues.push(reason);
      return;
    }
    issues.push(...driftIssues(effect, pointer));
    effects.push(resolveEffect(effect));
  });
  return { effects, issues };
};
