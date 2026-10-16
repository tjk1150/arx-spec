import Foundation
import Testing
@testable import ArxCore

/// The bundled ARX_effects resources are byte copies of the root files (spec/extensions/ARX_effects.md 5),
/// the constants match the root extension schema, and an unreadable preset table drops only the effects.
struct EffectsResourceTests {
    static let extensionDirectory = fixturesRoot.deletingLastPathComponent().appendingPathComponent("schema/ext")

    static func rootFile(_ name: String) throws -> Data {
        try Data(contentsOf: extensionDirectory.appendingPathComponent(name))
    }

    static func rootSchema() throws -> [String: Any] {
        try #require(try JSONSerialization.jsonObject(with: rootFile("ARX_effects.schema.json")) as? [String: Any])
    }

    @Test func bundledExtensionSchemaMatchesTheRepositorySchema() throws {
        #expect(try ArxEffectsValidator.bundledSchemaData() == Self.rootFile("ARX_effects.schema.json"))
    }

    @Test func bundledPresetTableMatchesTheRepositoryTable() throws {
        #expect(try EffectPresets.bundledData() == Self.rootFile("ARX_effects.presets.json"))
    }

    @Test func constantsMatchTheRootExtensionSchema() throws {
        let schema = try Self.rootSchema()
        let effects = (schema["properties"] as? [String: Any])?["effects"] as? [String: Any]
        #expect(effects?["maxItems"] as? Int == EffectConstants.maxEffects)
        let effect = ((schema["$defs"] as? [String: Any])?["effect"] as? [String: Any])?["properties"] as? [String: Any]
        #expect((effect?["amount"] as? [String: Any])?["default"] as? Double == EffectConstants.defaultAmount)
        #expect((effect?["speed"] as? [String: Any])?["default"] as? Double == EffectConstants.defaultSpeed)
        let sprites = try FileManager.default.contentsOfDirectory(
            atPath: Self.extensionDirectory.appendingPathComponent("sprites").path)
            .filter { $0.hasSuffix(".png") }.map { String($0.dropLast(4)) }.sorted()
        #expect(EffectConstants.sprites.sorted() == sprites)
    }

    @Test func bundledPresetTableHoldsTheFivePresets() throws {
        let presets = try #require(EffectPresets.bundled)
        #expect(presets.keys.sorted() == ["burst", "float", "rise", "snow", "sparkle"])
        #expect(presets["sparkle"]?.size == 0.03)
        #expect(presets["sparkle"]?.sprite == "star")
        #expect(presets["burst"]?.emission == EffectEmission(kind: .burst, emitSeconds: 0.1, pauseSeconds: 1.4))
        #expect(presets["float"]?.alphaCurve == "constant")
        #expect(presets["float"]?.sprite == "glow-star")
        #expect(presets.values.allSatisfy { EffectConstants.sprites.contains($0.sprite) })
    }

    @Test func anUnreadablePresetFileGivesNoTable() throws {
        #expect(EffectPresets.load(from: nil) == nil)
        #expect(EffectPresets.load(from: Self.extensionDirectory.appendingPathComponent("missing.json")) == nil)
        let broken = FileManager.default.temporaryDirectory.appendingPathComponent("arx-presets-\(UUID().uuidString).json")
        defer { try? FileManager.default.removeItem(at: broken) }
        try Data(#"{"presets": {"sparkle": {"size": 1}}}"#.utf8).write(to: broken)
        #expect(EffectPresets.load(from: broken) == nil)
        #expect(EffectPresets.load(from: Self.extensionDirectory.appendingPathComponent("ARX_effects.presets.json"))
            == EffectPresets.bundled)
    }

    /// The external boundary `EffectPresets.load()`: without a preset table every
    /// effect is dropped with one ARX_EFFECT_UNSUPPORTED, and the layers still load.
    @Test func withoutPresetsEveryEffectIsDroppedAndTheLayersStay() async throws {
        let directory = fixturesRoot.appendingPathComponent("effects/E001-sparkle-defaults")
        let missing = EffectPresets.load(from: Self.extensionDirectory.appendingPathComponent("missing.json"))
        let options = ArxValidationOptions(supportedExtensions: [EffectConstants.extensionName], effectPresets: missing)

        let data = try Data(contentsOf: directory.appendingPathComponent("manifest.json"))
        let result = ArxManifestValidator.validate(data, manifestURL: ArxLocal.manifestURL, options: options)
        #expect(result.issues.map(\.description).map { $0.components(separatedBy: ":")[0] }
            == ["warning ARX_EFFECT_UNSUPPORTED \(EffectConstants.extensionPointer)"])
        let manifest = try #require(result.manifest)
        #expect(manifest.effects.isEmpty)
        #expect(manifest.layers.map(\.id) == ["overlay"])

        let cache = FileManager.default.temporaryDirectory.appendingPathComponent("arx-effects-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: cache) }
        let loaded = await ArxExperienceLoader.validate(
            source: ArxLocalSource.directory(directory), options: options, cacheDirectory: cache)
        #expect(!loaded.issues.hasErrors, "\(loaded.issues)")
        #expect(loaded.experience?.layers.map(\.id) == ["overlay"])
    }
}
