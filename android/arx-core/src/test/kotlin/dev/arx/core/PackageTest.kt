package dev.arx.core

import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Timeout
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource
import java.util.concurrent.TimeUnit
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Ports package.test.ts and PackageTests.swift: ZIP attacks, limits and bounded inflate. */
@Timeout(value = 20, unit = TimeUnit.SECONDS, threadMode = Timeout.ThreadMode.SEPARATE_THREAD)
class PackageTest {
    companion object {
        private val manifest = TestZip.manifestBytes

        @JvmStatic
        fun unsafeNames(): List<Arguments> = listOf(
            "../evil.png", "assets/../../evil.png", "/etc/evil.png", "C:/evil.png", "c:evil.png",
            "assets\\evil.png", "assets/a\u0000.png", "assets//a.png", "assets/..", "..",
        ).map { Arguments.of(it, "ARX_PACKAGE_PATH zip:$it") }

        /** fflate's `deflateSync(new Uint8Array(4000))`; the expectations are what fflate reports for each stream. */
        private val fflateZeros = intArrayOf(237, 192, 49, 1, 0, 0, 0, 194, 32, 251, 167, 54, 198, 30, 24, 0, 0, 0, 144, 59)

        private fun stream(vararg values: Int) = ByteArray(values.size) { values[it].toByte() }

        @JvmStatic
        fun inflateCases(): List<Arguments> = listOf(
            Arguments.of("complete", stream(*fflateZeros), 4000L, true),
            Arguments.of("trailing bytes", stream(*fflateZeros, 0, 0, 0, 0, 0), 4000L, true),
            Arguments.of("empty stream", ByteArray(0), 0L, true),
            Arguments.of("stored block", stream(0x01, 0x03, 0x00, 0xfc, 0xff, 1, 2, 3), 3L, true),
            Arguments.of("truncated by 1", stream(*fflateZeros.copyOf(fflateZeros.size - 1)), 4000L, false),
            Arguments.of("truncated by 2", stream(*fflateZeros.copyOf(fflateZeros.size - 2)), 4000L, false),
            Arguments.of("truncated by 10", stream(*fflateZeros.copyOf(fflateZeros.size - 10)), 4000L, false),
            Arguments.of("truncated stored block", stream(0x01, 0x03, 0x00, 0xfc, 0xff, 1, 2), 3L, false),
            Arguments.of("no final block", stream(0x00, 0x03, 0x00, 0xfc, 0xff, 1, 2, 3), 3L, false),
            Arguments.of("invalid block type", stream(0xff, 0xff, 0xff), 3L, false),
            Arguments.of("longer than declared", stream(*fflateZeros), 3999L, false),
            Arguments.of("shorter than declared", stream(*fflateZeros), 4001L, false),
        )
    }

    private fun codes(bytes: ByteArray, limits: ArxPackageLimits = ArxPackageLimits()): List<String> =
        ArxPackage.open(bytes, limits).issues.map { "${it.code.raw} ${it.path}" }

    private fun packageUrl(path: String) = ArxLocal.ORIGIN + path

    @Test
    fun opensAWellFormedPackageAndReadsEntries() {
        val result = ArxPackage.open(
            TestZip.build(
                listOf(
                    TestZipEntry("manifest.json", manifest, deflate = true),
                    TestZipEntry("assets/"),
                    TestZipEntry("assets/a.png", byteArrayOf(1, 2, 3)),
                ),
            ),
        )
        assertEquals(emptyList(), result.issues)
        val source = assertNotNull(result.source)
        assertContentEquals(byteArrayOf(1, 2, 3), source.read(packageUrl("assets/a.png")))
        assertContentEquals(manifest, source.read(packageUrl("manifest.json")))
        assertNull(source.read(packageUrl("assets/missing.png")))
        assertNull(source.read(packageUrl("assets/")))
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("unsafeNames")
    fun rejectsTheUnsafeEntryName(name: String, issue: String) {
        val bytes = TestZip.build(listOf(TestZipEntry("manifest.json", manifest), TestZipEntry(name, manifest)))
        assertTrue(issue in codes(bytes), "${codes(bytes)}")
        assertNull(ArxPackage.open(bytes).source)
    }

    @Test
    fun rejectsDuplicateEntries() {
        val bytes = TestZip.build(
            listOf(
                TestZipEntry("manifest.json", manifest),
                TestZipEntry("assets/a.png", manifest),
                TestZipEntry("assets/a.png", manifest),
            ),
        )
        assertTrue("ARX_PACKAGE_PATH zip:assets/a.png" in codes(bytes))
    }

    @Test
    fun rejectsSymbolicLinksAndEncryptedEntries() {
        val bytes = TestZip.build(
            listOf(
                TestZipEntry("manifest.json", manifest),
                TestZipEntry("assets/link.png", "/etc/passwd".toByteArray(), symlink = true),
                TestZipEntry("assets/secret.png", manifest, encrypted = true),
            ),
        )
        val found = codes(bytes)
        assertTrue("ARX_PACKAGE_PATH zip:assets/link.png" in found, "$found")
        assertTrue("ARX_PACKAGE_UNSUPPORTED zip:assets/secret.png" in found, "$found")
    }

    @Test
    fun rejectsUnsupportedCompressionMethods() {
        val bytes = TestZip.build(listOf(TestZipEntry("manifest.json", manifest))).also { zip ->
            // Method field of the central directory record (after the local entry).
            val central = 30 + "manifest.json".length + manifest.size
            zip[central + 10] = 12 // bzip2
        }
        assertEquals(listOf("ARX_PACKAGE_UNSUPPORTED zip:manifest.json"), codes(bytes))
    }

    @Test
    fun requiresManifestAtTheArchiveRoot() {
        val bytes = TestZip.build(listOf(TestZipEntry("nested/manifest.json", manifest)))
        assertTrue("ARX_PACKAGE_MANIFEST_MISSING zip:manifest.json" in codes(bytes))
    }

    @Test
    fun enforcesImplementationLimitsBeforeDecompressing() {
        val bytes = TestZip.build(
            listOf(
                TestZipEntry("manifest.json", manifest),
                TestZipEntry("assets/zeros.png", ByteArray(1_000_000), deflate = true),
            ),
        )
        assertTrue("ARX_PACKAGE_LIMIT zip:assets/zeros.png" in codes(bytes))
        val totalLimit = ArxPackageLimits(maxTotalUncompressedBytes = 1000, maxCompressionRatio = 1e9)
        assertTrue("ARX_PACKAGE_LIMIT zip:" in codes(bytes, totalLimit))
        val twoEntries = TestZip.build(listOf(TestZipEntry("manifest.json", manifest), TestZipEntry("a.png")))
        assertTrue("ARX_PACKAGE_LIMIT zip:" in codes(twoEntries, ArxPackageLimits(maxEntries = 1)))
        assertTrue("ARX_PACKAGE_LIMIT zip:manifest.json" in codes(twoEntries, ArxPackageLimits(maxManifestBytes = 4)))
    }

    @Test
    fun rejectsEntriesWhoseDataDoesNotMatchTheDeclaredSize() {
        val bytes = TestZip.build(
            listOf(
                TestZipEntry("manifest.json", manifest),
                TestZipEntry("assets/a.png", ByteArray(4000), declaredSize = 10, deflate = true),
            ),
        )
        assertTrue("ARX_PACKAGE_CORRUPT zip:assets/a.png" in codes(bytes, ArxPackageLimits(maxCompressionRatio = 1e9)))
        val stored = TestZip.build(
            listOf(TestZipEntry("manifest.json", manifest), TestZipEntry("assets/b.png", ByteArray(40), declaredSize = 30)),
        )
        assertTrue("ARX_PACKAGE_CORRUPT zip:assets/b.png" in codes(stored))
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("inflateCases")
    fun inflatesLikeFflate(label: String, stream: ByteArray, size: Long, accepted: Boolean) {
        val bytes = TestZip.build(
            listOf(
                TestZipEntry("manifest.json", manifest),
                TestZipEntry("assets/a.png", declaredSize = size, deflate = true, body = stream),
            ),
        )
        val found = codes(bytes, ArxPackageLimits(maxCompressionRatio = 1e9))
        assertEquals(if (accepted) emptyList() else listOf("ARX_PACKAGE_CORRUPT zip:assets/a.png"), found, label)
    }

    @Test
    fun inflatesLargeEntriesAcrossManyChunks() {
        val zeros = ByteArray(1_000_000)
        val result = ArxPackage.open(
            TestZip.build(
                listOf(TestZipEntry("manifest.json", manifest), TestZipEntry("assets/zeros.png", zeros, deflate = true)),
            ),
            ArxPackageLimits(maxCompressionRatio = 1e9),
        )
        assertEquals(emptyList(), result.issues)
        assertContentEquals(zeros, assertNotNull(result.source).read(packageUrl("assets/zeros.png")))
    }

    @Test
    fun warnsAboutFilesAnArxPackageDoesNotUse() {
        val result = ArxPackage.open(
            TestZip.build(listOf(TestZipEntry("manifest.json", manifest), TestZipEntry("run.sh", manifest))),
        )
        assertNotNull(result.source)
        assertEquals(listOf("warning ARX_PACKAGE_UNEXPECTED_FILE"), result.issues.map { "${it.severity} ${it.code.raw}" })
        val upper = ArxPackage.open(TestZip.build(listOf(TestZipEntry("manifest.json", manifest), TestZipEntry("A.PNG"))))
        assertEquals(emptyList(), upper.issues)
    }

    @Test
    fun rejectsBytesThatAreNotAZipArchive() {
        assertEquals(listOf("ARX_PACKAGE_CORRUPT zip:"), codes(byteArrayOf(1, 2, 3)))
        assertEquals(listOf("ARX_PACKAGE_CORRUPT zip:"), codes(ByteArray(0)))
    }

    @Test
    fun rejectsZip64Markers() {
        val bytes = TestZip.build(listOf(TestZipEntry("manifest.json", manifest)))
        val entryCount = bytes.size - 22 + 10
        bytes[entryCount] = 0xff.toByte()
        bytes[entryCount + 1] = 0xff.toByte()
        assertEquals(listOf("ARX_PACKAGE_UNSUPPORTED zip:"), codes(bytes))
    }

    @Test
    fun rejectsACentralDirectoryThatPointsOutsideTheArchive() {
        val bytes = TestZip.build(listOf(TestZipEntry("manifest.json", manifest)))
        val directoryOffset = bytes.size - 22 + 16
        bytes[directoryOffset + 3] = 0x7f
        assertEquals(listOf("ARX_PACKAGE_CORRUPT zip:"), codes(bytes))
    }

    @Test
    fun opensThePackageRelativeFixture() {
        val result = ArxPackage.open(Fixtures.bytes("positive/C011-package-relative/experience.arx"))
        assertEquals(emptyList(), result.issues)
        val target = assertNotNull(assertNotNull(result.source).read(packageUrl("assets/target.jpg")))
        assertEquals(269_198, target.size)
        assertEquals(0xFF.toByte(), target[0])
        assertEquals(0xD8.toByte(), target[1])
    }

    @Test
    fun rejectsTheZipSlipFixture() {
        val result = ArxPackage.open(Fixtures.bytes("negative/N008-zip-slip/experience.arx"))
        assertTrue("ARX_PACKAGE_PATH zip:../evil.png" in result.issues.map { "${it.code.raw} ${it.path}" })
        assertNull(result.source)
    }
}
