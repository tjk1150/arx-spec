import CryptoKit
import Foundation

/// SHA-256 digests for asset integrity (spec 8.2) and content-addressed cache names.
public enum ArxIntegrity {
    /// Subresource-Integrity style digest: `sha256-<base64>`.
    public static func sha256(_ data: Data) -> String {
        "sha256-" + Data(SHA256.hash(data: data)).base64EncodedString()
    }

    /// Lowercase hex digest, used for cache file names.
    public static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
