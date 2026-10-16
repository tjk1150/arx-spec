import Foundation
import ZIPFoundation

/// Implementation defaults, not format limits: ARX itself sets no size cap (spec 8.3).
public struct ArxPackageLimits: Sendable {
    public var maxEntries = 1000
    public var maxTotalUncompressedBytes = 1 << 30
    public var maxCompressionRatio = 100.0
    public var maxManifestBytes = 1 << 20

    public init() {}
}

/// Safe reader for `.arx` packages (spec 8.3), matching the TypeScript `openPackage`.
///
/// The central directory is parsed here rather than through ZIPFoundation's
/// `Archive`, because the checks need the raw entry name bytes, the general
/// purpose flags and the external attributes of every entry. ZIPFoundation keeps
/// those internal and stops iterating at the first encrypted or unreadable entry.
/// Its public streaming `Data.decompress` does the bounded inflate.
public enum ArxPackage {
    /// Checks every entry before decompressing anything; returns a source only when there are no errors.
    public static func open(
        _ data: Data,
        limits: ArxPackageLimits = ArxPackageLimits(),
        fetcher: @escaping ArxFetcher = ArxHTTP.fetcher()
    ) -> (issues: [ArxIssue], source: ArxLocalSource?) {
        let bytes = ZipBytes(data)
        let entries: [CentralEntry]
        do {
            entries = try readCentralDirectory(bytes)
        } catch let failure as ZipFailure {
            return ([failure.issue(path: "zip:")], nil)
        } catch {
            return ([.error(.packageCorrupt, "zip:", "\(error)")], nil)
        }

        var issues = checkEntries(entries, limits: limits)
        if issues.hasErrors { return (issues, nil) }

        var files: [[UInt8]: Data] = [:]
        for entry in entries where !entry.isDirectory {
            do {
                files[entry.key] = try extract(bytes, entry)
            } catch {
                let message = (error as? ZipFailure)?.message ?? "\(error)"
                issues.append(.error(.packageCorrupt, "zip:\(entry.name)", message))
            }
        }
        if issues.hasErrors { return (issues, nil) }

        let contents = files
        let source = ArxLocalSource(readLocal: { path in contents[Array(path.utf8)] }, fetcher: fetcher)
        return (issues, source)
    }
}

// MARK: - Central directory

private let endOfCentralDirectory: UInt32 = 0x0605_4b50
private let centralFileHeader: UInt32 = 0x0201_4b50
private let localFileHeader: UInt32 = 0x0403_4b50
private let storedMethod = 0
private let deflatedMethod = 8
private let unixHost = 3
private let symlinkMode: UInt32 = 0o120000
private let fileTypeMask: UInt32 = 0o170000
private let manifestName = "manifest.json"
private let expectedExtensions = [".json", ".jpg", ".jpeg", ".png", ".mp4"]
private let inflateChunkSize = 64 * 1024

private struct CentralEntry {
    let name: String
    let flags: Int
    let method: Int
    let compressedSize: Int
    let size: Int
    let localOffset: Int
    let isSymlink: Bool

    /// Exact code point identity, like JavaScript string equality (Swift `==` folds canonical equivalents).
    var key: [UInt8] { Array(name.utf8) }
    var isDirectory: Bool { name.unicodeScalars.last == "/" }
}

private struct ZipFailure: Error {
    let unsupported: Bool
    let message: String

    static func corrupt(_ message: String) -> ZipFailure { ZipFailure(unsupported: false, message: message) }

    func issue(path: String) -> ArxIssue {
        .error(unsupported ? .packageUnsupported : .packageCorrupt, path, message)
    }
}

/// Bounds-checked little-endian reads; every offset is relative to the start of the archive.
private struct ZipBytes {
    let data: Data
    var count: Int { data.count }

    init(_ data: Data) { self.data = data }

    func uint16(_ offset: Int) -> Int? {
        guard offset >= 0, offset + 2 <= count else { return nil }
        let base = data.startIndex + offset
        return Int(data[base]) | Int(data[base + 1]) << 8
    }

    func uint32(_ offset: Int) -> UInt32? {
        guard let low = uint16(offset), let high = uint16(offset + 2) else { return nil }
        return UInt32(low) | UInt32(high) << 16
    }

    /// Clamped like `Uint8Array.subarray`: a range past the end yields fewer (or no) bytes.
    func slice(_ start: Int, _ length: Int) -> Data {
        let lower = min(max(start, 0), count)
        let upper = min(max(start + length, lower), count)
        return data[(data.startIndex + lower)..<(data.startIndex + upper)]
    }
}

/// UTF-8 with replacement characters and a stripped leading BOM, like `new TextDecoder("utf-8")`.
private func decodeName(_ raw: Data) -> String {
    let bom: [UInt8] = [0xEF, 0xBB, 0xBF]
    let body = raw.starts(with: bom) ? raw.dropFirst(bom.count) : raw
    return String(decoding: body, as: UTF8.self)
}

private func readCentralDirectory(_ bytes: ZipBytes) throws -> [CentralEntry] {
    let searchStart = max(0, bytes.count - 22 - 0xffff)
    var end = -1
    var offset = bytes.count - 22
    while offset >= searchStart {
        if bytes.uint32(offset) == endOfCentralDirectory {
            end = offset
            break
        }
        offset -= 1
    }
    guard end >= 0, let count = bytes.uint16(end + 10), let directoryOffset = bytes.uint32(end + 16) else {
        throw ZipFailure.corrupt("end of central directory not found")
    }
    if count == 0xffff || directoryOffset == 0xffff_ffff {
        throw ZipFailure(unsupported: true, message: "ZIP64 archives are not supported")
    }

    var entries: [CentralEntry] = []
    var cursor = Int(directoryOffset)
    for _ in 0..<count {
        guard cursor + 46 <= bytes.count, bytes.uint32(cursor) == centralFileHeader,
              let versionMadeBy = bytes.uint16(cursor + 4),
              let flags = bytes.uint16(cursor + 8),
              let method = bytes.uint16(cursor + 10),
              let compressedSize = bytes.uint32(cursor + 20),
              let size = bytes.uint32(cursor + 24),
              let nameLength = bytes.uint16(cursor + 28),
              let extraLength = bytes.uint16(cursor + 30),
              let commentLength = bytes.uint16(cursor + 32),
              let attributes = bytes.uint32(cursor + 38),
              let localOffset = bytes.uint32(cursor + 42)
        else { throw ZipFailure.corrupt("bad central directory entry") }
        let mode = attributes >> 16
        entries.append(CentralEntry(
            name: decodeName(bytes.slice(cursor + 46, nameLength)),
            flags: flags,
            method: method,
            compressedSize: Int(compressedSize),
            size: Int(size),
            localOffset: Int(localOffset),
            isSymlink: versionMadeBy >> 8 == unixHost && mode & fileTypeMask == symlinkMode))
        cursor += 46 + nameLength + extraLength + commentLength
    }
    return entries
}

// MARK: - Checks

private func unsafeNameReason(_ name: String) -> String? {
    let scalars = name.unicodeScalars
    if scalars.contains("\0") { return "NUL in entry name" }
    if scalars.contains("\\") { return "backslash in entry name" }
    if scalars.first == "/" || hasDriveLetter(scalars) { return "absolute entry name" }
    let trimmed = scalars.last == "/" ? scalars.dropLast() : scalars[...]
    let segments = trimmed.split(separator: "/", omittingEmptySubsequences: false)
    if segments.contains(where: { $0.elementsEqual("..".unicodeScalars) }) { return "'..' in entry name" }
    if segments.contains(where: \.isEmpty) { return "empty path segment" }
    return nil
}

/// `/^[A-Za-z]:/`
private func hasDriveLetter(_ scalars: String.UnicodeScalarView) -> Bool {
    var iterator = scalars.makeIterator()
    guard let letter = iterator.next(), iterator.next() == ":" else { return false }
    return ("A"..."Z").contains(letter) || ("a"..."z").contains(letter)
}

/// `/\.(json|jpe?g|png|mp4)$/i`, folding ASCII letters only as a non-Unicode JavaScript regex does.
private func hasExpectedExtension(_ name: String) -> Bool {
    let folded = String(String.UnicodeScalarView(name.unicodeScalars.map { scalar in
        ("A"..."Z").contains(scalar) ? Unicode.Scalar(scalar.value + 32) ?? scalar : scalar
    }))
    return expectedExtensions.contains { folded.unicodeScalars.reversed().starts(with: $0.unicodeScalars.reversed()) }
}

private func checkEntries(_ entries: [CentralEntry], limits: ArxPackageLimits) -> [ArxIssue] {
    if entries.count > limits.maxEntries {
        return [.error(.packageLimit, "zip:", "\(entries.count) entries exceed \(limits.maxEntries)")]
    }
    var issues: [ArxIssue] = []
    var seen = Set<[UInt8]>()
    var total = 0
    for entry in entries {
        let path = "zip:\(entry.name)"
        let reason = unsafeNameReason(entry.name)
        if let reason { issues.append(.error(.packagePath, path, reason)) }
        if entry.isSymlink { issues.append(.error(.packagePath, path, "symbolic links are not allowed")) }
        if !seen.insert(entry.key).inserted { issues.append(.error(.packagePath, path, "duplicate entry")) }
        if entry.flags & 1 != 0 {
            issues.append(.error(.packageUnsupported, path, "encrypted entries are not supported"))
        }
        if entry.method != storedMethod && entry.method != deflatedMethod {
            issues.append(.error(.packageUnsupported, path, "compression method \(entry.method)"))
        }
        if entry.compressedSize > 0,
           Double(entry.size) / Double(entry.compressedSize) > limits.maxCompressionRatio {
            issues.append(.error(.packageLimit, path, "compression ratio exceeds the limit"))
        }
        total += entry.size
        if !entry.isDirectory && reason == nil && !hasExpectedExtension(entry.name) {
            issues.append(.warning(.packageUnexpectedFile, path, "file type is not used by ARX 0.1"))
        }
    }
    if total > limits.maxTotalUncompressedBytes {
        issues.append(.error(.packageLimit, "zip:", "uncompressed size \(total) exceeds the limit"))
    }
    let manifestKey = Array(manifestName.utf8)
    if let manifest = entries.first(where: { $0.key == manifestKey }) {
        if manifest.size > limits.maxManifestBytes {
            issues.append(.error(.packageLimit, "zip:\(manifestName)", "manifest.json exceeds the limit"))
        }
    } else {
        issues.append(.error(.packageManifestMissing, "zip:\(manifestName)", "manifest.json must be at the root"))
    }
    return issues
}

// MARK: - Extraction

private func extract(_ bytes: ZipBytes, _ entry: CentralEntry) throws -> Data {
    let header = entry.localOffset
    guard header + 30 <= bytes.count, bytes.uint32(header) == localFileHeader,
          let nameLength = bytes.uint16(header + 26), let extraLength = bytes.uint16(header + 28)
    else { throw ZipFailure.corrupt("bad local header") }
    let compressed = bytes.slice(header + 30 + nameLength + extraLength, entry.compressedSize)
    guard compressed.count == entry.compressedSize else { throw ZipFailure.corrupt("truncated entry") }
    if entry.method == storedMethod {
        guard entry.compressedSize == entry.size else { throw ZipFailure.corrupt("stored size mismatch") }
        return Data(compressed)
    }
    return try inflateBounded(compressed, expectedSize: entry.size)
}

/// Raw DEFLATE that stops as soon as the output would exceed `expectedSize`.
private func inflateBounded(_ compressed: Data, expectedSize: Int) throws -> Data {
    var output = Data()
    // An empty stream inflates to nothing, as in fflate; the Compression framework is not asked.
    if !compressed.isEmpty {
        _ = try Data.decompress(
            size: Int64(compressed.count),
            bufferSize: inflateChunkSize,
            skipCRC32: true,
            provider: { position, length in
                let start = min(max(Int(position), 0), compressed.count)
                let end = min(start + max(length, 0), compressed.count)
                return compressed.subdata(in: (compressed.startIndex + start)..<(compressed.startIndex + end))
            },
            consumer: { chunk in
                guard output.count + chunk.count <= expectedSize else {
                    throw ZipFailure.corrupt("data exceeds declared size")
                }
                output.append(chunk)
            })
    }
    guard output.count == expectedSize else { throw ZipFailure.corrupt("data is shorter than declared size") }
    return output
}
