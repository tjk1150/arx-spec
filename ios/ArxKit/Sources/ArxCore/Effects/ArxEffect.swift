import Foundation

/// An effect after validation (spec/extensions/ARX_effects.md 4.3): defaults filled from the
/// extension and its preset, rotation normalized. Ported from ResolvedEffect in
/// packages/arx-core/src/effects/effects.types.ts.
public struct ArxEffect: Sendable, Equatable {
    public let id: String
    public let preset: String
    /// Birth color, then death color, each `#RRGGBB` (sRGB).
    public let colors: [String]
    public let amount: Double
    /// Particle side in target-width units.
    public let size: Double
    public let speed: Double
    public let sprite: String
    public let transform: ArxTransform

    public init(
        id: String, preset: String, colors: [String], amount: Double, size: Double, speed: Double, sprite: String,
        transform: ArxTransform
    ) {
        self.id = id
        self.preset = preset
        self.colors = colors
        self.amount = amount
        self.size = size
        self.speed = speed
        self.sprite = sprite
        self.transform = transform
    }

    /// Emitter-to-content-root matrix E = T x R x S, column-major.
    public var matrix: [Double] { transform.matrix }
}

/// Effects kept by the effect stage and the warnings for the dropped ones.
public struct ArxEffectsResult: Sendable, Equatable {
    public let effects: [ArxEffect]
    public let issues: [ArxIssue]

    public static let empty = ArxEffectsResult(effects: [], issues: [])
}

/// How a preset emits particles (spec/extensions/ARX_effects.md 7.3).
public struct EffectEmission: Sendable, Equatable, Decodable {
    public enum Kind: String, Sendable, Decodable {
        case continuous
        case burst
    }

    public let kind: Kind
    /// Burst only: length of one emission window, seconds.
    public let emitSeconds: Double?
    /// Burst only: pause after each window, seconds.
    public let pauseSeconds: Double?
}

/// One row of schema/ext/ARX_effects.presets.json. Field meanings: spec section 5.
public struct EffectPreset: Sendable, Equatable, Decodable {
    public let shapeSize: [Double]
    public let direction: [Double]
    public let spreadDegrees: Double
    public let emission: EffectEmission
    public let rate: Double
    public let lifetime: [Double]
    public let speed: Double
    public let speedVariation: Double
    public let acceleration: [Double]
    public let size: Double
    public let sizeVariation: Double
    public let endSizeScale: Double
    public let angleDegrees: [Double]
    public let angularSpeedDegrees: [Double]
    public let alphaCurve: String
    public let sprite: String
}

/// Preset name to preset.
public typealias EffectPresetTable = [String: EffectPreset]

/// The preset file as a whole; only `presets` is read.
struct EffectPresetFile: Decodable {
    let presets: EffectPresetTable
}

/// One `effects[]` entry as authored, read after it passed the extension schema.
struct AuthoredEffect {
    let id: String
    let preset: String
    let colors: [String]
    let amount: Double?
    let size: Double?
    let speed: Double?
    let sprite: String?
    let position: [Double]?
    let rotation: [Double]?
    let scale: [Double]?
}

/// One failing location of the extension schema, relative to the extension object.
struct EffectSchemaFailure {
    /// JSON Pointer, e.g. "/effects/1/amount"; empty for the extension object.
    let pointer: String
    let message: String

    /// Unescaped pointer tokens, e.g. ["effects", "1", "amount"].
    var tokens: [String] {
        pointer.split(separator: "/", omittingEmptySubsequences: false).dropFirst()
            .map { $0.replacingOccurrences(of: "~1", with: "/").replacingOccurrences(of: "~0", with: "~") }
    }

    /// Index of the effect the failure is inside, or nil for a failure of the extension object itself.
    var effectIndex: Int? {
        tokens.count >= 2 && tokens[0] == "effects" ? Int(tokens[1]) : nil
    }
}
