import Compression
import Foundation
import Testing
@testable import ArxCore

/// One archive entry for `buildZip`; mirrors the `Entry` helper in package.test.ts.
private struct ZipEntry {
    var name: String
    var data = Data()
    /// Overrides the declared uncompressed size, to simulate a lying header.
    var declaredSize: Int?
    var deflate = false
    var symlink = false
    var encrypted = false
    /// Stored as-is instead of `data` (compressed when `deflate`), for crafted streams.
    var body: Data?
}

private let manifestBytes = Data(#"{"spec":"arx/0.1"}"#.utf8)

/// Raw DEFLATE (no zlib header), as stored in ZIP entries.
private func deflateRaw(_ raw: Data) -> Data {
    guard !raw.isEmpty else { return Data([0x03, 0x00]) }
    let capacity = raw.count + 1024
    var output = Data(count: capacity)
    let written = output.withUnsafeMutableBytes { destination in
        raw.withUnsafeBytes { source in
            guard let target = destination.bindMemory(to: UInt8.self).baseAddress,
                  let input = source.bindMemory(to: UInt8.self).baseAddress else { return 0 }
            return compression_encode_buffer(target, capacity, input, raw.count, nil, COMPRESSION_ZLIB)
        }
    }
    precondition(written > 0, "deflate failed")
    return output.prefix(written)
}

private extension Data {
    mutating func appendUInt16(_ value: Int) {
        append(contentsOf: [UInt8(value & 0xff), UInt8(value >> 8 & 0xff)])
    }

    mutating func appendUInt32(_ value: UInt32) {
        append(contentsOf: [0, 8, 16, 24].map { UInt8(value >> UInt32($0) & 0xff) })
    }

    mutating func appendZeros(_ count: Int) { append(Data(count: count)) }
}

/// Minimal ZIP writer so tests can build archives that real tools refuse to.
private func buildZip(_ entries: [ZipEntry]) -> Data {
    var locals = Data()
    var centrals = Data()
    for entry in entries {
        let body = entry.body ?? (entry.deflate ? deflateRaw(entry.data) : entry.data)
        let name = Data(entry.name.utf8)
        let size = UInt32(entry.declaredSize ?? entry.data.count)
        let flags = entry.encrypted ? 1 : 0
        let method = entry.deflate ? 8 : 0
        let offset = UInt32(locals.count)

        locals.appendUInt32(0x0403_4b50)
        locals.appendUInt16(20)
        locals.appendUInt16(flags)
        locals.appendUInt16(method)
        locals.appendZeros(8) // time, date, crc32
        locals.appendUInt32(UInt32(body.count))
        locals.appendUInt32(size)
        locals.appendUInt16(name.count)
        locals.appendUInt16(0)
        locals.append(name)
        locals.append(body)

        centrals.appendUInt32(0x0201_4b50)
        centrals.appendUInt16(3 << 8 | 20)
        centrals.appendUInt16(20)
        centrals.appendUInt16(flags)
        centrals.appendUInt16(method)
        centrals.appendZeros(8) // time, date, crc32
        centrals.appendUInt32(UInt32(body.count))
        centrals.appendUInt32(size)
        centrals.appendUInt16(name.count)
        centrals.appendZeros(8) // extra, comment, disk, internal attributes
        centrals.appendUInt32(UInt32(entry.symlink ? 0o120777 : 0o100644) << 16)
        centrals.appendUInt32(offset)
        centrals.append(name)
    }
    var end = Data()
    end.appendUInt32(0x0605_4b50)
    end.appendZeros(4)
    end.appendUInt16(entries.count)
    end.appendUInt16(entries.count)
    end.appendUInt32(UInt32(centrals.count))
    end.appendUInt32(UInt32(locals.count))
    end.appendUInt16(0)
    return locals + centrals + end
}

private func limits(_ configure: (inout ArxPackageLimits) -> Void) -> ArxPackageLimits {
    var limits = ArxPackageLimits()
    configure(&limits)
    return limits
}

private func codes(_ bytes: Data, limits: ArxPackageLimits = ArxPackageLimits()) -> [String] {
    ArxPackage.open(bytes, limits: limits).issues.map { "\($0.code.rawValue) \($0.path)" }
}

private func packageURL(_ path: String) throws -> URL {
    try #require(URL(string: ArxLocal.origin + path))
}

@Suite struct PackageTests {
    @Test func opensAWellFormedPackageAndReadsEntries() async throws {
        let result = ArxPackage.open(buildZip([
            ZipEntry(name: "manifest.json", data: manifestBytes, deflate: true),
            ZipEntry(name: "assets/"),
            ZipEntry(name: "assets/a.png", data: Data([1, 2, 3])),
        ]))
        #expect(result.issues.isEmpty)
        let source = try #require(result.source)
        #expect(await source.read(try packageURL("assets/a.png")) == Data([1, 2, 3]))
        #expect(await source.read(try packageURL("manifest.json")) == manifestBytes)
        #expect(await source.read(try packageURL("assets/missing.png")) == nil)
    }

    @Test(arguments: [
        ("../evil.png", "ARX_PACKAGE_PATH zip:../evil.png"),
        ("assets/../../evil.png", "ARX_PACKAGE_PATH zip:assets/../../evil.png"),
        ("/etc/evil.png", "ARX_PACKAGE_PATH zip:/etc/evil.png"),
        ("C:/evil.png", "ARX_PACKAGE_PATH zip:C:/evil.png"),
        ("assets\\evil.png", "ARX_PACKAGE_PATH zip:assets\\evil.png"),
        ("assets/a\0.png", "ARX_PACKAGE_PATH zip:assets/a\0.png"),
        ("assets//a.png", "ARX_PACKAGE_PATH zip:assets//a.png"),
    ])
    func rejectsTheUnsafeEntryName(name: String, issue: String) {
        let bytes = buildZip([
            ZipEntry(name: "manifest.json", data: manifestBytes),
            ZipEntry(name: name, data: manifestBytes),
        ])
        #expect(codes(bytes).contains(issue))
        #expect(ArxPackage.open(bytes).source == nil)
    }

    @Test func rejectsDuplicateEntries() {
        let bytes = buildZip([
            ZipEntry(name: "manifest.json", data: manifestBytes),
            ZipEntry(name: "assets/a.png", data: manifestBytes),
            ZipEntry(name: "assets/a.png", data: manifestBytes),
        ])
        #expect(codes(bytes).contains("ARX_PACKAGE_PATH zip:assets/a.png"))
    }

    @Test func rejectsSymbolicLinksAndEncryptedEntries() {
        let bytes = buildZip([
            ZipEntry(name: "manifest.json", data: manifestBytes),
            ZipEntry(name: "assets/link.png", data: Data("/etc/passwd".utf8), symlink: true),
            ZipEntry(name: "assets/secret.png", data: manifestBytes, encrypted: true),
        ])
        let found = codes(bytes)
        #expect(found.contains("ARX_PACKAGE_PATH zip:assets/link.png"))
        #expect(found.contains("ARX_PACKAGE_UNSUPPORTED zip:assets/secret.png"))
    }

    @Test func requiresManifestAtTheArchiveRoot() {
        let bytes = buildZip([ZipEntry(name: "nested/manifest.json", data: manifestBytes)])
        #expect(codes(bytes).contains("ARX_PACKAGE_MANIFEST_MISSING zip:manifest.json"))
    }

    @Test func enforcesImplementationLimitsBeforeDecompressing() {
        let bytes = buildZip([
            ZipEntry(name: "manifest.json", data: manifestBytes),
            ZipEntry(name: "assets/zeros.png", data: Data(count: 1_000_000), deflate: true),
        ])
        #expect(codes(bytes).contains("ARX_PACKAGE_LIMIT zip:assets/zeros.png"))
        let totalLimit = limits { $0.maxTotalUncompressedBytes = 1000; $0.maxCompressionRatio = 1e9 }
        #expect(codes(bytes, limits: totalLimit).contains("ARX_PACKAGE_LIMIT zip:"))
        let twoEntries = buildZip([ZipEntry(name: "manifest.json", data: manifestBytes), ZipEntry(name: "a.png")])
        #expect(codes(twoEntries, limits: limits { $0.maxEntries = 1 }).contains("ARX_PACKAGE_LIMIT zip:"))
    }

    @Test func rejectsEntriesWhoseDataDoesNotMatchTheDeclaredSize() {
        let bytes = buildZip([
            ZipEntry(name: "manifest.json", data: manifestBytes),
            ZipEntry(name: "assets/a.png", data: Data(count: 4000), declaredSize: 10, deflate: true),
        ])
        let found = codes(bytes, limits: limits { $0.maxCompressionRatio = 1e9 })
        #expect(found.contains("ARX_PACKAGE_CORRUPT zip:assets/a.png"))
    }

    /// fflate's `deflateSync(new Uint8Array(4000))`; the expectations below are what fflate reports for each stream.
    private static let fflateZeros: [UInt8] = [
        237, 192, 49, 1, 0, 0, 0, 194, 32, 251, 167, 54, 198, 30, 24, 0, 0, 0, 144, 59,
    ]

    @Test(arguments: [
        ("complete", fflateZeros, 4000, true),
        ("trailing bytes", fflateZeros + [0, 0, 0, 0, 0], 4000, true),
        ("empty stream", [], 0, true),
        ("stored block", [0x01, 0x03, 0x00, 0xfc, 0xff, 1, 2, 3], 3, true),
        ("truncated by 1", Array(fflateZeros.dropLast(1)), 4000, false),
        ("truncated by 2", Array(fflateZeros.dropLast(2)), 4000, false),
        ("truncated by 10", Array(fflateZeros.dropLast(10)), 4000, false),
        ("truncated stored block", [0x01, 0x03, 0x00, 0xfc, 0xff, 1, 2], 3, false),
        ("no final block", [0x00, 0x03, 0x00, 0xfc, 0xff, 1, 2, 3], 3, false),
        ("invalid block type", [0xff, 0xff, 0xff], 3, false),
    ] as [(String, [UInt8], Int, Bool)])
    func inflatesLikeFflate(label: String, stream: [UInt8], size: Int, accepted: Bool) {
        let bytes = buildZip([
            ZipEntry(name: "manifest.json", data: manifestBytes),
            ZipEntry(name: "assets/a.png", declaredSize: size, deflate: true, body: Data(stream)),
        ])
        let found = codes(bytes, limits: limits { $0.maxCompressionRatio = 1e9 })
        #expect(found == (accepted ? [] : ["ARX_PACKAGE_CORRUPT zip:assets/a.png"]), "\(label)")
    }

    @Test func inflatesLargeEntriesAcrossManyChunks() async throws {
        let zeros = Data(count: 1_000_000)
        let result = ArxPackage.open(
            buildZip([
                ZipEntry(name: "manifest.json", data: manifestBytes),
                ZipEntry(name: "assets/zeros.png", data: zeros, deflate: true),
            ]),
            limits: limits { $0.maxCompressionRatio = 1e9 })
        #expect(result.issues.isEmpty)
        let source = try #require(result.source)
        #expect(await source.read(try packageURL("assets/zeros.png")) == zeros)
    }

    @Test func warnsAboutFilesAnArxPackageDoesNotUse() {
        let result = ArxPackage.open(buildZip([
            ZipEntry(name: "manifest.json", data: manifestBytes),
            ZipEntry(name: "run.sh", data: manifestBytes),
        ]))
        #expect(result.source != nil)
        #expect(result.issues.map { "\($0.severity.rawValue) \($0.code.rawValue)" }
            == ["warning ARX_PACKAGE_UNEXPECTED_FILE"])
    }

    @Test func rejectsBytesThatAreNotAZipArchive() {
        #expect(codes(Data([1, 2, 3])) == ["ARX_PACKAGE_CORRUPT zip:"])
    }

    @Test func rejectsZip64Markers() {
        var bytes = buildZip([ZipEntry(name: "manifest.json", data: manifestBytes)])
        let entryCount = bytes.count - 22 + 10
        bytes.replaceSubrange(entryCount..<(entryCount + 2), with: [0xff, 0xff])
        #expect(codes(bytes) == ["ARX_PACKAGE_UNSUPPORTED zip:"])
    }

    @Test func opensThePackageRelativeFixture() async throws {
        let url = fixturesRoot.appendingPathComponent("positive/C011-package-relative/experience.arx")
        let result = ArxPackage.open(try Data(contentsOf: url))
        #expect(result.issues.isEmpty)
        let source = try #require(result.source)
        let target = try #require(await source.read(try packageURL("assets/target.jpg")))
        #expect(target.count == 269_198)
        #expect(target.starts(with: [0xFF, 0xD8]))
    }

    @Test func rejectsTheZipSlipFixture() throws {
        let url = fixturesRoot.appendingPathComponent("negative/N008-zip-slip/experience.arx")
        let result = ArxPackage.open(try Data(contentsOf: url))
        #expect(result.issues.map { "\($0.code.rawValue) \($0.path)" }.contains("ARX_PACKAGE_PATH zip:../evil.png"))
        #expect(result.source == nil)
    }
}
