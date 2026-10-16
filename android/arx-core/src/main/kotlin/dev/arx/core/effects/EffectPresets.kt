package dev.arx.core.effects

import dev.arx.core.Vec2
import dev.arx.core.Vec3
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/**
 * The ARX_effects preset table, read from the bundled copy of schema/ext/ARX_effects.presets.json
 * (spec/extensions/ARX_effects.md section 5). A table that cannot be read or has a malformed row
 * reads as null, and the validator then turns every effect off.
 */
object EffectPresets {
    /** The bundled table, or null when it cannot be read. */
    val bundled: ArxEffectPresetTable? by lazy { load() }

    /** Bytes of a class-path resource, or null when it is missing. */
    fun resourceBytes(resource: String): ByteArray? =
        try {
            EffectPresets::class.java.getResourceAsStream(resource)?.use { it.readBytes() }
        } catch (_: java.io.IOException) {
            null
        }

    /** The preset table in [resource], or null when it is missing, not JSON, or has a malformed row. */
    fun load(resource: String = EffectConstants.PRESETS_RESOURCE): ArxEffectPresetTable? {
        val bytes = resourceBytes(resource) ?: return null
        val root = runCatching { Json.parseToJsonElement(String(bytes, Charsets.UTF_8)) }.getOrNull() as? JsonObject
        val rows = root?.get("presets") as? JsonObject ?: return null
        if (rows.isEmpty()) return null
        return rows.mapValues { (_, row) -> (row as? JsonObject)?.let(::preset) ?: return null }
    }

    private fun preset(row: JsonObject): ArxEffectPreset? = ArxEffectPreset(
        shapeSize = row.vec3("shapeSize") ?: return null,
        direction = row.vec3("direction") ?: return null,
        spreadDegrees = row.number("spreadDegrees") ?: return null,
        emission = (row["emission"] as? JsonObject)?.let(::emission) ?: return null,
        rate = row.number("rate") ?: return null,
        lifetime = row.vec2("lifetime") ?: return null,
        speed = row.number("speed") ?: return null,
        speedVariation = row.number("speedVariation") ?: return null,
        acceleration = row.vec3("acceleration") ?: return null,
        size = row.number("size") ?: return null,
        sizeVariation = row.number("sizeVariation") ?: return null,
        endSizeScale = row.number("endSizeScale") ?: return null,
        angleDegrees = row.vec2("angleDegrees") ?: return null,
        angularSpeedDegrees = row.vec2("angularSpeedDegrees") ?: return null,
        alphaCurve = row.string("alphaCurve") ?: return null,
        sprite = row.string("sprite")?.takeIf { it in EffectConstants.SPRITES } ?: return null,
    )

    private fun emission(value: JsonObject): ArxEffectEmission? = when (value.string("kind")) {
        "continuous" -> ArxEffectEmission.Continuous
        "burst" -> ArxEffectEmission.Burst(
            emitSeconds = value.number("emitSeconds") ?: return null,
            pauseSeconds = value.number("pauseSeconds") ?: return null,
        )
        else -> null
    }

    private fun JsonObject.string(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun JsonObject.number(key: String): Double? =
        (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull

    private fun JsonObject.numbers(key: String, count: Int): List<Double>? =
        (this[key] as? JsonArray)?.takeIf { it.size == count }
            ?.map { (it as? JsonPrimitive)?.takeIf { value -> !value.isString }?.doubleOrNull ?: return null }

    private fun JsonObject.vec2(key: String): Vec2? = numbers(key, 2)?.let { Vec2(it[0], it[1]) }

    private fun JsonObject.vec3(key: String): Vec3? = numbers(key, 3)?.let { Vec3(it[0], it[1], it[2]) }
}
