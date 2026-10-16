import Foundation

/// ARX 0.1 Portable Video Profile checks (authoring recommendations).
public enum ArxVideoProfile {
    public static let maxLongSide = 1920.0
    public static let maxShortSide = 1080.0
    public static let maxFrameRate = 30.0
    public static let maxBitrate = 8_000_000.0
    /// H.264 level_idc 41 = level 4.1.
    public static let maxLevel = 41

    private static let h264Codecs: Set<String> = ["avc1", "avc3"]
    private static let baseline = 66
    private static let main = 77
    private static let high = 100
    private static let aacLc = 2
    private static let mpeg4Audio = 0x40

    /// Checks a probed MP4 against the Portable Video Profile. Codec failures are
    /// errors; other deviations are warnings unless `strict` is set.
    /// Same rules and codes as checkVideoProfile in video-profile.ts.
    public static func check(_ probe: ArxMp4Probe, path: String, strict: Bool = false) -> [ArxIssue] {
        var issues: [ArxIssue] = []
        func deviation(_ code: ArxIssueCode, _ message: String) {
            issues.append(ArxIssue(code: code, severity: strict ? .error : .warning, path: path, message: message))
        }

        guard let video = probe.video else {
            return [.error(.assetDecode, path, "MP4 has no video track")]
        }
        guard h264Codecs.contains(video.codec) else {
            return [.error(.videoCodec, path, "video codec \(video.codec) is not H.264")]
        }
        if let profile = video.avcProfile, profile > high {
            issues.append(.error(.videoPixelFormat, path, "H.264 profile \(profile) is not 8-bit 4:2:0"))
        } else if let profile = video.avcProfile, profile != baseline, profile != main {
            deviation(.videoProfile, "H.264 profile \(profile); Main or Baseline is portable")
        }
        if let level = video.avcLevel, level > maxLevel {
            deviation(.videoProfile, "H.264 level \(jsNumber(Double(level) / 10)) exceeds 4.1")
        }
        let longSide = max(video.width, video.height)
        let shortSide = min(video.width, video.height)
        if longSide > maxLongSide || shortSide > maxShortSide {
            deviation(.videoResolution, "\(jsNumber(video.width))x\(jsNumber(video.height)) exceeds 1920x1080")
        }
        if let frameRate = video.frameRate, frameRate > maxFrameRate + 0.5 {
            deviation(.videoFrameRate, "\(String(format: "%.2f", frameRate)) fps exceeds 30")
        }
        if let bitrate = probe.bitrate, bitrate > maxBitrate {
            deviation(.videoBitrate, "\(String(format: "%.1f", bitrate / 1e6)) Mbps exceeds 8 Mbps")
        }
        if !video.identityMatrix {
            deviation(.videoRotation, "track has rotation metadata; bake it into the pixels")
        }
        if !probe.faststart {
            deviation(.videoNotFaststart, "moov box is after mdat; encode with -movflags +faststart")
        }
        if let audio = probe.audio {
            let isAacLc = audio.codec == "mp4a" && audio.objectType == mpeg4Audio && audio.audioObjectType == aacLc
            if !isAacLc {
                issues.append(.error(.audioCodec, path, "audio track \(audio.codec) is not AAC-LC"))
            }
        }
        return issues
    }

    /// Formats a number the way JavaScript template literals do for the values
    /// seen here: integers without a fractional part, others in shortest form.
    private static func jsNumber(_ value: Double) -> String {
        if value.rounded() == value, abs(value) < 1e15 { return String(Int(value)) }
        return String(value)
    }
}
