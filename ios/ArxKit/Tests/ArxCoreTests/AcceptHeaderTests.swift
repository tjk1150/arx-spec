import Foundation
import Testing
@testable import ArxCore

/// `ArxHTTPTransport` sends its default Accept header (ARX zip above JSON above anything else) on every request,
/// including after a redirect hop, and a caller can override it via the
/// `requestHeaders` initializer argument. Mirrors `ArxHttpAcceptTest` on Kotlin.
struct AcceptHeaderTests {
    static let loopback = ArxUriPolicy(allowInsecureLocalhost: true, allowPrivateNetwork: true)

    @Test func sendsTheDefaultAcceptHeader() async throws {
        let server = try await LoopbackServer.start(routes: ["/asset": .body(status: 200, Data("{}".utf8))])
        defer { server.stop() }
        let transport = ArxHTTPTransport(policy: Self.loopback)
        _ = try await transport.get(server.url("/asset"), maxBytes: 1024) { _, _ in }
        #expect(server.header("/asset", "Accept") == "application/x-arx+zip, application/json;q=0.9, */*;q=0.1")
    }

    @Test func sendsTheSameAcceptHeaderAfterARedirect() async throws {
        let server = try await LoopbackServer.start(routes: [
            "/redirect": .redirect(to: "/asset"),
            "/asset": .body(status: 200, Data("{}".utf8)),
        ])
        defer { server.stop() }
        let transport = ArxHTTPTransport(policy: Self.loopback)
        _ = try await transport.get(server.url("/redirect"), maxBytes: 1024) { _, _ in }
        #expect(server.header("/redirect", "Accept") == server.header("/asset", "Accept"))
        #expect(server.header("/asset", "Accept") == "application/x-arx+zip, application/json;q=0.9, */*;q=0.1")
    }

    @Test func sendsAnOverriddenAcceptHeaderWhenGiven() async throws {
        let server = try await LoopbackServer.start(routes: ["/asset": .body(status: 200, Data("{}".utf8))])
        defer { server.stop() }
        let transport = ArxHTTPTransport(policy: Self.loopback, requestHeaders: ["Accept": "application/json"])
        _ = try await transport.get(server.url("/asset"), maxBytes: 1024) { _, _ in }
        #expect(server.header("/asset", "Accept") == "application/json")
    }
}
