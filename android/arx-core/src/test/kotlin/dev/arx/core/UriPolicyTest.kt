package dev.arx.core

import com.sun.net.httpserver.HttpServer
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.Arguments
import org.junit.jupiter.params.provider.MethodSource
import org.junit.jupiter.params.provider.ValueSource
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Same table as packages/arx-core/test/uri.test.ts and UriPolicyTests.swift (spec 7). */
class UriPolicyTest {
    companion object {
        @JvmStatic
        fun unsafeSources(): List<Arguments> = listOf(
            Arguments.of("../a.png", "ARX_URI_PATH"),
            Arguments.of("assets/../../a.png", "ARX_URI_PATH"),
            Arguments.of("assets/%2e%2e/a.png", "ARX_URI_PATH"),
            Arguments.of("/assets/a.png", "ARX_URI_PATH"),
            Arguments.of("assets\\a.png", "ARX_URI_PATH"),
            Arguments.of("assets/a.png?x=1", "ARX_URI_PATH"),
            Arguments.of("assets/a.png#frag", "ARX_URI_PATH"),
            Arguments.of("//evil.example/a.png", "ARX_URI_PATH"),
            Arguments.of("assets//a.png", "ARX_URI_PATH"),
            Arguments.of("javascript:alert(1)", "ARX_URI_SCHEME"),
            Arguments.of("data:image/png;base64,AAAA", "ARX_URI_SCHEME"),
            Arguments.of("file:///etc/passwd", "ARX_URI_SCHEME"),
            Arguments.of("blob:https://cdn.arx.example/x", "ARX_URI_SCHEME"),
            Arguments.of("http://cdn.arx.example/a.png", "ARX_URI_SCHEME"),
            Arguments.of("https://user:pass@cdn.arx.example/a.png", "ARX_URI_CREDENTIALS"),
            Arguments.of("https://localhost/a.png", "ARX_URI_PRIVATE_NETWORK"),
            Arguments.of("https://127.0.0.1/a.png", "ARX_URI_PRIVATE_NETWORK"),
            Arguments.of("https://10.1.2.3/a.png", "ARX_URI_PRIVATE_NETWORK"),
            Arguments.of("https://172.20.0.1/a.png", "ARX_URI_PRIVATE_NETWORK"),
            Arguments.of("https://192.168.0.10/a.png", "ARX_URI_PRIVATE_NETWORK"),
            Arguments.of("https://100.64.0.1/a.png", "ARX_URI_PRIVATE_NETWORK"),
            Arguments.of("https://0.0.0.0/a.png", "ARX_URI_PRIVATE_NETWORK"),
            Arguments.of("https://169.254.169.254/latest/meta-data", "ARX_URI_PRIVATE_NETWORK"),
            Arguments.of("https://[::1]/a.png", "ARX_URI_PRIVATE_NETWORK"),
            Arguments.of("https://[fd00::1]/a.png", "ARX_URI_PRIVATE_NETWORK"),
            Arguments.of("https://[fe80::1]/a.png", "ARX_URI_PRIVATE_NETWORK"),
            Arguments.of("https://[::ffff:192.168.0.1]/a.png", "ARX_URI_PRIVATE_NETWORK"),
            Arguments.of("https://[::ffff:c0a8:1]/a.png", "ARX_URI_PRIVATE_NETWORK"),
        )
    }

    private val remote = "https://cdn.arx.example/e/abc/manifest.json"

    private fun outcome(src: String, base: String = remote, policy: ArxUriPolicy = ArxUriPolicy()): String =
        when (val result = ArxUri.resolve(src, base, "/layers/0/src", policy)) {
            is ArxResolution.Resolved -> result.url
            is ArxResolution.Rejected -> result.issue.code.raw
        }

    @Test
    fun resolvesRelativePathsAgainstTheManifest() {
        assertEquals("https://cdn.arx.example/e/abc/assets/video.mp4", outcome("assets/video.mp4"))
        assertEquals("https://cdn.arx.example/e/abc/assets/a.png", outcome("./assets/a.png"))
        assertEquals("arx-package://root/assets/a.png", outcome("assets/a.png", base = ArxLocal.MANIFEST_URL))
    }

    @Test
    fun acceptsHttpsIncludingPresignedQueries() {
        val signed = "https://bucket.s3.amazonaws.com/a.mp4?X-Amz-Signature=abc"
        assertEquals(signed, outcome(signed))
    }

    @ParameterizedTest(name = "{0} -> {1}")
    @MethodSource("unsafeSources")
    fun rejectsUnsafeSources(src: String, code: String) {
        assertEquals(code, outcome(src), src)
    }

    /** Forms a WHATWG URL parser or inet_aton would turn into a private address. */
    @ParameterizedTest
    @ValueSource(
        strings = [
            "https://2130706433/a.png",
            "https://127.1/a.png",
            "https://0x7f.0.0.1/a.png",
            "https://0177.0.0.1/a.png",
            "https://localhost./a.png",
            "https://app.localhost/a.png",
            "https://%31%32%37.0.0.1/a.png",
            "https://[0:0:0:0:0:0:0:1]/a.png",
            "https://[::ffff:7f00:1]/a.png",
            "https://[::]/a.png",
            "https://999.1.1.1/a.png",
        ],
    )
    fun rejectsNonCanonicalPrivateHosts(src: String) {
        assertEquals("ARX_URI_PRIVATE_NETWORK", outcome(src), src)
    }

    @Test
    fun allowsPublicAddressesThatLookSimilar() {
        assertEquals("https://172.32.0.1/a.png", outcome("https://172.32.0.1/a.png"))
        assertEquals("https://8.8.8.8/a.png", outcome("https://8.8.8.8/a.png"))
        assertEquals("https://100.128.0.1/a.png", outcome("https://100.128.0.1/a.png"))
        assertEquals("https://[2001:db8::1]/a.png", outcome("https://[2001:db8::1]/a.png"))
        assertEquals("https://my_host.example/a.png", outcome("https://my_host.example/a.png"))
    }

    @Test
    fun allowsHttpLocalhostOnlyInDevelopmentMode() {
        val development = ArxUriPolicy(allowInsecureLocalhost = true, allowPrivateNetwork = true)
        assertEquals("http://localhost:3000/a.png", outcome("http://localhost:3000/a.png", policy = development))
        assertEquals("http://[::1]:3000/a.png", outcome("http://[::1]:3000/a.png", policy = development))
        assertEquals("ARX_URI_SCHEME", outcome("http://example.com/a.png", policy = development))
        assertEquals("ARX_URI_PRIVATE_NETWORK", outcome("http://localhost:3000/a.png", policy = ArxUriPolicy(allowInsecureLocalhost = true)))
    }

    @Test
    fun allowsPrivateHostsOnlyWhenThePolicySaysSo() {
        val enterprise = ArxUriPolicy(allowPrivateNetwork = true)
        assertEquals("https://10.1.2.3/a.png", outcome("https://10.1.2.3/a.png", policy = enterprise))
        assertEquals("ARX_URI_CREDENTIALS", outcome("https://user@10.1.2.3/a.png", policy = enterprise))
    }

    @Test
    fun resolvesAgainstABaseWithoutAPath() {
        assertEquals("https://cdn.arx.example/a.png", outcome("a.png", base = "https://cdn.arx.example"))
    }

    /** The HTTP fetcher refuses URLs the policy rejects before any request is made. */
    @Test
    fun httpFetcherRefusesUnsafeUrlsWithoutRequesting() {
        val fetch = ArxHttp.fetcher()
        for (unsafe in listOf("http://cdn.arx.example/a.png", "https://127.0.0.1/a.png", "file:///etc/passwd")) {
            assertNull(fetch(unsafe), unsafe)
        }
    }
}

/**
 * Redirect handling of the default fetcher against a local server. Loopback
 * over http needs the development policy, so the hops under test are the ones
 * that policy still refuses.
 */
class HttpRedirectTest {
    private lateinit var server: HttpServer
    private val hits = AtomicInteger()
    private val development = ArxUriPolicy(allowInsecureLocalhost = true, allowPrivateNetwork = true)
    private val body = byteArrayOf(1, 2, 3, 4)

    private val base: String get() = "http://127.0.0.1:${server.address.port}"

    @BeforeEach
    fun start() {
        server = HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0)
        server.createContext("/") { exchange ->
            hits.incrementAndGet()
            val path = exchange.requestURI.path
            val location = when {
                path == "/asset.png" -> null
                path == "/relative" -> "/asset.png"
                path == "/to-http-remote" -> "http://cdn.arx.example/asset.png"
                path == "/to-file" -> "file:///etc/passwd"
                // Reachable, but the policy refuses credentials in URLs.
                path == "/to-credentials" -> "http://user:secret@127.0.0.1:${server.address.port}/asset.png"
                path.startsWith("/loop") -> "/loop${path.removePrefix("/loop").length + 1}"
                else -> null
            }
            when {
                location != null -> {
                    exchange.responseHeaders.add("Location", location)
                    exchange.sendResponseHeaders(302, -1)
                }
                path == "/asset.png" -> {
                    exchange.sendResponseHeaders(200, body.size.toLong())
                    exchange.responseBody.use { it.write(body) }
                }
                else -> exchange.sendResponseHeaders(404, -1)
            }
            exchange.close()
        }
        server.start()
    }

    @AfterEach
    fun stop() {
        server.stop(0)
    }

    @Test
    fun followsARelativeRedirectOnTheSameHost() {
        assertContentEquals(body, ArxHttp.fetcher(development)("$base/relative"))
        assertEquals(2, hits.get())
    }

    @Test
    fun refusesARedirectThatThePolicyRejects() {
        assertNull(ArxHttp.fetcher(development)("$base/to-http-remote"))
        assertNull(ArxHttp.fetcher(development)("$base/to-file"))
        assertEquals(2, hits.get(), "only the first hop of each chain was requested")
    }

    @Test
    fun checksEveryHopBeforeRequestingIt() {
        assertNull(ArxHttp.fetcher(development)("$base/to-credentials"))
        assertEquals(1, hits.get(), "the refused hop must not be requested")
    }

    @Test
    fun stopsAfterTheRedirectLimit() {
        assertNull(ArxHttp.fetcher(development, maxRedirects = 3)("$base/loop"))
        assertEquals(4, hits.get())
    }

    @Test
    fun returnsNullForErrorStatuses() {
        assertNull(ArxHttp.fetcher(development)("$base/missing.png"))
    }

    @Test
    fun theDefaultPolicyNeverContactsLoopback() {
        assertNull(ArxHttp.fetcher()("$base/asset.png"))
        assertFalse(hits.get() > 0)
        assertTrue(ArxUri.isPrivateHost("127.0.0.1"))
    }
}
