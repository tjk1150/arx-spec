package dev.arx.core

import dev.arx.core.effects.ArxEffect
import dev.arx.core.effects.EffectConstants
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource
import java.io.File
import kotlin.math.abs
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Runs every conformance fixture through the full loader, like conformance.test.ts
 * and ConformanceTests.swift. Every key expected.json may state is checked, and an
 * unknown key fails the test so a new expectation cannot be skipped silently.
 */
class ConformanceTest {
    companion object {
        /** Spec 12.3 allows 1e-5; the reference implementations check at 1e-6. */
        const val TOLERANCE = 1e-6

        private val fixtureKeys = setOf(
            "valid", "warnings", "errors", "package", "manifestUrl", "serve", "resolved", "target", "layers", "effects",
        )
        private val layerKeys = setOf("id", "size", "matrix", "arFoundation", "arcore", "arkit", "playback")
        private val effectKeys = setOf("id", "preset", "colors", "amount", "size", "speed", "sprite", "matrix")

        /** Effects fixtures run as an implementation that reads ARX_effects (spec/extensions/ARX_effects.md 4.1). */
        val EFFECTS_OPTIONS = ArxValidationOptions(supportedExtensions = setOf(EffectConstants.EXTENSION))

        /** Every effects fixture of the conformance table (spec section 12.2). */
        private val effectsFixtures = listOf(
            "D001-unknown-preset", "D002-amount-range", "D003-bad-color", "D004-extra-field", "D005-duplicate-id",
            "D006-not-array", "D007-too-many", "D008-quaternion", "D009-undeclared", "E001-sparkle-defaults",
            "E002-all-presets", "E003-white-cone", "E004-pink-sparkle", "E009-worst-case",
        )

        @JvmStatic
        fun positiveNames(): List<String> = Fixtures.names("positive")

        @JvmStatic
        fun negativeNames(): List<String> = Fixtures.names("negative")

        @JvmStatic
        fun effectsNames(): List<String> = Fixtures.names("effects")

        private const val EFFECTS_ROOT = "/extensions/ARX_effects"
        private const val GOOD = """"id":"b","preset":"sparkle","colors":["#FF0071","#18004A"]"""

        @JvmStatic
        fun badExtensionObjects(): List<String> = listOf(
            "[]", "\"sparkle\"", "null", """{"effects":{"id":"a"}}""", "{}", """{"effects":[]}""",
            """{"effects":[${(0..EffectConstants.MAX_EFFECTS).joinToString(",") { """{"id":"fx-$it","preset":"sparkle","colors":["#FF0071","#18004A"]}""" }}]}""",
            """{"effects":[{"id":"a","preset":"sparkle","colors":["#FF0071","#18004A"]}],"version":2}""",
        )

        @JvmStatic
        fun badEffects(): List<Arguments> = listOf(
            """{$GOOD,"amount":5}""" to "/effects/1/amount",
            """{$GOOD,"amount":0.05}""" to "/effects/1/amount",
            """{$GOOD,"size":0.3}""" to "/effects/1/size",
            """{$GOOD,"speed":-1}""" to "/effects/1/speed",
            """{"id":"b","preset":"sparkle","colors":["#FFF","#18004A"]}""" to "/effects/1/colors/0",
            """{"id":"b","preset":"sparkle","colors":["#FFFFFF"]}""" to "/effects/1/colors",
            """{$GOOD,"opacity":1}""" to "/effects/1",
            """{"id":"b","preset":"rise"}""" to "/effects/1",
            """{"id":"","preset":"sparkle","colors":["#FF0071","#18004A"]}""" to "/effects/1/id",
            """{"id":"b","preset":"Sparkle","colors":["#FF0071","#18004A"]}""" to "/effects/1/preset",
            """{$GOOD,"transform":{"skew":1}}""" to "/effects/1/transform",
            "5" to "/effects/1",
            """{$GOOD,"transform":{"rotation":[0,0,0,1.05]}}""" to "/effects/1/transform/rotation/3",
            """{$GOOD,"transform":{"rotation":[0.3,0,0,1]}}""" to "/effects/1/transform/rotation",
        ).map { (bad, pointer) -> Arguments.of(bad, pointer) }

        /** Effects with several schema errors: the one reported is the one ajv reports first (validate-effects.ts). */
        @JvmStatic
        fun ajvFirstErrors(): List<Arguments> = listOf(
            """{$GOOD,"opacity":1,"amount":9}""" to "/effects/0",
            """{"id":"b","preset":"rise","amount":9}""" to "/effects/0",
            """{"id":"","preset":"Sparkle","colors":["#FFF","x"]}""" to "/effects/0/id",
            """{"id":"b","preset":"sparkle","colors":["#FFF"]}""" to "/effects/0/colors",
            """{$GOOD,"transform":{"skew":1,"rotation":[0,0,0,1.05]}}""" to "/effects/0/transform",
            """{$GOOD,"transform":{"rotation":[2,0,0]}}""" to "/effects/0/transform/rotation",
            """{$GOOD,"transform":{"position":["a",0,0],"scale":[0,1,1]}}""" to "/effects/0/transform/position/0",
            """{$GOOD,"amount":"1"}""" to "/effects/0/amount",
            """{"sprite":"Heart","speed":-1,"size":9,"amount":9,$GOOD}""" to "/effects/0/amount",
            """{"zzz":1,"id":5,"preset":"sparkle","colors":["#FF0071","#18004A"]}""" to "/effects/0",
            """{"preset":"sparkle","colors":["#FF0071","#18004A"],"id":"b","aaa":1}""" to "/effects/0",
            """{"id":"b","preset":"sparkle","colors":["#FFF","#18004A","#000000"],"amount":0}""" to "/effects/0/colors",
            """{"id":"b","preset":7,"colors":"red"}""" to "/effects/0/preset",
            """{$GOOD,"transform":{"scale":[1,1,1],"rotation":[0,0,0,1],"position":[0,0]}}""" to "/effects/0/transform/position",
            """{$GOOD,"transform":5}""" to "/effects/0/transform",
        ).map { (bad, pointer) -> Arguments.of(bad, pointer) }

        /** Schema, rotation, id, preset, sprite (spec/extensions/ARX_effects.md 4.2). */
        @JvmStatic
        fun firstProblems(): List<Arguments> = listOf(
            """{"id":"planet","preset":"firefly","colors":["#FF0071","#18004A"],"amount":9,"sprite":"heart","transform":{"rotation":[0.3,0,0,1]}}""" to
                "warning ARX_EFFECT_INVALID /effects/0/amount",
            """{"id":"planet","preset":"firefly","colors":["#FF0071","#18004A"],"sprite":"heart","transform":{"rotation":[0.3,0,0,1]}}""" to
                "warning ARX_EFFECT_INVALID /effects/0/transform/rotation",
            """{"id":"planet","preset":"firefly","colors":["#FF0071","#18004A"],"sprite":"heart"}""" to
                "warning ARX_EFFECT_INVALID /effects/0/id",
            """{"id":"fx","preset":"firefly","colors":["#FF0071","#18004A"],"sprite":"heart"}""" to
                "warning ARX_EFFECT_UNSUPPORTED /effects/0/preset",
            """{"id":"fx","preset":"sparkle","colors":["#FF0071","#18004A"],"sprite":"heart"}""" to
                "warning ARX_EFFECT_UNSUPPORTED /effects/0/sprite",
            // A drifted rotation is not reported for a dropped effect.
            """{"id":"fx","preset":"firefly","colors":["#FF0071","#18004A"],"transform":{"rotation":[0,0,0.1,1]}}""" to
                "warning ARX_EFFECT_UNSUPPORTED /effects/0/preset",
        ).map { (bad, issue) -> Arguments.of(bad, issue) }
    }

    @TempDir
    lateinit var cacheDir: File

    private fun expected(directory: File): JsonObject {
        val expected = Json.parseToJsonElement(File(directory, "expected.json").readText()).jsonObject
        val unknown = expected.keys - fixtureKeys
        assertTrue(unknown.isEmpty(), "${directory.name}: unchecked expected.json keys $unknown")
        return expected
    }

    private fun run(
        directory: File,
        expected: JsonObject,
        options: ArxValidationOptions = ArxValidationOptions(),
    ): ArxValidationResult {
        expected.string("package")?.let { name ->
            return ArxExperienceLoader.validatePackage(File(directory, name).readBytes(), cacheDir, options)
        }
        return ArxExperienceLoader.validate(source(directory, expected), cacheDir, options)
    }

    private fun source(directory: File, expected: JsonObject): ArxAssetSource {
        expected.string("package")?.let { name ->
            return assertNotNull(ArxPackage.open(File(directory, name).readBytes()).source, "${directory.name}: package")
        }
        val manifestUrl = expected.string("manifestUrl")
        val serve = expected["serve"] as? JsonObject
        if (manifestUrl != null && serve != null) {
            val files = serve.mapValues { it.value.jsonPrimitive.content }
            return ArxRemoteSource(manifestUrl) { url -> files[url]?.let { File(directory, it).readBytes() } }
        }
        assertTrue(manifestUrl == null && serve == null, "${directory.name}: manifestUrl and serve go together")
        return ArxLocalSource.directory(directory)
    }

    /** The experience carries no effects, so they are read from the resolved manifest with the same options. */
    private fun resolvedEffects(directory: File, expected: JsonObject, options: ArxValidationOptions): List<ArxEffect> {
        val source = source(directory, expected)
        val data = assertNotNull(source.read(source.manifestUrl), "${directory.name}: manifest")
        return assertNotNull(ArxManifestValidator.validate(data, source.manifestUrl, options).manifest).effects
    }

    @Test
    fun coversEveryFixture() {
        assertTrue(positiveNames().size >= 17, "${positiveNames()}")
        assertTrue(negativeNames().size >= 18, "${negativeNames()}")
        assertEquals(37, positiveNames().size + negativeNames().size)
        assertEquals(effectsFixtures, effectsNames())
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("positiveNames")
    fun positiveFixture(name: String) {
        val directory = Fixtures.file("positive/$name")
        val expected = expected(directory)
        assertTrue(expected.getValue("valid").jsonPrimitive.boolean, "$name: a positive fixture must be valid")
        val result = run(directory, expected)
        val errors = result.issues.filter { it.severity == ArxIssue.Severity.ERROR }
        assertTrue(errors.isEmpty(), "$name: $errors")
        val warnings = result.issues.filter { it.severity == ArxIssue.Severity.WARNING }.map { it.code.raw }.sorted()
        assertEquals(expected.strings("warnings").sorted(), warnings, "$name: ${result.issues}")

        val experience = assertNotNull(result.experience, "$name should load")
        assertTrue(result.isValid)
        assertExperience(name, expected, experience)
        expected["effects"]?.let { assertEffects(it.jsonArray, resolvedEffects(directory, expected, ArxValidationOptions()), name) }
    }

    /**
     * Effect data never fails a manifest (spec/extensions/ARX_effects.md 4.2): every
     * effects fixture is valid, keeps its layers, and drops only the bad effects with a warning each.
     */
    @ParameterizedTest(name = "{0}")
    @MethodSource("effectsNames")
    fun effectsFixture(name: String) {
        val directory = Fixtures.file("effects/$name")
        val expected = expected(directory)
        assertTrue(expected.getValue("valid").jsonPrimitive.boolean, "$name: every effects fixture is valid")
        val result = run(directory, expected, EFFECTS_OPTIONS)
        val errors = result.issues.filter { it.severity == ArxIssue.Severity.ERROR }
        assertTrue(errors.isEmpty(), "$name: $errors")
        val warnings = result.issues.filter { it.severity == ArxIssue.Severity.WARNING }.map { "${it.code.raw} ${it.path}" }
        val wanted = expected.getValue("warnings").jsonArray.map {
            "${it.jsonObject.getValue("code").jsonPrimitive.content} ${it.jsonObject.getValue("path").jsonPrimitive.content}"
        }
        assertEquals(wanted.sorted(), warnings.sorted(), "$name: ${result.issues}")
        val experience = assertNotNull(result.experience, "$name should load")
        assertExperience(name, expected, experience)
        assertEffects(expected.getValue("effects").jsonArray, resolvedEffects(directory, expected, EFFECTS_OPTIONS), name)
    }

    @Test
    fun worstCaseHasTheMostEffectsAllSnowAtAmountFour() {
        val expected = expected(Fixtures.file("effects/E009-worst-case"))
        val effects = expected.getValue("effects").jsonArray.map { it.jsonObject }
        assertEquals(EffectConstants.MAX_EFFECTS, effects.size)
        for (effect in effects) {
            assertEquals("snow" to 4.0, effect.getValue("preset").jsonPrimitive.content to effect.getValue("amount").jsonPrimitive.double)
        }
    }

    /** An implementation that does not read ARX_effects passes no supported extensions (spec section 10). */
    @Test
    fun c019CarriesDeclaredEffectDataYetOpensLikeC001WithoutOptions() {
        val directory = Fixtures.file("positive/C019-unknown-extension-ignored")
        val manifest = Json.parseToJsonElement(File(directory, "manifest.json").readText()).jsonObject
        assertEquals(listOf(EffectConstants.EXTENSION), manifest.strings("extensionsUsed"))
        val authored = manifest.getValue("extensions").jsonObject.getValue(EffectConstants.EXTENSION).jsonObject
        assertTrue(authored.getValue("effects").jsonArray.isNotEmpty())

        val expected = expected(directory)
        val c001 = expected(Fixtures.file("positive/C001-minimal-image"))
        assertEquals(emptyList(), expected.strings("warnings"))
        assertEquals(emptyList(), expected.getValue("effects").jsonArray.toList())
        assertEquals(c001["target"], expected["target"])
        assertEquals(c001["layers"], expected["layers"])

        val data = File(directory, "manifest.json").readBytes()
        val plain = ArxManifestValidator.validate(data, ArxLocal.MANIFEST_URL)
        assertEquals(emptyList(), plain.issues)
        assertEquals(emptyList(), assertNotNull(plain.manifest).effects)
        val reading = ArxManifestValidator.validate(data, ArxLocal.MANIFEST_URL, EFFECTS_OPTIONS)
        assertEquals(emptyList(), reading.issues)
        assertEquals(listOf("pink-sparkle"), assertNotNull(reading.manifest).effects.map { it.id })
    }

    // Effect cases the fixtures do not cover, with the verdicts of validate-effects.test.ts.

    /** Issues as "code path" (path relative to /extensions/ARX_effects when inside it), kept ids, layer ids. */
    private fun checkEffects(
        extensions: String?,
        options: ArxValidationOptions = EFFECTS_OPTIONS,
        declared: Boolean = true,
        layerExtensions: String? = null,
    ): Triple<List<String>, List<String>, List<String>> {
        val text = buildString {
            append("""{"spec":"arx/0.1","anchor":{"type":"image","src":"target.png"},""")
            append(""""layers":[{"id":"planet","type":"image","src":"planet.png"""")
            layerExtensions?.let { append(""","extensions":$it""") }
            append("}]")
            if (declared) append(""","extensionsUsed":["ARX_effects"]""")
            extensions?.let { append(""","extensions":$it""") }
            append("}")
        }
        val result = ArxManifestValidator.validate(text.toByteArray(), "https://example.com/experience/manifest.json", options)
        val manifest = assertNotNull(result.manifest, "$text: ${result.issues}")
        val issues = result.issues.map { "${it.severity.raw} ${it.code.raw} ${it.path.removePrefix(EFFECTS_ROOT)}" }
        return Triple(issues, manifest.effects.map { it.id }, manifest.layers.map { it.id })
    }

    private fun withEffects(vararg effects: String): String = """{"ARX_effects":{"effects":[${effects.joinToString(",")}]}}"""

    private fun effect(id: String = "fx", extra: String = ""): String =
        """{"id":"$id","preset":"sparkle","colors":["#FF0071","#18004A"]$extra}"""

    @Test
    fun declaredButAbsentEffectsGiveNoEffectsAndNoWarning() {
        assertEquals(Triple(emptyList(), emptyList(), listOf("planet")), checkEffects("{}"))
        assertEquals(Triple(emptyList(), emptyList(), listOf("planet")), checkEffects(null))
    }

    @Test
    fun anExplicitNullIsNotAnObject() {
        assertEquals(Triple(listOf("warning ARX_EFFECT_INVALID "), emptyList(), listOf("planet")), checkEffects("""{"ARX_effects":null}"""))
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("badExtensionObjects")
    fun aBadExtensionObjectDropsEveryEffect(arxEffects: String) {
        assertEquals(
            Triple(listOf("warning ARX_EFFECT_INVALID "), emptyList(), listOf("planet")),
            checkEffects("""{"ARX_effects":$arxEffects}"""),
        )
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("badEffects")
    fun aBadEffectDropsOnlyItself(bad: String, pointer: String) {
        assertEquals(
            Triple(listOf("warning ARX_EFFECT_INVALID $pointer"), listOf("a"), listOf("planet")),
            checkEffects(withEffects(effect("a"), bad)),
        )
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("ajvFirstErrors")
    fun reportsTheSchemaErrorAjvReportsFirst(bad: String, pointer: String) {
        assertEquals(Triple(listOf("warning ARX_EFFECT_INVALID $pointer"), emptyList(), listOf("planet")), checkEffects(withEffects(bad)))
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("firstProblems")
    fun reportsTheFirstProblemInSpecOrder(bad: String, issue: String) {
        assertEquals(Triple(listOf(issue), emptyList(), listOf("planet")), checkEffects(withEffects(bad)))
    }

    @Test
    fun reportsEachBadEffectOnceInEffectOrder() {
        val (issues, ids) = checkEffects(
            withEffects(effect("a", ""","amount":9,"size":9,"speed":9"""), effect("b"), effect("c").replace("sparkle", "firefly")),
        )
        assertEquals(listOf("warning ARX_EFFECT_INVALID /effects/0/amount", "warning ARX_EFFECT_UNSUPPORTED /effects/2/preset"), issues)
        assertEquals(listOf("b"), ids)
    }

    @Test
    fun idsCollideWithLayersAndKeptEffectsOnly() {
        assertEquals(listOf("warning ARX_EFFECT_INVALID /effects/0/id"), checkEffects(withEffects(effect("planet"), effect("b"))).first)
        val (issues, ids) = checkEffects(withEffects(effect("a"), effect("a", ""","sprite":"dot"""")))
        assertEquals(listOf("warning ARX_EFFECT_INVALID /effects/1/id") to listOf("a"), issues to ids)
        // A dropped effect does not reserve its id.
        val dropped = checkEffects(withEffects(effect("a").replace("sparkle", "firefly"), effect("a")))
        assertEquals(listOf("warning ARX_EFFECT_UNSUPPORTED /effects/0/preset") to listOf("a"), dropped.first to dropped.second)
    }

    @Test
    fun objectMemberNamesAreNotPresets() {
        val issues = checkEffects(withEffects(effect().replace("sparkle", "constructor"))).first
        assertEquals(listOf("warning ARX_EFFECT_UNSUPPORTED /effects/0/preset"), issues)
    }

    @Test
    fun aDriftedRotationIsNormalizedAndWarnedAboveOneTenThousandth() {
        val drifted = checkEffects(withEffects(effect(extra = ""","transform":{"rotation":[0,0,0.1,1]}""")))
        assertEquals(listOf("warning ARX_QUATERNION_DRIFT /effects/0/transform/rotation"), drifted.first)
        assertEquals(listOf("fx"), drifted.second)
        assertEquals(emptyList(), checkEffects(withEffects(effect(extra = ""","transform":{"rotation":[0,0,0.01,1]}"""))).first)
    }

    @Test
    fun undeclaredEffectsOnlyWarnUndeclared() {
        val bad = withEffects(*Array(EffectConstants.MAX_EFFECTS + 1) { effect().replace("sparkle", "firefly") })
        assertEquals(
            Triple(listOf("warning ARX_EXTENSION_UNDECLARED "), emptyList(), listOf("planet")),
            checkEffects(bad, declared = false),
        )
    }

    @Test
    fun aViewerThatDoesNotReadEffectsIgnoresThemSilently() {
        val bad = withEffects(*Array(EffectConstants.MAX_EFFECTS + 1) { effect().replace("sparkle", "firefly") })
        val options = listOf(ArxValidationOptions(), ArxValidationOptions(supportedExtensions = setOf("ARX_other")))
        for (option in options) {
            for (input in listOf(withEffects(effect()), bad, """{"ARX_effects":"not an object"}""")) {
                assertEquals(Triple(emptyList(), emptyList(), listOf("planet")), checkEffects(input, option), input)
            }
        }
    }

    @Test
    fun effectsInALayerExtensionsAreNotRead() {
        val layered = checkEffects(null, layerExtensions = withEffects(effect()))
        assertEquals(Triple(emptyList(), emptyList(), listOf("planet")), layered)
    }

    /** Target size, every layer's geometry, adapters and playback, and resolved sources against expected.json. */
    private fun assertExperience(name: String, expected: JsonObject, experience: ArxExperience) {
        val target = expected.getValue("target").jsonObject
        assertClose(target.doubles("size"), experience.target.size.array, "$name target size")
        val physicalWidth = target.getValue("physicalWidth")
        assertEquals(if (physicalWidth is JsonNull) null else physicalWidth.jsonPrimitive.double, experience.target.physicalWidth, "$name physicalWidth")
        assertPlayedFileIsCached(experience.target.file, name)

        val layers = expected.getValue("layers").jsonArray.map { it.jsonObject }
        assertEquals(layers.map { it.getValue("id").jsonPrimitive.content }, experience.layers.map { it.id }, name)
        for ((layer, want) in experience.layers.zip(layers)) {
            val label = "$name ${layer.id}"
            val unknown = want.keys - layerKeys
            assertTrue(unknown.isEmpty(), "$label: unchecked layer keys $unknown")
            assertClose(want.doubles("size"), layer.size.array, "$label size")
            assertClose(want.doubles("matrix"), layer.matrix, "$label matrix")
            assertTransform(want.getValue("arFoundation"), ArFoundationBasis.transform(layer.transform), "$label arFoundation")
            assertTransform(want.getValue("arcore"), ArCoreBasis.transform(layer.transform), "$label arcore")
            // Spec 11.3: ARKit image anchors use the ARCore axes.
            assertTransform(want.getValue("arkit"), ArCoreBasis.transform(layer.transform), "$label arkit")
            val playback = (want["playback"] as? JsonObject)?.let {
                Playback(it.getValue("autoplay").jsonPrimitive.boolean, it.getValue("loop").jsonPrimitive.boolean)
            }
            assertEquals(playback, layer.playback, "$label playback")
            assertPlayedFileIsCached(layer.file, label)
        }

        for ((pointer, url) in (expected["resolved"] as? JsonObject).orEmpty()) {
            val actual = if (pointer == "/anchor/src") {
                experience.target.sourceUrl
            } else {
                val index = Regex("^/layers/(\\d+)/src$").find(pointer)?.groupValues?.get(1)?.toInt()
                    ?: fail("$name: unexpected resolved pointer $pointer")
                experience.layers[index].sourceUrl
            }
            assertEquals(url.jsonPrimitive.content, actual, "$name $pointer")
        }
    }

    /** Resolved effects (spec/extensions/ARX_effects.md 4.3) against expected.json, in order. */
    private fun assertEffects(expected: JsonArray, actual: List<ArxEffect>, name: String) {
        val wanted = expected.map { it.jsonObject }
        assertEquals(wanted.map { it.getValue("id").jsonPrimitive.content }, actual.map { it.id }, "$name effect ids")
        for ((effect, want) in actual.zip(wanted)) {
            val label = "$name effect ${effect.id}"
            val unknown = want.keys - effectKeys
            assertTrue(unknown.isEmpty(), "$label: unchecked effect keys $unknown")
            assertEquals(want.getValue("preset").jsonPrimitive.content, effect.preset, "$label preset")
            assertEquals(want.strings("colors"), effect.colors, "$label colors")
            assertEquals(want.getValue("sprite").jsonPrimitive.content, effect.sprite, "$label sprite")
            assertClose(
                listOf("amount", "size", "speed").map { want.getValue(it).jsonPrimitive.double },
                doubleArrayOf(effect.amount, effect.size, effect.speed),
                "$label amount,size,speed",
            )
            assertClose(want.doubles("matrix"), effect.matrix, "$label matrix")
        }
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("negativeNames")
    fun negativeFixture(name: String) {
        val directory = Fixtures.file("negative/$name")
        val expected = expected(directory)
        assertFalse(expected.getValue("valid").jsonPrimitive.boolean, "$name: a negative fixture must be invalid")
        val result = run(directory, expected)
        assertNull(result.experience, "$name should be invalid")
        assertFalse(result.isValid)
        val reported = result.issues.filter { it.severity == ArxIssue.Severity.ERROR }.map { it.code.raw to it.path }.toSet()
        val wanted = (expected["errors"] as? JsonArray).orEmpty().map {
            it.jsonObject.getValue("code").jsonPrimitive.content to it.jsonObject.getValue("path").jsonPrimitive.content
        }
        assertTrue(wanted.isNotEmpty(), "$name: a negative fixture names its errors")
        for (want in wanted) assertTrue(want in reported, "$name missing $want; got ${result.issues}")
        val warnings = result.issues.filter { it.severity == ArxIssue.Severity.WARNING }.map { it.code.raw }.sorted()
        if (expected.containsKey("warnings")) assertEquals(expected.strings("warnings").sorted(), warnings, name)
    }

    /** The loader writes validated bytes to the cache and points the experience there. */
    @Test
    fun experienceUsesCachedValidatedFiles() {
        val directory = Fixtures.file("positive/C002-video-once")
        val experience = ArxExperienceLoader.load(ArxLocalSource.directory(directory), cacheDir)
        val video = experience.layers.first()
        assertEquals(cacheDir.canonicalFile, video.file.parentFile.canonicalFile)
        assertEquals("mp4", video.file.extension)
        assertEquals(ArxIntegrity.sha256Hex(video.file.readBytes()), video.file.nameWithoutExtension)
        assertContentEquals(File(directory, "assets/video.mp4").readBytes(), video.file.readBytes())
    }

    /** A tampered cache entry is replaced by the validated bytes, never played. */
    @Test
    fun replacesATamperedCacheEntry() {
        val directory = Fixtures.file("positive/C001-minimal-image")
        val first = ArxExperienceLoader.load(directory, cacheDir)
        first.target.file.writeBytes(byteArrayOf(1, 2, 3))
        val second = ArxExperienceLoader.load(directory, cacheDir)
        assertEquals(first.target.file, second.target.file)
        assertContentEquals(File(directory, "assets/target.jpg").readBytes(), second.target.file.readBytes())
    }

    @Test
    fun loadThrowsEveryIssueForAnInvalidExperience() {
        val failure = runCatching {
            ArxExperienceLoader.load(Fixtures.file("negative/N006-hash-mismatch"), cacheDir)
        }.exceptionOrNull()
        val issues = (failure as? ArxValidationFailure)?.issues ?: fail("expected ArxValidationFailure, got $failure")
        assertTrue(issues.any { it.code == ArxIssueCode.INTEGRITY_MISMATCH && it.path == "/layers/0/integrity" }, "$issues")
    }

    @Test
    fun loadsAPackageFromBytes() {
        val bytes = Fixtures.bytes("positive/C011-package-relative/experience.arx")
        val experience = ArxExperienceLoader.load(bytes, cacheDir)
        assertEquals(listOf("overlay", "clip"), experience.layers.map { it.id })
        assertEquals("arx-package://root/assets/target.jpg", experience.target.sourceUrl)
    }

    private fun assertPlayedFileIsCached(file: File, label: String) {
        assertEquals(cacheDir.canonicalFile, file.parentFile.canonicalFile, "$label plays from the cache")
        assertEquals(ArxIntegrity.sha256Hex(file.readBytes()), file.nameWithoutExtension, "$label cache name")
    }

    private fun assertClose(expected: List<Double>, actual: DoubleArray, label: String) {
        assertEquals(expected.size, actual.size, "$label length")
        expected.forEachIndexed { index, value ->
            assertTrue(abs(actual[index] - value) < TOLERANCE, "$label[$index]: expected $value, got ${actual[index]}")
        }
    }

    private fun assertTransform(expected: JsonElement, actual: ArxTransform, label: String) {
        val transform = expected.jsonObject
        assertClose(transform.doubles("position"), actual.position.array, "$label.position")
        assertClose(transform.doubles("rotation"), actual.rotation.array, "$label.rotation")
        assertClose(transform.doubles("scale"), actual.scale.array, "$label.scale")
    }

    private fun JsonObject.string(key: String): String? = (this[key] as? kotlinx.serialization.json.JsonPrimitive)?.content

    private fun JsonObject.strings(key: String): List<String> =
        (this[key] as? JsonArray).orEmpty().map { it.jsonPrimitive.content }

    private fun JsonObject.doubles(key: String): List<Double> = getValue(key).jsonArray.map { it.jsonPrimitive.double }
}
