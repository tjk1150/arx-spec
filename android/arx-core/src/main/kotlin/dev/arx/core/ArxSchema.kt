package dev.arx.core

import io.github.optimumcode.json.schema.ExperimentalApi
import io.github.optimumcode.json.schema.FormatBehavior
import io.github.optimumcode.json.schema.FormatValidationResult
import io.github.optimumcode.json.schema.FormatValidator
import io.github.optimumcode.json.schema.JsonSchema
import io.github.optimumcode.json.schema.JsonSchemaLoader
import io.github.optimumcode.json.schema.SchemaOption
import io.github.optimumcode.json.schema.ValidationError
import io.github.optimumcode.json.schema.model.AbstractElement
import io.github.optimumcode.json.schema.model.PrimitiveElement
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Structural validation against the normative JSON Schema (bundled copy of
 * schema/arx-0.1.schema.json; a test keeps the two byte-identical).
 *
 * The library checks its built-in `uri-reference` before custom formats, and its
 * RFC 3986 parser differs from the ajv-formats expression the TypeScript
 * validator uses. The loaded tree therefore renames that format to
 * [URI_REFERENCE_FORMAT], which carries the ajv expression, so every
 * implementation rejects the same strings (fixture N016).
 */
internal object ArxSchema {
    const val RESOURCE = "/dev/arx/core/arx-0.1.schema.json"
    private const val URI_REFERENCE_FORMAT = "arx-uri-reference"

    fun bundledSchemaBytes(): ByteArray =
        ArxSchema::class.java.getResourceAsStream(RESOURCE)?.use { it.readBytes() }
            ?: throw IllegalStateException("missing resource $RESOURCE")

    @OptIn(ExperimentalApi::class)
    private val loaded: Result<JsonSchema> by lazy {
        runCatching {
            val tree = StrictJson.parse(bundledSchemaBytes())
            JsonSchemaLoader.create()
                .withCustomFormat(URI_REFERENCE_FORMAT, UriReferenceFormat)
                .withSchemaOption(SchemaOption.FORMAT_BEHAVIOR_OPTION, FormatBehavior.ANNOTATION_AND_ASSERTION)
                .fromJsonElement(renameUriReferenceFormat(tree))
        }
    }

    /**
     * ARX_SCHEMA issues at each failing instance location. Deduplicated by location
     * and message: the library reports a `$ref`'d keyword once per `oneOf` branch,
     * where ajv reports it once.
     */
    fun check(manifest: JsonElement): List<ArxIssue> {
        val schema = loaded.getOrElse { cause ->
            return listOf(
                ArxIssue.error(ArxIssueCode.SCHEMA, "/", "the bundled ARX schema could not be loaded: " +
                        generateSequence(cause) { it.cause }.joinToString(" <- ")),
            )
        }
        val errors = mutableListOf<ValidationError>()
        if (schema.validate(manifest) { errors += it }) return emptyList()
        val issues = LinkedHashMap<String, ArxIssue>()
        for (error in errors) {
            val path = error.objectPath.toString().ifEmpty { "/" }
            val message = "${error.message} (${error.schemaPath})"
            issues.getOrPut("$path ${error.message}") { ArxIssue.error(ArxIssueCode.SCHEMA, path, message) }
        }
        if (issues.isEmpty()) {
            return listOf(ArxIssue.error(ArxIssueCode.SCHEMA, "/", "manifest does not match the ARX 0.1 schema"))
        }
        return issues.values.toList()
    }

    private fun renameUriReferenceFormat(element: JsonElement): JsonElement = when (element) {
        is JsonObject -> JsonObject(
            element.mapValues { (key, value) ->
                if (key == "format" && value is JsonPrimitive && value.isString && value.content == "uri-reference") {
                    JsonPrimitive(URI_REFERENCE_FORMAT)
                } else {
                    renameUriReferenceFormat(value)
                }
            },
        )
        is JsonArray -> JsonArray(element.map(::renameUriReferenceFormat))
        else -> element
    }

    /**
     * RFC 3986 URI-reference with the ajv-formats expression (full mode), matched
     * without deep recursion. java.util.regex recurses once per repetition of
     * `(?:[chars]|%[0-9a-f]{2})*`, which overflows the stack on long presigned
     * URLs. So every valid escape in the input becomes one [ESCAPE] character and
     * every `(?:[chars]|%[0-9a-f]{2})` in the expression becomes `[chars<ESCAPE>]`.
     * `%` is in no character class, so both forms accept exactly the same strings;
     * a test compares them.
     */
    @OptIn(ExperimentalApi::class)
    internal object UriReferenceFormat : FormatValidator {
        /** Verbatim from ajv-formats 3.0.1 `formats.js` (`fullFormats["uri-reference"]`). */
        const val AJV_EXPRESSION =
            """^(?:[a-z][a-z0-9+\-.]*:)?(?:\/?\/(?:(?:[a-z0-9\-._~!$&'()*+,;=:]|%[0-9a-f]{2})*@)?(?:\[(?:(?:(?:(?:[0-9a-f]{1,4}:){6}|::(?:[0-9a-f]{1,4}:){5}|(?:[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){4}|(?:(?:[0-9a-f]{1,4}:){0,1}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){3}|(?:(?:[0-9a-f]{1,4}:){0,2}[0-9a-f]{1,4})?::(?:[0-9a-f]{1,4}:){2}|(?:(?:[0-9a-f]{1,4}:){0,3}[0-9a-f]{1,4})?::[0-9a-f]{1,4}:|(?:(?:[0-9a-f]{1,4}:){0,4}[0-9a-f]{1,4})?::)(?:[0-9a-f]{1,4}:[0-9a-f]{1,4}|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?))|(?:(?:[0-9a-f]{1,4}:){0,5}[0-9a-f]{1,4})?::[0-9a-f]{1,4}|(?:(?:[0-9a-f]{1,4}:){0,6}[0-9a-f]{1,4})?::)|[Vv][0-9a-f]+\.[a-z0-9\-._~!$&'()*+,;=:]+)\]|(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)|(?:[a-z0-9\-._~!$&'"()*+,;=]|%[0-9a-f]{2})*)(?::\d*)?(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*|\/(?:(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?|(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})+(?:\/(?:[a-z0-9\-._~!$&'"()*+,;=:@]|%[0-9a-f]{2})*)*)?(?:\?(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?(?:#(?:[a-z0-9\-._~!$&'"()*+,;=:@/?]|%[0-9a-f]{2})*)?$"""

        private const val ESCAPE = '\uE000'
        private val escapeAlternative = Regex("""\(\?:\[([^\]]*)\]\|%\[0-9a-f\]\{2\}\)""")
        private val escapeInInput = Regex("%[0-9a-fA-F]{2}")

        private val expression: Regex = run {
            val rewritten = escapeAlternative.replace(AJV_EXPRESSION) { "[" + it.groupValues[1] + ESCAPE + "]" }
            check("%" !in rewritten) { "uri-reference expression has an escape outside a character class" }
            Regex(rewritten, RegexOption.IGNORE_CASE)
        }

        fun matches(value: String): Boolean {
            // Every character class is ASCII, so anything else (including ESCAPE itself) cannot match.
            if (value.any { it.code > 0x7f }) return false
            return expression.matches(escapeInInput.replace(value, ESCAPE.toString()))
        }

        override fun validate(element: AbstractElement): FormatValidationResult {
            if (element !is PrimitiveElement || !element.isString) return FormatValidator.Valid()
            return if (matches(element.content)) FormatValidator.Valid() else FormatValidator.Invalid()
        }
    }
}
