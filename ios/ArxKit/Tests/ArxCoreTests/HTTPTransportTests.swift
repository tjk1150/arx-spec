import Foundation
import Testing
@testable import ArxCore

/// Progress pairs from the transport's @Sendable callback.
final class ByteProgress: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [(received: Int64, expected: Int64?)] = []

    var events: [(received: Int64, expected: Int64?)] { lock.withLock { stored } }
    var maxReceived: Int64 { events.map(\.received).max() ?? 0 }

    func append(_ received: Int64, _ expected: Int64?) {
        lock.withLock { stored.append((received, expected)) }
    }
}

/// `ArxHTTPTransport` against a real server on 127.0.0.1 (`LoopbackServer`). The policy
/// allows plain http to the loopback host, which is otherwise refused (spec 7).
struct HTTPTransportTests {
    static let loopback = ArxUriPolicy(allowInsecureLocalhost: true, allowPrivateNetwork: true)

    static func transport() -> ArxHTTPTransport { ArxHTTPTransport(policy: loopback) }

    static func failure(_ body: () async throws -> ArxDownload) async -> ArxOpenFailure? {
        do {
            _ = try await body()
            return nil
        } catch {
            return error as? ArxOpenFailure
        }
    }

    @Test func downloadsTheBodyAndReportsProgress() async throws {
        let body = Data((0..<200_000).map { UInt8($0 % 251) })
        let server = try await LoopbackServer.start(routes: ["/work.arx": .body(status: 200, body)])
        defer { server.stop() }
        let progress = ByteProgress()
        let download = try await Self.transport().get(server.url("/work.arx"), maxBytes: 1 << 20) { progress.append($0, $1) }
        #expect(download.data == body)
        #expect(download.finalURL == server.url("/work.arx"))
        #expect(progress.events.count > 2, "progress while streaming, not only at the end")
        #expect(progress.events.last?.received == 200_000)
        #expect(progress.events.last?.expected == 200_000)
    }

    /// Redirects are followed and the last hop's URL is reported, so a manifest behind a
    /// short link resolves its relative assets against where it really lives.
    @Test func followsRedirectsAndReportsTheFinalURL() async throws {
        let server = try await LoopbackServer.start(routes: [
            "/s/abc": .redirect(to: "/s/abc-2"),
            "/s/abc-2": .redirect(to: "/works/42/manifest.json"),
            "/works/42/manifest.json": .body(status: 200, Data("{}".utf8)),
        ])
        defer { server.stop() }
        let download = try await Self.transport().get(server.url("/s/abc"), maxBytes: 1024) { _, _ in }
        #expect(download.data == Data("{}".utf8))
        #expect(download.finalURL == server.url("/works/42/manifest.json"))
        #expect(server.requests("/works/42/manifest.json") == 1)
    }

    /// The hop is refused in the redirect callback, so the server never sees it.
    @Test func refusesARedirectHopBeforeRequestingIt() async throws {
        let server = try await LoopbackServer.start(routes: ["/secret": .body(status: 200, Data("secret".utf8))])
        defer { server.stop() }
        let sneaky = try await LoopbackServer.start(routes: [
            "/start": .redirect(to: "http://user:pass@127.0.0.1:\(server.port)/secret"),
        ])
        defer { sneaky.stop() }
        let failure = await Self.failure { try await Self.transport().get(sneaky.url("/start"), maxBytes: 1024) { _, _ in } }
        #expect(failure?.code == ArxIssueCode.uriCredentials.rawValue, "\(String(describing: failure))")
        #expect(server.requests("/secret") == 0)
    }

    @Test func refusesAURLThePolicyRejectsWithoutRequesting() async throws {
        let server = try await LoopbackServer.start(routes: ["/a.json": .body(status: 200, Data("{}".utf8))])
        defer { server.stop() }
        let failure = await Self.failure {
            try await ArxHTTPTransport().get(server.url("/a.json"), maxBytes: 1024) { _, _ in }
        }
        #expect(failure?.code == ArxIssueCode.uriScheme.rawValue)
        #expect(server.requests("/a.json") == 0)
    }

    @Test func reportsHTTPErrorsAsDownloadFailures() async throws {
        let server = try await LoopbackServer.start(routes: [:])
        defer { server.stop() }
        let failure = await Self.failure { try await Self.transport().get(server.url("/missing"), maxBytes: 1024) { _, _ in } }
        #expect(failure?.viewerCode == .downloadFailed)
    }

    /// Content-Length over the cap fails before any body byte is consumed. URLSession
    /// hands over the response only with the first body packet, so the server starts
    /// sending at once (the whole body would take 40 s).
    @Test func refusesADeclaredLengthOverTheCap() async throws {
        let server = try await LoopbackServer.start(routes: [
            "/huge.arx": .stream(chunkSize: 65536, count: 800, interval: 0.05, delay: 0, declareLength: true),
        ])
        defer { server.stop() }
        let started = ContinuousClock.now
        let progress = ByteProgress()
        let failure = await Self.failure {
            try await Self.transport().get(server.url("/huge.arx"), maxBytes: 1 << 20) { progress.append($0, $1) }
        }
        #expect(failure?.viewerCode == .downloadTooLarge)
        #expect(progress.events.isEmpty, "refused on the header, before reading: \(progress.events)")
        #expect(ContinuousClock.now - started < .seconds(2))
    }

    /// Without Content-Length the stream is abandoned at the first byte over the cap.
    @Test func stopsStreamingOnceOverTheCap() async throws {
        let chunks = 400
        let server = try await LoopbackServer.start(routes: [
            "/endless.arx": .stream(chunkSize: 65536, count: chunks, interval: 0.02, delay: 0, declareLength: false),
        ])
        defer { server.stop() }
        let started = ContinuousClock.now
        let progress = ByteProgress()
        let failure = await Self.failure {
            try await Self.transport().get(server.url("/endless.arx"), maxBytes: 200_000) { progress.append($0, $1) }
        }
        #expect(failure?.viewerCode == .downloadTooLarge)
        #expect(ContinuousClock.now - started < .seconds(4), "the full body would take 8 s")
        #expect(progress.maxReceived <= 200_000)
        try await Task.sleep(for: .milliseconds(300))
        #expect(server.bytesSent("/endless.arx") < chunks * 65536 / 2)
    }

    @Test func cancellationStopsTheDownload() async throws {
        let server = try await LoopbackServer.start(routes: [
            "/slow.arx": .stream(chunkSize: 65536, count: 3, interval: 30, delay: 0, declareLength: false),
        ])
        defer { server.stop() }
        let transport = Self.transport()
        let progress = ByteProgress()
        let task = Task { try await transport.get(server.url("/slow.arx"), maxBytes: 1 << 30) { progress.append($0, $1) } }
        let waitStart = ContinuousClock.now
        while progress.maxReceived < 65536 && ContinuousClock.now - waitStart < .seconds(5) {
            try await Task.sleep(for: .milliseconds(20))
        }
        #expect(progress.maxReceived == 65536, "first chunk arrived before cancelling")
        let cancelled = ContinuousClock.now
        task.cancel()
        let failure = await Self.failure { try await task.value }
        #expect(failure?.viewerCode == .cancelled, "\(String(describing: failure))")
        #expect(ContinuousClock.now - cancelled < .seconds(2))
    }

    /// Asset downloads through `ArxHTTP.fetcher` are capped too.
    @Test func fetcherIsCapped() async throws {
        let server = try await LoopbackServer.start(routes: [
            "/small.png": .body(status: 200, Data(repeating: 1, count: 1000)),
            "/large.png": .body(status: 200, Data(repeating: 1, count: 5000)),
        ])
        defer { server.stop() }
        let fetch = ArxHTTP.fetcher(policy: Self.loopback, maxBytes: 4096)
        #expect(await fetch(server.url("/small.png"))?.count == 1000)
        #expect(await fetch(server.url("/large.png")) == nil)
    }

    @Test func readsRootCertificatesFromPEM() {
        let der = Data((0..<300).map { UInt8($0 % 256) })
        let base64 = der.base64EncodedString(options: .lineLength64Characters)
        let pem = "junk\n-----BEGIN CERTIFICATE-----\n\(base64)\n-----END CERTIFICATE-----\n"
        #expect(ArxHTTPTransport.derCertificates(pem: pem + pem) == [der, der])
    }
}

/// A redirect to a private host under the default policy, with `URLProtocol` stubs
/// standing in for the network (a loopback server is itself a private host).
struct PrivateRedirectTests {
    final class Stub: URLProtocol, @unchecked Sendable {
        static let requested = RequestLog()

        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

        override func startLoading() {
            guard let url = request.url, let client else { return }
            Self.requested.append(url.absoluteString)
            if url.host == "cdn.arx.example" {
                let target = URL(string: "https://192.168.0.10/secret.json")!
                let response = HTTPURLResponse(
                    url: url, statusCode: 302, httpVersion: "HTTP/1.1", headerFields: ["Location": target.absoluteString])!
                client.urlProtocol(self, wasRedirectedTo: URLRequest(url: target), redirectResponse: response)
                client.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            } else {
                let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [:])!
                client.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
                client.urlProtocol(self, didLoad: Data("{}".utf8))
            }
            client.urlProtocolDidFinishLoading(self)
        }

        override func stopLoading() {}
    }

    final class RequestLog: @unchecked Sendable {
        private let lock = NSLock()
        private var urls: [String] = []

        var all: [String] { lock.withLock { urls } }

        func append(_ url: String) {
            lock.withLock { urls.append(url) }
        }
    }

    @Test(.timeLimit(.minutes(1)))
    func refusesARedirectToAPrivateHost() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [Stub.self]
        let transport = ArxHTTPTransport(configuration: configuration)
        var failure: ArxOpenFailure?
        do {
            _ = try await transport.get(URL(string: "https://cdn.arx.example/short")!, maxBytes: 1024) { _, _ in }
        } catch {
            failure = error as? ArxOpenFailure
        }
        #expect(failure?.code == ArxIssueCode.uriPrivateNetwork.rawValue, "\(String(describing: failure))")
        #expect(Stub.requested.all == ["https://cdn.arx.example/short"])
    }
}
