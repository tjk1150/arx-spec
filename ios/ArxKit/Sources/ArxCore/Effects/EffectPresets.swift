import Foundation

/// The preset table, read from the bundled copy of schema/ext/ARX_effects.presets.json
/// (a test keeps the two identical). The viewer's external boundary for presets.
public enum EffectPresets {
    /// Reads a preset file, or nil when it is missing or does not decode.
    public static func load(from url: URL?) -> EffectPresetTable? {
        guard let url, let data = try? Data(contentsOf: url),
              let file = try? JSONDecoder().decode(EffectPresetFile.self, from: data),
              !file.presets.isEmpty
        else { return nil }
        return file.presets
    }

    static func bundledData() throws -> Data {
        guard let url = bundledURL else { throw CocoaError(.fileNoSuchFile) }
        return try Data(contentsOf: url)
    }

    static var bundledURL: URL? {
        Bundle.module.url(forResource: EffectConstants.presetsResource, withExtension: "json")
    }

    /// The bundled table, or nil when it cannot be read (every effect is then dropped).
    public static let bundled: EffectPresetTable? = load(from: bundledURL)
}
