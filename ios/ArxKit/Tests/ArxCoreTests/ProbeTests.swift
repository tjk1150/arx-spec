import Foundation
import Testing
@testable import ArxCore

/// Ports packages/arx-core/test/probe.test.ts.
struct ProbeTests {
    static func fixture(_ relative: String) throws -> Data {
        try Data(contentsOf: fixturesRoot.appendingPathComponent(relative))
    }

    static func u16(_ value: Int) -> [UInt8] { [UInt8(value >> 8 & 255), UInt8(value & 255)] }
    static func u32(_ value: Int) -> [UInt8] {
        [UInt8(value >> 24 & 255), UInt8(value >> 16 & 255), UInt8(value >> 8 & 255), UInt8(value & 255)]
    }
    static func latin1(_ text: String) -> [UInt8] { text.unicodeScalars.map { UInt8($0.value) } }

    /// SOI, APP1 Exif with IFD0 orientation, SOF0 with the given size, EOI.
    static func jpegWithOrientation(width: Int, height: Int, orientation: Int) -> Data {
        let tiff: [UInt8] = [0x4D, 0x4D, 0x00, 0x2A] + u32(8) // big-endian TIFF header, IFD0 at 8
            + u16(1) // one entry
            + u16(0x0112) + u16(3) + u32(1) + u16(orientation) + [0, 0]
            + u32(0)
        let app1 = latin1("Exif\0\0") + tiff
        let sof: [UInt8] = [8] + u16(height) + u16(width) + [3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]
        let parts: [[UInt8]] = [
            [0xFF, 0xD8],
            [0xFF, 0xE1] + u16(app1.count + 2) + app1,
            [0xFF, 0xC0] + u16(sof.count + 2) + sof,
            [0xFF, 0xD9],
        ]
        return Data(parts.flatMap { $0 })
    }

    static func pngChunk(_ type: String, _ data: [UInt8]) -> [UInt8] {
        u32(data.count) + latin1(type) + data + u32(0)
    }

    static func png(width: Int, height: Int, colorType: UInt8, extra: [UInt8] = []) -> Data {
        let parts: [[UInt8]] = [
            [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
            pngChunk("IHDR", u32(width) + u32(height) + [8, colorType, 0, 0, 0]),
            extra,
            pngChunk("IDAT", []),
            pngChunk("IEND", []),
        ]
        return Data(parts.flatMap { $0 })
    }

    // MARK: - ArxImageProber

    @Test func readsJpegSizeAndAppliesExifOrientationToTheDisplaySize() throws {
        let probe = try #require(ArxImageProber.probe(Self.jpegWithOrientation(width: 300, height: 200, orientation: 6)))
        #expect(probe == ArxImageProbe(format: .jpeg, width: 300, height: 200, orientation: 6, hasAlpha: false))
        #expect(probe.displaySize == (width: 200, height: 300))
        let upright = try #require(ArxImageProber.probe(Self.jpegWithOrientation(width: 300, height: 200, orientation: 1)))
        #expect(upright.displaySize == (width: 300, height: 200))
    }

    @Test func detectsPngTransparencyFromTheColorTypeOrATrnsChunk() {
        #expect(
            ArxImageProber.probe(Self.png(width: 10, height: 20, colorType: 2))
                == ArxImageProbe(format: .png, width: 10, height: 20, orientation: 1, hasAlpha: false)
        )
        #expect(ArxImageProber.probe(Self.png(width: 10, height: 20, colorType: 6))?.hasAlpha == true)
        let withTrns = Self.png(width: 10, height: 20, colorType: 2, extra: Self.pngChunk("tRNS", [0, 0]))
        #expect(ArxImageProber.probe(withTrns)?.hasAlpha == true)
    }

    @Test func readsTheGeneratedImageFixtures() throws {
        let target = try #require(ArxImageProber.probe(Self.fixture("positive/C001-minimal-image/assets/target.jpg")))
        #expect(target.format == .jpeg && target.width == 1000 && target.height == 750 && !target.hasAlpha)
        let overlay = try #require(ArxImageProber.probe(Self.fixture("positive/C001-minimal-image/assets/overlay.png")))
        #expect(overlay.format == .png && overlay.width == 800 && overlay.height == 800 && overlay.hasAlpha)
    }

    @Test func rejectsOtherImageFormatsAndTruncatedData() throws {
        #expect(ArxImageProber.probe(Data("GIF89a".utf8)) == nil)
        #expect(ArxImageProber.probe(Data([0xFF, 0xD8, 0xFF])) == nil)
        #expect(ArxImageProber.probe(Data()) == nil)
        #expect(ArxImageProber.probe(try Self.fixture("positive/C002-video-once/assets/video.mp4")) == nil)
    }

    @Test func toleratesEveryTruncationOfTheImageHeaders() throws {
        let inputs = [
            Self.jpegWithOrientation(width: 300, height: 200, orientation: 6),
            Self.png(width: 10, height: 20, colorType: 2, extra: Self.pngChunk("tRNS", [0, 0])),
            try Self.fixture("positive/C001-minimal-image/assets/overlay.png").prefix(4096),
        ]
        for input in inputs {
            for length in 0...input.count {
                _ = ArxImageProber.probe(Data(input.prefix(length)))
            }
        }
        // A slice whose indices do not start at zero is read from its own start.
        let sliced = (Data([0, 0]) + Self.png(width: 10, height: 20, colorType: 6)).dropFirst(2)
        #expect(ArxImageProber.probe(sliced)?.hasAlpha == true)
    }

    // MARK: - ArxMp4Prober

    @Test func readsThePortableH264AacFixture() throws {
        let probe = try #require(ArxMp4Prober.probe(Self.fixture("positive/C002-video-once/assets/video.mp4")))
        #expect(probe.faststart)
        let duration = try #require(probe.durationSeconds)
        #expect(abs(duration - 2) < 0.05)
        let video = try #require(probe.video)
        #expect(video.codec == "avc1" && video.width == 480 && video.height == 270)
        #expect(video.avcProfile == 77 && video.avcLevel == 30)
        let frameRate = try #require(video.frameRate)
        #expect(abs(frameRate - 30) < 0.5)
        #expect(video.identityMatrix)
        let audio = try #require(probe.audio)
        #expect(audio.codec == "mp4a" && audio.objectType == 0x40 && audio.audioObjectType == 2)
        #expect(ArxVideoProfile.check(probe, path: "/layers/0/src").isEmpty)
    }

    @Test func detectsAMoovBoxPlacedAfterMdat() throws {
        let probe = try #require(ArxMp4Prober.probe(Self.fixture("positive/C014-video-no-faststart/assets/video.mp4")))
        #expect(!probe.faststart)
        #expect(Self.codes(probe) == ["warning ARX_VIDEO_NOT_FASTSTART"])
    }

    @Test func reportsMpeg4Part2VideoAsTheWrongCodec() throws {
        let probe = try #require(ArxMp4Prober.probe(Self.fixture("negative/N007-bad-video/assets/video.mp4")))
        #expect(probe.video?.codec == "mp4v")
        #expect(Self.codes(probe) == ["error ARX_VIDEO_CODEC"])
    }

    @Test func returnsNilForDataThatIsNotIsoBmff() throws {
        #expect(ArxMp4Prober.probe(try Self.fixture("positive/C001-minimal-image/assets/target.jpg")) == nil)
        #expect(ArxMp4Prober.probe(Data(count: 4)) == nil)
        #expect(ArxMp4Prober.probe(Data()) == nil)
    }

    @Test func toleratesTruncatedAndCorruptedMp4Data() throws {
        let video = try Self.fixture("positive/C002-video-once/assets/video.mp4")
        let lengths = Array(0...2048) + Array(stride(from: 2049, through: video.count, by: 997)) + [video.count - 1]
        for length in lengths {
            _ = ArxMp4Prober.probe(Data(video.prefix(length)))
        }
        // Deterministic byte corruption across the header region.
        var state: UInt64 = 0x9E37_79B9_7F4A_7C15
        for _ in 0..<300 {
            var bytes = [UInt8](video.prefix(8192))
            for _ in 0..<8 {
                state = state &* 6_364_136_223_846_793_005 &+ 1_442_695_040_888_963_407
                bytes[Int(state >> 33) % bytes.count] = UInt8(truncatingIfNeeded: state >> 17)
            }
            _ = ArxMp4Prober.probe(Data(bytes))
        }
    }

    // MARK: - ArxVideoProfile

    static let base = ArxMp4Probe(
        faststart: true,
        durationSeconds: nil,
        bitrate: 5e6,
        video: .init(
            codec: "avc1", width: 1920, height: 1080, frameRate: 30,
            avcProfile: 77, avcLevel: 41, identityMatrix: true
        ),
        audio: nil
    )

    static func codes(_ probe: ArxMp4Probe, strict: Bool = false) -> [String] {
        ArxVideoProfile.check(probe, path: "/p", strict: strict).map { "\($0.severity.rawValue) \($0.code.rawValue)" }
    }

    static func withVideo(
        _ probe: ArxMp4Probe,
        width: Double? = nil,
        height: Double? = nil,
        frameRate: Double? = nil,
        avcProfile: Int? = nil,
        bitrate: Double? = nil,
        audio: ArxMp4Probe.Audio? = nil
    ) -> ArxMp4Probe {
        let video = probe.video
        return ArxMp4Probe(
            faststart: probe.faststart,
            durationSeconds: probe.durationSeconds,
            bitrate: bitrate ?? probe.bitrate,
            video: video.map {
                .init(
                    codec: $0.codec, width: width ?? $0.width, height: height ?? $0.height,
                    frameRate: frameRate ?? $0.frameRate, avcProfile: avcProfile ?? $0.avcProfile,
                    avcLevel: $0.avcLevel, identityMatrix: $0.identityMatrix
                )
            },
            audio: audio ?? probe.audio
        )
    }

    @Test func acceptsThePortableProfileLimitsExactly() {
        #expect(Self.codes(Self.base).isEmpty)
    }

    @Test func warnsOnDeviationsAndEscalatesThemInStrictMode() {
        let heavy = Self.withVideo(Self.base, width: 3840, height: 2160, frameRate: 60, bitrate: 12e6)
        #expect(Self.codes(heavy) == [
            "warning ARX_VIDEO_RESOLUTION",
            "warning ARX_VIDEO_FRAME_RATE",
            "warning ARX_VIDEO_BITRATE",
        ])
        #expect(Self.codes(heavy, strict: true) == [
            "error ARX_VIDEO_RESOLUTION",
            "error ARX_VIDEO_FRAME_RATE",
            "error ARX_VIDEO_BITRATE",
        ])
        let messages = ArxVideoProfile.check(heavy, path: "/p").map(\.message)
        #expect(messages == [
            "3840x2160 exceeds 1920x1080",
            "60.00 fps exceeds 30",
            "12.0 Mbps exceeds 8 Mbps",
        ])
    }

    @Test func rejects10BitProfilesAndNonAacLcAudio() {
        #expect(Self.codes(Self.withVideo(Self.base, avcProfile: 110)) == ["error ARX_VIDEO_PIXEL_FORMAT"])
        let heAac = ArxMp4Probe.Audio(codec: "mp4a", objectType: 0x40, audioObjectType: 5)
        #expect(Self.codes(Self.withVideo(Self.base, audio: heAac)) == ["error ARX_AUDIO_CODEC"])
    }

    @Test func rejectsNonH264VideoAndMissingVideo() {
        let mpeg4 = ArxMp4Probe(
            faststart: true, durationSeconds: nil, bitrate: nil,
            video: .init(
                codec: "mp4v", width: 480, height: 270, frameRate: nil,
                avcProfile: nil, avcLevel: nil, identityMatrix: true
            ),
            audio: nil
        )
        #expect(Self.codes(mpeg4) == ["error ARX_VIDEO_CODEC"])
        let audioOnly = ArxMp4Probe(faststart: true, durationSeconds: nil, bitrate: nil, video: nil, audio: nil)
        #expect(Self.codes(audioOnly) == ["error ARX_ASSET_DECODE"])
    }
}
