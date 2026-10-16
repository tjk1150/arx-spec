package dev.arx.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * ARX 0.1 manifest as authored. The validator decodes it only after the schema
 * check passed, so every field has the type the schema requires.
 */
data class ArxManifest(
    val spec: String,
    val id: String?,
    val title: String?,
    val anchor: Anchor,
    val layers: List<Layer>,
    val extensionsUsed: List<String>,
    val extensionsRequired: List<String>,
) {
    data class Anchor(
        val type: String,
        val src: String,
        val physicalWidth: Double?,
        val integrity: String?,
    )

    enum class LayerType(val raw: String) {
        IMAGE("image"),
        VIDEO("video"),
        ;

        companion object {
            fun fromRaw(raw: String): LayerType? = entries.firstOrNull { it.raw == raw }
        }
    }

    data class Layer(
        val id: String,
        val type: LayerType,
        val src: String,
        val integrity: String?,
        val transform: TransformInput?,
        val autoplay: Boolean?,
        val loop: Boolean?,
    )

    data class TransformInput(
        val position: List<Double>?,
        val rotation: List<Double>?,
        val scale: List<Double>?,
    )

    companion object {
        /** Decodes a schema-valid manifest object; null when a required field has the wrong shape. */
        fun decode(json: JsonElement): ArxManifest? {
            val root = json as? JsonObject ?: return null
            val anchor = root["anchor"] as? JsonObject ?: return null
            val layers = (root["layers"] as? JsonArray)?.map { decodeLayer(it) ?: return null } ?: return null
            return ArxManifest(
                spec = root.string("spec") ?: return null,
                id = root.string("id"),
                title = root.string("title"),
                anchor = Anchor(
                    type = anchor.string("type") ?: return null,
                    src = anchor.string("src") ?: return null,
                    physicalWidth = anchor.number("physicalWidth"),
                    integrity = anchor.string("integrity"),
                ),
                layers = layers,
                extensionsUsed = root.strings("extensionsUsed"),
                extensionsRequired = root.strings("extensionsRequired"),
            )
        }

        private fun decodeLayer(element: JsonElement): Layer? {
            val layer = element as? JsonObject ?: return null
            val transform = layer["transform"] as? JsonObject
            return Layer(
                id = layer.string("id") ?: return null,
                type = LayerType.fromRaw(layer.string("type") ?: return null) ?: return null,
                src = layer.string("src") ?: return null,
                integrity = layer.string("integrity"),
                transform = transform?.let {
                    TransformInput(it.numbers("position"), it.numbers("rotation"), it.numbers("scale"))
                },
                autoplay = (layer["autoplay"] as? JsonPrimitive)?.booleanOrNull,
                loop = (layer["loop"] as? JsonPrimitive)?.booleanOrNull,
            )
        }

        private fun JsonObject.string(key: String): String? =
            (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

        private fun JsonObject.number(key: String): Double? =
            (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull

        private fun JsonObject.numbers(key: String): List<Double>? =
            (this[key] as? JsonArray)?.map { (it as? JsonPrimitive)?.doubleOrNull ?: return null }

        private fun JsonObject.strings(key: String): List<String> =
            (this[key] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.takeIf { value -> value.isString }?.content }
                ?: emptyList()
    }
}
