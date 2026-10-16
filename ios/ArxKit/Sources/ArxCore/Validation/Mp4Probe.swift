import Foundation

/// Header facts about an MP4 (ISO BMFF) asset, read from its box structure.
public struct ArxMp4Probe: Sendable {
    /// The first video track.
    public struct Video: Sendable {
        /// Sample entry four-character code, e.g. avc1.
        public let codec: String
        /// Display size from the track header.
        public let width: Double
        public let height: Double
        public let frameRate: Double?
        /// H.264 profile_idc and level_idc from avcC.
        public let avcProfile: Int?
        public let avcLevel: Int?
        /// False when the track matrix rotates or mirrors the picture.
        public let identityMatrix: Bool
    }

    /// The first audio track.
    public struct Audio: Sendable {
        public let codec: String
        /// MPEG-4 objectTypeIndication from esds (0x40 = MPEG-4 audio).
        public let objectType: Int?
        /// AudioSpecificConfig audioObjectType (2 = AAC-LC).
        public let audioObjectType: Int?
    }

    /// True when moov comes before mdat (or there is no mdat).
    public let faststart: Bool
    public let durationSeconds: Double?
    /// Whole-file bits per second of duration.
    public let bitrate: Double?
    public let video: Video?
    public let audio: Audio?
}

/// Header-only MP4 probe: returns nil when the bytes are not ISO BMFF or a
/// header read runs past the end of the data.
public enum ArxMp4Prober {
    public static func probe(_ data: Data) -> ArxMp4Probe? {
        try? Mp4Reader(ArxProbeBytes(Array(data))).probe()
    }
}

private struct Mp4Box {
    let type: String
    /// Start of the payload (after the header).
    let start: Int
    let end: Int
}

private struct Mp4Reader {
    static let identityMatrix = [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x4000_0000]

    let bytes: ArxProbeBytes

    init(_ bytes: ArxProbeBytes) {
        self.bytes = bytes
    }

    func fourcc(_ offset: Int) -> String { bytes.ascii(offset, 4) }

    func boxes(_ start: Int, _ end: Int) throws -> [Mp4Box] {
        var found: [Mp4Box] = []
        var offset = start
        while offset + 8 <= end {
            var size = try bytes.uint32(offset)
            var header = 8
            if size == 1 {
                if offset + 16 > end { break }
                let large = try bytes.uint64(offset + 8)
                // Larger than the data can hold; the bounds check below would reject it too.
                if large > UInt64(end - offset) { break }
                size = Int(large)
                header = 16
            } else if size == 0 {
                size = end - offset
            }
            if size < header || offset + size > end { break }
            found.append(Mp4Box(type: fourcc(offset + 4), start: offset + header, end: offset + size))
            offset += size
        }
        return found
    }

    func child(_ box: Mp4Box?, _ type: String) throws -> Mp4Box? {
        guard let box else { return nil }
        return try boxes(box.start, box.end).first { $0.type == type }
    }

    /// Follows a path of container boxes.
    func path(_ box: Mp4Box?, _ types: String...) throws -> Mp4Box? {
        try types.reduce(box) { current, type in try child(current, type) }
    }

    /// Returns (timescale, duration) from an mvhd or mdhd full box.
    func timing(_ box: Mp4Box?) throws -> (timescale: Double, duration: Double)? {
        guard let box else { return nil }
        if bytes.byte(box.start) == 1 {
            return (Double(try bytes.uint32(box.start + 20)), Double(try bytes.uint64(box.start + 24)))
        }
        return (Double(try bytes.uint32(box.start + 12)), Double(try bytes.uint32(box.start + 16)))
    }

    /// Returns the offset after a descriptor length (1-4 bytes, 7 bits each).
    func skipDescriptorLength(_ offset: Int) -> Int {
        var cursor = offset
        for _ in 0..<4 {
            let byte = bytes.byte(cursor) ?? 0
            cursor += 1
            if byte & 0x80 == 0 { break }
        }
        return cursor
    }

    func parseEsds(_ esds: Mp4Box) -> (objectType: Int?, audioObjectType: Int?) {
        var offset = esds.start + 4
        if bytes.byte(offset) != 0x03 { return (nil, nil) }
        offset = skipDescriptorLength(offset + 1)
        let flags = bytes.byte(offset + 2) ?? 0
        offset += 3
        if flags & 0x80 != 0 { offset += 2 }
        if flags & 0x40 != 0 { offset += 1 + (bytes.byte(offset) ?? 0) }
        if flags & 0x20 != 0 { offset += 2 }
        if bytes.byte(offset) != 0x04 { return (nil, nil) }
        offset = skipDescriptorLength(offset + 1)
        let objectType = bytes.byte(offset)
        offset += 13
        if bytes.byte(offset) != 0x05 { return (objectType, nil) }
        offset = skipDescriptorLength(offset + 1)
        return (objectType, (bytes.byte(offset) ?? 0) >> 3)
    }

    func parseVideo(_ trak: Mp4Box, _ entry: Mp4Box) throws -> ArxMp4Probe.Video {
        var width = 0.0
        var height = 0.0
        var identityMatrix = true
        if let tkhd = try child(trak, "tkhd") {
            let matrixOffset = tkhd.start + (bytes.byte(tkhd.start) == 1 ? 52 : 40)
            for (index, value) in Self.identityMatrix.enumerated() {
                if try bytes.int32(matrixOffset + index * 4) != value {
                    identityMatrix = false
                    break
                }
            }
            width = Double(try bytes.uint32(matrixOffset + 36)) / 65536
            height = Double(try bytes.uint32(matrixOffset + 40)) / 65536
        }
        // VisualSampleEntry: 78 bytes before child boxes; coded size at 24/26.
        if width == 0 || height == 0 {
            width = Double(try bytes.uint16(entry.start + 24))
            height = Double(try bytes.uint16(entry.start + 26))
        }
        let avcC = try boxes(entry.start + 78, entry.end).first { $0.type == "avcC" }
        let mdia = try child(trak, "mdia")
        let mdhdTiming = try timing(try child(mdia, "mdhd"))
        let stts = try path(mdia, "minf", "stbl", "stts")
        var frameRate: Double?
        if let timing = mdhdTiming, let stts, timing.duration > 0 {
            let entries = try bytes.uint32(stts.start + 4)
            var samples = 0.0
            for index in 0..<entries {
                samples += Double(try bytes.uint32(stts.start + 8 + index * 8))
            }
            frameRate = samples / (timing.duration / timing.timescale)
        }
        return ArxMp4Probe.Video(
            codec: entry.type,
            width: width,
            height: height,
            frameRate: frameRate,
            avcProfile: avcC.map { bytes.byte($0.start + 1) ?? 0 },
            avcLevel: avcC.map { bytes.byte($0.start + 3) ?? 0 },
            identityMatrix: identityMatrix
        )
    }

    func parseAudio(_ entry: Mp4Box) throws -> ArxMp4Probe.Audio {
        // AudioSampleEntry (version 0): 28 bytes before child boxes.
        let esds = try boxes(entry.start + 28, entry.end).first { $0.type == "esds" }
        let config = esds.map { parseEsds($0) }
        return ArxMp4Probe.Audio(
            codec: entry.type,
            objectType: config?.objectType,
            audioObjectType: config?.audioObjectType
        )
    }

    func probe() throws -> ArxMp4Probe? {
        let top = try boxes(0, bytes.count)
        guard top.first?.type == "ftyp" else { return nil }
        guard let moovIndex = top.firstIndex(where: { $0.type == "moov" }) else { return nil }
        let mdatIndex = top.firstIndex { $0.type == "mdat" }
        let moov = top[moovIndex]

        var video: ArxMp4Probe.Video?
        var audio: ArxMp4Probe.Audio?
        for trak in try boxes(moov.start, moov.end) where trak.type == "trak" {
            let mdia = try child(trak, "mdia")
            let hdlr = try child(mdia, "hdlr")
            let handler = hdlr.map { fourcc($0.start + 8) } ?? ""
            // stsd is a full box followed by an entry count.
            let stsd = try path(mdia, "minf", "stbl", "stsd")
            guard let stsd, let entry = try boxes(stsd.start + 8, stsd.end).first else { continue }
            if handler == "vide" && video == nil { video = try parseVideo(trak, entry) }
            if handler == "soun" && audio == nil { audio = try parseAudio(entry) }
        }

        let mvhdTiming = try timing(try child(moov, "mvhd"))
        // A zero duration is treated as unknown, as in the TypeScript probe.
        let seconds = mvhdTiming.flatMap { $0.timescale > 0 ? $0.duration / $0.timescale : nil }
        let durationSeconds = seconds.flatMap { $0 != 0 ? $0 : nil }
        return ArxMp4Probe(
            faststart: mdatIndex.map { moovIndex < $0 } ?? true,
            durationSeconds: durationSeconds,
            bitrate: durationSeconds.map { Double(bytes.count * 8) / $0 },
            video: video,
            audio: audio
        )
    }
}
