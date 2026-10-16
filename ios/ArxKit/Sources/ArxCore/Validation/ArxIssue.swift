/// Portable ARX 0.1 issue codes (spec 13). The raw values match the TypeScript
/// validator exactly, so fixtures assert the same codes on every platform.
public enum ArxIssueCode: String, Sendable, CaseIterable {
    // Errors
    case jsonParse = "ARX_JSON_PARSE"
    case specVersion = "ARX_SPEC_VERSION"
    case schema = "ARX_SCHEMA"
    case duplicateLayerId = "ARX_DUPLICATE_LAYER_ID"
    case quaternionNotUnit = "ARX_QUATERNION_NOT_UNIT"
    case extensionNotDeclared = "ARX_EXTENSION_NOT_DECLARED"
    case extensionUnsupported = "ARX_EXTENSION_UNSUPPORTED"
    case uriScheme = "ARX_URI_SCHEME"
    case uriPath = "ARX_URI_PATH"
    case uriCredentials = "ARX_URI_CREDENTIALS"
    case uriPrivateNetwork = "ARX_URI_PRIVATE_NETWORK"
    case assetMissing = "ARX_ASSET_MISSING"
    case assetDecode = "ARX_ASSET_DECODE"
    case integrityMismatch = "ARX_INTEGRITY_MISMATCH"
    case videoCodec = "ARX_VIDEO_CODEC"
    case videoPixelFormat = "ARX_VIDEO_PIXEL_FORMAT"
    case audioCodec = "ARX_AUDIO_CODEC"
    case packagePath = "ARX_PACKAGE_PATH"
    case packageLimit = "ARX_PACKAGE_LIMIT"
    case packageCorrupt = "ARX_PACKAGE_CORRUPT"
    case packageUnsupported = "ARX_PACKAGE_UNSUPPORTED"
    case packageManifestMissing = "ARX_PACKAGE_MANIFEST_MISSING"
    // Warnings
    case quaternionDrift = "ARX_QUATERNION_DRIFT"
    case extensionUndeclared = "ARX_EXTENSION_UNDECLARED"
    case targetLowResolution = "ARX_TARGET_LOW_RESOLUTION"
    case targetAlpha = "ARX_TARGET_ALPHA"
    case imageOrientation = "ARX_IMAGE_ORIENTATION"
    case assetTypeMismatch = "ARX_ASSET_TYPE_MISMATCH"
    case videoNotFaststart = "ARX_VIDEO_NOT_FASTSTART"
    case videoProfile = "ARX_VIDEO_PROFILE"
    case videoResolution = "ARX_VIDEO_RESOLUTION"
    case videoFrameRate = "ARX_VIDEO_FRAME_RATE"
    case videoBitrate = "ARX_VIDEO_BITRATE"
    case videoRotation = "ARX_VIDEO_ROTATION"
    case packageUnexpectedFile = "ARX_PACKAGE_UNEXPECTED_FILE"
    // Warnings of the ARX_effects extension (spec/extensions/ARX_effects.md 9)
    case effectInvalid = "ARX_EFFECT_INVALID"
    case effectUnsupported = "ARX_EFFECT_UNSUPPORTED"
}

public struct ArxIssue: Error, Sendable, Equatable, CustomStringConvertible {
    public enum Severity: String, Sendable {
        case error
        case warning
    }

    public let code: ArxIssueCode
    public let severity: Severity
    /// JSON Pointer into the manifest, or `zip:<entry>` for package entries.
    public let path: String
    public let message: String

    public init(code: ArxIssueCode, severity: Severity, path: String, message: String) {
        self.code = code
        self.severity = severity
        self.path = path
        self.message = message
    }

    public static func error(_ code: ArxIssueCode, _ path: String, _ message: String) -> ArxIssue {
        ArxIssue(code: code, severity: .error, path: path, message: message)
    }

    public static func warning(_ code: ArxIssueCode, _ path: String, _ message: String) -> ArxIssue {
        ArxIssue(code: code, severity: .warning, path: path, message: message)
    }

    public var description: String { "\(severity.rawValue) \(code.rawValue) \(path): \(message)" }
}

extension Array where Element == ArxIssue {
    public var hasErrors: Bool { contains { $0.severity == .error } }
}
