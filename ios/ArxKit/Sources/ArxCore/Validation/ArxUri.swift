import Foundation

/// Remote-asset policy switches (spec 7).
public struct ArxUriPolicy: Sendable {
    /// Development only: permit http://localhost, 127.0.0.1 and [::1].
    public var allowInsecureLocalhost: Bool
    /// Enterprise deployments only: permit loopback and private addresses.
    public var allowPrivateNetwork: Bool

    public init(allowInsecureLocalhost: Bool = false, allowPrivateNetwork: Bool = false) {
        self.allowInsecureLocalhost = allowInsecureLocalhost
        self.allowPrivateNetwork = allowPrivateNetwork
    }
}

/// URI policy and resolution, ported from packages/arx-core/src/uri.ts.
public enum ArxUri {
    private static let loopbackHosts: Set<String> = ["localhost", "127.0.0.1", "::1", "[::1]"]

    /// Resolves `src` against the manifest URL after applying the policy.
    public static func resolve(
        _ src: String, manifestURL: URL, path: String, policy: ArxUriPolicy = ArxUriPolicy()
    ) -> Result<URL, ArxIssue> {
        if hasScheme(src) {
            guard let url = URL(string: src) else {
                return .failure(.error(.uriScheme, path, "unparseable URL: \(src)"))
            }
            if let issue = checkAbsolute(url, path: path, policy: policy) { return .failure(issue) }
            return .success(url)
        }
        if let issue = checkRelativePath(src, path: path) { return .failure(issue) }
        guard let url = URL(string: src, relativeTo: manifestURL)?.absoluteURL else {
            return .failure(.error(.uriPath, path, "cannot resolve \(src)"))
        }
        if ArxLocal.relativePath(url) == nil, let issue = checkAbsolute(url, path: path, policy: policy) {
            return .failure(issue)
        }
        return .success(url)
    }

    /// Checks an absolute URL against the remote-asset policy (also used after redirects).
    public static func checkAbsolute(_ url: URL, path: String, policy: ArxUriPolicy = ArxUriPolicy()) -> ArxIssue? {
        let scheme = url.scheme?.lowercased() ?? ""
        let host = (url.host(percentEncoded: false) ?? "").lowercased()
        if scheme == "http" {
            guard policy.allowInsecureLocalhost && loopbackHosts.contains(host) else {
                return .error(.uriScheme, path, "http is not allowed: \(url.absoluteString)")
            }
        } else if scheme != "https" {
            return .error(.uriScheme, path, "scheme \(scheme): is not allowed")
        }
        // "https:host" and "https:///host" parse without a host (fixture N018).
        if host.isEmpty { return .error(.uriScheme, path, "URL has no host: \(url.absoluteString)") }
        if url.user != nil || url.password != nil {
            return .error(.uriCredentials, path, "URLs must not embed credentials")
        }
        if !policy.allowPrivateNetwork && isPrivateHost(host) {
            return .error(.uriPrivateNetwork, path, "private or loopback host: \(host)")
        }
        return nil
    }

    /// True for hosts an untrusted manifest must not reach (loopback, private, link-local, CGNAT).
    /// Numeric spellings a URL parser normalizes (`127.1`, `2130706433`, `0x7f.0.0.1`,
    /// `[0:0:0:0:0:0:0:1]`) and the fully qualified `localhost.` count too (fixture N017).
    public static func isPrivateHost(_ hostname: String) -> Bool {
        var host = hostname.lowercased()
        if host.hasSuffix(".") { host.removeLast() }
        if host == "localhost" || host.hasSuffix(".localhost") { return true }
        if host.hasPrefix("[") && host.hasSuffix("]") { host = String(host.dropFirst().dropLast()) }
        if host.contains(":") { return isPrivateIPv6(host) }
        if let octets = IpAddress.parseIPv4(host) { return isPrivateIPv4(octets) }
        // A numeric host that is not a valid IPv4 address (e.g. 999.1.1.1) is refused, not guessed at.
        return IpAddress.looksNumeric(host)
    }

    static func hasScheme(_ src: String) -> Bool {
        guard let colon = src.firstIndex(of: ":") else { return false }
        let scheme = src[src.startIndex..<colon]
        guard let first = scheme.first, first.isASCII, first.isLetter else { return false }
        return scheme.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || "+.-".contains($0)) }
    }

    static func checkRelativePath(_ src: String, path: String) -> ArxIssue? {
        func reject(_ reason: String) -> ArxIssue { .error(.uriPath, path, "\(reason): \(src)") }
        if src.hasPrefix("/") { return reject("relative src must not start with '/'") }
        if src.contains("\\") { return reject("backslash is not a path separator") }
        if src.contains("?") || src.contains("#") { return reject("relative src must not contain a query or fragment") }
        let segments = src.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        if segments.contains(where: { ($0.removingPercentEncoding ?? $0) == ".." }) {
            return reject("'..' segments are not allowed")
        }
        if segments.contains(where: \.isEmpty) { return reject("empty path segment") }
        return nil
    }

    static func isPrivateIPv4(_ octets: [Int]) -> Bool {
        let (first, second) = (octets[0], octets[1])
        return first == 0 || first == 10 || first == 127
            || (first == 100 && (64...127).contains(second))
            || (first == 169 && second == 254)
            || (first == 172 && (16...31).contains(second))
            || (first == 192 && second == 168)
    }

    static func isPrivateIPv6(_ address: String) -> Bool {
        // Unparseable text inside brackets is refused.
        let unscoped = address.split(separator: "%", maxSplits: 1).first.map(String.init) ?? address
        guard let groups = IpAddress.parseIPv6(unscoped) else { return true }
        if groups.allSatisfy({ $0 == 0 }) { return true }
        if groups.prefix(7).allSatisfy({ $0 == 0 }) && groups[7] == 1 { return true }
        if groups.prefix(5).allSatisfy({ $0 == 0 }) && groups[5] == 0xffff {
            return isPrivateIPv4([groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255])
        }
        return (groups[0] & 0xfe00) == 0xfc00 || (groups[0] & 0xffc0) == 0xfe80
    }
}
