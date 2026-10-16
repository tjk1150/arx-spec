import Foundation

/// Textual IP address parsing for the URI policy, ported from the Kotlin core
/// (IpAddress.kt). IPv4 follows the WHATWG URL host parser (and inet_aton): one
/// to four decimal, octal (leading 0) or hex (0x) parts, so `2130706433` and
/// `127.1` are both 127.0.0.1. IPv6 accepts `::` compression and a trailing dotted quad.
enum IpAddress {
    /// The four octets, or nil when `host` is not an IPv4 address.
    static func parseIPv4(_ host: String) -> [Int]? {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        guard !parts.isEmpty, parts.count <= 4 else { return nil }
        var numbers: [UInt64] = []
        for part in parts {
            guard let number = parsePart(part) else { return nil }
            numbers.append(number)
        }
        let leading = numbers.dropLast()
        guard let last = numbers.last, leading.allSatisfy({ $0 <= 255 }),
              last < (UInt64(1) << (8 * UInt64(5 - numbers.count)))
        else { return nil }
        var value = last
        for (index, part) in leading.enumerated() {
            value += part << (8 * UInt64(3 - index))
        }
        return (0..<4).map { Int((value >> (8 * UInt64(3 - $0))) & 255) }
    }

    /// True when the last dot-separated part is numeric, i.e. a URL parser would treat the host as IPv4.
    static func looksNumeric(_ host: String) -> Bool {
        let last = host.split(separator: ".", omittingEmptySubsequences: false).last.map(String.init) ?? ""
        return !last.isEmpty && (last.allSatisfy { ("0"..."9").contains($0) } || isHexPart(last))
    }

    /// Eight 16-bit groups, or nil when `address` is not IPv6 text.
    static func parseIPv6(_ address: String) -> [Int]? {
        guard !address.isEmpty, address.filter({ $0 == ":" }).count >= 2 else { return nil }
        let halves = address.components(separatedBy: "::")
        guard halves.count <= 2, let head = groups(halves[0]) else { return nil }
        let tail: [Int]
        if halves.count == 2 {
            guard let parsed = groups(halves[1]) else { return nil }
            tail = parsed
        } else {
            tail = []
        }
        let total = head.count + tail.count
        if halves.count == 1 && total != 8 { return nil }
        if halves.count == 2 && total > 7 { return nil }
        return head + Array(repeating: 0, count: 8 - total) + tail
    }

    private static func groups(_ text: String) -> [Int]? {
        if text.isEmpty { return [] }
        let pieces = text.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
        var result: [Int] = []
        for (index, piece) in pieces.enumerated() {
            if index == pieces.count - 1 && piece.contains(".") {
                guard let octets = parseDottedQuad(piece) else { return nil }
                result.append((octets[0] << 8) | octets[1])
                result.append((octets[2] << 8) | octets[3])
            } else {
                guard !piece.isEmpty, piece.count <= 4, piece.allSatisfy(\.isHexDigit),
                      let group = Int(piece, radix: 16)
                else { return nil }
                result.append(group)
            }
        }
        return result
    }

    private static func parseDottedQuad(_ text: String) -> [Int]? {
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return nil }
        var octets: [Int] = []
        for part in parts {
            guard !part.isEmpty, part.count <= 3, part.allSatisfy({ ("0"..."9").contains($0) }),
                  let octet = Int(part), octet <= 255
            else { return nil }
            octets.append(octet)
        }
        return octets
    }

    private static func parsePart(_ part: String) -> UInt64? {
        guard !part.isEmpty else { return nil }
        let digits: Substring
        let radix: Int
        if isHexPart(part) {
            digits = part.dropFirst(2)
            radix = 16
        } else if part.count > 1 && part.hasPrefix("0") {
            digits = part.dropFirst()
            radix = 8
        } else {
            digits = Substring(part)
            radix = 10
        }
        if digits.isEmpty { return 0 }
        guard digits.count <= 12 else { return nil }
        return UInt64(digits, radix: radix)
    }

    private static func isHexPart(_ part: String) -> Bool {
        (part.hasPrefix("0x") || part.hasPrefix("0X")) && part.dropFirst(2).allSatisfy(\.isHexDigit)
    }
}
