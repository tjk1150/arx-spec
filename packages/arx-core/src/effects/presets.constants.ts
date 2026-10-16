import presetFile from "../../../../schema/ext/ARX_effects.presets.json";
import type { EffectPresetTable } from "./effects.types";
import { checkPresets } from "./utils/check-presets";

/**
 * The preset table, read from the one root file (schema/ext/ARX_effects.presets.json) and
 * checked at import. Keys are preset names; the table has a null prototype.
 */
export const EFFECT_PRESETS: EffectPresetTable = checkPresets(presetFile);
