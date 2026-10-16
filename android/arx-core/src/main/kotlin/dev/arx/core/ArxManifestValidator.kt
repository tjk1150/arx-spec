package dev.arx.core

import dev.arx.core.effects.ArxEffect
import dev.arx.core.effects.ArxEffectPresetTable
import dev.arx.core.effects.ArxEffectsValidator
import dev.arx.core.effects.EffectPresets
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.abs
import kotlin.math.sqrt

/** Options shared by manifest and experience validation. */
data class ArxValidationOptions(
    val uriPolicy: ArxUriPolicy = ArxUriPolicy(),
    /** Extension names this implementation understands. */
    val supportedExtensions: Set<String> = emptySet(),
    /** Treat Portable Video Profile deviations as errors (publish-time strict mode). */
    val strictVideoProfile: Boolean = false,
)

/** A manifest after validation: defaults applied, rotations normalized, sources resolved. */
data class ArxResolvedManifest(
    val id: String?,
    val title: String?,
    val anchor: Anchor,
    val layers: List<Layer>,
    val extensionsUsed: List<String>,
    val extensionsRequired: List<String>,
    /** Kept ARX_effects effects; empty when the extension is not read (spec/extensions/ARX_effects.md 4.3). */
    val effects: List<ArxEffect> = emptyList(),
) {
    data class Anchor(val url: String, val physicalWidth: Double?, val integrity: String?)

    data class Layer(
        val id: String,
        val type: ArxManifest.LayerType,
        val url: String,
        val integrity: String?,
        val transform: ArxTransform,
        val playback: Playback?,
    )
}

/** Manifest-level result: every issue found, and the resolved manifest when there are no errors. */
data class ArxManifestValidation(
    val issues: List<ArxIssue>,
    val manifest: ArxResolvedManifest?,
    /** The decoded manifest as authored, present whenever [manifest] is. */
    val decoded: ArxManifest? = null,
)

/** Schema and semantic validation (spec 5), ported from semantic.ts and ArxManifestValidator.swift. */
object ArxManifestValidator {
    /** |norm(q) - 1| above this is invalid (OpenXR pose rule). */
    const val QUATERNION_TOLERANCE = 0.01

    /** Authoring tools should flag drift above this. */
    const val QUATERNION_AUTHORING_TOLERANCE = 1e-4

    fun validate(
        data: ByteArray,
        manifestUrl: String,
        options: ArxValidationOptions = ArxValidationOptions(),
    ): ArxManifestValidation {
        val json = try {
            StrictJson.parse(data)
        } catch (failure: StrictJson.ParseException) {
            return ArxManifestValidation(
                listOf(ArxIssue.error(ArxIssueCode.JSON_PARSE, "", "manifest is not valid JSON: ${failure.message}")),
                null,
            )
        }
        return validate(json, manifestUrl, options)
    }

    fun validate(
        json: JsonElement,
        manifestUrl: String,
        options: ArxValidationOptions = ArxValidationOptions(),
    ): ArxManifestValidation = validate(json, manifestUrl, options, EffectPresets.bundled)

    /** [effectPresets] is null when the preset table could not be read: effects are then off. */
    internal fun validate(
        json: JsonElement,
        manifestUrl: String,
        options: ArxValidationOptions,
        effectPresets: ArxEffectPresetTable?,
    ): ArxManifestValidation {
        val spec = ((json as? JsonObject)?.get("spec") as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (spec != null && spec != ArxSpec.VERSION) {
            return ArxManifestValidation(
                listOf(ArxIssue.error(ArxIssueCode.SPEC_VERSION, "/spec", "unsupported spec version $spec")),
                null,
            )
        }
        val schemaIssues = ArxSchema.check(json)
        if (schemaIssues.isNotEmpty()) return ArxManifestValidation(schemaIssues, null)
        val manifest = ArxManifest.decode(json) ?: return ArxManifestValidation(
            listOf(ArxIssue.error(ArxIssueCode.SCHEMA, "/", "manifest does not decode")),
            null,
        )

        val issues = checkExtensions(json as JsonObject, manifest, options).toMutableList()
        val seen = HashSet<String>()
        manifest.layers.forEachIndexed { index, layer ->
            if (!seen.add(layer.id)) {
                issues += ArxIssue.error(ArxIssueCode.DUPLICATE_LAYER_ID, "/layers/$index/id", "duplicate layer id ${layer.id}")
            }
        }

        fun resolve(src: String, path: String): String? =
            when (val resolution = ArxUri.resolve(src, manifestUrl, path, options.uriPolicy)) {
                is ArxResolution.Resolved -> resolution.url
                is ArxResolution.Rejected -> {
                    issues += resolution.issue
                    null
                }
            }

        val anchorUrl = resolve(manifest.anchor.src, "/anchor/src")
        val layers = manifest.layers.mapIndexedNotNull { index, layer ->
            val url = resolve(layer.src, "/layers/$index/src")
            issues += checkRotation(layer.transform?.rotation, "/layers/$index/transform/rotation")
            url?.let {
                ArxResolvedManifest.Layer(
                    id = layer.id,
                    type = layer.type,
                    url = it,
                    integrity = layer.integrity,
                    transform = ArxTransform.from(layer.transform),
                    playback = if (layer.type == ArxManifest.LayerType.VIDEO) {
                        Playback(autoplay = layer.autoplay ?: false, loop = layer.loop ?: false)
                    } else {
                        null
                    },
                )
            }
        }

        // After the layers: an effect id must not repeat a layer id (spec/extensions/ARX_effects.md 4.1).
        val effectStage = ArxEffectsValidator.validate(json, manifest, options, effectPresets)
        issues += effectStage.issues

        if (issues.hasErrors || anchorUrl == null) return ArxManifestValidation(issues, null)
        val resolved = ArxResolvedManifest(
            id = manifest.id,
            title = manifest.title,
            anchor = ArxResolvedManifest.Anchor(anchorUrl, manifest.anchor.physicalWidth, manifest.anchor.integrity),
            layers = layers,
            extensionsUsed = manifest.extensionsUsed,
            extensionsRequired = manifest.extensionsRequired,
            effects = effectStage.effects,
        )
        return ArxManifestValidation(issues, resolved, manifest)
    }

    internal fun checkRotation(rotation: List<Double>?, path: String): List<ArxIssue> {
        val values = rotation ?: listOf(0.0, 0.0, 0.0, 1.0)
        val deviation = abs(sqrt(values.sumOf { it * it }) - 1)
        return when {
            deviation > QUATERNION_TOLERANCE -> listOf(
                ArxIssue.error(
                    ArxIssueCode.QUATERNION_NOT_UNIT, path, "|q| deviates from 1 by ${JsFormat.toFixed(deviation, 4)}",
                ),
            )
            deviation > QUATERNION_AUTHORING_TOLERANCE -> listOf(
                ArxIssue.warning(
                    ArxIssueCode.QUATERNION_DRIFT, path,
                    "|q| deviates from 1 by ${JsFormat.toFixed(deviation, 6)}; normalized",
                ),
            )
            else -> emptyList()
        }
    }

    internal fun checkExtensions(
        json: JsonObject,
        manifest: ArxManifest,
        options: ArxValidationOptions,
    ): List<ArxIssue> {
        val used = manifest.extensionsUsed.toSet()
        val issues = mutableListOf<ArxIssue>()
        manifest.extensionsRequired.forEachIndexed { index, name ->
            val path = "/extensionsRequired/$index"
            if (name !in used) {
                issues += ArxIssue.error(ArxIssueCode.EXTENSION_NOT_DECLARED, path, "$name is not in extensionsUsed")
            } else if (name !in options.supportedExtensions) {
                issues += ArxIssue.error(ArxIssueCode.EXTENSION_UNSUPPORTED, path, "required extension $name is not supported")
            }
        }
        val holders = buildList {
            add("" to json["extensions"])
            add("/anchor" to (json["anchor"] as? JsonObject)?.get("extensions"))
            val layers = json["layers"] as? kotlinx.serialization.json.JsonArray
            layers?.forEachIndexed { index, layer -> add("/layers/$index" to (layer as? JsonObject)?.get("extensions")) }
        }
        for ((prefix, extensions) in holders) {
            // Object.keys order, as in the TypeScript validator.
            for (name in (extensions as? JsonObject)?.keys.orEmpty()) {
                if (name !in used) {
                    issues += ArxIssue.warning(
                        ArxIssueCode.EXTENSION_UNDECLARED, "$prefix/extensions/$name", "$name is not in extensionsUsed",
                    )
                }
            }
        }
        return issues
    }
}
