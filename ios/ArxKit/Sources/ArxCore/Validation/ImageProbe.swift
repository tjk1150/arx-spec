import Foundation

/// Header facts about a PNG or JPEG asset, read without decoding pixels.
public struct ArxImageProbe: Sendable, Equatable {
    public enum Format: String, Sendable {
        case png
        case jpeg
    }

    public let format: Format
    /// Stored pixel size.
    public let width: Int
    public let height: Int
    /// EXIF orientation (1-8); 1 when absent.
    public let orientation: Int
    public let hasAlpha: Bool

    /// Display size after applying EXIF orientation (5-8 swap the axes).
    public var displaySize: (width: Int, height: Int) {
        orientation >= 5 ? (width: height, height: width) : (width: width, height: height)
    }
}

/// Header-only probe for the PNG and JPEG formats ARX 0.1 allows.
public enum ArxImageProber {
    private static let pngSignature: [UInt8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]

    /// Returns nil for other formats and for truncated or malformed headers.
    public static func probe(_ data: Data) -> ArxImageProbe? {
        let bytes = ArxProbeBytes(Array(data))
        if bytes.bytes.starts(with: pngSignature) { return try? probePng(bytes) }
        if bytes.byte(0) == 0xFF, bytes.byte(1) == 0xD8 { return try? probeJpeg(bytes) }
        return nil
    }

    private static func probePng(_ bytes: ArxProbeBytes) throws -> ArxImageProbe? {
        if bytes.count < 33 || bytes.ascii(12, 4) != "IHDR" { return nil }
        let width = try bytes.uint32(16)
        let height = try bytes.uint32(20)
        let colorType = bytes.byte(25)
        var hasAlpha = colorType == 4 || colorType == 6
        // A tRNS chunk before the image data also adds transparency.
        var offset = 8
        while !hasAlpha && offset + 8 <= bytes.count {
            let length = try bytes.uint32(offset)
            let type = bytes.ascii(offset + 4, 4)
            if type == "tRNS" { hasAlpha = true }
            if type == "IDAT" || type == "IEND" { break }
            offset += 12 + length
        }
        return ArxImageProbe(format: .png, width: width, height: height, orientation: 1, hasAlpha: hasAlpha)
    }

    /// Reads tag 0x0112 from IFD0 of a TIFF block (the EXIF payload).
    private static func readExifOrientation(_ tiff: ArxProbeBytes) throws -> Int {
        if tiff.count < 8 { return 1 }
        let little = tiff.ascii(0, 2) == "II"
        if !little && tiff.ascii(0, 2) != "MM" { return 1 }
        let ifd = try tiff.uint32(4, little: little)
        if ifd + 2 > tiff.count { return 1 }
        let count = try tiff.uint16(ifd, little: little)
        for index in 0..<count {
            let entry = ifd + 2 + index * 12
            if entry + 12 > tiff.count { break }
            if try tiff.uint16(entry, little: little) == 0x0112 {
                let value = try tiff.uint16(entry + 8, little: little)
                return (1...8).contains(value) ? value : 1
            }
        }
        return 1
    }

    private static func isStartOfFrame(_ marker: Int) -> Bool {
        marker >= 0xC0 && marker <= 0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC
    }

    private static func probeJpeg(_ bytes: ArxProbeBytes) throws -> ArxImageProbe? {
        var orientation = 1
        var offset = 2
        while offset + 4 <= bytes.count {
            guard bytes.byte(offset) == 0xFF, let marker = bytes.byte(offset + 1) else { return nil }
            if marker == 0xFF {
                offset += 1
                continue
            }
            if marker == 0xD8 || (0xD0...0xD7).contains(marker) || marker == 0x01 {
                offset += 2
                continue
            }
            let length = try bytes.uint16(offset + 2)
            let segment = offset + 4
            if marker == 0xE1 && bytes.ascii(segment, 6) == "Exif\0\0" {
                orientation = try readExifOrientation(bytes.slice(segment + 6, offset + 2 + length))
            }
            if isStartOfFrame(marker) && segment + 5 <= bytes.count {
                return ArxImageProbe(
                    format: .jpeg,
                    width: try bytes.uint16(segment + 3),
                    height: try bytes.uint16(segment + 1),
                    orientation: orientation,
                    hasAlpha: false
                )
            }
            if marker == 0xD9 || marker == 0xDA { return nil }
            offset += 2 + length
        }
        return nil
    }
}

/// Byte access for the media probes, mirroring the TypeScript semantics:
/// multi-byte reads past the end throw (like `DataView`), single-byte reads
/// return nil (like indexing a `Uint8Array`), and `ascii`/`slice` clamp to the
/// available bytes (like `subarray`).
struct ArxProbeBytes {
    struct OutOfBounds: Error {}

    let bytes: [UInt8]

    init(_ bytes: [UInt8]) {
        self.bytes = bytes
    }

    var count: Int { bytes.count }

    func byte(_ offset: Int) -> Int? {
        offset >= 0 && offset < bytes.count ? Int(bytes[offset]) : nil
    }

    func unsigned(_ offset: Int, width: Int, little: Bool = false) throws -> UInt64 {
        guard offset >= 0, width <= bytes.count, offset <= bytes.count - width else { throw OutOfBounds() }
        var value: UInt64 = 0
        for index in 0..<width {
            let position = little ? offset + width - 1 - index : offset + index
            value = value << 8 | UInt64(bytes[position])
        }
        return value
    }

    func uint16(_ offset: Int, little: Bool = false) throws -> Int {
        Int(try unsigned(offset, width: 2, little: little))
    }

    func uint32(_ offset: Int, little: Bool = false) throws -> Int {
        Int(try unsigned(offset, width: 4, little: little))
    }

    func int32(_ offset: Int) throws -> Int {
        Int(Int32(bitPattern: UInt32(truncatingIfNeeded: try unsigned(offset, width: 4))))
    }

    func uint64(_ offset: Int) throws -> UInt64 {
        try unsigned(offset, width: 8)
    }

    /// Bytes `start..<end`, clamped to the array; empty when the range is inverted.
    func slice(_ start: Int, _ end: Int) -> ArxProbeBytes {
        let lower = min(max(start, 0), bytes.count)
        let upper = min(max(end, lower), bytes.count)
        return ArxProbeBytes(Array(bytes[lower..<upper]))
    }

    /// Each byte as one Latin-1 character, like `String.fromCharCode`.
    func ascii(_ start: Int, _ length: Int) -> String {
        String(String.UnicodeScalarView(slice(start, start + length).bytes.map { Unicode.Scalar($0) }))
    }
}
