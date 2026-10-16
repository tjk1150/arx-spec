import Foundation

/// Options shared by manifest and experience validation.
public struct ArxValidationOptions: Sendable {
    public var uriPolicy: ArxUriPolicy
    /// Extension names this implementation understands.
    public var supportedExtensions: Set<String>
    /// Treat Portable Video Profile deviations as errors (publish-time strict mode).
    public var strictVideoProfile: Bool
    /// ARX_effects preset table; nil (unreadable) drops every effect with ARX_EFFECT_UNSUPPORTED.
    public var effectPresets: EffectPresetTable?

    public init(
        uriPolicy: ArxUriPolicy = ArxUriPolicy(), supportedExtensions: Set<String> = [], strictVideoProfile: Bool = false,
        effectPresets: EffectPresetTable? = EffectPresets.bundled
    ) {
        self.uriPolicy = uriPolicy
        self.supportedExtensions = supportedExtensions
        self.strictVideoProfile = strictVideoProfile
        self.effectPresets = effectPresets
    }
}

/// A manifest after validation: defaults applied, rotations normalized, sources resolved.
public struct ArxResolvedManifest: Sendable {
    public struct Anchor: Sendable {
        public let url: URL
        public let physicalWidth: Double?
        public let integrity: String?
    }

    public struct Layer: Sendable {
        public let id: String
        public let type: ArxManifest.LayerType
        public let url: URL
        public let integrity: String?
        public let transform: ArxTransform
        public let playback: Playback?
    }

    public let id: String?
    public let title: String?
    public let anchor: Anchor
    public let layers: [Layer]
    /// Kept ARX_effects effects; empty when the extension is not read (spec/extensions/ARX_effects.md 4.3).
    public let effects: [ArxEffect]
    public let extensionsUsed: [String]
    public let extensionsRequired: [String]
}

/// Schema and semantic validation (spec 5), ported from packages/arx-core/src/semantic.ts.
public enum ArxManifestValidator {
    /// |norm(q) - 1| above this is invalid (OpenXR pose rule).
    public static let quaternionTolerance = 0.01
    /// Authoring tools should flag drift above this.
    public static let quaternionAuthoringTolerance = 1e-4

    public static func validate(
        _ bytes: Data, manifestURL: URL, options: ArxValidationOptions = ArxValidationOptions()
    ) -> (issues: [ArxIssue], manifest: ArxResolvedManifest?) {
        let data = withoutByteOrderMark(bytes)
        guard let raw = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else {
            return ([.error(.jsonParse, "", "manifest is not valid JSON")], nil)
        }
        if let object = raw as? [String: Any], let spec = object["spec"] as? String, spec != ArxSpec.version {
            return ([.error(.specVersion, "/spec", "unsupported spec version \(spec)")], nil)
        }
        let schemaIssues = ArxSchema.check(String(decoding: data, as: UTF8.self))
        guard schemaIssues.isEmpty, let object = raw as? [String: Any],
              let manifest = try? JSONDecoder().decode(ArxManifest.self, from: data)
        else { return (schemaIssues.isEmpty ? [.error(.schema, "/", "manifest does not decode")] : schemaIssues, nil) }

        var issues = checkExtensions(object, options: options)
        var seen = Set<String>()
        for (index, layer) in manifest.layers.enumerated() {
            if !seen.insert(layer.id).inserted {
                issues.append(.error(.duplicateLayerId, "/layers/\(index)/id", "duplicate layer id \(layer.id)"))
            }
        }

        func resolve(_ src: String, _ path: String) -> URL? {
            switch ArxUri.resolve(src, manifestURL: manifestURL, path: path, policy: options.uriPolicy) {
            case .success(let url): return url
            case .failure(let issue):
                issues.append(issue)
                return nil
            }
        }

        let anchorURL = resolve(manifest.anchor.src, "/anchor/src")
        var layers: [ArxResolvedManifest.Layer] = []
        for (index, layer) in manifest.layers.enumerated() {
            let url = resolve(layer.src, "/layers/\(index)/src")
            checkRotation(layer.transform?.rotation, path: "/layers/\(index)/transform/rotation", issues: &issues)
            if let url {
                layers.append(ArxResolvedManifest.Layer(
                    id: layer.id, type: layer.type, url: url, integrity: layer.integrity,
                    transform: ArxTransform(layer.transform),
                    playback: layer.type == .video
                        ? Playback(autoplay: layer.autoplay ?? false, loop: layer.loop ?? false) : nil))
            }
        }

        let effectStage = ArxEffectsValidator.validate(data, layerIds: manifest.layers.map(\.id), options: options)
        issues += effectStage.issues

        guard !issues.hasErrors, let anchorURL else { return (issues, nil) }
        let resolved = ArxResolvedManifest(
            id: manifest.id, title: manifest.title,
            anchor: .init(url: anchorURL, physicalWidth: manifest.anchor.physicalWidth, integrity: manifest.anchor.integrity),
            layers: layers,
            effects: effectStage.effects,
            extensionsUsed: object["extensionsUsed"] as? [String] ?? [],
            extensionsRequired: object["extensionsRequired"] as? [String] ?? [])
        return (issues, resolved)
    }

    static func checkRotation(_ rotation: [Double]?, path: String, issues: inout [ArxIssue]) {
        let values = rotation ?? [0, 0, 0, 1]
        let deviation = abs((values.map { $0 * $0 }.reduce(0, +)).squareRoot() - 1)
        if deviation > quaternionTolerance {
            issues.append(.error(.quaternionNotUnit, path, String(format: "|q| deviates from 1 by %.4f", deviation)))
        } else if deviation > quaternionAuthoringTolerance {
            issues.append(.warning(.quaternionDrift, path, String(format: "|q| deviates from 1 by %.6f; normalized", deviation)))
        }
    }

    /// Drops a leading UTF-8 byte order mark, as `TextDecoder` does in the TypeScript validator.
    static func withoutByteOrderMark(_ data: Data) -> Data {
        let mark: [UInt8] = [0xEF, 0xBB, 0xBF]
        return data.starts(with: mark) ? data.dropFirst(mark.count) : data
    }

    static func checkExtensions(_ object: [String: Any], options: ArxValidationOptions) -> [ArxIssue] {
        let used = Set(object["extensionsUsed"] as? [String] ?? [])
        var issues: [ArxIssue] = []
        for (index, name) in (object["extensionsRequired"] as? [String] ?? []).enumerated() {
            let path = "/extensionsRequired/\(index)"
            if !used.contains(name) {
                issues.append(.error(.extensionNotDeclared, path, "\(name) is not in extensionsUsed"))
            } else if !options.supportedExtensions.contains(name) {
                issues.append(.error(.extensionUnsupported, path, "required extension \(name) is not supported"))
            }
        }
        var holders: [(String, Any?)] = [("", object["extensions"]), ("/anchor", (object["anchor"] as? [String: Any])?["extensions"])]
        for (index, layer) in (object["layers"] as? [[String: Any]] ?? []).enumerated() {
            holders.append(("/layers/\(index)", layer["extensions"]))
        }
        for (prefix, extensions) in holders {
            for name in (extensions as? [String: Any])?.keys.sorted() ?? [] where !used.contains(name) {
                issues.append(.warning(.extensionUndeclared, "\(prefix)/extensions/\(name)", "\(name) is not in extensionsUsed"))
            }
        }
        return issues
    }
}
