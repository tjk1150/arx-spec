package dev.arx.core

import org.junit.jupiter.api.Test
import kotlin.math.abs
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Ports probe.test.ts and ProbeTests.swift. */
class ProbeTest {
    private fun u16(value: Int) = byteArrayOf((value shr 8 and 255).toByte(), (value and 255).toByte())

    private fun u32(value: Int) = byteArrayOf(
        (value shr 24 and 255).toByte(), (value shr 16 and 255).toByte(), (value shr 8 and 255).toByte(), (value and 255).toByte(),
    )

    private fun latin1(text: String) = text.toByteArray(Charsets.ISO_8859_1)

    private fun bytes(vararg values: Int) = ByteArray(values.size) { values[it].toByte() }

    /** SOI, APP1 Exif with IFD0 orientation, SOF0 with the given size, EOI. */
    private fun jpegWithOrientation(width: Int, height: Int, orientation: Int): ByteArray {
        // Big-endian TIFF header with IFD0 at 8, one entry: orientation (SHORT, count 1).
        val tiff = bytes(0x4D, 0x4D, 0x00, 0x2A) + u32(8) + u16(1) +
            u16(0x0112) + u16(3) + u32(1) + u16(orientation) + bytes(0, 0) + u32(0)
        val app1 = latin1("Exif\u0000\u0000") + tiff
        val sof = bytes(8) + u16(height) + u16(width) + bytes(3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1)
        return bytes(0xFF, 0xD8) +
            bytes(0xFF, 0xE1) + u16(app1.size + 2) + app1 +
            bytes(0xFF, 0xC0) + u16(sof.size + 2) + sof +
            bytes(0xFF, 0xD9)
    }

    private fun pngChunk(type: String, data: ByteArray) = u32(data.size) + latin1(type) + data + u32(0)

    private fun png(width: Int, height: Int, colorType: Int, extra: ByteArray = ByteArray(0)): ByteArray =
        bytes(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A) +
            pngChunk("IHDR", u32(width) + u32(height) + bytes(8, colorType, 0, 0, 0)) +
            extra + pngChunk("IDAT", ByteArray(0)) + pngChunk("IEND", ByteArray(0))

    // ArxImageProber

    @Test
    fun readsJpegSizeAndAppliesExifOrientationToTheDisplaySize() {
        val probe = assertNotNull(ArxImageProber.probe(jpegWithOrientation(300, 200, 6)))
        assertEquals(ArxImageProbe(ArxImageProbe.Format.JPEG, 300, 200, 6, false), probe)
        assertEquals(ArxImageProbe.PixelSize(200, 300), probe.displaySize)
        val upright = assertNotNull(ArxImageProber.probe(jpegWithOrientation(300, 200, 1)))
        assertEquals(ArxImageProbe.PixelSize(300, 200), upright.displaySize)
    }

    @Test
    fun detectsPngTransparencyFromTheColorTypeOrATrnsChunk() {
        assertEquals(ArxImageProbe(ArxImageProbe.Format.PNG, 10, 20, 1, false), ArxImageProber.probe(png(10, 20, 2)))
        assertEquals(true, ArxImageProber.probe(png(10, 20, 6))?.hasAlpha)
        assertEquals(true, ArxImageProber.probe(png(10, 20, 2, pngChunk("tRNS", bytes(0, 0))))?.hasAlpha)
    }

    @Test
    fun readsTheGeneratedImageFixtures() {
        val target = assertNotNull(ArxImageProber.probe(Fixtures.bytes("positive/C001-minimal-image/assets/target.jpg")))
        assertEquals(ArxImageProbe(ArxImageProbe.Format.JPEG, 1000, 750, 1, false), target)
        val overlay = assertNotNull(ArxImageProber.probe(Fixtures.bytes("positive/C001-minimal-image/assets/overlay.png")))
        assertEquals(ArxImageProbe(ArxImageProbe.Format.PNG, 800, 800, 1, true), overlay)
    }

    @Test
    fun rejectsOtherImageFormatsAndTruncatedData() {
        assertNull(ArxImageProber.probe(latin1("GIF89a")))
        assertNull(ArxImageProber.probe(bytes(0xFF, 0xD8, 0xFF)))
        assertNull(ArxImageProber.probe(ByteArray(0)))
        assertNull(ArxImageProber.probe(Fixtures.bytes("positive/C002-video-once/assets/video.mp4")))
    }

    @Test
    fun toleratesEveryTruncationOfTheImageHeaders() {
        val inputs = listOf(
            jpegWithOrientation(300, 200, 6),
            png(10, 20, 2, pngChunk("tRNS", bytes(0, 0))),
            Fixtures.bytes("positive/C001-minimal-image/assets/overlay.png").copyOf(4096),
        )
        for (input in inputs) {
            for (length in 0..input.size) ArxImageProber.probe(input.copyOf(length))
        }
    }

    // ArxMp4Prober

    @Test
    fun readsThePortableH264AacFixture() {
        val probe = assertNotNull(ArxMp4Prober.probe(Fixtures.bytes("positive/C002-video-once/assets/video.mp4")))
        assertTrue(probe.faststart)
        assertTrue(abs(assertNotNull(probe.durationSeconds) - 2) < 0.05)
        val video = assertNotNull(probe.video)
        assertEquals("avc1", video.codec)
        assertEquals(480.0, video.width)
        assertEquals(270.0, video.height)
        assertEquals(77, video.avcProfile)
        assertEquals(30, video.avcLevel)
        assertTrue(abs(assertNotNull(video.frameRate) - 30) < 0.5)
        assertTrue(video.identityMatrix)
        assertEquals(ArxMp4Probe.Audio("mp4a", 0x40, 2), probe.audio)
        assertEquals(emptyList(), ArxVideoProfile.check(probe, "/layers/0/src"))
    }

    @Test
    fun detectsAMoovBoxPlacedAfterMdat() {
        val probe = assertNotNull(ArxMp4Prober.probe(Fixtures.bytes("positive/C014-video-no-faststart/assets/video.mp4")))
        assertFalse(probe.faststart)
        assertEquals(listOf("warning ARX_VIDEO_NOT_FASTSTART"), codes(probe))
    }

    @Test
    fun reportsMpeg4Part2VideoAsTheWrongCodec() {
        val probe = assertNotNull(ArxMp4Prober.probe(Fixtures.bytes("negative/N007-bad-video/assets/video.mp4")))
        assertEquals("mp4v", probe.video?.codec)
        assertEquals(listOf("error ARX_VIDEO_CODEC"), codes(probe))
    }

    @Test
    fun returnsNullForDataThatIsNotIsoBmff() {
        assertNull(ArxMp4Prober.probe(Fixtures.bytes("positive/C001-minimal-image/assets/target.jpg")))
        assertNull(ArxMp4Prober.probe(ByteArray(4)))
        assertNull(ArxMp4Prober.probe(ByteArray(0)))
    }

    @Test
    fun toleratesTruncatedAndCorruptedMp4Data() {
        val video = Fixtures.bytes("positive/C002-video-once/assets/video.mp4")
        val lengths = (0..2048) + (2049..video.size step 997) + listOf(video.size - 1)
        for (length in lengths) ArxMp4Prober.probe(video.copyOf(length))
        // Deterministic byte corruption across the header region.
        var state = 0x9E3779B97F4A7C15uL
        repeat(300) {
            val corrupted = video.copyOf(8192)
            repeat(8) {
                state = state * 6364136223846793005uL + 1442695040888963407uL
                corrupted[((state shr 33) % corrupted.size.toULong()).toInt()] = (state shr 17).toByte()
            }
            ArxMp4Prober.probe(corrupted)
        }
    }

    // ArxVideoProfile

    private val base = ArxMp4Probe(
        faststart = true,
        durationSeconds = null,
        bitrate = 5e6,
        video = ArxMp4Probe.Video("avc1", 1920.0, 1080.0, 30.0, avcProfile = 77, avcLevel = 41, identityMatrix = true),
        audio = null,
    )

    private fun codes(probe: ArxMp4Probe, strict: Boolean = false): List<String> =
        ArxVideoProfile.check(probe, "/p", strict).map { "${it.severity} ${it.code.raw}" }

    @Test
    fun acceptsThePortableProfileLimitsExactly() {
        assertEquals(emptyList(), codes(base))
    }

    @Test
    fun warnsOnDeviationsAndEscalatesThemInStrictMode() {
        val heavy = base.copy(bitrate = 12e6, video = base.video!!.copy(width = 3840.0, height = 2160.0, frameRate = 60.0))
        assertEquals(
            listOf("warning ARX_VIDEO_RESOLUTION", "warning ARX_VIDEO_FRAME_RATE", "warning ARX_VIDEO_BITRATE"),
            codes(heavy),
        )
        assertEquals(
            listOf("error ARX_VIDEO_RESOLUTION", "error ARX_VIDEO_FRAME_RATE", "error ARX_VIDEO_BITRATE"),
            codes(heavy, strict = true),
        )
        assertEquals(
            listOf("3840x2160 exceeds 1920x1080", "60.00 fps exceeds 30", "12.0 Mbps exceeds 8 Mbps"),
            ArxVideoProfile.check(heavy, "/p").map { it.message },
        )
    }

    @Test
    fun warnsAboutHighLevelsRotationAndNonMainProfiles() {
        val odd = base.copy(video = base.video!!.copy(avcProfile = 100, avcLevel = 42, identityMatrix = false))
        assertEquals(
            listOf("warning ARX_VIDEO_PROFILE", "warning ARX_VIDEO_PROFILE", "warning ARX_VIDEO_ROTATION"),
            codes(odd),
        )
        assertEquals("H.264 level 4.2 exceeds 4.1", ArxVideoProfile.check(odd, "/p")[1].message)
    }

    @Test
    fun rejects10BitProfilesAndNonAacLcAudio() {
        assertEquals(listOf("error ARX_VIDEO_PIXEL_FORMAT"), codes(base.copy(video = base.video!!.copy(avcProfile = 110))))
        val heAac = ArxMp4Probe.Audio("mp4a", 0x40, 5)
        assertEquals(listOf("error ARX_AUDIO_CODEC"), codes(base.copy(audio = heAac)))
    }

    @Test
    fun rejectsNonH264VideoAndMissingVideo() {
        val mpeg4 = ArxMp4Probe(true, null, null, ArxMp4Probe.Video("mp4v", 480.0, 270.0, null, null, null, true), null)
        assertEquals(listOf("error ARX_VIDEO_CODEC"), codes(mpeg4))
        val audioOnly = ArxMp4Probe(true, null, null, null, null)
        assertEquals(listOf("error ARX_ASSET_DECODE"), codes(audioOnly))
    }
}
