import Foundation

public struct Playback: Sendable, Equatable, Codable {
    public let autoplay: Bool
    public let loop: Bool

    public init(autoplay: Bool, loop: Bool) {
        self.autoplay = autoplay
        self.loop = loop
    }
}

/// A loaded experience: resolved asset URLs, media sizes and layer geometry.
public struct ArxExperience: Sendable {
    public struct Target: Sendable {
        /// Local file with the validated bytes (what renders).
        public let url: URL
        /// Where the manifest pointed (resolved against the manifest URL).
        public let sourceURL: URL
        /// Always [1, height / width] in target-width units.
        public let size: Vec2
        public let pixelWidth: Double
        public let pixelHeight: Double
        /// Meters per unit when the author supplied it.
        public let physicalWidth: Double?
    }

    public struct Layer: Sendable {
        public let id: String
        public let type: ArxManifest.LayerType
        /// Local file with the validated bytes (what renders).
        public let url: URL
        /// Where the manifest pointed (resolved against the manifest URL).
        public let sourceURL: URL
        public let size: Vec2
        public let transform: ArxTransform
        public let playback: Playback?

        /// Layer-to-content-root matrix, column-major.
        public var matrix: [Double] { transform.matrix }
    }

    public let manifest: ArxManifest
    public let target: Target
    public let layers: [Layer]
    /// Kept ARX_effects effects in authored order; empty when the extension is absent or not read.
    public let effects: [ArxEffect]

    init(manifest: ArxManifest, target: Target, layers: [Layer], effects: [ArxEffect] = []) {
        self.manifest = manifest
        self.target = target
        self.layers = layers
        self.effects = effects
    }
}
