package dev.arx.core

/** Header facts about a PNG or JPEG asset, read without decoding pixels. */
data class ArxImageProbe(
    val format: Format,
    /** Stored pixel size. */
    val width: Long,
    val height: Long,
    /** EXIF orientation (1-8); 1 when absent. */
    val orientation: Int,
    val hasAlpha: Boolean,
) {
    enum class Format(val raw: String) {
        PNG("png"),
        JPEG("jpeg"),
    }

    data class PixelSize(val width: Long, val height: Long)

    /** Display size after applying EXIF orientation (5-8 swap the axes). */
    val displaySize: PixelSize
        get() = if (orientation >= 5) PixelSize(height, width) else PixelSize(width, height)
}

/** Header-only probe for the PNG and JPEG formats ARX 0.1 allows. */
object ArxImageProber {
    private val pngSignature = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)

    /** Returns null for other formats and for truncated or malformed headers. */
    fun probe(data: ByteArray): ArxImageProbe? {
        val bytes = ProbeBytes(data)
        return try {
            when {
                bytes.startsWith(pngSignature) -> probePng(bytes)
                bytes.byte(0) == 0xFF && bytes.byte(1) == 0xD8 -> probeJpeg(bytes)
                else -> null
            }
        } catch (_: ProbeBytes.OutOfBounds) {
            null
        }
    }

    private fun probePng(bytes: ProbeBytes): ArxImageProbe? {
        if (bytes.count < 33 || bytes.ascii(12, 4) != "IHDR") return null
        val width = bytes.uint32(16)
        val height = bytes.uint32(20)
        val colorType = bytes.byte(25)
        var hasAlpha = colorType == 4 || colorType == 6
        // A tRNS chunk before the image data also adds transparency.
        var offset = 8L
        while (!hasAlpha && offset + 8 <= bytes.count) {
            val length = bytes.uint32(offset)
            val type = bytes.ascii(offset + 4, 4)
            if (type == "tRNS") hasAlpha = true
            if (type == "IDAT" || type == "IEND") break
            offset += 12 + length
        }
        return ArxImageProbe(ArxImageProbe.Format.PNG, width, height, orientation = 1, hasAlpha = hasAlpha)
    }

    /** Reads tag 0x0112 from IFD0 of a TIFF block (the EXIF payload). */
    private fun readExifOrientation(tiff: ProbeBytes): Int {
        if (tiff.count < 8) return 1
        val little = tiff.ascii(0, 2) == "II"
        if (!little && tiff.ascii(0, 2) != "MM") return 1
        val ifd = tiff.uint32(4, little)
        if (ifd + 2 > tiff.count) return 1
        val count = tiff.uint16(ifd, little)
        for (index in 0 until count) {
            val entry = ifd + 2 + index * 12
            if (entry + 12 > tiff.count) break
            if (tiff.uint16(entry, little) == 0x0112L) {
                val value = tiff.uint16(entry + 8, little).toInt()
                return if (value in 1..8) value else 1
            }
        }
        return 1
    }

    private fun isStartOfFrame(marker: Int): Boolean =
        marker in 0xC0..0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC

    private fun probeJpeg(bytes: ProbeBytes): ArxImageProbe? {
        var orientation = 1
        var offset = 2L
        while (offset + 4 <= bytes.count) {
            if (bytes.byte(offset) != 0xFF) return null
            val marker = bytes.byte(offset + 1) ?: return null
            if (marker == 0xFF) {
                offset += 1
                continue
            }
            if (marker == 0xD8 || marker in 0xD0..0xD7 || marker == 0x01) {
                offset += 2
                continue
            }
            val length = bytes.uint16(offset + 2)
            val segment = offset + 4
            if (marker == 0xE1 && bytes.ascii(segment, 6) == "Exif\u0000\u0000") {
                orientation = readExifOrientation(bytes.slice(segment + 6, offset + 2 + length))
            }
            if (isStartOfFrame(marker) && segment + 5 <= bytes.count) {
                return ArxImageProbe(
                    ArxImageProbe.Format.JPEG,
                    width = bytes.uint16(segment + 3),
                    height = bytes.uint16(segment + 1),
                    orientation = orientation,
                    hasAlpha = false,
                )
            }
            if (marker == 0xD9 || marker == 0xDA) return null
            offset += 2 + length
        }
        return null
    }
}
