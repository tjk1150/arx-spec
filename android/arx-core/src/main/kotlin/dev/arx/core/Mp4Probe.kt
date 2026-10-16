package dev.arx.core

/** Header facts about an MP4 (ISO BMFF) asset, read from its box structure. */
data class ArxMp4Probe(
    /** True when moov comes before mdat (or there is no mdat). */
    val faststart: Boolean,
    val durationSeconds: Double?,
    /** Whole-file bits per second of duration. */
    val bitrate: Double?,
    val video: Video?,
    val audio: Audio?,
) {
    /** The first video track. */
    data class Video(
        /** Sample entry four-character code, e.g. avc1. */
        val codec: String,
        /** Display size from the track header. */
        val width: Double,
        val height: Double,
        val frameRate: Double?,
        /** H.264 profile_idc and level_idc from avcC. */
        val avcProfile: Int?,
        val avcLevel: Int?,
        /** False when the track matrix rotates or mirrors the picture. */
        val identityMatrix: Boolean,
    )

    /** The first audio track. */
    data class Audio(
        val codec: String,
        /** MPEG-4 objectTypeIndication from esds (0x40 = MPEG-4 audio). */
        val objectType: Int?,
        /** AudioSpecificConfig audioObjectType (2 = AAC-LC). */
        val audioObjectType: Int?,
    )
}

/** Header-only MP4 probe: null when the bytes are not ISO BMFF or a header read runs past the end. */
object ArxMp4Prober {
    fun probe(data: ByteArray): ArxMp4Probe? = try {
        Mp4Reader(ProbeBytes(data)).probe()
    } catch (_: ProbeBytes.OutOfBounds) {
        null
    }
}

private class Mp4Box(val type: String, /** Start of the payload (after the header). */ val start: Long, val end: Long)

private class Timing(val timescale: Double, val duration: Double)

private class Mp4Reader(private val bytes: ProbeBytes) {
    private val identity = longArrayOf(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x4000_0000)

    private fun fourcc(offset: Long): String = bytes.ascii(offset, 4)

    fun boxes(start: Long, end: Long): List<Mp4Box> {
        val found = mutableListOf<Mp4Box>()
        var offset = start
        while (offset + 8 <= end) {
            var size = bytes.uint32(offset)
            var header = 8L
            if (size == 1L) {
                if (offset + 16 > end) break
                val large = bytes.uint64(offset + 8)
                // Larger than the data can hold; the bounds check below would reject it too.
                if (large < 0 || large > end - offset) break
                size = large
                header = 16
            } else if (size == 0L) {
                size = end - offset
            }
            if (size < header || offset + size > end) break
            found += Mp4Box(fourcc(offset + 4), offset + header, offset + size)
            offset += size
        }
        return found
    }

    fun child(box: Mp4Box?, type: String): Mp4Box? = box?.let { boxes(it.start, it.end).firstOrNull { child -> child.type == type } }

    /** Follows a path of container boxes. */
    fun path(box: Mp4Box?, vararg types: String): Mp4Box? = types.fold(box) { current, type -> child(current, type) }

    /** (timescale, duration) from an mvhd or mdhd full box. */
    fun timing(box: Mp4Box?): Timing? {
        if (box == null) return null
        if (bytes.byte(box.start) == 1) {
            return Timing(bytes.uint32(box.start + 20).toDouble(), bytes.uint64(box.start + 24).toULong().toDouble())
        }
        return Timing(bytes.uint32(box.start + 12).toDouble(), bytes.uint32(box.start + 16).toDouble())
    }

    /** The offset after a descriptor length (1-4 bytes, 7 bits each). */
    fun skipDescriptorLength(offset: Long): Long {
        var cursor = offset
        repeat(4) {
            val byte = bytes.byte(cursor) ?: 0
            cursor += 1
            if (byte and 0x80 == 0) return cursor
        }
        return cursor
    }

    fun parseEsds(esds: Mp4Box): Pair<Int?, Int?> {
        var offset = esds.start + 4
        if (bytes.byte(offset) != 0x03) return null to null
        offset = skipDescriptorLength(offset + 1)
        val flags = bytes.byte(offset + 2) ?: 0
        offset += 3
        if (flags and 0x80 != 0) offset += 2
        if (flags and 0x40 != 0) offset += 1 + (bytes.byte(offset) ?: 0)
        if (flags and 0x20 != 0) offset += 2
        if (bytes.byte(offset) != 0x04) return null to null
        offset = skipDescriptorLength(offset + 1)
        val objectType = bytes.byte(offset)
        offset += 13
        if (bytes.byte(offset) != 0x05) return objectType to null
        offset = skipDescriptorLength(offset + 1)
        return objectType to ((bytes.byte(offset) ?: 0) shr 3)
    }

    fun parseVideo(trak: Mp4Box, entry: Mp4Box): ArxMp4Probe.Video {
        var width = 0.0
        var height = 0.0
        var identityMatrix = true
        child(trak, "tkhd")?.let { tkhd ->
            val matrixOffset = tkhd.start + if (bytes.byte(tkhd.start) == 1) 52 else 40
            for ((index, value) in identity.withIndex()) {
                if (bytes.int32(matrixOffset + index * 4) != value) {
                    identityMatrix = false
                    break
                }
            }
            width = bytes.uint32(matrixOffset + 36) / 65536.0
            height = bytes.uint32(matrixOffset + 40) / 65536.0
        }
        // VisualSampleEntry: 78 bytes before child boxes; coded size at 24/26.
        if (width == 0.0 || height == 0.0) {
            width = bytes.uint16(entry.start + 24).toDouble()
            height = bytes.uint16(entry.start + 26).toDouble()
        }
        val avcC = boxes(entry.start + 78, entry.end).firstOrNull { it.type == "avcC" }
        val mdia = child(trak, "mdia")
        val mdhdTiming = timing(child(mdia, "mdhd"))
        val stts = path(mdia, "minf", "stbl", "stts")
        var frameRate: Double? = null
        if (mdhdTiming != null && stts != null && mdhdTiming.duration > 0) {
            val entries = bytes.uint32(stts.start + 4)
            var samples = 0.0
            for (index in 0 until entries) {
                samples += bytes.uint32(stts.start + 8 + index * 8).toDouble()
            }
            frameRate = samples / (mdhdTiming.duration / mdhdTiming.timescale)
        }
        return ArxMp4Probe.Video(
            codec = entry.type,
            width = width,
            height = height,
            frameRate = frameRate,
            avcProfile = avcC?.let { bytes.byte(it.start + 1) ?: 0 },
            avcLevel = avcC?.let { bytes.byte(it.start + 3) ?: 0 },
            identityMatrix = identityMatrix,
        )
    }

    fun parseAudio(entry: Mp4Box): ArxMp4Probe.Audio {
        // AudioSampleEntry (version 0): 28 bytes before child boxes.
        val esds = boxes(entry.start + 28, entry.end).firstOrNull { it.type == "esds" }
        val config = esds?.let(::parseEsds)
        return ArxMp4Probe.Audio(entry.type, config?.first, config?.second)
    }

    fun probe(): ArxMp4Probe? {
        val top = boxes(0, bytes.count.toLong())
        if (top.firstOrNull()?.type != "ftyp") return null
        val moovIndex = top.indexOfFirst { it.type == "moov" }
        if (moovIndex < 0) return null
        val mdatIndex = top.indexOfFirst { it.type == "mdat" }
        val moov = top[moovIndex]

        var video: ArxMp4Probe.Video? = null
        var audio: ArxMp4Probe.Audio? = null
        for (trak in boxes(moov.start, moov.end)) {
            if (trak.type != "trak") continue
            val mdia = child(trak, "mdia")
            val handler = child(mdia, "hdlr")?.let { fourcc(it.start + 8) } ?: ""
            // stsd is a full box followed by an entry count.
            val stsd = path(mdia, "minf", "stbl", "stsd") ?: continue
            val entry = boxes(stsd.start + 8, stsd.end).firstOrNull() ?: continue
            if (handler == "vide" && video == null) video = parseVideo(trak, entry)
            if (handler == "soun" && audio == null) audio = parseAudio(entry)
        }

        val mvhdTiming = timing(child(moov, "mvhd"))
        // A zero duration is treated as unknown, as in the TypeScript probe.
        val seconds = mvhdTiming?.takeIf { it.timescale > 0 }?.let { it.duration / it.timescale }
        val durationSeconds = seconds?.takeIf { it != 0.0 }
        return ArxMp4Probe(
            faststart = mdatIndex < 0 || moovIndex < mdatIndex,
            durationSeconds = durationSeconds,
            bitrate = durationSeconds?.let { bytes.count * 8.0 / it },
            video = video,
            audio = audio,
        )
    }
}
