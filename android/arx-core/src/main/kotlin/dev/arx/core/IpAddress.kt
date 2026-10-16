package dev.arx.core

/**
 * Textual IP address parsing for the URI policy. IPv4 follows the WHATWG URL
 * host parser (and inet_aton, which Android's resolver uses): one to four
 * decimal, octal (leading 0) or hex (0x) parts, so `2130706433` and `127.1`
 * are both 127.0.0.1. IPv6 accepts `::` compression and a trailing dotted quad.
 */
internal object IpAddress {
    /** The four octets, or null when [host] is not an IPv4 address. */
    fun parseIpv4(host: String): IntArray? {
        val parts = host.split(".")
        if (parts.isEmpty() || parts.size > 4) return null
        val numbers = parts.map { parsePart(it) ?: return null }
        val last = numbers.last()
        val leading = numbers.dropLast(1)
        if (leading.any { it > 255 }) return null
        if (last >= 1L shl (8 * (5 - numbers.size))) return null
        var value = last
        leading.forEachIndexed { index, part -> value += part shl (8 * (3 - index)) }
        return IntArray(4) { index -> ((value shr (8 * (3 - index))) and 255).toInt() }
    }

    /** True when every dot-separated part is numeric, i.e. a URL parser would treat it as IPv4. */
    fun looksNumeric(host: String): Boolean {
        val last = host.split(".").last()
        return last.isNotEmpty() && (last.all { it in '0'..'9' } || isHexPart(last))
    }

    /** Eight 16-bit groups, or null when [address] is not IPv6 text. */
    fun parseIpv6(address: String): IntArray? {
        if (address.isEmpty() || address.count { it == ':' } < 2) return null
        val halves = address.split("::")
        if (halves.size > 2) return null
        val head = groups(halves[0]) ?: return null
        val tail = if (halves.size == 2) groups(halves[1]) ?: return null else emptyList()
        val total = head.size + tail.size
        if (halves.size == 1 && total != 8) return null
        if (halves.size == 2 && total > 7) return null
        return (head + List(8 - total) { 0 } + tail).toIntArray()
    }

    private fun groups(text: String): List<Int>? {
        if (text.isEmpty()) return emptyList()
        val pieces = text.split(":")
        val result = mutableListOf<Int>()
        pieces.forEachIndexed { index, piece ->
            if (index == pieces.lastIndex && piece.contains('.')) {
                val octets = parseDottedQuad(piece) ?: return null
                result += (octets[0] shl 8) or octets[1]
                result += (octets[2] shl 8) or octets[3]
            } else {
                if (piece.isEmpty() || piece.length > 4) return null
                result += piece.toIntOrNull(16)?.takeIf { piece.all(::isHexDigit) } ?: return null
            }
        }
        return result
    }

    private fun parseDottedQuad(text: String): IntArray? {
        val parts = text.split(".")
        if (parts.size != 4) return null
        return IntArray(4) { index ->
            val part = parts[index]
            if (part.isEmpty() || part.length > 3 || !part.all { it in '0'..'9' }) return null
            part.toInt().takeIf { it <= 255 } ?: return null
        }
    }

    private fun parsePart(part: String): Long? {
        if (part.isEmpty()) return null
        val (digits, radix) = when {
            isHexPart(part) -> part.substring(2) to 16
            part.length > 1 && part.startsWith("0") -> part.substring(1) to 8
            else -> part to 10
        }
        if (digits.isEmpty()) return 0
        if (digits.length > 12 || !digits.all { Character.digit(it, radix) >= 0 }) return null
        return digits.toLong(radix)
    }

    private fun isHexPart(part: String): Boolean =
        (part.startsWith("0x") || part.startsWith("0X")) && part.drop(2).all(::isHexDigit)

    private fun isHexDigit(char: Char): Boolean = char in '0'..'9' || char in 'a'..'f' || char in 'A'..'F'
}
