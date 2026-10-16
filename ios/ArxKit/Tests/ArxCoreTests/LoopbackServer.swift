import Foundation
import Network

/// A tiny HTTP/1.1 server bound to 127.0.0.1 for transport tests: one request per
/// connection, fixed routes, request counts and bytes sent per path.
final class LoopbackServer: @unchecked Sendable {
    enum Reply: Sendable {
        case body(status: Int, Data)
        case redirect(to: String)
        /// `count` chunks of `chunkSize` bytes, one every `interval` seconds, the first after
        /// `delay`. With `declareLength` the total goes in Content-Length, otherwise the body
        /// is sent with chunked transfer encoding.
        case stream(chunkSize: Int, count: Int, interval: TimeInterval, delay: TimeInterval, declareLength: Bool)
    }

    private let listener: NWListener
    private let routes: [String: Reply]
    private let queue = DispatchQueue(label: "arx.loopback-server")
    private let lock = NSLock()
    private var hits: [String: Int] = [:]
    private var sent: [String: Int] = [:]
    private var headers: [String: [String: String]] = [:]
    private var connections: [NWConnection] = []

    private init(listener: NWListener, routes: [String: Reply]) {
        self.listener = listener
        self.routes = routes
    }

    static func start(routes: [String: Reply]) async throws -> LoopbackServer {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
        let server = LoopbackServer(listener: try NWListener(using: parameters), routes: routes)
        try await server.run()
        return server
    }

    var port: UInt16 { listener.port?.rawValue ?? 0 }

    func url(_ path: String) -> URL { URL(string: "http://127.0.0.1:\(port)\(path)")! }

    func requests(_ path: String) -> Int { lock.withLock { hits[path, default: 0] } }

    func bytesSent(_ path: String) -> Int { lock.withLock { sent[path, default: 0] } }

    /// A request header's value from the last hit on `path` (nil if absent or never hit).
    func header(_ path: String, _ name: String) -> String? { lock.withLock { headers[path]?[name] } }

    func stop() {
        listener.cancel()
        lock.withLock { connections }.forEach { $0.cancel() }
    }

    private func run() async throws {
        let resumed = Once()
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, any Error>) in
            listener.stateUpdateHandler = { state in
                let result: Result<Void, any Error>?
                switch state {
                case .ready: result = .success(())
                case .failed(let error): result = .failure(error)
                default: result = nil
                }
                guard let result else { return }
                if resumed.claim() { continuation.resume(with: result) }
            }
            listener.newConnectionHandler = { [self] connection in accept(connection) }
            listener.start(queue: queue)
        }
    }

    private func accept(_ connection: NWConnection) {
        lock.withLock { connections.append(connection) }
        connection.start(queue: queue)
        receiveHead(connection, buffer: Data())
    }

    private func receiveHead(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [self] data, _, isComplete, error in
            let received = buffer + (data ?? Data())
            if let end = received.range(of: Data("\r\n\r\n".utf8)) {
                respond(connection, head: received[..<end.lowerBound])
            } else if error == nil && !isComplete {
                receiveHead(connection, buffer: received)
            } else {
                connection.cancel()
            }
        }
    }

    private func respond(_ connection: NWConnection, head: Data) {
        let lines = String(decoding: head, as: UTF8.self).components(separatedBy: "\r\n")
        let requestLine = lines.first ?? ""
        let parts = requestLine.split(separator: " ")
        let path = parts.count > 1 ? String(parts[1]) : "/"
        lock.withLock {
            hits[path, default: 0] += 1
            headers[path] = Self.parseHeaders(lines.dropFirst())
        }
        switch routes[path] {
        case nil:
            send(connection, status: 404, headers: ["Content-Length": "0"], body: Data(), close: true)
        case .body(let status, let body):
            send(connection, status: status, headers: ["Content-Length": "\(body.count)"], body: body, close: true)
        case .redirect(let location):
            send(connection, status: 302, headers: ["Location": location, "Content-Length": "0"], body: Data(), close: true)
        case .stream(let chunkSize, let count, let interval, let delay, let declareLength):
            let headers = declareLength
                ? ["Content-Length": "\(chunkSize * count)", "Content-Type": "application/zip"]
                : ["Transfer-Encoding": "chunked", "Content-Type": "application/zip"]
            send(connection, status: 200, headers: headers, body: Data(), close: false)
            let chunk = Data(repeating: 0x61, count: chunkSize)
            queue.asyncAfter(deadline: .now() + delay) { [self] in
                stream(connection, path: path, chunk: chunk, remaining: count, interval: interval, chunked: !declareLength)
            }
        }
    }

    private func stream(
        _ connection: NWConnection, path: String, chunk: Data, remaining: Int, interval: TimeInterval, chunked: Bool
    ) {
        guard remaining > 0 else {
            connection.send(content: chunked ? Data("0\r\n\r\n".utf8) : Data(), completion: .contentProcessed { _ in
                connection.cancel()
            })
            return
        }
        let payload = chunked ? Data("\(String(chunk.count, radix: 16))\r\n".utf8) + chunk + Data("\r\n".utf8) : chunk
        connection.send(content: payload, completion: .contentProcessed { [self] error in
            guard error == nil, connection.state == .ready else {
                connection.cancel()
                return
            }
            lock.withLock { sent[path, default: 0] += chunk.count }
            queue.asyncAfter(deadline: .now() + interval) { [self] in
                stream(connection, path: path, chunk: chunk, remaining: remaining - 1, interval: interval, chunked: chunked)
            }
        })
    }

    /// `Name: value` header lines (everything after the request line), trimmed.
    private static func parseHeaders<Lines: Sequence>(_ lines: Lines) -> [String: String] where Lines.Element == String {
        var result: [String: String] = [:]
        for line in lines {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let name = String(line[..<colon])
            let value = String(line[line.index(after: colon)...]).trimmingCharacters(in: .whitespaces)
            result[name] = value
        }
        return result
    }

    private func send(_ connection: NWConnection, status: Int, headers: [String: String], body: Data, close: Bool) {
        var head = "HTTP/1.1 \(status) Test\r\nConnection: close\r\n"
        for (name, value) in headers { head += "\(name): \(value)\r\n" }
        head += "\r\n"
        connection.send(content: Data(head.utf8) + body, completion: .contentProcessed { _ in
            if close { connection.cancel() }
        })
    }
}

/// True for the first caller only.
private final class Once: @unchecked Sendable {
    private let lock = NSLock()
    private var claimed = false

    func claim() -> Bool {
        lock.withLock {
            defer { claimed = true }
            return !claimed
        }
    }
}
