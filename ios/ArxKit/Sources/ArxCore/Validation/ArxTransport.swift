import Foundation
import Security

/// A finished download: the body and the URL it came from after redirects.
public struct ArxDownload: Sendable, Equatable {
    public let data: Data
    /// The last hop's URL; relative references resolve against it, as in a browser.
    public let finalURL: URL

    public init(data: Data, finalURL: URL) {
        self.data = data
        self.finalURL = finalURL
    }
}

/// Downloads bytes. Implementations follow redirects, return the final
/// URL, throw `ArxOpenFailure` with `downloadFailed`, `downloadTooLarge` or `cancelled`
/// (or a URI policy code when a URL or redirect is refused), and report progress as
/// (bytes so far, expected total).
public protocol ArxTransport: Sendable {
    func get(_ url: URL, maxBytes: Int64, progress: @Sendable (Int64, Int64?) -> Void) async throws -> ArxDownload
}

/// Header values `ArxHTTPTransport` falls back to.
enum ArxHTTPHeaderDefaults {
    /// Ranks the ARX zip format above JSON above anything else.
    static let accept = "application/x-arx+zip, application/json;q=0.9, */*;q=0.1"
}

/// HTTPS downloads under the ARX URI policy (spec 7).
///
/// - Every redirect hop is checked against the policy before it is followed; a refused
///   hop fails the download with that hop's URI code and is never requested. The last
///   hop's URL is returned as `ArxDownload.finalURL`.
/// - The body is streamed and the download stops as soon as it exceeds `maxBytes`
///   (at once when Content-Length already says so).
/// - Task cancellation stops the request and throws `VIEWER_CANCELLED`.
/// - `requestHeaders` is set on every request, including after a redirect hop.
///
/// Host names that resolve to private addresses (DNS rebinding) are not caught here.
public struct ArxHTTPTransport: ArxTransport {
    public let policy: ArxUriPolicy
    private let trustedRootCertificates: [Data]
    private let session: URLSession
    private let requestHeaders: [String: String]

    /// Progress is reported at most once per this many bytes, plus at the start and the end.
    static let progressStep = 64 * 1024

    /// The default `requestHeaders`: only Accept, ranking the ARX zip format
    /// above JSON above anything else.
    public static let defaultRequestHeaders: [String: String] = ["Accept": ArxHTTPHeaderDefaults.accept]

    /// - Parameter trustedRootCertificates: development only. DER root certificates trusted
    ///   in addition to the system roots (for example a mkcert root for a LAN test server).
    /// - Parameter requestHeaders: sent on every request; see `defaultRequestHeaders`.
    public init(
        policy: ArxUriPolicy = ArxUriPolicy(), trustedRootCertificates: [Data] = [],
        configuration: URLSessionConfiguration = .ephemeral,
        requestHeaders: [String: String] = ArxHTTPTransport.defaultRequestHeaders
    ) {
        self.init(
            policy: policy, trustedRootCertificates: trustedRootCertificates,
            session: URLSession(configuration: configuration), requestHeaders: requestHeaders)
    }

    /// Uses an existing session. Redirects and server trust are handled by a per-task
    /// delegate, so the session's own delegate must not answer those callbacks.
    /// - Parameter requestHeaders: sent on every request; see `defaultRequestHeaders`.
    public init(
        policy: ArxUriPolicy = ArxUriPolicy(), trustedRootCertificates: [Data] = [], session: URLSession,
        requestHeaders: [String: String] = ArxHTTPTransport.defaultRequestHeaders
    ) {
        self.policy = policy
        self.trustedRootCertificates = trustedRootCertificates
        self.session = session
        self.requestHeaders = requestHeaders
    }

    public func get(_ url: URL, maxBytes: Int64, progress: @Sendable (Int64, Int64?) -> Void) async throws -> ArxDownload {
        if let issue = ArxUri.checkAbsolute(url, path: "", policy: policy) { throw ArxOpenFailure(issue: issue) }
        let guardian = HopGuard(policy: policy, trustedRootCertificates: trustedRootCertificates, requestHeaders: requestHeaders)
        var request = URLRequest(url: url)
        for (name, value) in requestHeaders { request.setValue(value, forHTTPHeaderField: name) }
        let bytes: URLSession.AsyncBytes
        let response: URLResponse
        do {
            (bytes, response) = try await session.bytes(for: request, delegate: guardian)
        } catch {
            throw guardian.failure ?? Self.failure(error, url: url)
        }
        defer { bytes.task.cancel() }
        if let refused = guardian.failure { throw refused }
        guard let http = response as? HTTPURLResponse else {
            throw ArxOpenFailure(.downloadFailed, "not an HTTP response: \(url.absoluteString)")
        }
        let finalURL = http.url ?? url
        if let issue = ArxUri.checkAbsolute(finalURL, path: "", policy: policy) { throw ArxOpenFailure(issue: issue) }
        guard (200..<300).contains(http.statusCode) else {
            throw ArxOpenFailure(.downloadFailed, "HTTP \(http.statusCode): \(url.absoluteString)")
        }
        let expected = http.expectedContentLength >= 0 ? http.expectedContentLength : nil
        if let expected, expected > maxBytes { throw Self.tooLarge(url, maxBytes) }
        let data = try await Self.collect(bytes, url: url, expected: expected, maxBytes: maxBytes, progress: progress)
        return ArxDownload(data: data, finalURL: finalURL)
    }

    /// Reads the body, stopping at the first byte over `maxBytes`.
    private static func collect(
        _ bytes: URLSession.AsyncBytes, url: URL, expected: Int64?, maxBytes: Int64,
        progress: @Sendable (Int64, Int64?) -> Void
    ) async throws -> Data {
        var data = Data()
        if let expected { data.reserveCapacity(Int(expected)) }
        var chunk: [UInt8] = []
        chunk.reserveCapacity(progressStep)
        var received: Int64 = 0
        progress(0, expected)
        do {
            for try await byte in bytes {
                received += 1
                if received > maxBytes { throw tooLarge(url, maxBytes) }
                chunk.append(byte)
                if chunk.count == progressStep {
                    data.append(contentsOf: chunk)
                    chunk.removeAll(keepingCapacity: true)
                    try Task.checkCancellation()
                    progress(received, expected)
                }
            }
        } catch let failure as ArxOpenFailure {
            throw failure
        } catch {
            throw failure(error, url: url)
        }
        data.append(contentsOf: chunk)
        progress(received, expected)
        return data
    }

    private static func tooLarge(_ url: URL, _ maxBytes: Int64) -> ArxOpenFailure {
        ArxOpenFailure(.downloadTooLarge, "\(url.absoluteString) is larger than \(maxBytes) bytes")
    }

    private static func failure(_ error: any Error, url: URL) -> ArxOpenFailure {
        if Task.isCancelled || error is CancellationError { return ArxOpenFailure(.cancelled, "download cancelled") }
        return ArxOpenFailure(.downloadFailed, "\(url.absoluteString): \(error.localizedDescription)")
    }

    /// DER bytes of every certificate in PEM text (for `trustedRootCertificates`).
    public static func derCertificates(pem: String) -> [Data] {
        let begin = "-----BEGIN CERTIFICATE-----"
        let end = "-----END CERTIFICATE-----"
        return pem.components(separatedBy: begin).dropFirst().compactMap { block in
            guard let body = block.components(separatedBy: end).first else { return nil }
            return Data(base64Encoded: body, options: .ignoreUnknownCharacters)
        }
    }
}

/// Per-task delegate: vets every redirect hop and, when development roots are
/// configured, evaluates server trust with them added to the system anchors.
private final class HopGuard: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let policy: ArxUriPolicy
    private let trustedRootCertificates: [Data]
    private let requestHeaders: [String: String]
    private let lock = NSLock()
    private var recorded: ArxOpenFailure?

    init(policy: ArxUriPolicy, trustedRootCertificates: [Data], requestHeaders: [String: String]) {
        self.policy = policy
        self.trustedRootCertificates = trustedRootCertificates
        self.requestHeaders = requestHeaders
    }

    /// The first refused hop or certificate, if any.
    var failure: ArxOpenFailure? { lock.withLock { recorded } }

    private func record(_ failure: ArxOpenFailure) {
        lock.withLock { recorded = recorded ?? failure }
    }

    func urlSession(
        _ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest
    ) async -> URLRequest? {
        guard let next = request.url else {
            record(ArxOpenFailure(.downloadFailed, "redirect without a location"))
            return nil
        }
        if let issue = ArxUri.checkAbsolute(next, path: "", policy: policy) {
            record(ArxOpenFailure(issue: .error(issue.code, "", "redirect refused: \(issue.message)")))
            return nil
        }
        // URLSession usually carries the original headers over, but this makes it explicit
        // and independent of that behavior: the next hop must send the same Accept too.
        var redirected = request
        for (name, value) in requestHeaders { redirected.setValue(value, forHTTPHeaderField: name) }
        return redirected
    }

    func urlSession(
        _ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge
    ) async -> (URLSession.AuthChallengeDisposition, URLCredential?) {
        guard !trustedRootCertificates.isEmpty,
              challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust
        else { return (.performDefaultHandling, nil) }
        let anchors = trustedRootCertificates.compactMap { SecCertificateCreateWithData(nil, $0 as CFData) }
        SecTrustSetAnchorCertificates(trust, anchors as CFArray)
        SecTrustSetAnchorCertificatesOnly(trust, false)
        var error: CFError?
        guard SecTrustEvaluateWithError(trust, &error) else {
            let reason = error.map { CFErrorCopyDescription($0) as String } ?? "untrusted"
            record(ArxOpenFailure(.downloadFailed, "server certificate refused: \(reason)"))
            return (.cancelAuthenticationChallenge, nil)
        }
        return (.useCredential, URLCredential(trust: trust))
    }
}
