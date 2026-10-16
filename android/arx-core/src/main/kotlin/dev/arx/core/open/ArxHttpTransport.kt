package dev.arx.core.open

import dev.arx.core.ArxHttp
import dev.arx.core.ArxUri
import dev.arx.core.ArxUriPolicy
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLSocketFactory

/**
 * HTTPS downloads under the ARX URI policy (spec 7), shared by app code and
 * [ArxHttp.fetcher]. Redirects are followed by hand and every hop is checked
 * against [policy] before it is requested, so a redirect cannot reach a private
 * host or downgrade to http. The body is read in chunks and the download stops
 * as soon as it exceeds the cap (at once when Content-Length already does).
 *
 * [trustedRootCertificates] (DER or PEM) is for development servers with a
 * private CA: when present, a server chain is accepted if it leads to a system
 * root or to one of these. Blocking: call it off the main thread.
 *
 * [requestHeaders] is set on every hop, including after a redirect. The default
 * Accept ranks the ARX zip format above JSON above anything else.
 */
class ArxHttpTransport(
    private val policy: ArxUriPolicy = ArxUriPolicy(),
    trustedRootCertificates: List<ByteArray> = emptyList(),
    private val timeouts: ArxHttpTimeouts = ArxHttpTimeouts(),
    private val maxRedirects: Int = ArxHttp.DEFAULT_MAX_REDIRECTS,
    private val requestHeaders: Map<String, String> = DEFAULT_REQUEST_HEADERS,
) : ArxTransport {
    private val socketFactory: SSLSocketFactory? =
        if (trustedRootCertificates.isEmpty()) null else ArxTrust.socketFactory(trustedRootCertificates)

    override fun get(
        url: String,
        maxBytes: Long,
        cancellation: ArxCancellation,
        progress: (received: Long, expected: Long?) -> Unit,
    ): ArxDownload {
        var current = ArxUri.parse(url) ?: throw failed("unparseable URL: $url")
        repeat(maxRedirects + 1) {
            cancellation.throwIfCancelled()
            ArxUri.checkAbsolute(current, "", policy)?.let { issue ->
                throw ArxOpenFailure(ArxViewerCode.DOWNLOAD_FAILED.raw, listOf(issue), "refused $current: ${issue.message}")
            }
            when (val hop = request(current, maxBytes, cancellation, progress)) {
                is Hop.Body -> return ArxDownload(hop.bytes, current.toString())
                is Hop.Redirect -> current = resolveLocation(current, hop.location)
                    ?: throw failed("bad redirect location ${hop.location}")
            }
        }
        throw failed("more than $maxRedirects redirects from $url")
    }

    private sealed interface Hop {
        class Body(val bytes: ByteArray) : Hop

        class Redirect(val location: String) : Hop
    }

    private fun request(
        url: URI,
        maxBytes: Long,
        cancellation: ArxCancellation,
        progress: (Long, Long?) -> Unit,
    ): Hop {
        val connection = try {
            url.toURL().openConnection() as? HttpURLConnection ?: throw failed("not an HTTP URL: $url")
        } catch (failure: IOException) {
            throw failed("cannot open $url", failure)
        } catch (failure: IllegalArgumentException) {
            throw failed("cannot open $url", failure)
        }
        // Closing the connection unblocks a read that is waiting on the network.
        val registration = cancellation.onCancel { connection.disconnect() }
        return try {
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.connectTimeout = timeouts.connectMillis
            connection.readTimeout = timeouts.readMillis
            for ((name, value) in requestHeaders) connection.setRequestProperty(name, value)
            if (connection is HttpsURLConnection && socketFactory != null) connection.sslSocketFactory = socketFactory
            val status = connection.responseCode
            when {
                status in 200..299 -> Hop.Body(readBody(connection, url, maxBytes, cancellation, progress))
                status in redirectStatuses ->
                    Hop.Redirect(connection.getHeaderField("Location") ?: throw failed("HTTP $status without Location"))
                else -> throw failed("HTTP $status from $url")
            }
        } catch (failure: IOException) {
            throw interrupted(cancellation, url, failure)
        } catch (failure: SecurityException) {
            throw interrupted(cancellation, url, failure)
        } finally {
            registration.close()
            connection.disconnect()
        }
    }

    private fun readBody(
        connection: HttpURLConnection,
        url: URI,
        maxBytes: Long,
        cancellation: ArxCancellation,
        progress: (Long, Long?) -> Unit,
    ): ByteArray {
        val limit = minOf(maxBytes, MAX_ARRAY_BYTES)
        val expected = connection.contentLengthLong.takeIf { it >= 0 }
        if (expected != null && expected > limit) throw tooLarge(url, limit)
        progress(0, expected)
        connection.inputStream.use { input ->
            val output = ByteArrayOutputStream(minOf(expected ?: CHUNK_BYTES.toLong(), INITIAL_BUFFER_BYTES).toInt())
            val buffer = ByteArray(CHUNK_BYTES)
            var received = 0L
            while (true) {
                cancellation.throwIfCancelled()
                val count = input.read(buffer)
                if (count < 0) break
                received += count
                if (received > limit) throw tooLarge(url, limit)
                output.write(buffer, 0, count)
                progress(received, expected)
            }
            return output.toByteArray()
        }
    }

    private fun interrupted(cancellation: ArxCancellation, url: URI, cause: Exception): ArxOpenFailure =
        if (cancellation.isCancelled) {
            ArxOpenFailure(ArxViewerCode.CANCELLED, cause = cause)
        } else {
            failed("cannot download $url: ${cause.message}", cause)
        }

    /** A Location header may be relative to the URL that answered. */
    private fun resolveLocation(current: URI, location: String): URI? {
        val reference = ArxUri.parse(location.trim()) ?: return null
        return try {
            current.resolve(reference)
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private companion object {
        const val CHUNK_BYTES = 64 * 1024
        const val INITIAL_BUFFER_BYTES = 1L shl 20
        const val MAX_ARRAY_BYTES = Int.MAX_VALUE - 8L
        val redirectStatuses = setOf(301, 302, 303, 307, 308)

        // Ranks the ARX zip format above JSON above anything else.
        val DEFAULT_REQUEST_HEADERS = mapOf(
            "Accept" to "application/x-arx+zip, application/json;q=0.9, */*;q=0.1",
        )

        fun failed(message: String, cause: Throwable? = null) =
            ArxOpenFailure(ArxViewerCode.DOWNLOAD_FAILED, message, cause)

        fun tooLarge(url: URI, limit: Long) =
            ArxOpenFailure(ArxViewerCode.DOWNLOAD_TOO_LARGE, "$url is larger than $limit bytes")
    }
}
