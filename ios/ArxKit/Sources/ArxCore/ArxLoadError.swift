import Foundation

/// Runtime failures after validation (validation itself reports ArxIssue values).
public enum ArxLoadError: Error, Equatable, CustomStringConvertible {
    case unreadableImage(String)

    public var description: String {
        switch self {
        case .unreadableImage(let name): "cannot decode image \(name)"
        }
    }
}
