package dev.arx.core.open

import com.sun.net.httpserver.HttpServer
import dev.arx.core.ArxUriPolicy
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.test.assertEquals

/**
 * [ArxHttpTransport] sends its default Accept header (ARX zip above JSON above anything else) on every request,
 * including after a redirect hop, and a caller can override it via the
 * `requestHeaders` constructor argument.
 */
class ArxHttpAcceptTest {
    private lateinit var server: HttpServer
    private val executor: ExecutorService = Executors.newCachedThreadPool()
    private val acceptHeaders = ConcurrentHashMap<String, String?>()
    private val development = ArxUriPolicy(allowInsecureLocalhost = true, allowPrivateNetwork = true)

    private val base: String get() = "http://127.0.0.1:${server.address.port}"

    @BeforeEach
    fun start() {
        server = HttpServer.create(InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0)
        server.executor = executor
        server.createContext("/") { exchange ->
            val path = exchange.requestURI.path
            acceptHeaders[path] = exchange.requestHeaders.getFirst("Accept")
            if (path == "/redirect") {
                exchange.responseHeaders.add("Location", "/asset")
                exchange.sendResponseHeaders(302, -1)
            } else {
                exchange.sendResponseHeaders(200, 0)
            }
            exchange.close()
        }
        server.start()
    }

    @AfterEach
    fun stop() {
        server.stop(0)
        executor.shutdownNow()
    }

    private fun get(transport: ArxHttpTransport, path: String) {
        transport.get("$base$path", 1L shl 20, ArxCancellation()) { _, _ -> }
    }

    @Test
    fun sendsTheDefaultAcceptHeader() {
        get(ArxHttpTransport(development), "/asset")
        assertEquals(
            "application/x-arx+zip, application/json;q=0.9, */*;q=0.1",
            acceptHeaders["/asset"],
        )
    }

    @Test
    fun sendsTheSameAcceptHeaderAfterARedirect() {
        get(ArxHttpTransport(development), "/redirect")
        assertEquals(acceptHeaders["/redirect"], acceptHeaders["/asset"])
    }

    @Test
    fun sendsAnOverriddenAcceptHeaderWhenGiven() {
        val transport = ArxHttpTransport(development, requestHeaders = mapOf("Accept" to "application/json"))
        get(transport, "/asset")
        assertEquals("application/json", acceptHeaders["/asset"])
    }
}
