import {
  ALPHA_CURVE_NAMES,
  DIRECTION_TOLERANCE,
  EFFECTS_EXTENSION,
  EFFECT_LIMITS,
  EFFECT_NAME_PATTERN,
  EFFECT_SPRITES,
  PRESET_FIELDS,
} from "../effects.constants";
import type {
  AlphaCurveName,
  EffectEmission,
  EffectPreset,
  EffectPresetTable,
  EffectSprite,
  JsonObject,
} from "../effects.types";
import type { Vec2, Vec3 } from "../../types";

const fail = (where: string, problem: string): never => {
  throw new Error(`ARX_effects preset table: ${where} ${problem}`);
};

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const objectAt = (value: unknown, where: string): JsonObject => (isObject(value) ? value : fail(where, "is not an object"));

const numberAt = (value: unknown, where: string, min: number, max = Number.POSITIVE_INFINITY): number =>
  isFiniteNumber(value) && value >= min && value <= max ? value : fail(where, `is not a number in [${min}, ${max}]`);

const positiveAt = (value: unknown, where: string): number =>
  isFiniteNumber(value) && value > 0 ? value : fail(where, "is not a positive number");

const numbersAt = (value: unknown, where: string, length: number): readonly number[] =>
  Array.isArray(value) && value.length === length && value.every(isFiniteNumber)
    ? Object.freeze([...value])
    : fail(where, `is not ${length} finite numbers`);

const vec3At = (value: unknown, where: string): Vec3 => numbersAt(value, where, 3) as unknown as Vec3;

/** A [min, max] pair with min <= max, at or above `floor`. */
const rangeAt = (value: unknown, where: string, floor = Number.NEGATIVE_INFINITY): Vec2 => {
  const [low = Number.NaN, high = Number.NaN] = numbersAt(value, where, 2);
  return low >= floor && low <= high ? (Object.freeze([low, high] as const) as Vec2) : fail(where, "is not a [min, max] range");
};

const directionAt = (value: unknown, where: string): Vec3 => {
  const direction = vec3At(value, where);
  return Math.abs(Math.hypot(...direction) - 1) <= DIRECTION_TOLERANCE ? direction : fail(where, "is not a unit vector");
};

const emissionAt = (value: unknown, where: string): EffectEmission => {
  const emission = objectAt(value, where);
  const keys = Object.keys(emission).sort().join(",");
  if (emission.kind === "continuous" && keys === "kind") return Object.freeze({ kind: "continuous" as const });
  if (emission.kind === "burst" && keys === "emitSeconds,kind,pauseSeconds") {
    return Object.freeze({
      kind: "burst" as const,
      emitSeconds: positiveAt(emission.emitSeconds, `${where}.emitSeconds`),
      pauseSeconds: numberAt(emission.pauseSeconds, `${where}.pauseSeconds`, 0),
    });
  }
  return fail(where, "is not a continuous or burst emission");
};

const oneOf = <T extends string>(value: unknown, where: string, names: readonly T[]): T =>
  names.find((name) => name === value) ?? fail(where, `is not one of ${names.join(", ")}`);

const checkFields = (row: JsonObject, where: string): void => {
  const missing = PRESET_FIELDS.find((field) => !Object.hasOwn(row, field));
  if (missing !== undefined) fail(`${where}.${missing}`, "is missing");
  const extra = Object.keys(row).find((field) => !PRESET_FIELDS.includes(field));
  if (extra !== undefined) fail(`${where}.${extra}`, "is not a preset field");
};

const checkPreset = (value: unknown, name: string): EffectPreset => {
  const where = `presets.${name}`;
  if (!EFFECT_NAME_PATTERN.test(name)) fail(where, "is not a valid preset name");
  const row = objectAt(value, where);
  checkFields(row, where);
  const at = (field: string) => `${where}.${field}`;
  return Object.freeze({
    shapeSize: vec3At(row.shapeSize, at("shapeSize")),
    direction: directionAt(row.direction, at("direction")),
    spreadDegrees: numberAt(row.spreadDegrees, at("spreadDegrees"), 0, 180),
    emission: emissionAt(row.emission, at("emission")),
    rate: positiveAt(row.rate, at("rate")),
    lifetime: rangeAt(row.lifetime, at("lifetime"), Number.MIN_VALUE),
    speed: numberAt(row.speed, at("speed"), 0),
    speedVariation: numberAt(row.speedVariation, at("speedVariation"), 0, 1),
    acceleration: vec3At(row.acceleration, at("acceleration")),
    size: numberAt(row.size, at("size"), EFFECT_LIMITS.size.min, EFFECT_LIMITS.size.max),
    sizeVariation: numberAt(row.sizeVariation, at("sizeVariation"), 0, 1),
    endSizeScale: numberAt(row.endSizeScale, at("endSizeScale"), 0),
    angleDegrees: rangeAt(row.angleDegrees, at("angleDegrees")),
    angularSpeedDegrees: rangeAt(row.angularSpeedDegrees, at("angularSpeedDegrees")),
    alphaCurve: oneOf<AlphaCurveName>(row.alphaCurve, at("alphaCurve"), ALPHA_CURVE_NAMES),
    sprite: oneOf<EffectSprite>(row.sprite, at("sprite"), EFFECT_SPRITES),
  });
};

/**
 * Checks the parsed schema/ext/ARX_effects.presets.json and returns its presets as a frozen
 * table with a null prototype. Throws on any shape or value the renderers cannot use, so a bad
 * edit to the root file fails at import instead of drawing something wrong.
 */
export const checkPresets = (file: unknown): EffectPresetTable => {
  const root = objectAt(file, "file");
  if (root.extension !== EFFECTS_EXTENSION) fail("extension", `is not ${EFFECTS_EXTENSION}`);
  const presets = Object.entries(objectAt(root.presets, "presets")).map(
    ([name, row]) => [name, checkPreset(row, name)] as const,
  );
  return Object.freeze(Object.assign(Object.create(null) as Record<string, EffectPreset>, Object.fromEntries(presets)));
};
