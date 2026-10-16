import Foundation
import Testing
@testable import ArxCore

/// Manifest-level checks (schema + semantics + URI policy), before any asset is read.
struct ManifestValidationTests {
    struct ExpectedError: Decodable, Hashable {
        let code: String
        let path: String
    }

    struct Expected: Decodable {
        let valid: Bool
        let errors: [ExpectedError]?
        let warnings: [String]?
        let package: String?
    }

    static let manifestLevelCodes: Set<String> = [
        "ARX_SCHEMA", "ARX_SPEC_VERSION", "ARX_DUPLICATE_LAYER_ID", "ARX_QUATERNION_NOT_UNIT",
        "ARX_EXTENSION_NOT_DECLARED", "ARX_EXTENSION_UNSUPPORTED", "ARX_URI_SCHEME", "ARX_URI_PATH",
        "ARX_URI_CREDENTIALS", "ARX_URI_PRIVATE_NETWORK",
    ]

    static func expected(_ directory: URL) throws -> Expected {
        try JSONDecoder().decode(Expected.self, from: Data(contentsOf: directory.appendingPathComponent("expected.json")))
    }

    static var manifestLevelNegatives: [String] {
        let negative = fixturesRoot.appendingPathComponent("negative")
        let names = (try? FileManager.default.contentsOfDirectory(atPath: negative.path)) ?? []
        return names.sorted().filter { name in
            guard let expected = try? expected(negative.appendingPathComponent(name)), expected.package == nil else {
                return false
            }
            return expected.errors?.allSatisfy { manifestLevelCodes.contains($0.code) } ?? false
        }
    }

    static var positives: [String] {
        let positive = fixturesRoot.appendingPathComponent("positive")
        let names = (try? FileManager.default.contentsOfDirectory(atPath: positive.path)) ?? []
        return names.sorted().filter { FileManager.default.fileExists(atPath: positive.appendingPathComponent("\($0)/manifest.json").path) }
    }

    @Test func coversTheManifestLevelFixtures() {
        #expect(Self.manifestLevelNegatives.count >= 11, "\(Self.manifestLevelNegatives)")
    }

    @Test(arguments: manifestLevelNegatives)
    func negativeFixtureReportsItsError(name: String) throws {
        let directory = fixturesRoot.appendingPathComponent("negative/\(name)")
        let data = try Data(contentsOf: directory.appendingPathComponent("manifest.json"))
        let result = ArxManifestValidator.validate(data, manifestURL: ArxLocal.manifestURL)
        #expect(result.manifest == nil, "\(name) should be invalid")
        let reported = Set(result.issues.filter { $0.severity == .error }.map { ExpectedError(code: $0.code.rawValue, path: $0.path) })
        for want in try Self.expected(directory).errors ?? [] {
            #expect(reported.contains(want), "\(name) missing \(want); got \(result.issues)")
        }
    }

    @Test(arguments: positives)
    func positiveFixtureHasNoManifestErrors(name: String) throws {
        let directory = fixturesRoot.appendingPathComponent("positive/\(name)")
        let data = try Data(contentsOf: directory.appendingPathComponent("manifest.json"))
        let result = ArxManifestValidator.validate(data, manifestURL: ArxLocal.manifestURL)
        #expect(!result.issues.hasErrors, "\(name): \(result.issues)")
        #expect(result.manifest != nil)
    }

    @Test func driftingQuaternionWarnsAndNormalizes() throws {
        let directory = fixturesRoot.appendingPathComponent("positive/C013-quaternion-near-unit")
        let result = ArxManifestValidator.validate(
            try Data(contentsOf: directory.appendingPathComponent("manifest.json")), manifestURL: ArxLocal.manifestURL)
        #expect(result.issues.map(\.code) == [.quaternionDrift])
        let rotation = try #require(result.manifest?.layers.first?.transform.rotation)
        #expect(abs(rotation.norm - 1) < 1e-9)
    }

    @Test func rejectsInvalidJson() {
        let result = ArxManifestValidator.validate(Data("{".utf8), manifestURL: ArxLocal.manifestURL)
        #expect(result.issues.map(\.code) == [.jsonParse])
    }

    @Test func bundledSchemaMatchesTheRepositorySchema() throws {
        let repository = try Data(contentsOf: fixturesRoot.deletingLastPathComponent().appendingPathComponent("schema/arx-0.1.schema.json"))
        #expect(try ArxSchema.bundledSchemaData() == repository)
    }
}
