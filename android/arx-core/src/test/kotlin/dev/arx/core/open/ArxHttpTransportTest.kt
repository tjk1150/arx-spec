package dev.arx.core.open

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import dev.arx.core.ArxHttp
import dev.arx.core.ArxUriPolicy
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * [ArxHttpTransport] against a local server. Loopback over http needs the
 * development policy, so the refused hops are ones that policy still refuses.
 */
class ArxHttpTransportTest {
    private lateinit var server: HttpServer
    private val executor: ExecutorService = Executors.newCachedThreadPool()
    private val hits = ConcurrentHashMap<String, Int>()
    private val development = ArxUriPolicy(allowInsecureLocalhost = true, allowPrivateNetwork = true)
    private val transport = ArxHttpTransport(development)
    private val body = ByteArray(200_000) { (it % 251).toByte() }

    private val base: String get() = "http://127.0.0.1:${server.address.port}"

    @BeforeEach
    fun start() {
        server = HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0)
        server.executor = executor
        server.createContext("/") { exchange ->
            val path = exchange.requestURI.path
            hits.merge(path, 1, Int::plus)
            try {
                handle(exchange, path)
            } catch (_: IOException) {
                // The client hung up (size cap or cancellation); that is what these tests provoke.
            } finally {
                exchange.close()
            }
        }
        server.start()
    }

    @AfterEach
    fun stop() {
        server.stop(0)
        executor.shutdownNow()
    }

    private fun handle(exchange: HttpExchange, path: String) {
        fun redirect(location: String) {
            exchange.responseHeaders.add("Location", location)
            exchange.sendResponseHeaders(302, -1)
        }
        when (path) {
            "/asset" -> {
                exchange.sendResponseHeaders(200, body.size.toLong())
                exchange.responseBody.write(body)
            }
            "/relative" -> redirect("/asset")
            "/to-http-remote" -> redirect("http://cdn.arx.example/asset")
            "/to-credentials" -> redirect("http://user:secret@127.0.0.1:${server.address.port}/asset")
            "/endless" -> {
                // Chunked, no Content-Length: only the running count can stop the client (8 MiB in all).
                exchange.sendResponseHeaders(200, 0)
                val chunk = ByteArray(16 * 1024)
                repeat(512) { exchange.responseBody.write(chunk) }
            }
            "/slow" -> {
                exchange.sendResponseHeaders(200, 0)
                val chunk = ByteArray(1024)
                repeat(200) {
                    exchange.responseBody.write(chunk)
                    exchange.responseBody.flush()
                    Thread.sleep(20)
                }
            }
            else -> exchange.sendResponseHeaders(404, -1)
        }
    }

    private fun get(path: String, maxBytes: Long = 1L shl 30, cancellation: ArxCancellation = ArxCancellation()): ByteArray =
        transport.get("$base$path", maxBytes, cancellation) { _, _ -> }.bytes

    private fun failureCode(block: () -> Unit): ArxViewerCode? = assertFailsWith<ArxOpenFailure> { block() }.viewerCode

    @Test
    fun downloadsAndReportsProgress() {
        val reports = mutableListOf<Pair<Long, Long?>>()
        val download = transport.get("$base/asset", 1L shl 30, ArxCancellation()) { received, expected ->
            reports += received to expected
        }
        assertContentEquals(body, download.bytes)
        assertEquals("$base/asset", download.finalUrl)
        assertEquals(0L to body.size.toLong(), reports.first())
        assertEquals(body.size.toLong() to body.size.toLong(), reports.last())
        assertTrue(reports.size > 2, "progress is reported per chunk: $reports")
    }

    @Test
    fun followsARelativeRedirect() {
        assertContentEquals(body, get("/relative"))
        assertEquals(mapOf("/relative" to 1, "/asset" to 1), hits.toMap())
    }

    @Test
    fun reportsTheUrlThatAnsweredAfterRedirects() {
        val download = transport.get("$base/relative", 1L shl 30, ArxCancellation()) { _, _ -> }
        assertEquals("$base/asset", download.finalUrl)
        assertContentEquals(body, download.bytes)
    }

    @Test
    fun neverRequestsARedirectHopThePolicyRefuses() {
        assertEquals(ArxViewerCode.DOWNLOAD_FAILED, failureCode { get("/to-credentials") })
        assertEquals(ArxViewerCode.DOWNLOAD_FAILED, failureCode { get("/to-http-remote") })
        assertEquals(mapOf("/to-credentials" to 1, "/to-http-remote" to 1), hits.toMap())
    }

    @Test
    fun keepsThePolicyIssueOfARefusedHop() {
        val failure = assertFailsWith<ArxOpenFailure> { get("/to-credentials") }
        assertEquals(listOf("ARX_URI_CREDENTIALS"), failure.issues.map { it.code.raw })
    }

    @Test
    fun refusesTheFirstUrlWithoutRequestingIt() {
        val strict = ArxHttpTransport()
        val failure = assertFailsWith<ArxOpenFailure> {
            strict.get("$base/asset", 1L shl 30, ArxCancellation()) { _, _ -> }
        }
        assertEquals(ArxViewerCode.DOWNLOAD_FAILED, failure.viewerCode)
        assertTrue(hits.isEmpty())
    }

    @Test
    fun refusesABodyWhoseContentLengthIsOverTheCap() {
        val reports = mutableListOf<Long>()
        val failure = assertFailsWith<ArxOpenFailure> {
            transport.get("$base/asset", 1000, ArxCancellation()) { count, _ -> reports += count }
        }
        assertEquals(ArxViewerCode.DOWNLOAD_TOO_LARGE, failure.viewerCode)
        assertEquals(emptyList(), reports, "the body is not read when Content-Length is already over the cap")
    }

    @Test
    fun stopsReadingAsSoonAsTheCapIsExceeded() {
        val cap = 100_000L
        var received = 0L
        val failure = assertFailsWith<ArxOpenFailure> {
            transport.get("$base/endless", cap, ArxCancellation()) { count, _ -> received = count }
        }
        assertEquals(ArxViewerCode.DOWNLOAD_TOO_LARGE, failure.viewerCode)
        assertTrue(received <= cap, "stopped at $received bytes")
    }

    @Test
    fun acceptsABodyExactlyAtTheCap() {
        assertContentEquals(body, get("/asset", maxBytes = body.size.toLong()))
    }

    @Test
    fun reportsErrorStatusesAsDownloadFailures() {
        assertEquals(ArxViewerCode.DOWNLOAD_FAILED, failureCode { get("/missing") })
    }

    @Test
    fun stopsWhenCancelledWhileReading() {
        val cancellation = ArxCancellation()
        var received = 0L
        val failure = assertFailsWith<ArxOpenFailure> {
            transport.get("$base/slow", 1L shl 30, cancellation) { count, _ ->
                received = count
                if (count > 0) cancellation.cancel()
            }
        }
        assertEquals(ArxViewerCode.CANCELLED, failure.viewerCode)
        assertTrue(received < 200 * 1024, "stopped at $received bytes")
    }

    @Test
    fun cancelFromAnotherThreadUnblocksAWaitingRead() {
        val cancellation = ArxCancellation()
        Thread {
            Thread.sleep(150)
            cancellation.cancel()
        }.start()
        val started = System.nanoTime()
        assertEquals(ArxViewerCode.CANCELLED, failureCode { get("/slow", cancellation = cancellation) })
        assertTrue(System.nanoTime() - started < 3_000_000_000L, "the slow body takes about 4 s in full")
    }

    @Test
    fun doesNotRequestAfterCancellation() {
        val cancellation = ArxCancellation().apply { cancel() }
        assertEquals(ArxViewerCode.CANCELLED, failureCode { get("/asset", cancellation = cancellation) })
        assertTrue(hits.isEmpty())
    }

    @Test
    fun theLoaderFetcherIsCappedToo() {
        assertContentEquals(body, ArxHttp.fetcher(development)("$base/asset"))
        assertNull(ArxHttp.fetcher(development, maxBytes = 1000)("$base/asset"))
        assertNull(ArxHttp.fetcher(development, maxBytes = 100_000)("$base/endless"))
    }
}
