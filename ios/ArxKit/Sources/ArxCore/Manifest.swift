/// ARX 0.1 manifest as authored. Validation beyond decoding lives in the
/// validator (item 5); this model is enough to load trusted fixtures.
public struct ArxManifest: Codable, Sendable {
    public let spec: String
    public let id: String?
    public let title: String?
    public let anchor: Anchor
    public let layers: [Layer]

    public struct Anchor: Codable, Sendable {
        public let type: String
        public let src: String
        public let physicalWidth: Double?
        public let integrity: String?
    }

    public enum LayerType: String, Codable, Sendable {
        case image
        case video
    }

    public struct Layer: Codable, Sendable {
        public let id: String
        public let type: LayerType
        public let src: String
        public let integrity: String?
        public let transform: TransformInput?
        public let autoplay: Bool?
        public let loop: Bool?
    }

    public struct TransformInput: Codable, Sendable {
        public let position: [Double]?
        public let rotation: [Double]?
        public let scale: [Double]?
    }
}
