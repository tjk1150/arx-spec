package dev.arx.core.effects

import dev.arx.core.ArxIssue
import dev.arx.core.ArxIssueCode
import dev.arx.core.ArxManifest
import dev.arx.core.ArxManifestValidator
import dev.arx.core.ArxTransform
import dev.arx.core.ArxValidationOptions
import dev.arx.core.JsFormat
import io.github.optimumcode.json.schema.JsonSchema
import io.github.optimumcode.json.schema.JsonSchemaLoader
import io.github.optimumcode.json.schema.ValidationError
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Effect stage of manifest validation (spec/extensions/ARX_effects.md section 4),
 * ported from validate-effects.ts. Reads `extensions.ARX_effects` only when the implementation
 * supports ARX_effects and the manifest lists it in `extensionsUsed`; an undeclared object is
 * already reported as ARX_EXTENSION_UNDECLARED by the extension check. Bad data never fails the
 * manifest: a bad extension object drops every effect, a bad effect drops only itself, each with
 * one warning (the first problem in the order schema, rotation, id, preset, sprite). A kept effect
 * with a drifted rotation also gets ARX_QUATERNION_DRIFT. A preset table or extension schema that
 * cannot be read turns every effect off with one ARX_EFFECT_UNSUPPORTED.
 */
object ArxEffectsValidator {
    /** The compiled extension schema and its property names in schema order (effect, then transform). */
    private class LoadedSchema(val schema: JsonSchema, val propertyOrder: List<String>)

    private val loaded: LoadedSchema? by lazy {
        runCatching {
            val bytes = checkNotNull(EffectPresets.resourceBytes(EffectConstants.SCHEMA_RESOURCE))
            val tree = Json.parseToJsonElement(String(bytes, Charsets.UTF_8)) as JsonObject
            val definitions = tree.getValue("\$defs") as JsonObject
            val propertyOrder = listOf("effect", "transform").flatMap { name ->
                ((definitions.getValue(name) as JsonObject).getValue("properties") as JsonObject).keys
            }
            LoadedSchema(JsonSchemaLoader.create().fromJsonElement(tree), propertyOrder)
        }.getOrNull()
    }

    fun validate(
        json: JsonObject,
        manifest: ArxManifest,
        options: ArxValidationOptions,
        presets: ArxEffectPresetTable?,
    ): ArxEffectsValidation {
        // An explicit null is present (JsonNull) and is then reported as not an object.
        val data = (json["extensions"] as? JsonObject)?.get(EffectConstants.EXTENSION)
        val read = EffectConstants.EXTENSION in options.supportedExtensions &&
            EffectConstants.EXTENSION in manifest.extensionsUsed
        if (!read || data == null) return ArxEffectsValidation.NONE

        val root = EffectConstants.ROOT_POINTER
        val loaded = loaded
        if (presets == null || loaded == null) {
            val issue = ArxIssue.warning(
                ArxIssueCode.EFFECT_UNSUPPORTED, root, "the effect preset table or schema could not be read; every effect dropped",
            )
            return ArxEffectsValidation(emptyList(), listOf(issue))
        }

        val errors = mutableListOf<ValidationError>()
        loaded.schema.validate(data) { errors += it }
        val located = errors.map { pointerOf(it) to it }
        located.firstOrNull { (pointer) -> effectIndexOf(pointer) == null }?.let { (_, error) ->
            val issue = ArxIssue.warning(ArxIssueCode.EFFECT_INVALID, root, "${describe(error)}; every effect dropped")
            return ArxEffectsValidation(emptyList(), listOf(issue))
        }
        // The schema error ajv reports first for each effect.
        val ajvOrder = ajvOrder(loaded.propertyOrder)
        val schemaErrors = located.groupBy { (pointer) -> effectIndexOf(pointer) }
            .mapValues { (_, inEffect) -> inEffect.minWith { left, right -> ajvOrder.compare(left.first, right.first) } }

        val authored = (data as JsonObject).getValue("effects") as JsonArray
        val layerIds = manifest.layers.map { it.id }.toSet()
        val effects = mutableListOf<ArxEffect>()
        val issues = mutableListOf<ArxIssue>()
        authored.forEachIndexed { index, value ->
            val pointer = "$root/effects/$index"
            schemaErrors[index]?.let { (errorPointer, error) ->
                issues += ArxIssue.warning(ArxIssueCode.EFFECT_INVALID, "$root$errorPointer", "${describe(error)}; effect dropped")
                return@forEachIndexed
            }
            val effect = value as JsonObject
            val takenIds = layerIds + effects.map { it.id }
            val reason = dropReason(effect, pointer, takenIds, presets)
            if (reason != null) {
                issues += reason
                return@forEachIndexed
            }
            issues += driftIssues(effect, pointer)
            effects += resolve(effect, presets.getValue(effect.string("preset")!!))
        }
        return ArxEffectsValidation(effects, issues)
    }

    /**
     * Instance location of a schema error, placed as ajv places it: an unknown field is reported at
     * the object that has it, which is what the TypeScript validator and the fixtures expect.
     */
    private fun pointerOf(error: ValidationError): String {
        val pointer = error.objectPath.toString()
        val keyword = error.schemaPath.toString().substringAfterLast('/')
        return if (keyword == "additionalProperties") pointer.substringBeforeLast('/') else pointer
    }

    /**
     * Ajv's order of errors inside one effect, which this library does not keep: a node's own errors
     * (type, required, unknown field, item count) come before its children's, object children in
     * schema property order, array items by index. Pointers are compared segment by segment, so a
     * pointer sorts before the pointers below it; errors at one pointer keep the library's order.
     */
    private fun ajvOrder(propertyOrder: List<String>): Comparator<String> {
        fun rank(segment: String): Int =
            segment.toIntOrNull() ?: propertyOrder.indexOf(segment).takeIf { it >= 0 } ?: Int.MAX_VALUE
        return Comparator { left, right ->
            val leftRanks = left.split('/').drop(1).map(::rank)
            val rightRanks = right.split('/').drop(1).map(::rank)
            leftRanks.zip(rightRanks).firstOrNull { (mine, theirs) -> mine != theirs }?.let { (mine, theirs) -> mine.compareTo(theirs) }
                ?: leftRanks.size.compareTo(rightRanks.size)
        }
    }

    /** Index of the effect a pointer is inside, or null for a pointer on the extension object itself. */
    private fun effectIndexOf(pointer: String): Int? {
        val parts = pointer.split('/')
        return if (parts.size > 2 && parts[1] == "effects") parts[2].toIntOrNull() else null
    }

    private fun describe(error: ValidationError): String = "${error.message} (${error.schemaPath})"

    /** The first problem that drops a schema-valid effect, in the spec order after the schema. */
    private fun dropReason(
        effect: JsonObject,
        pointer: String,
        takenIds: Set<String>,
        presets: ArxEffectPresetTable,
    ): ArxIssue? {
        val deviation = rotationDeviation(effect)
        if (deviation > ArxManifestValidator.QUATERNION_TOLERANCE) {
            return ArxIssue.warning(
                ArxIssueCode.EFFECT_INVALID, "$pointer/transform/rotation",
                "|q| deviates from 1 by ${JsFormat.toFixed(deviation, 4)}; effect dropped",
            )
        }
        val id = effect.string("id")!!
        if (id in takenIds) {
            return ArxIssue.warning(
                ArxIssueCode.EFFECT_INVALID, "$pointer/id", "id $id is already a layer or effect id; effect dropped",
            )
        }
        val preset = effect.string("preset")!!
        if (preset !in presets) {
            return ArxIssue.warning(ArxIssueCode.EFFECT_UNSUPPORTED, "$pointer/preset", "unknown preset $preset; effect dropped")
        }
        val sprite = effect.string("sprite")
        if (sprite != null && sprite !in EffectConstants.SPRITES) {
            return ArxIssue.warning(ArxIssueCode.EFFECT_UNSUPPORTED, "$pointer/sprite", "unknown sprite $sprite; effect dropped")
        }
        return null
    }

    /** ARX_QUATERNION_DRIFT for a kept effect whose rotation is normalized on resolution. */
    private fun driftIssues(effect: JsonObject, pointer: String): List<ArxIssue> {
        val deviation = rotationDeviation(effect)
        if (deviation <= ArxManifestValidator.QUATERNION_AUTHORING_TOLERANCE) return emptyList()
        return listOf(
            ArxIssue.warning(
                ArxIssueCode.QUATERNION_DRIFT, "$pointer/transform/rotation",
                "|q| deviates from 1 by ${JsFormat.toFixed(deviation, 6)}; normalized",
            ),
        )
    }

    private fun rotationDeviation(effect: JsonObject): Double {
        val rotation = transformOf(effect)?.rotation ?: return 0.0
        return abs(sqrt(rotation.sumOf { it * it }) - 1)
    }

    /** Defaults filled, rotation normalized, emitter matrix from the transform (spec section 4.3). */
    private fun resolve(effect: JsonObject, preset: ArxEffectPreset): ArxEffect = ArxEffect(
        id = effect.string("id")!!,
        preset = effect.string("preset")!!,
        colors = (effect.getValue("colors") as JsonArray).map { (it as JsonPrimitive).content },
        amount = effect.number("amount") ?: EffectConstants.DEFAULT_AMOUNT,
        size = effect.number("size") ?: preset.size,
        speed = effect.number("speed") ?: EffectConstants.DEFAULT_SPEED,
        sprite = effect.string("sprite") ?: preset.sprite,
        transform = ArxTransform.from(transformOf(effect)),
    )

    private fun transformOf(effect: JsonObject): ArxManifest.TransformInput? {
        val transform = effect["transform"] as? JsonObject ?: return null
        return ArxManifest.TransformInput(transform.numbers("position"), transform.numbers("rotation"), transform.numbers("scale"))
    }

    private fun JsonObject.string(key: String): String? =
        (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content

    private fun JsonObject.number(key: String): Double? =
        (this[key] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull

    private fun JsonObject.numbers(key: String): List<Double>? =
        (this[key] as? JsonArray)?.map { (it as? JsonPrimitive)?.doubleOrNull ?: return null }
}
