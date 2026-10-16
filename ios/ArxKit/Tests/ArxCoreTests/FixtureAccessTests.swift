import Foundation
import Testing
@testable import ArxCore

/// The shared conformance fixtures live at the repository root.
let fixturesRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .appendingPathComponent("../../../../fixtures")
    .standardizedFileURL

@Test func positiveFixturesDeclareTheSupportedSpec() throws {
    let positive = fixturesRoot.appendingPathComponent("positive")
    let names = try FileManager.default.contentsOfDirectory(atPath: positive.path)
        .filter { FileManager.default.fileExists(atPath: positive.appendingPathComponent("\($0)/manifest.json").path) }
    #expect(names.count >= 15)
    for name in names {
        let data = try Data(contentsOf: positive.appendingPathComponent("\(name)/manifest.json"))
        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        #expect(json?["spec"] as? String == ArxSpec.version, "\(name)")
    }
}
