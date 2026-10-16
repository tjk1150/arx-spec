package dev.arx.core

import java.io.ByteArrayOutputStream
import java.net.URI
import java.net.URISyntaxException
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException

/** Remote-asset policy switches (spec 7). */
data class ArxUriPolicy(
    /** Development only: permit http://localhost, 127.0.0.1 and [::1]. */
    val allowInsecureLocalhost: Boolean = false,
    /** Enterprise deployments only: permit loopback and private addresses. */
    val allowPrivateNetwork: Boolean = false,
)

/** Outcome of resolving a manifest `src`. */
sealed interface ArxResolution {
    data class Resolved(val url: String) : ArxResolution

    data class Rejected(val issue: ArxIssue) : ArxResolution
}

/** URI policy and resolution, ported from packages/arx-core/src/uri.ts and ArxUri.swift. */
object ArxUri {
    private val loopbackHosts = setOf("localhost", "127.0.0.1", "::1", "[::1]")
    private val schemePattern = Regex("^[A-Za-z][A-Za-z0-9+.-]*:")

    /** Resolves [src] against [manifestUrl] after applying the policy. */
    fun resolve(src: String, manifestUrl: String, path: String, policy: ArxUriPolicy = ArxUriPolicy()): ArxResolution {
        if (hasScheme(src)) {
            val url = parse(src)
                ?: return ArxResolution.Rejected(ArxIssue.error(ArxIssueCode.URI_SCHEME, path, "unparseable URL: $src"))
            checkAbsolute(url, path, policy)?.let { return ArxResolution.Rejected(it) }
            return ArxResolution.Resolved(url.toString())
        }
        checkRelativePath(src, path)?.let { return ArxResolution.Rejected(it) }
        val resolved = resolveRelative(src, manifestUrl)
            ?: return ArxResolution.Rejected(ArxIssue.error(ArxIssueCode.URI_PATH, path, "cannot resolve $src"))
        if (ArxLocal.relativePath(resolved.toString()) == null) {
            checkAbsolute(resolved, path, policy)?.let { return ArxResolution.Rejected(it) }
        }
        return ArxResolution.Resolved(resolved.toString())
    }

    /** Checks an absolute URL against the remote-asset policy (also used on every redirect hop). */
    fun checkAbsolute(url: String, path: String, policy: ArxUriPolicy = ArxUriPolicy()): ArxIssue? {
        val parsed = parse(url) ?: return ArxIssue.error(ArxIssueCode.URI_SCHEME, path, "unparseable URL: $url")
        return checkAbsolute(parsed, path, policy)
    }

    internal fun checkAbsolute(url: URI, path: String, policy: ArxUriPolicy): ArxIssue? {
        val scheme = url.scheme?.lowercase() ?: ""
        val host = hostOf(url)
        if (scheme == "http") {
            if (!(policy.allowInsecureLocalhost && host in loopbackHosts)) {
                return ArxIssue.error(ArxIssueCode.URI_SCHEME, path, "http is not allowed: $url")
            }
        } else if (scheme != "https") {
            return ArxIssue.error(ArxIssueCode.URI_SCHEME, path, "scheme $scheme: is not allowed")
        }
        if (host.isEmpty()) return ArxIssue.error(ArxIssueCode.URI_SCHEME, path, "URL has no host: $url")
        if (!url.rawUserInfo.isNullOrEmpty()) {
            return ArxIssue.error(ArxIssueCode.URI_CREDENTIALS, path, "URLs must not embed credentials")
        }
        if (!policy.allowPrivateNetwork && isPrivateHost(host)) {
            return ArxIssue.error(ArxIssueCode.URI_PRIVATE_NETWORK, path, "private or loopback host: $host")
        }
        return null
    }

    /** True for hosts an untrusted manifest must not reach (loopback, private, link-local, CGNAT). */
    fun isPrivateHost(hostname: String): Boolean {
        val host = hostname.lowercase().removeSuffix(".")
        if (host == "localhost" || host.endsWith(".localhost")) return true
        if (host.startsWith("[") && host.endsWith("]")) return isPrivateIpv6(host.substring(1, host.length - 1))
        if (host.contains(":")) return isPrivateIpv6(host)
        val parsed = IpAddress.parseIpv4(host)
        return when {
            parsed != null -> isPrivateIpv4(parsed)
            // A numeric host that is not a valid IPv4 address (e.g. 999.1.1.1) is refused, not guessed at.
            IpAddress.looksNumeric(host) -> true
            else -> false
        }
    }

    internal fun hasScheme(src: String): Boolean = schemePattern.containsMatchIn(src)

    internal fun checkRelativePath(src: String, path: String): ArxIssue? {
        fun reject(reason: String) = ArxIssue.error(ArxIssueCode.URI_PATH, path, "$reason: $src")
        if (src.startsWith("/")) return reject("relative src must not start with '/'")
        if (src.contains('\\')) return reject("backslash is not a path separator")
        if (src.contains('?') || src.contains('#')) return reject("relative src must not contain a query or fragment")
        val segments = src.split("/")
        if (segments.any { (percentDecode(it) ?: it) == ".." }) return reject("'..' segments are not allowed")
        if (segments.any { it.isEmpty() }) return reject("empty path segment")
        return null
    }

    internal fun parse(url: String): URI? = try {
        URI(url)
    } catch (_: URISyntaxException) {
        null
    }

    private fun resolveRelative(src: String, manifestUrl: String): URI? {
        val base = parse(manifestUrl) ?: return null
        // RFC 3986 4.2: a first segment with a colon needs "./" to stay a relative path.
        val firstSegment = src.substringBefore('/')
        val reference = parse(if (firstSegment.contains(':')) "./$src" else src) ?: return null
        // java.net.URI drops the "/" between an authority and an empty base path.
        val anchored = if (base.rawAuthority != null && base.rawPath.isNullOrEmpty()) {
            parse("${base.scheme}://${base.rawAuthority}/") ?: return null
        } else {
            base
        }
        return try {
            anchored.resolve(reference)
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    /**
     * Host as the policy sees it: lowercase, percent-decoded, brackets kept for
     * IPv6. java.net.URI leaves the host null for registry-based authorities
     * (for example `my_host.example` or `%31%32%37.0.0.1`), so those are read from
     * the raw authority instead of being skipped.
     */
    internal fun hostOf(url: URI): String {
        url.host?.let { return it.lowercase() }
        val authority = url.rawAuthority ?: return ""
        val hostAndPort = authority.substringAfterLast('@')
        val host = if (hostAndPort.startsWith("[")) {
            hostAndPort.substringBefore(']') + "]"
        } else {
            hostAndPort.substringBefore(':')
        }
        return (percentDecode(host) ?: host).lowercase()
    }

    internal fun isPrivateIpv4(octets: IntArray): Boolean {
        val first = octets[0]
        val second = octets[1]
        return first == 0 || first == 10 || first == 127 ||
            (first == 100 && second in 64..127) ||
            (first == 169 && second == 254) ||
            (first == 172 && second in 16..31) ||
            (first == 192 && second == 168)
    }

    internal fun isPrivateIpv6(address: String): Boolean {
        // Unparseable text inside brackets is refused.
        val groups = IpAddress.parseIpv6(address.substringBefore('%')) ?: return true
        if (groups.all { it == 0 }) return true
        if (groups.take(7).all { it == 0 } && groups[7] == 1) return true
        if (groups.take(5).all { it == 0 } && groups[5] == 0xffff) {
            return isPrivateIpv4(intArrayOf(groups[6] shr 8, groups[6] and 255, groups[7] shr 8, groups[7] and 255))
        }
        val first = groups[0]
        return (first and 0xfe00) == 0xfc00 || (first and 0xffc0) == 0xfe80
    }

    /** `decodeURIComponent`, or null when the escapes are malformed or not UTF-8. */
    internal fun percentDecode(text: String): String? {
        if (!text.contains('%')) return text
        val bytes = ByteArrayOutputStream()
        var index = 0
        while (index < text.length) {
            val next = text.indexOf('%', index).let { if (it < 0) text.length else it }
            bytes.write(text.substring(index, next).toByteArray(Charsets.UTF_8))
            if (next == text.length) break
            val hex = text.substring(next + 1, minOf(next + 3, text.length))
            if (hex.length != 2 || !hex.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) return null
            bytes.write(hex.toInt(16))
            index = next + 3
        }
        return try {
            Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes.toByteArray())).toString()
        } catch (_: CharacterCodingException) {
            null
        }
    }
}
