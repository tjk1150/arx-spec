import Foundation
import JSONSchema

/// Effect stage of manifest validation (spec/extensions/ARX_effects.md 4), ported from
/// packages/arx-core/src/effects/validate-effects.ts. Reads `extensions.ARX_effects` only when the
/// implementation supports ARX_effects and the manifest lists it in `extensionsUsed`; an undeclared
/// object is already reported as ARX_EXTENSION_UNDECLARED by the extension check. Bad data never
/// fails the manifest: a bad extension object drops every effect, a bad effect drops only itself,
/// each with one warning (the first problem in the order schema, rotation, id, preset, sprite). A
/// kept effect with a drifted rotation also gets ARX_QUATERNION_DRIFT. Runs after the layers are
/// known, since an effect id must not repeat a layer id.
enum ArxEffectsValidator {
    static func bundledSchemaData() throws -> Data {
        guard let url = Bundle.module.url(forResource: EffectConstants.schemaResource, withExtension: "json") else {
            throw CocoaError(.fileNoSuchFile)
        }
        return try Data(contentsOf: url)
    }

    /// The bundled extension schema, and its raw form with the key order kept.
    static let extensionSchema: (schema: Schema, raw: JSONValue)? = {
        guard let data = try? bundledSchemaData(), let raw = try? JSONValue.parse(data),
              let schema = try? Schema(instance: String(decoding: data, as: UTF8.self))
        else { return nil }
        return (schema, raw)
    }()

    static func validate(_ manifestData: Data, layerIds: [String], options: ArxValidationOptions) -> ArxEffectsResult {
        let name = EffectConstants.extensionName
        guard options.supportedExtensions.contains(name),
              let manifest = (try? JSONValue.parse(manifestData))?.object,
              manifest["extensionsUsed"]?.array?.contains(where: { $0.string == name }) == true,
              let data = manifest["extensions"]?.object?[name]
        else { return .empty }

        let root = EffectConstants.extensionPointer
        guard let presets = options.effectPresets, let extensionSchema else {
            return ArxEffectsResult(effects: [], issues: [
                .warning(.effectUnsupported, root, "the effect presets or schema could not be read; every effect dropped"),
            ])
        }
        let failures = schemaFailures(extensionSchema.schema.validate(data))
        if let rootFailure = failures.first(where: { $0.effectIndex == nil }) {
            return ArxEffectsResult(effects: [], issues: [
                .warning(.effectInvalid, root, "\(rootFailure.message); every effect dropped"),
            ])
        }
        let firstFailures = firstFailurePerEffect(failures, schema: extensionSchema.raw)

        var effects: [ArxEffect] = []
        var issues: [ArxIssue] = []
        for (index, value) in (data.object?["effects"]?.array ?? []).enumerated() {
            let pointer = "\(root)/effects/\(index)"
            if let failure = firstFailures[index] {
                issues.append(.warning(.effectInvalid, root + failure.pointer, "\(failure.message); effect dropped"))
                continue
            }
            guard let effect = authored(value) else {
                issues.append(.warning(.effectInvalid, pointer, "effect does not decode; effect dropped"))
                continue
            }
            let takenIds = Set(layerIds + effects.map(\.id))
            if let reason = dropReason(effect, pointer: pointer, takenIds: takenIds, presets: presets) {
                issues.append(reason)
                continue
            }
            issues += driftIssues(effect, pointer: pointer)
            if let preset = presets[effect.preset] { effects.append(resolve(effect, preset: preset)) }
        }
        return ArxEffectsResult(effects: effects, issues: issues)
    }

    // MARK: schema failures

    /// Failing instance locations: leaf errors, and `additionalProperties` at the object that has the
    /// unknown field (where Ajv reports it). An invalid result without a leaf fails the extension object.
    static func schemaFailures(_ result: ValidationResult) -> [EffectSchemaFailure] {
        guard !result.isValid else { return [] }
        func collect(_ errors: [ValidationError]) -> [EffectSchemaFailure] {
            errors.flatMap { detail -> [EffectSchemaFailure] in
                let children = detail.errors ?? []
                guard detail.keyword != "additionalProperties", !children.isEmpty else {
                    return [EffectSchemaFailure(
                        pointer: detail.instanceLocation.jsonPointerString,
                        message: "\(detail.message) (\(detail.keywordLocation.jsonPointerString))")]
                }
                return collect(children)
            }
        }
        let failures = collect(result.errors ?? [])
        return failures.isEmpty ? [EffectSchemaFailure(pointer: "", message: "invalid")] : failures
    }

    /// The failure Ajv reports first for each effect. Ajv checks an object's own keywords (type,
    /// required, additionalProperties) before its properties, in schema property order, and an
    /// array's own keywords before its items, in index order; so the first failure is the one whose
    /// location comes first in that walk of the schema.
    static func firstFailurePerEffect(_ failures: [EffectSchemaFailure], schema: JSONValue) -> [Int: EffectSchemaFailure] {
        var first: [Int: (key: [Int], failure: EffectSchemaFailure)] = [:]
        for failure in failures {
            guard let index = failure.effectIndex else { continue }
            let key = orderKey(failure.tokens.dropFirst(2), schema: schema)
            if let kept = first[index], !key.lexicographicallyPrecedes(kept.key) { continue }
            first[index] = (key, failure)
        }
        return first.mapValues(\.failure)
    }

    /// Position of each pointer token in the schema: property order for object fields, the index for
    /// array items, after the end for anything the schema does not name.
    static func orderKey(_ tokens: ArraySlice<String>, schema: JSONValue) -> [Int] {
        let definitions = schema.object?["$defs"]?.object
        func dereferenced(_ node: JSONValue?) -> JSONValue? {
            guard let reference = node?.object?["$ref"]?.string, reference.hasPrefix("#/$defs/") else { return node }
            return definitions?[String(reference.dropFirst("#/$defs/".count))]
        }
        var node = definitions?["effect"]
        var key: [Int] = []
        for token in tokens {
            let current = dereferenced(node)?.object
            if let properties = current?["properties"]?.object, let position = properties.index(forKey: token) {
                key.append(position)
                node = properties.values[position]
            } else if let index = Int(token) {
                key.append(index)
                let prefix = current?["prefixItems"]?.array ?? []
                node = index < prefix.count ? prefix[index] : current?["items"]
            } else {
                key.append(Int.max)
                node = nil
            }
        }
        return key
    }

    // MARK: checks after the schema

    static func authored(_ value: JSONValue) -> AuthoredEffect? {
        guard let object = value.object, let id = object["id"]?.string, let preset = object["preset"]?.string,
              let colors = object["colors"]?.array?.compactMap(\.string)
        else { return nil }
        let transform = object["transform"]?.object
        func numbers(_ field: JSONValue?) -> [Double]? { field?.array?.compactMap(\.number) }
        return AuthoredEffect(
            id: id, preset: preset, colors: colors,
            amount: object["amount"]?.number, size: object["size"]?.number, speed: object["speed"]?.number,
            sprite: object["sprite"]?.string,
            position: numbers(transform?["position"]), rotation: numbers(transform?["rotation"]),
            scale: numbers(transform?["scale"]))
    }

    static func rotationDeviation(_ effect: AuthoredEffect) -> Double {
        guard let rotation = effect.rotation else { return 0 }
        return abs(rotation.map { $0 * $0 }.reduce(0, +).squareRoot() - 1)
    }

    /// The first problem that drops a schema-valid effect, in the spec order after the schema:
    /// rotation, id, preset, sprite (spec/extensions/ARX_effects.md 4.2).
    static func dropReason(
        _ effect: AuthoredEffect, pointer: String, takenIds: Set<String>, presets: EffectPresetTable
    ) -> ArxIssue? {
        let deviation = rotationDeviation(effect)
        if deviation > ArxManifestValidator.quaternionTolerance {
            return .warning(.effectInvalid, "\(pointer)/transform/rotation",
                            String(format: "|q| deviates from 1 by %.4f; effect dropped", deviation))
        }
        if takenIds.contains(effect.id) {
            return .warning(.effectInvalid, "\(pointer)/id", "id \(effect.id) is already a layer or effect id; effect dropped")
        }
        if presets[effect.preset] == nil {
            return .warning(.effectUnsupported, "\(pointer)/preset", "unknown preset \(effect.preset); effect dropped")
        }
        if let sprite = effect.sprite, !EffectConstants.sprites.contains(sprite) {
            return .warning(.effectUnsupported, "\(pointer)/sprite", "unknown sprite \(sprite); effect dropped")
        }
        return nil
    }

    /// ARX_QUATERNION_DRIFT for a kept effect whose rotation is normalized on resolution.
    static func driftIssues(_ effect: AuthoredEffect, pointer: String) -> [ArxIssue] {
        let deviation = rotationDeviation(effect)
        guard deviation > ArxManifestValidator.quaternionAuthoringTolerance else { return [] }
        return [.warning(.quaternionDrift, "\(pointer)/transform/rotation",
                         String(format: "|q| deviates from 1 by %.6f; normalized", deviation))]
    }

    /// Fills the defaults (amount, speed, and the preset's size and sprite) and normalizes the
    /// rotation (spec/extensions/ARX_effects.md 4.3), as resolveEffect does in TypeScript.
    static func resolve(_ effect: AuthoredEffect, preset: EffectPreset) -> ArxEffect {
        let position = effect.position ?? [0, 0, 0]
        let rotation = effect.rotation ?? [0, 0, 0, 1]
        let scale = effect.scale ?? [1, 1, 1]
        let quat = Quat(x: rotation[0], y: rotation[1], z: rotation[2], w: rotation[3])
        let transform = ArxTransform(
            position: Vec3(x: position[0], y: position[1], z: position[2]),
            rotation: rotationDeviation(effect) == 0 ? quat : quat.normalized,
            scale: Vec3(x: scale[0], y: scale[1], z: scale[2]))
        return ArxEffect(
            id: effect.id, preset: effect.preset, colors: effect.colors,
            amount: effect.amount ?? EffectConstants.defaultAmount, size: effect.size ?? preset.size,
            speed: effect.speed ?? EffectConstants.defaultSpeed, sprite: effect.sprite ?? preset.sprite,
            transform: transform)
    }
}
