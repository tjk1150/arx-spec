package dev.arx.core.effects

import dev.arx.core.ArxIssue
import dev.arx.core.ArxTransform
import dev.arx.core.Vec2
import dev.arx.core.Vec3

/**
 * One kept effect of `extensions.ARX_effects` with its defaults filled, its rotation normalized
 * and its emitter matrix (spec/extensions/ARX_effects.md section 4.3).
 */
data class ArxEffect(
    val id: String,
    /** A preset name of the table. */
    val preset: String,
    /** Birth color, then death color, each `#RRGGBB` (sRGB). */
    val colors: List<String>,
    val amount: Double,
    /** Particle side in target-width units: the effect's value or the preset's. */
    val size: Double,
    val speed: Double,
    /** A built-in sprite name: the effect's value or the preset's. */
    val sprite: String,
    val transform: ArxTransform,
) {
    /** Emitter-to-content-root matrix E = T x R x S, column-major (16 values). */
    val matrix: DoubleArray get() = transform.matrix
}

/** How a preset emits (spec section 7.3). */
sealed interface ArxEffectEmission {
    data object Continuous : ArxEffectEmission

    data class Burst(val emitSeconds: Double, val pauseSeconds: Double) : ArxEffectEmission
}

/** One row of schema/ext/ARX_effects.presets.json. Field meanings: spec section 5. */
data class ArxEffectPreset(
    val shapeSize: Vec3,
    val direction: Vec3,
    val spreadDegrees: Double,
    val emission: ArxEffectEmission,
    val rate: Double,
    val lifetime: Vec2,
    val speed: Double,
    val speedVariation: Double,
    val acceleration: Vec3,
    val size: Double,
    val sizeVariation: Double,
    val endSizeScale: Double,
    val angleDegrees: Vec2,
    val angularSpeedDegrees: Vec2,
    val alphaCurve: String,
    val sprite: String,
)

/** Preset name to preset, in table order. */
typealias ArxEffectPresetTable = Map<String, ArxEffectPreset>

/** Result of the effect stage: the kept effects and one warning per dropped effect or drift. */
data class ArxEffectsValidation(val effects: List<ArxEffect>, val issues: List<ArxIssue>) {
    companion object {
        val NONE = ArxEffectsValidation(emptyList(), emptyList())
    }
}
