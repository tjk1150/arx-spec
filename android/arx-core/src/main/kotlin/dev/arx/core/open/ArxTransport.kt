package dev.arx.core.open

import dev.arx.core.ArxFetcher
import dev.arx.core.ArxHttp

/** A finished download: the body and the URL that answered it, after any redirects. */
class ArxDownload(val bytes: ByteArray, val finalUrl: String)

/**
 * Downloads one URL and returns the body with the final URL, so
 * relative references resolve against it as a browser would (a short link that
 * redirects to a manifest). Implementations block, stop as soon as the
 * body exceeds [maxBytes], check [cancellation] while reading, and report
 * progress as (bytes received, expected total when known). Failures are thrown
 * as [ArxOpenFailure] with [ArxViewerCode.DOWNLOAD_FAILED],
 * [ArxViewerCode.DOWNLOAD_TOO_LARGE] or [ArxViewerCode.CANCELLED].
 */
fun interface ArxTransport {
    fun get(
        url: String,
        maxBytes: Long,
        cancellation: ArxCancellation,
        progress: (received: Long, expected: Long?) -> Unit,
    ): ArxDownload
}

data class ArxHttpTimeouts(
    val connectMillis: Int = ArxHttp.DEFAULT_CONNECT_TIMEOUT_MILLIS,
    val readMillis: Int = ArxHttp.DEFAULT_READ_TIMEOUT_MILLIS,
)

/** Adapts a transport to the loader's [ArxFetcher], which reports any failure as a missing asset (null). */
internal fun ArxTransport.asFetcher(maxBytes: Long): ArxFetcher = { url ->
    try {
        get(url, maxBytes, ArxCancellation()) { _, _ -> }.bytes
    } catch (_: ArxOpenFailure) {
        null
    }
}
