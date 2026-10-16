import Foundation

/// Base URL for manifests read from a local directory or a `.arx` package.
public enum ArxLocal {
    public static let manifestURL = URL(string: "arx-package://root/manifest.json")!
    public static let origin = "arx-package://root/"

    /// Maps an `arx-package://root/...` URL to its relative path, or nil for other URLs.
    public static func relativePath(_ url: URL) -> String? {
        let string = url.absoluteString
        guard string.hasPrefix(origin) else { return nil }
        return String(string.dropFirst(origin.count)).removingPercentEncoding
    }
}

/// Reads bytes for an absolute URL; nil when missing or unreachable.
public typealias ArxFetcher = @Sendable (URL) async -> Data?

/// HTTPS downloads under the ARX URI policy (spec 7), through `ArxHTTPTransport`:
/// every redirect hop is checked before it is followed, so a redirect cannot reach a
/// private host, and a body larger than `maxBytes` is abandoned as soon as it is.
public enum ArxHTTP {
    /// Per-file cap; the same as the default package limit on total uncompressed bytes.
    public static let defaultMaxBytes: Int64 = 1 << 30

    public static func fetcher(
        policy: ArxUriPolicy = ArxUriPolicy(), session: URLSession = .shared, maxBytes: Int64 = defaultMaxBytes
    ) -> ArxFetcher {
        fetcher(transport: ArxHTTPTransport(policy: policy, session: session), maxBytes: maxBytes)
    }

    /// Adapts a transport to the loader's fetcher; any failure reads as a missing file.
    public static func fetcher(transport: any ArxTransport, maxBytes: Int64 = defaultMaxBytes) -> ArxFetcher {
        { url in try? await transport.get(url, maxBytes: maxBytes, progress: { _, _ in }).data }
    }
}

/// Where a manifest and its assets come from (spec 9.1).
public protocol ArxAssetSource: Sendable {
    var manifestURL: URL { get }
    func read(_ url: URL) async -> Data?
}

/// A manifest served over HTTPS; relative assets resolve against its URL.
public struct ArxRemoteSource: ArxAssetSource {
    public let manifestURL: URL
    private let fetcher: ArxFetcher

    public init(manifestURL: URL, fetcher: @escaping ArxFetcher = ArxHTTP.fetcher()) {
        self.manifestURL = manifestURL
        self.fetcher = fetcher
    }

    public func read(_ url: URL) async -> Data? { await fetcher(url) }
}

/// A local manifest (directory or package). Local paths go to `readLocal`,
/// absolute HTTPS assets to `fetcher`.
public struct ArxLocalSource: ArxAssetSource {
    public let manifestURL = ArxLocal.manifestURL
    private let readLocal: @Sendable (String) async -> Data?
    private let fetcher: ArxFetcher

    public init(readLocal: @escaping @Sendable (String) async -> Data?, fetcher: @escaping ArxFetcher = ArxHTTP.fetcher()) {
        self.readLocal = readLocal
        self.fetcher = fetcher
    }

    public func read(_ url: URL) async -> Data? {
        if let path = ArxLocal.relativePath(url) { return await readLocal(path) }
        return await fetcher(url)
    }

    /// A manifest.json directory; reads never leave `directory`.
    public static func directory(_ directory: URL, fetcher: @escaping ArxFetcher = ArxHTTP.fetcher()) -> ArxLocalSource {
        let root = directory.standardizedFileURL.resolvingSymlinksInPath()
        return ArxLocalSource(
            readLocal: { relative in
                let file = root.appendingPathComponent(relative).standardizedFileURL.resolvingSymlinksInPath()
                guard file.path == root.path || file.path.hasPrefix(root.path + "/") else { return nil }
                return try? Data(contentsOf: file)
            },
            fetcher: fetcher)
    }
}
