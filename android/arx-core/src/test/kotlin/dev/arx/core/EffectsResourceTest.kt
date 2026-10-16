package dev.arx.core

import dev.arx.core.effects.ArxEffectEmission
import dev.arx.core.effects.EffectConstants
import dev.arx.core.effects.EffectPresets
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Test
import java.io.File
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The bundled ARX_effects schema and preset table are copies of the root files (spec
 * extensions/ARX_effects.md section 5), and a preset table that cannot be read turns effects off
 * without touching the layers.
 */
class EffectsResourceTest {
    private fun root(path: String): ByteArray = File(Fixtures.repoRoot, path).readBytes()

    private fun rootJson(path: String): JsonObject = Json.parseToJsonElement(String(root(path))).jsonObject

    @Test
    fun bundledSchemaMatchesTheRepositorySchema() {
        assertContentEquals(root("schema/ext/ARX_effects.schema.json"), EffectPresets.resourceBytes(EffectConstants.SCHEMA_RESOURCE))
    }

    @Test
    fun bundledPresetsMatchTheRepositoryPresets() {
        assertContentEquals(root("schema/ext/ARX_effects.presets.json"), EffectPresets.resourceBytes(EffectConstants.PRESETS_RESOURCE))
    }

    @Test
    fun maxEffectsIsTheSchemaLimit() {
        val effects = rootJson("schema/ext/ARX_effects.schema.json").getValue("properties").jsonObject.getValue("effects").jsonObject
        assertEquals(EffectConstants.MAX_EFFECTS, effects.getValue("maxItems").jsonPrimitive.int)
    }

    @Test
    fun bundledPresetsReadEveryRowOfTheTable() {
        val table = assertNotNull(EffectPresets.bundled)
        val rows = rootJson("schema/ext/ARX_effects.presets.json").getValue("presets").jsonObject
        assertEquals(rows.keys.toList(), table.keys.toList())
        for ((name, row) in rows) {
            val preset = table.getValue(name)
            val fields = row.jsonObject
            assertEquals(fields.getValue("size").jsonPrimitive.double, preset.size, name)
            assertEquals(fields.getValue("sprite").jsonPrimitive.content, preset.sprite, name)
            assertEquals(fields.getValue("rate").jsonPrimitive.double, preset.rate, name)
            assertEquals(fields.getValue("alphaCurve").jsonPrimitive.content, preset.alphaCurve, name)
            assertEquals(fields.getValue("lifetime").jsonArray.map { it.jsonPrimitive.double }, preset.lifetime.array.toList(), name)
            val emission = fields.getValue("emission").jsonObject
            when (val kind = emission.getValue("kind").jsonPrimitive.content) {
                "continuous" -> assertEquals(ArxEffectEmission.Continuous, preset.emission, name)
                else -> assertEquals(
                    ArxEffectEmission.Burst(
                        emission.getValue("emitSeconds").jsonPrimitive.double,
                        emission.getValue("pauseSeconds").jsonPrimitive.double,
                    ),
                    preset.emission,
                    "$name $kind",
                )
            }
        }
    }

    @Test
    fun spritesAreTheRootSpriteFolder() {
        val names = File(Fixtures.repoRoot, "schema/ext/sprites").list().orEmpty()
            .filter { it.endsWith(".png") }.map { it.removeSuffix(".png") }.toSet()
        assertTrue("glow-star" in names)
        assertEquals(names, EffectConstants.SPRITES)
    }

    /** `float` draws with `glow-star` by default; the other presets keep their sprites. */
    @Test
    fun floatDrawsWithGlowStarAndE002KeepsEveryEffect() {
        val table = assertNotNull(EffectPresets.bundled)
        assertEquals(
            mapOf("sparkle" to "star", "rise" to "dot", "burst" to "soft", "snow" to "soft", "float" to "glow-star"),
            table.mapValues { it.value.sprite },
        )
        val json = Json.parseToJsonElement(File(Fixtures.file("effects/E002-all-presets"), "manifest.json").readText())
        val options = ArxValidationOptions(supportedExtensions = setOf(EffectConstants.EXTENSION))
        val result = ArxManifestValidator.validate(json, ArxLocal.MANIFEST_URL, options)
        assertEquals(emptyList(), result.issues)
        val manifest = assertNotNull(result.manifest)
        assertEquals("glow-star", manifest.effects.single { it.id == "float-a" }.sprite)
    }

    @Test
    fun aMissingOrMalformedPresetResourceReadsAsNothing() {
        assertNull(EffectPresets.load("/dev/arx/core/ARX_effects.missing.json"))
        assertNull(EffectPresets.load(EffectConstants.SCHEMA_RESOURCE))
    }

    @Test
    fun unreadablePresetsTurnEffectsOffAndKeepTheLayers() {
        val directory = Fixtures.file("effects/E002-all-presets")
        val json = Json.parseToJsonElement(File(directory, "manifest.json").readText())
        val options = ArxValidationOptions(supportedExtensions = setOf(EffectConstants.EXTENSION))
        val presets = EffectPresets.load("/dev/arx/core/ARX_effects.missing.json")

        val result = ArxManifestValidator.validate(json, ArxLocal.MANIFEST_URL, options, presets)
        val manifest = assertNotNull(result.manifest, "${result.issues}")
        assertEquals(listOf("warning ARX_EFFECT_UNSUPPORTED /extensions/ARX_effects"), result.issues.map { "${it.severity.raw} ${it.code.raw} ${it.path}" })
        assertEquals(emptyList(), manifest.effects)
        assertEquals(listOf("overlay"), manifest.layers.map { it.id })

        val readable = assertNotNull(ArxManifestValidator.validate(json, ArxLocal.MANIFEST_URL, options).manifest)
        assertEquals(manifest.layers, readable.layers)
        assertEquals(5, readable.effects.size)
    }
}
