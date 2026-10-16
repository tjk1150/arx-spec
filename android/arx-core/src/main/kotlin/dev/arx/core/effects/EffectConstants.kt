package dev.arx.core.effects

/** Constants of the ARX_effects extension (spec/extensions/ARX_effects.md). */
object EffectConstants {
    /** Extension name in `extensionsUsed` and the `extensions` key. */
    const val EXTENSION = "ARX_effects"

    /** JSON Pointer of the extension object in a manifest. */
    const val ROOT_POINTER = "/extensions/$EXTENSION"

    /** Most effects per manifest; equals the extension schema's `effects.maxItems` (EffectsResourceTest). */
    const val MAX_EFFECTS = 8

    /** Default `amount` and `speed` multipliers (spec section 2). */
    const val DEFAULT_AMOUNT = 1.0
    const val DEFAULT_SPEED = 1.0

    /** Built-in sprites (spec section 8). */
    val SPRITES: Set<String> = setOf("dot", "soft", "star", "glow-star")

    /** Byte-identical copies of schema/ext/ARX_effects.schema.json and ARX_effects.presets.json. */
    const val SCHEMA_RESOURCE = "/dev/arx/core/ARX_effects.schema.json"
    const val PRESETS_RESOURCE = "/dev/arx/core/ARX_effects.presets.json"
}
