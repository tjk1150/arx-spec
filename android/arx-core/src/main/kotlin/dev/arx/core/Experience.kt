package dev.arx.core

import dev.arx.core.effects.ArxEffect
import java.io.File

data class Playback(val autoplay: Boolean, val loop: Boolean)

/** A loaded experience: cached asset files, media sizes, layer geometry and kept effects. */
data class ArxExperience(
    val manifest: ArxManifest,
    val target: Target,
    val layers: List<Layer>,
    /** Kept ARX_effects effects in authored order; empty when the extension is absent or not read. */
    val effects: List<ArxEffect> = emptyList(),
) {
    data class Target(
        /** Local file with the validated bytes (what renders). */
        val file: File,
        /** Where the manifest pointed (resolved against the manifest URL). */
        val sourceUrl: String,
        /** Always [1, height / width] in target-width units. */
        val size: Vec2,
        val pixelWidth: Double,
        val pixelHeight: Double,
        /** Meters per unit when the author supplied it. */
        val physicalWidth: Double?,
    )

    data class Layer(
        val id: String,
        val type: ArxManifest.LayerType,
        /** Local file with the validated bytes (what renders). */
        val file: File,
        /** Where the manifest pointed (resolved against the manifest URL). */
        val sourceUrl: String,
        val size: Vec2,
        val transform: ArxTransform,
        val playback: Playback?,
    ) {
        /** Layer-to-content-root matrix, column-major (16 values). */
        val matrix: DoubleArray get() = transform.matrix
    }
}
