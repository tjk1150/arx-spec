import Foundation

/// Constants of the ARX_effects extension (spec/extensions/ARX_effects.md), the same values as
/// packages/arx-core/src/effects/effects.constants.ts. Tests tie them to the root extension schema.
public enum EffectConstants {
    /// Extension name in `extensionsUsed` and the `extensions` key.
    public static let extensionName = "ARX_effects"
    /// JSON Pointer of the extension object in a manifest.
    public static let extensionPointer = "/extensions/ARX_effects"
    /// Most effects per manifest; the extension schema's `effects.maxItems`.
    public static let maxEffects = 8
    /// Default `amount` and `speed` multipliers.
    public static let defaultAmount = 1.0
    public static let defaultSpeed = 1.0
    /// Built-in sprites, one PNG each under schema/ext/sprites/.
    public static let sprites: [String] = ["dot", "soft", "star", "glow-star"]
    /// Bundled copies of schema/ext/ARX_effects.schema.json and ARX_effects.presets.json.
    static let schemaResource = "ARX_effects.schema"
    static let presetsResource = "ARX_effects.presets"
}
