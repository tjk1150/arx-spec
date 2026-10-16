package dev.arx.core

/** ARX 0.1 Portable Video Profile checks (spec 8.1.1). */
object ArxVideoProfile {
    const val MAX_LONG_SIDE = 1920.0
    const val MAX_SHORT_SIDE = 1080.0
    const val MAX_FRAME_RATE = 30.0
    const val MAX_BITRATE = 8_000_000.0

    /** H.264 level_idc 41 = level 4.1. */
    const val MAX_LEVEL = 41

    private val h264Codecs = setOf("avc1", "avc3")
    private const val BASELINE = 66
    private const val MAIN = 77
    private const val HIGH = 100
    private const val AAC_LC = 2
    private const val MPEG4_AUDIO = 0x40

    /**
     * Checks a probed MP4 against the Portable Video Profile. Codec failures are
     * errors; other deviations are warnings unless [strict] is set.
     * Same rules and codes as checkVideoProfile in video-profile.ts.
     */
    fun check(probe: ArxMp4Probe, path: String, strict: Boolean = false): List<ArxIssue> {
        val issues = mutableListOf<ArxIssue>()
        fun deviation(code: ArxIssueCode, message: String) {
            issues += if (strict) ArxIssue.error(code, path, message) else ArxIssue.warning(code, path, message)
        }

        val video = probe.video ?: return listOf(ArxIssue.error(ArxIssueCode.ASSET_DECODE, path, "MP4 has no video track"))
        if (video.codec !in h264Codecs) {
            return listOf(ArxIssue.error(ArxIssueCode.VIDEO_CODEC, path, "video codec ${video.codec} is not H.264"))
        }
        val profile = video.avcProfile
        if (profile != null && profile > HIGH) {
            issues += ArxIssue.error(ArxIssueCode.VIDEO_PIXEL_FORMAT, path, "H.264 profile $profile is not 8-bit 4:2:0")
        } else if (profile != null && profile != BASELINE && profile != MAIN) {
            deviation(ArxIssueCode.VIDEO_PROFILE, "H.264 profile $profile; Main or Baseline is portable")
        }
        val level = video.avcLevel
        if (level != null && level > MAX_LEVEL) {
            deviation(ArxIssueCode.VIDEO_PROFILE, "H.264 level ${JsFormat.number(level / 10.0)} exceeds 4.1")
        }
        val longSide = maxOf(video.width, video.height)
        val shortSide = minOf(video.width, video.height)
        if (longSide > MAX_LONG_SIDE || shortSide > MAX_SHORT_SIDE) {
            deviation(
                ArxIssueCode.VIDEO_RESOLUTION,
                "${JsFormat.number(video.width)}x${JsFormat.number(video.height)} exceeds 1920x1080",
            )
        }
        val frameRate = video.frameRate
        if (frameRate != null && frameRate > MAX_FRAME_RATE + 0.5) {
            deviation(ArxIssueCode.VIDEO_FRAME_RATE, "${JsFormat.toFixed(frameRate, 2)} fps exceeds 30")
        }
        val bitrate = probe.bitrate
        if (bitrate != null && bitrate > MAX_BITRATE) {
            deviation(ArxIssueCode.VIDEO_BITRATE, "${JsFormat.toFixed(bitrate / 1e6, 1)} Mbps exceeds 8 Mbps")
        }
        if (!video.identityMatrix) {
            deviation(ArxIssueCode.VIDEO_ROTATION, "track has rotation metadata; bake it into the pixels")
        }
        if (!probe.faststart) {
            deviation(ArxIssueCode.VIDEO_NOT_FASTSTART, "moov box is after mdat; encode with -movflags +faststart")
        }
        val audio = probe.audio
        if (audio != null) {
            val isAacLc = audio.codec == "mp4a" && audio.objectType == MPEG4_AUDIO && audio.audioObjectType == AAC_LC
            if (!isAacLc) issues += ArxIssue.error(ArxIssueCode.AUDIO_CODEC, path, "audio track ${audio.codec} is not AAC-LC")
        }
        return issues
    }
}
