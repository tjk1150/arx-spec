package dev.arx.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.MethodSource
import org.junit.jupiter.params.provider.ValueSource
import kotlin.math.abs
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Manifest-level checks (schema + semantics + URI policy), before any asset is read. */
class ManifestValidationTest {
    companion object {
        private val manifestLevelCodes = setOf(
            "ARX_SCHEMA", "ARX_SPEC_VERSION", "ARX_DUPLICATE_LAYER_ID", "ARX_QUATERNION_NOT_UNIT",
            "ARX_EXTENSION_NOT_DECLARED", "ARX_EXTENSION_UNSUPPORTED", "ARX_URI_SCHEME", "ARX_URI_PATH",
            "ARX_URI_CREDENTIALS", "ARX_URI_PRIVATE_NETWORK",
        )

        private fun expected(kind: String, name: String): JsonObject =
            Json.parseToJsonElement(Fixtures.file("$kind/$name/expected.json").readText()).jsonObject

        private fun expectedErrors(expected: JsonObject): List<Pair<String, String>> =
            (expected["errors"] as? JsonArray).orEmpty().map {
                it.jsonObject["code"]!!.jsonPrimitive.content to it.jsonObject["path"]!!.jsonPrimitive.content
            }

        @JvmStatic
        fun manifestLevelNegatives(): List<String> = Fixtures.names("negative").filter { name ->
            val expected = expected("negative", name)
            val errors = expectedErrors(expected)
            expected["package"] == null && errors.isNotEmpty() && errors.all { it.first in manifestLevelCodes }
        }

        @JvmStatic
        fun positives(): List<String> = Fixtures.names("positive").filter {
            Fixtures.file("positive/$it/manifest.json").isFile
        }
    }

    private fun validate(bytes: ByteArray) = ArxManifestValidator.validate(bytes, ArxLocal.MANIFEST_URL)

    @Test
    fun coversTheManifestLevelFixtures() {
        assertTrue(manifestLevelNegatives().size >= 11, "${manifestLevelNegatives()}")
    }

    @ParameterizedTest
    @MethodSource("manifestLevelNegatives")
    fun negativeFixtureReportsItsError(name: String) {
        val result = validate(Fixtures.bytes("negative/$name/manifest.json"))
        assertNull(result.manifest, "$name should be invalid")
        val reported = result.issues.filter { it.severity == ArxIssue.Severity.ERROR }.map { it.code.raw to it.path }.toSet()
        for (want in expectedErrors(expected("negative", name))) {
            assertTrue(want in reported, "$name missing $want; got ${result.issues}")
        }
    }

    @ParameterizedTest
    @MethodSource("positives")
    fun positiveFixtureHasNoManifestErrors(name: String) {
        val result = validate(Fixtures.bytes("positive/$name/manifest.json"))
        assertFalse(result.issues.hasErrors, "$name: ${result.issues}")
        assertNotNull(result.manifest)
    }

    @Test
    fun driftingQuaternionWarnsAndNormalizes() {
        val result = validate(Fixtures.bytes("positive/C013-quaternion-near-unit/manifest.json"))
        assertEquals(listOf(ArxIssueCode.QUATERNION_DRIFT), result.issues.map { it.code })
        val rotation = assertNotNull(result.manifest?.layers?.first()?.transform?.rotation)
        assertTrue(abs(rotation.norm - 1) < 1e-9)
    }

    @Test
    fun rejectsInvalidJson() {
        assertEquals(listOf(ArxIssueCode.JSON_PARSE), validate("{".toByteArray()).issues.map { it.code })
    }

    /** Inputs that JavaScript `JSON.parse` rejects; kotlinx's own parser would accept some of them. */
    @ParameterizedTest
    @ValueSource(
        strings = [
            """{"spec": NaN}""", """{"spec": Infinity}""", """{"spec": abc}""", """{"spec": "arx/0.1",}""",
            """[1, 2,]""", """{'spec': 1}""", """{"a": 01}""", """{"a": 1.}""", """{"a": .5}""", """{"a": +1}""",
            """{"a": "\x"}""", "{\"a\": \"line\nbreak\"}", """{"a": 1} {}""", "",
        ],
    )
    fun rejectsWhatJsonParseRejects(text: String) {
        assertEquals(listOf(ArxIssueCode.JSON_PARSE), validate(text.toByteArray()).issues.map { it.code }, text)
    }

    @Test
    fun acceptsWhatJsonParseAccepts() {
        val parsed = StrictJson.parse("﻿ {\"a\": [1e3, -0.5E-2, true, null, \"\\u00e9\\n\"], \"a\": 2}".toByteArray())
        assertEquals("""{"a":2}""", parsed.toString())
        assertEquals(1, validate("""{"spec": "arx/0.1"}""".toByteArray()).issues.map { it.code }.distinct().size)
    }

    @Test
    fun refusesDeeplyNestedJsonWithoutOverflowingTheStack() {
        val text = "[".repeat(100_000) + "]".repeat(100_000)
        assertEquals(listOf(ArxIssueCode.JSON_PARSE), validate(text.toByteArray()).issues.map { it.code })
    }

    @Test
    fun reportsTheSpecVersionBeforeTheSchema() {
        val result = validate("""{"spec": "arx/9.9", "layers": 3}""".toByteArray())
        assertEquals(listOf("ARX_SPEC_VERSION /spec"), result.issues.map { "${it.code.raw} ${it.path}" })
    }

    @Test
    fun reportsSchemaErrorsAtTheInstanceLocation() {
        val text = """{"spec":"arx/0.1","anchor":{"type":"image","src":"a.jpg"},"layers":[{"id":"x","type":"image","src":"b.png","transform":{"scale":[1,0,1]}}]}"""
        val paths = validate(text.toByteArray()).issues.map { "${it.code.raw} ${it.path}" }
        assertTrue("ARX_SCHEMA /layers/0/transform/scale/1" in paths, "$paths")
    }

    /** The library reports a `$ref`'d keyword once per `oneOf` branch; ARX reports it once (fixture N016). */
    @Test
    fun reportsEachSchemaFailureOnce() {
        val issues = validate(Fixtures.bytes("negative/N016-src-not-uri-reference/manifest.json")).issues
        val paths = issues.map { it.path }
        assertEquals(paths.distinct(), paths, "$issues")
        assertTrue("/layers/0/src" in paths, "$issues")
    }

    @Test
    fun warnsAboutUndeclaredExtensionsAndRequiresSupportedOnes() {
        val text = """{"spec":"arx/0.1","extensionsUsed":["EXT_a"],"extensionsRequired":["EXT_a"],
            "anchor":{"type":"image","src":"a.jpg","extensions":{"EXT_b":{}}},
            "layers":[{"id":"x","type":"image","src":"b.png"}]}"""
        val unsupported = validate(text.toByteArray())
        assertEquals(
            listOf("error ARX_EXTENSION_UNSUPPORTED /extensionsRequired/0", "warning ARX_EXTENSION_UNDECLARED /anchor/extensions/EXT_b"),
            unsupported.issues.map { "${it.severity} ${it.code.raw} ${it.path}" },
        )
        val supported = ArxManifestValidator.validate(
            text.toByteArray(), ArxLocal.MANIFEST_URL, ArxValidationOptions(supportedExtensions = setOf("EXT_a")),
        )
        assertNotNull(supported.manifest)
    }

    /** The ajv-formats uri-reference expression, which decides fixture N016. */
    @Test
    fun uriReferenceFormatMatchesAjv() {
        val format = ArxSchema.UriReferenceFormat
        for (valid in listOf("assets/a.png", "./a.png", "https://cdn.example/a.mp4?sig=a%2Fb", "../x", "a:b", "")) {
            assertTrue(format.matches(valid), valid)
        }
        for (invalid in listOf("assets/over lay.png", "a\\b", "https://cdn.example/a|b", "100%", "a.png\n")) {
            assertFalse(format.matches(invalid), invalid)
        }
    }

    @Test
    fun uriReferenceFormatHandlesLongPresignedUrls() {
        val url = "https://bucket.example/a.mp4?" + "X-Amz-Signature=" + "a1%2F".repeat(4000)
        assertTrue(ArxSchema.UriReferenceFormat.matches(url))
    }

    /** The recursion-free matcher accepts exactly what the verbatim ajv expression accepts. */
    @Test
    fun uriReferenceMatcherIsEquivalentToTheAjvExpression() {
        val verbatim = Regex(ArxSchema.UriReferenceFormat.AJV_EXPRESSION, RegexOption.IGNORE_CASE)
        val alphabet = "aZ09:/?#[]@!$&'\"()*+,;=-._~%%fF4 \\|{}^`<>\u00e9vV.:1::"
        var state = 0x2545F4914F6CDD1DuL
        var accepted = 0
        repeat(20_000) {
            val length = (state % 14uL).toInt()
            val text = buildString {
                repeat(length) {
                    state = state * 6364136223846793005uL + 1442695040888963407uL
                    append(alphabet[((state shr 33) % alphabet.length.toULong()).toInt()])
                }
            }
            state = state * 6364136223846793005uL + 1442695040888963407uL
            val expected = verbatim.matches(text)
            if (expected) accepted++
            assertEquals(expected, ArxSchema.UriReferenceFormat.matches(text), text)
        }
        assertTrue(accepted > 1000, "the sample should include accepted strings: $accepted")
        val samples = listOf(
            "https://u%41@[::1]:8/p%2F?q#f", "https://[v1.x]/", "https://[::%41]/", "http://[v1.%41]/", "h%41ttp://x",
            "//host:80/a", "a%zz", "%%41", "%4%41", "https://user:p%40ss@host/", "?q=%E2%82%AC", "#%41%42",
        )
        for (text in samples) assertEquals(verbatim.matches(text), ArxSchema.UriReferenceFormat.matches(text), text)
    }

    @Test
    fun bundledSchemaMatchesTheRepositorySchema() {
        val repository = java.io.File(Fixtures.repoRoot, "schema/arx-0.1.schema.json").readBytes()
        assertContentEquals(repository, ArxSchema.bundledSchemaBytes())
    }
}
