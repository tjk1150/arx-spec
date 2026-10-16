package dev.arx.core.effects

/**
 * Particle alpha curves of spec/extensions/ARX_effects.md section 6, ported from
 * packages/arx-core/src/effects/utils/curves.ts.
 */
object AlphaCurves {
    /** Life share over which `quickFadeInOut` rises and falls. */
    private const val QUICK_EDGE = 0.1

    /** Life share over which `gradualFadeInOut` rises and falls. */
    private const val GRADUAL_EDGE = 0.3

    /** The curve names a preset may use. */
    val NAMES: Set<String> = setOf("linearFadeOut", "easeFadeOut", "quickFadeInOut", "gradualFadeInOut", "constant")

    /** Rises over the first [edge] of life, holds 1, and falls over the last [edge]. */
    private fun fadeInOut(life: Double, edge: Double): Double = minOf(1.0, life / edge, (1 - life) / edge)

    /**
     * Particle alpha at life fraction [life] (0..1) for the curve [name]. Throws an
     * IllegalArgumentException for a name outside [NAMES].
     */
    fun alpha(name: String, life: Double): Double = when (name) {
        "linearFadeOut" -> 1 - life
        "easeFadeOut" -> 1 - life * life
        "quickFadeInOut" -> fadeInOut(life, QUICK_EDGE)
        "gradualFadeInOut" -> fadeInOut(life, GRADUAL_EDGE)
        // Full alpha for the whole life: a particle appears at birth and vanishes at death.
        "constant" -> 1.0
        else -> throw IllegalArgumentException("unknown alpha curve $name")
    }
}
