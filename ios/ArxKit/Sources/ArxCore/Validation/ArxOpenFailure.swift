import Foundation

/// Outcomes of opening a work that are not about its content (spec 9.1, "open" step).
/// The raw values are shared with the Kotlin core.
public enum ArxViewerCode: String, Sendable, CaseIterable {
    /// The input is not an ARX link, manifest or package.
    case notArx = "VIEWER_NOT_ARX"
    /// The scanned or tapped text is longer than the link length limit.
    case linkTooLong = "VIEWER_LINK_TOO_LONG"
    /// The network or file read failed (unreachable, non-2xx status, refused certificate).
    case downloadFailed = "VIEWER_DOWNLOAD_FAILED"
    /// The body is larger than the download cap.
    case downloadTooLarge = "VIEWER_DOWNLOAD_TOO_LARGE"
    /// The surrounding task was cancelled.
    case cancelled = "VIEWER_CANCELLED"
    /// A video layer failed to play; reported apart from tracking (spec 9.3). Raised by the app, not the opener.
    case playbackFailed = "VIEWER_PLAYBACK_FAILED"
    /// The tracker refused the target image (too little detail). Raised by the app, not the opener.
    case targetUnusable = "VIEWER_TARGET_UNUSABLE"
    /// Any failure without a more specific code. Raised by the app, not the opener.
    case unknown = "VIEWER_UNKNOWN"
    /// The bundle of works breaks a format, id, path or origin rule.
    case exhibitionInvalid = "VIEWER_EXHIBITION_INVALID"
    /// The bundle `spec` is not one this app reads; the app needs an update.
    case exhibitionUnsupported = "VIEWER_EXHIBITION_UNSUPPORTED"
    /// The bundle holds more works than the app opens.
    case exhibitionTooLarge = "VIEWER_EXHIBITION_TOO_LARGE"
    /// A first open found no work or no usable target.
    case exhibitionEmpty = "VIEWER_EXHIBITION_EMPTY"
    /// The bundle of works was taken down.
    case exhibitionClosed = "VIEWER_EXHIBITION_CLOSED"
}

/// Why a link could not be opened.
///
/// `code` is either an `ArxViewerCode` raw value or an `ArxIssueCode` raw value.
/// When the work itself is invalid, `issues` carries every validation issue and
/// `code` is the first error's code.
public struct ArxOpenFailure: Error, Sendable, Equatable, CustomStringConvertible {
    public let code: String
    public let issues: [ArxIssue]
    public let message: String

    public init(code: String, issues: [ArxIssue] = [], message: String = "") {
        self.code = code
        self.issues = issues
        self.message = message
    }

    public init(_ code: ArxViewerCode, _ message: String = "", issues: [ArxIssue] = []) {
        self.init(code: code.rawValue, issues: issues, message: message)
    }

    /// A single policy issue, such as a link or redirect the URI policy refuses.
    public init(issue: ArxIssue) {
        self.init(code: issue.code.rawValue, issues: [issue], message: issue.message)
    }

    /// Validation issues of an invalid work; the code is the first error's code.
    public init(validation issues: [ArxIssue]) {
        let first = issues.first { $0.severity == .error } ?? issues.first
        self.init(
            code: first?.code.rawValue ?? ArxIssueCode.assetMissing.rawValue, issues: issues,
            message: first?.message ?? "the work is invalid")
    }

    /// The `ArxViewerCode`, or nil when `code` is a validation code.
    public var viewerCode: ArxViewerCode? { ArxViewerCode(rawValue: code) }

    public var description: String {
        let head = message.isEmpty ? code : "\(code): \(message)"
        return ([head] + issues.map(\.description)).joined(separator: "\n")
    }
}
