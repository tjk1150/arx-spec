import Foundation
import Testing
@testable import ArxCore

/// Runs every conformance fixture through the full loader, like
/// packages/arx-core/test/conformance.test.ts does for TypeScript.
struct ConformanceTests {
    static let tolerance = 1e-6

    struct Expected: Decodable {
        struct Target: Decodable {
            let size: [Double]
            let physicalWidth: Double?
        }
        struct Playback: Decodable, Equatable {
            let autoplay: Bool
            let loop: Bool
        }
        struct Layer: Decodable {
            let id: String
            let size: [Double]
            let matrix: [Double]
            let playback: Playback?
        }
        struct ExpectedError: Decodable, Hashable {
            let code: String
            let path: String
        }
        let valid: Bool
        let warnings: [String]?
        let errors: [ExpectedError]?
        let package: String?
        let manifestUrl: String?
        let serve: [String: String]?
        let resolved: [String: String]?
        let target: Target?
        let layers: [Layer]?
        let effects: [Effect]?
    }

    struct Effect: Decodable {
        let id: String
        let preset: String
        let colors: [String]
        let amount: Double
        let size: Double
        let speed: Double
        let sprite: String
        let matrix: [Double]
    }

    /// Effects fixtures (fixtures/effects): warnings are code and path objects.
    struct EffectsExpected: Decodable {
        let valid: Bool
        let warnings: [ExpectedError]
        let target: Expected.Target
        let layers: [Expected.Layer]
        let effects: [Effect]
    }

    typealias ExpectedError = Expected.ExpectedError

    /// Effects fixtures run as an implementation that reads ARX_effects (spec/extensions/ARX_effects.md 4.1).
    static let effectsOptions = ArxValidationOptions(supportedExtensions: [EffectConstants.extensionName])

    /// Every effects fixture of the conformance table (spec section 12.2).
    static let effectsFixtures = [
        "D001-unknown-preset", "D002-amount-range", "D003-bad-color", "D004-extra-field", "D005-duplicate-id",
        "D006-not-array", "D007-too-many", "D008-quaternion", "D009-undeclared", "E001-sparkle-defaults",
        "E002-all-presets", "E003-white-cone", "E004-pink-sparkle", "E009-worst-case",
    ]

    static func names(_ kind: String) -> [String] {
        let directory = fixturesRoot.appendingPathComponent(kind)
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        return names.sorted().filter {
            FileManager.default.fileExists(atPath: directory.appendingPathComponent("\($0)/expected.json").path)
        }
    }

    static func run(_ directory: URL, _ expected: Expected) async throws -> ArxValidationResult {
        let cache = FileManager.default.temporaryDirectory.appendingPathComponent("arx-conformance-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: cache) }
        if let package = expected.package {
            let data = try Data(contentsOf: directory.appendingPathComponent(package))
            return await ArxExperienceLoader.validatePackage(data, cacheDirectory: cache)
        }
        if let manifestUrl = expected.manifestUrl, let serve = expected.serve {
            let source = ArxRemoteSource(manifestURL: URL(string: manifestUrl)!) { url in
                guard let file = serve[url.absoluteString] else { return nil }
                return try? Data(contentsOf: directory.appendingPathComponent(file))
            }
            return await ArxExperienceLoader.validate(source: source, cacheDirectory: cache)
        }
        return await ArxExperienceLoader.validate(source: ArxLocalSource.directory(directory), cacheDirectory: cache)
    }

    /// Runs a directory fixture through the full loader with the given options.
    static func runDirectory(_ directory: URL, options: ArxValidationOptions) async -> ArxValidationResult {
        let cache = FileManager.default.temporaryDirectory.appendingPathComponent("arx-conformance-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: cache) }
        return await ArxExperienceLoader.validate(
            source: ArxLocalSource.directory(directory), options: options, cacheDirectory: cache)
    }

    /// Effects of a directory fixture's manifest after the manifest stage (spec/extensions/ARX_effects.md 4.3).
    static func resolvedEffects(_ directory: URL, options: ArxValidationOptions) throws -> [ArxEffect]? {
        let data = try Data(contentsOf: directory.appendingPathComponent("manifest.json"))
        return ArxManifestValidator.validate(data, manifestURL: ArxLocal.manifestURL, options: options).manifest?.effects
    }

    static func expectEffects(_ actual: [ArxEffect], _ expected: [Effect], _ name: String) {
        #expect(actual.map(\.id) == expected.map(\.id), "\(name) effect ids")
        for (effect, want) in zip(actual, expected) {
            let label = "\(name) effect \(effect.id)"
            #expect(effect.preset == want.preset, "\(label) preset")
            #expect(effect.colors == want.colors, "\(label) colors")
            #expect(effect.sprite == want.sprite, "\(label) sprite")
            #expect(close([effect.amount, effect.size, effect.speed], [want.amount, want.size, want.speed]), "\(label) amount,size,speed")
            #expect(close(effect.matrix, want.matrix), "\(label) matrix \(effect.matrix)")
        }
    }

    static func expectLayers(_ experience: ArxExperience, target: Expected.Target, layers: [Expected.Layer], _ name: String) {
        #expect(close(experience.target.size.array, target.size), "\(name) target size")
        #expect(experience.target.physicalWidth == target.physicalWidth, "\(name) physicalWidth")
        #expect(experience.layers.map(\.id) == layers.map(\.id))
        for (layer, want) in zip(experience.layers, layers) {
            #expect(close(layer.size.array, want.size), "\(name) \(layer.id) size")
            #expect(close(layer.matrix, want.matrix), "\(name) \(layer.id) matrix")
            let playback = layer.playback.map { Expected.Playback(autoplay: $0.autoplay, loop: $0.loop) }
            #expect(playback == want.playback, "\(name) \(layer.id) playback")
        }
    }

    static func close(_ actual: [Double], _ expected: [Double]) -> Bool {
        actual.count == expected.count && zip(actual, expected).allSatisfy { abs($0 - $1) < tolerance }
    }

    static func expected(_ directory: URL) throws -> Expected {
        try JSONDecoder().decode(Expected.self, from: Data(contentsOf: directory.appendingPathComponent("expected.json")))
    }

    @Test func coversEveryFixture() {
        #expect(Self.names("positive").count >= 19)
        #expect(Self.names("negative").count >= 16)
        #expect(Self.names("effects") == Self.effectsFixtures)
    }

    @Test(arguments: names("positive"))
    func positiveFixture(name: String) async throws {
        let directory = fixturesRoot.appendingPathComponent("positive/\(name)")
        let expected = try Self.expected(directory)
        let result = try await Self.run(directory, expected)
        let errors = result.issues.filter { $0.severity == .error }
        #expect(errors.isEmpty, "\(name): \(errors)")
        let warnings = result.issues.filter { $0.severity == .warning }.map(\.code.rawValue).sorted()
        #expect(warnings == (expected.warnings ?? []).sorted(), "\(name): \(result.issues)")

        let experience = try #require(result.experience, "\(name) should load")
        let target = try #require(expected.target)
        Self.expectLayers(experience, target: target, layers: expected.layers ?? [], name)
        if let effects = expected.effects {
            let actual = try #require(try Self.resolvedEffects(directory, options: ArxValidationOptions()))
            Self.expectEffects(actual, effects, name)
        }
        for (pointer, url) in expected.resolved ?? [:] {
            let actual = pointer == "/anchor/src"
                ? experience.target.sourceURL.absoluteString
                : experience.layers[Int(pointer.split(separator: "/")[1]) ?? 0].sourceURL.absoluteString
            #expect(actual == url, "\(name) \(pointer)")
        }
    }

    @Test(arguments: names("negative"))
    func negativeFixture(name: String) async throws {
        let directory = fixturesRoot.appendingPathComponent("negative/\(name)")
        let expected = try Self.expected(directory)
        let result = try await Self.run(directory, expected)
        #expect(result.experience == nil, "\(name) should be invalid")
        let reported = Set(result.issues.filter { $0.severity == .error }.map {
            Expected.ExpectedError(code: $0.code.rawValue, path: $0.path)
        })
        for want in expected.errors ?? [] {
            #expect(reported.contains(want), "\(name) missing \(want); got \(result.issues)")
        }
    }

    // An implementation that does not read ARX_effects passes no supported extensions (spec section 10).
    @Test func c019CarriesDeclaredEffectDataYetOpensLikeC001WithoutOptions() throws {
        let directory = fixturesRoot.appendingPathComponent("positive/C019-unknown-extension-ignored")
        let manifest = try #require(
            try JSONSerialization.jsonObject(with: Data(contentsOf: directory.appendingPathComponent("manifest.json")))
                as? [String: Any])
        #expect(manifest["extensionsUsed"] as? [String] == [EffectConstants.extensionName])
        let extensions = manifest["extensions"] as? [String: Any]
        let effects = (extensions?[EffectConstants.extensionName] as? [String: Any])?["effects"] as? [Any]
        #expect((effects?.count ?? 0) > 0)

        let expected = try Self.expected(directory)
        #expect(expected.warnings == [])
        #expect(expected.effects?.isEmpty == true)
        #expect(try Self.resolvedEffects(directory, options: ArxValidationOptions())?.isEmpty == true)
        let c001 = try Self.expected(fixturesRoot.appendingPathComponent("positive/C001-minimal-image"))
        #expect(expected.target?.size == c001.target?.size)
        #expect(expected.layers?.map(\.matrix) == c001.layers?.map(\.matrix))
    }

    // Effect data never fails a manifest (spec/extensions/ARX_effects.md 4.2): every D
    // fixture is valid, keeps its layers, and drops only the bad effects with a warning each.
    @Test(arguments: names("effects"))
    func effectsFixture(name: String) async throws {
        let directory = fixturesRoot.appendingPathComponent("effects/\(name)")
        let expected = try JSONDecoder().decode(
            EffectsExpected.self, from: Data(contentsOf: directory.appendingPathComponent("expected.json")))
        #expect(expected.valid, "\(name): every effects fixture is valid")
        let result = await Self.runDirectory(directory, options: Self.effectsOptions)
        let errors = result.issues.filter { $0.severity == .error }
        #expect(errors.isEmpty, "\(name): \(errors)")
        let warnings = result.issues.filter { $0.severity == .warning }
            .map { "\($0.code.rawValue) \($0.path)" }.sorted()
        #expect(warnings == expected.warnings.map { "\($0.code) \($0.path)" }.sorted(), "\(name): \(result.issues)")

        let experience = try #require(result.experience, "\(name) should load")
        Self.expectLayers(experience, target: expected.target, layers: expected.layers, name)
        let effects = try #require(try Self.resolvedEffects(directory, options: Self.effectsOptions))
        Self.expectEffects(effects, expected.effects, name)
    }

    @Test func e009IsTheWorstCaseTheMostEffectsAllSnowAtAmountFour() throws {
        let directory = fixturesRoot.appendingPathComponent("effects/E009-worst-case")
        let expected = try JSONDecoder().decode(
            EffectsExpected.self, from: Data(contentsOf: directory.appendingPathComponent("expected.json")))
        #expect(expected.warnings.isEmpty)
        #expect(expected.effects.count == EffectConstants.maxEffects)
        #expect(expected.effects.allSatisfy { $0.preset == "snow" && $0.amount == 4 })
    }

    /// The loader writes validated bytes to the cache and points the experience there.
    @Test func experienceUsesCachedValidatedFiles() async throws {
        let directory = fixturesRoot.appendingPathComponent("positive/C002-video-once")
        let cache = FileManager.default.temporaryDirectory.appendingPathComponent("arx-cache-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: cache) }
        let experience = try await ArxExperienceLoader.load(source: ArxLocalSource.directory(directory), cacheDirectory: cache)
        let video = try #require(experience.layers.first)
        #expect(video.url.path.hasPrefix(cache.path))
        #expect(video.url.pathExtension == "mp4")
        let original = try Data(contentsOf: directory.appendingPathComponent("assets/video.mp4"))
        #expect(try Data(contentsOf: video.url) == original)
    }
}

/// Effect stage of the manifest validator, the cases of packages/arx-core/test/validate-effects.test.ts:
/// bad effect data drops that effect (or all effects) with one warning, and the manifest stays valid.
struct EffectsStageTests {
    typealias Json = [String: Any]

    static let root = EffectConstants.extensionPointer
    static let supported = ArxValidationOptions(supportedExtensions: [EffectConstants.extensionName])

    static func effect(_ overrides: Json = [:]) -> Json {
        ["id": "fx", "preset": "sparkle", "colors": ["#FF0071", "#18004A"]].merging(overrides) { $1 }
    }

    /// A manifest with one layer `planet`; `arxEffects` is the value of extensions.ARX_effects.
    static func manifest(_ arxEffects: Any?, _ overrides: Json = [:]) -> Json {
        var base: Json = [
            "spec": "arx/0.1",
            "anchor": ["type": "image", "src": "target.png"],
            "layers": [["id": "planet", "type": "image", "src": "planet.png"]],
            "extensionsUsed": [EffectConstants.extensionName],
        ]
        if let arxEffects { base["extensions"] = [EffectConstants.extensionName: arxEffects] }
        return base.merging(overrides) { $1 }
    }

    static func withEffects(_ effects: Any...) -> Json { manifest(["effects": effects]) }

    struct Checked {
        let valid: Bool
        let issues: [String]
        let effectIds: [String]
        let layerIds: [String]
        let manifest: ArxResolvedManifest?
    }

    static func check(_ input: Json, options: ArxValidationOptions = supported) throws -> Checked {
        let data = try JSONSerialization.data(withJSONObject: input)
        let result = ArxManifestValidator.validate(data, manifestURL: ArxLocal.manifestURL, options: options)
        return Checked(
            valid: result.manifest != nil && !result.issues.hasErrors,
            issues: result.issues.map { "\($0.severity.rawValue) \($0.code.rawValue) \($0.path)" },
            effectIds: result.manifest?.effects.map(\.id) ?? [],
            layerIds: result.manifest?.layers.map(\.id) ?? [],
            manifest: result.manifest)
    }

    // MARK: well-formed effects

    @Test func resolvesAnEffectWithTheDefaultsFilled() throws {
        let result = try Self.check(Self.withEffects(Self.effect()))
        #expect(result.valid)
        #expect(result.issues == [])
        let resolved = try #require(result.manifest?.effects.first)
        #expect(resolved == ArxEffect(
            id: "fx", preset: "sparkle", colors: ["#FF0071", "#18004A"], amount: 1, size: 0.03, speed: 1,
            sprite: "star", transform: ArxTransform(nil)))
        #expect(resolved.matrix == [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    }

    @Test func keepsUpToMaxEffectsInOrder() throws {
        let effects = (0..<EffectConstants.maxEffects).map { Self.effect(["id": "fx-\($0)", "preset": "snow", "amount": 4]) }
        let result = try Self.check(Self.manifest(["effects": effects]))
        #expect(result.issues == [])
        #expect(result.effectIds == effects.map { $0["id"] as? String ?? "" })
    }

    @Test func noEffectsWithoutTheExtension() throws {
        var plain = Self.manifest(nil)
        plain["extensionsUsed"] = nil
        let result = try Self.check(plain)
        #expect(result.issues == [])
        #expect(result.manifest?.effects == [])
    }

    @Test func declaredButAbsentGivesNoEffectsAndNoWarning() throws {
        let result = try Self.check(Self.manifest(nil, ["extensions": Json()]))
        #expect(result.valid)
        #expect(result.issues == [])
        #expect(result.manifest?.effects == [])
    }

    @Test func doesNotReadArxEffectsInALayer() throws {
        let layered = Self.manifest(nil, [
            "layers": [[
                "id": "planet", "type": "image", "src": "planet.png",
                "extensions": [EffectConstants.extensionName: ["effects": [Self.effect()]]],
            ]],
        ])
        let result = try Self.check(layered)
        #expect(result.issues == [])
        #expect(result.manifest?.effects == [])
    }

    // MARK: the whole extension object is bad

    static var badExtensionObjects: [(String, Any)] {
        [
            ("an array", [Any]()),
            ("a string", "sparkle"),
            ("null", NSNull()),
            ("effects not an array", ["effects": ["id": "a"]]),
            ("effects missing", Json()),
            ("zero effects", ["effects": [Any]()]),
            ("more than MAX_EFFECTS effects",
             ["effects": (0...EffectConstants.maxEffects).map { effect(["id": "fx-\($0)"]) }]),
            ("an unknown field on the extension object", ["effects": [effect()], "version": 2] as Json),
        ]
    }

    @Test(arguments: badExtensionObjects.indices)
    func dropsEveryEffectWhenTheExtensionObjectIsBad(index: Int) throws {
        let (label, arxEffects) = Self.badExtensionObjects[index]
        let result = try Self.check(Self.manifest(arxEffects))
        #expect(result.valid, "\(label)")
        #expect(result.issues == ["warning ARX_EFFECT_INVALID \(Self.root)"], "\(label)")
        #expect(result.effectIds == [], "\(label)")
        #expect(result.layerIds == ["planet"], "\(label)")
    }

    // MARK: one effect is bad

    static var badEffects: [(String, Any, String)] {
        [
            ("amount above 4", effect(["id": "b", "amount": 5]), "/effects/1/amount"),
            ("amount below 0.1", effect(["id": "b", "amount": 0.05]), "/effects/1/amount"),
            ("size above 0.2", effect(["id": "b", "size": 0.3]), "/effects/1/size"),
            ("negative speed", effect(["id": "b", "speed": -1]), "/effects/1/speed"),
            ("a short color", effect(["id": "b", "colors": ["#FFF", "#18004A"]]), "/effects/1/colors/0"),
            ("one color", effect(["id": "b", "colors": ["#FFFFFF"]]), "/effects/1/colors"),
            ("an unknown field", effect(["id": "b", "opacity": 1]), "/effects/1"),
            ("no colors", ["id": "b", "preset": "rise"] as Json, "/effects/1"),
            ("an empty id", effect(["id": ""]), "/effects/1/id"),
            ("a preset that is not a name", effect(["id": "b", "preset": "Sparkle"]), "/effects/1/preset"),
            ("an unknown transform field", effect(["id": "b", "transform": ["skew": 1]]), "/effects/1/transform"),
            ("a non-object entry", 5, "/effects/1"),
            ("a rotation component above 1", effect(["id": "b", "transform": ["rotation": [0, 0, 0, 1.05]]]),
             "/effects/1/transform/rotation/3"),
            ("a rotation norm off by more than 0.01", effect(["id": "b", "transform": ["rotation": [0.3, 0, 0, 1]]]),
             "/effects/1/transform/rotation"),
        ]
    }

    @Test(arguments: badEffects.indices)
    func dropsOnlyTheBadEffect(index: Int) throws {
        let (label, bad, pointer) = Self.badEffects[index]
        let result = try Self.check(Self.withEffects(Self.effect(["id": "a"]), bad))
        #expect(result.valid, "\(label)")
        #expect(result.issues == ["warning ARX_EFFECT_INVALID \(Self.root)\(pointer)"], "\(label)")
        #expect(result.effectIds == ["a"], "\(label)")
        #expect(result.layerIds == ["planet"], "\(label)")
    }

    @Test func reportsEachBadEffectOnceInEffectOrder() throws {
        let result = try Self.check(Self.withEffects(
            Self.effect(["id": "a", "amount": 9, "size": 9, "speed": 9]),
            Self.effect(["id": "b"]),
            Self.effect(["id": "c", "preset": "firefly"])))
        #expect(result.issues == [
            "warning ARX_EFFECT_INVALID \(Self.root)/effects/0/amount",
            "warning ARX_EFFECT_UNSUPPORTED \(Self.root)/effects/2/preset",
        ])
        #expect(result.effectIds == ["b"])
    }

    // MARK: ids

    @Test func dropsAnEffectWhoseIdIsALayerId() throws {
        let result = try Self.check(Self.withEffects(Self.effect(["id": "planet"]), Self.effect(["id": "b"])))
        #expect(result.valid)
        #expect(result.issues == ["warning ARX_EFFECT_INVALID \(Self.root)/effects/0/id"])
        #expect(result.effectIds == ["b"])
    }

    @Test func dropsTheLaterOfTwoEffectsWithTheSameId() throws {
        let result = try Self.check(Self.withEffects(
            Self.effect(["id": "a", "preset": "rise"]), Self.effect(["id": "a", "preset": "snow"])))
        #expect(result.issues == ["warning ARX_EFFECT_INVALID \(Self.root)/effects/1/id"])
        #expect(result.manifest?.effects.map(\.preset) == ["rise"])
    }

    @Test func doesNotReserveTheIdOfADroppedEffect() throws {
        let result = try Self.check(Self.withEffects(
            Self.effect(["id": "a", "preset": "firefly"]), Self.effect(["id": "a"])))
        #expect(result.issues == ["warning ARX_EFFECT_UNSUPPORTED \(Self.root)/effects/0/preset"])
        #expect(result.effectIds == ["a"])
    }

    // MARK: unknown preset and sprite values

    @Test func dropsAnEffectWithAnUnknownPreset() throws {
        let result = try Self.check(Self.withEffects(Self.effect(["id": "a", "preset": "firefly"]), Self.effect(["id": "b"])))
        #expect(result.valid)
        #expect(result.issues == ["warning ARX_EFFECT_UNSUPPORTED \(Self.root)/effects/0/preset"])
        #expect(result.effectIds == ["b"])
    }

    @Test func dropsAnEffectWithAnUnknownSprite() throws {
        let result = try Self.check(Self.withEffects(
            Self.effect(["id": "a", "sprite": "heart"]), Self.effect(["id": "b", "sprite": "dot"])))
        #expect(result.issues == ["warning ARX_EFFECT_UNSUPPORTED \(Self.root)/effects/0/sprite"])
        #expect(result.effectIds == ["b"])
    }

    @Test func doesNotTakeObjectMemberNamesForPresets() throws {
        let result = try Self.check(Self.withEffects(Self.effect(["preset": "constructor"])))
        #expect(result.issues == ["warning ARX_EFFECT_UNSUPPORTED \(Self.root)/effects/0/preset"])
    }

    // MARK: first problem order (schema, rotation, id, preset, sprite)

    static var firstProblems: [(String, Json, String)] {
        [
            ("schema before the rest",
             effect(["id": "planet", "amount": 9, "preset": "firefly", "sprite": "heart",
                     "transform": ["rotation": [0.3, 0, 0, 1]]]),
             "ARX_EFFECT_INVALID /effects/0/amount"),
            ("rotation before id",
             effect(["id": "planet", "preset": "firefly", "sprite": "heart", "transform": ["rotation": [0.3, 0, 0, 1]]]),
             "ARX_EFFECT_INVALID /effects/0/transform/rotation"),
            ("id before preset", effect(["id": "planet", "preset": "firefly", "sprite": "heart"]),
             "ARX_EFFECT_INVALID /effects/0/id"),
            ("preset before sprite", effect(["preset": "firefly", "sprite": "heart"]),
             "ARX_EFFECT_UNSUPPORTED /effects/0/preset"),
            ("a drifted rotation is not reported for a dropped effect",
             effect(["preset": "firefly", "transform": ["rotation": [0, 0, 0.1, 1]]]),
             "ARX_EFFECT_UNSUPPORTED /effects/0/preset"),
            ("schema errors in schema property order",
             effect(["colors": ["#FFF"], "amount": 9, "transform": ["scale": [0, 1, 1], "position": [0, 0]]]),
             "ARX_EFFECT_INVALID /effects/0/transform/position"),
            ("an effect-level schema error before its fields", effect(["amount": 9, "opacity": 1]),
             "ARX_EFFECT_INVALID /effects/0"),
        ]
    }

    @Test(arguments: firstProblems.indices)
    func reportsTheFirstProblem(index: Int) throws {
        let (label, bad, expected) = Self.firstProblems[index]
        let parts = expected.split(separator: " ")
        let result = try Self.check(Self.withEffects(bad))
        #expect(result.valid, "\(label)")
        #expect(result.issues == ["warning \(parts[0]) \(Self.root)\(parts[1])"], "\(label)")
        #expect(result.effectIds == [], "\(label)")
    }

    // MARK: rotation drift

    static func expectNormalized(_ actual: Quat?, _ authored: [Double]) {
        let length = authored.map { $0 * $0 }.reduce(0, +).squareRoot()
        let values = [actual?.x, actual?.y, actual?.z, actual?.w].compactMap { $0 }
        #expect(values.count == 4)
        for (value, want) in zip(values, authored) { #expect(abs(value - want / length) < 1e-12) }
        #expect(abs((actual?.norm ?? 0) - 1) < 1e-12)
    }

    @Test func normalizesADriftedRotationAndWarns() throws {
        let result = try Self.check(Self.withEffects(Self.effect(["transform": ["rotation": [0, 0, 0.1, 1]]])))
        #expect(result.valid)
        #expect(result.issues == ["warning ARX_QUATERNION_DRIFT \(Self.root)/effects/0/transform/rotation"])
        Self.expectNormalized(result.manifest?.effects.first?.transform.rotation, [0, 0, 0.1, 1])
    }

    @Test func normalizesWithoutAWarningBelowTheAuthoringTolerance() throws {
        let result = try Self.check(Self.withEffects(Self.effect(["transform": ["rotation": [0, 0, 0.01, 1]]])))
        #expect(result.issues == [])
        Self.expectNormalized(result.manifest?.effects.first?.transform.rotation, [0, 0, 0.01, 1])
    }

    // MARK: when effects are not read

    static var badData: Json {
        [
            "effects": (0...EffectConstants.maxEffects).map { _ in effect(["preset": "firefly"]) },
        ]
    }

    @Test func onlyWarnsUndeclaredWhenExtensionsUsedLacksArxEffects() throws {
        var input = Self.manifest(Self.badData)
        input["extensionsUsed"] = nil
        let result = try Self.check(input)
        #expect(result.valid)
        #expect(result.issues == ["warning ARX_EXTENSION_UNDECLARED \(Self.root)"])
        #expect(result.effectIds == [])
    }

    static let notReadingOptions: [(String, ArxValidationOptions)] = [
        ("no options (an implementation without ARX_effects support)", ArxValidationOptions()),
        ("another supported extension", ArxValidationOptions(supportedExtensions: ["ARX_other"])),
    ]

    @Test(arguments: notReadingOptions.indices)
    func ignoresGoodAndBadEffectDataWithZeroWarnings(index: Int) throws {
        let (label, options) = Self.notReadingOptions[index]
        for input in [Self.withEffects(Self.effect()), Self.manifest(Self.badData), Self.manifest("not an object")] {
            let result = try Self.check(input, options: options)
            #expect(result.issues == [], "\(label)")
            #expect(result.manifest?.effects == [], "\(label)")
            #expect(result.layerIds == ["planet"], "\(label)")
        }
    }
}
