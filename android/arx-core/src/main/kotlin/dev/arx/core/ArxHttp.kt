package dev.arx.core

import dev.arx.core.open.ArxHttpTimeouts
import dev.arx.core.open.ArxHttpTransport
import dev.arx.core.open.asFetcher

/**
 * HTTPS downloads under the ARX URI policy (spec 7). Redirects are followed by
 * hand, and every hop is checked against the policy before it is requested, so
 * a redirect cannot reach a private host or downgrade to http. A body larger
 * than [maxBytes] is abandoned as soon as it exceeds the cap. Any failure reads
 * as null (a missing asset). Blocking: call it off the main thread.
 *
 * The work is done by [ArxHttpTransport], which callers can also use directly.
 */
object ArxHttp {
    const val DEFAULT_MAX_REDIRECTS = 5
    const val DEFAULT_CONNECT_TIMEOUT_MILLIS = 15_000
    const val DEFAULT_READ_TIMEOUT_MILLIS = 30_000

    /** Implementation default, not a format limit: ARX sets no size cap (spec 8.3). */
    const val DEFAULT_MAX_BYTES = 1L shl 30

    fun fetcher(
        policy: ArxUriPolicy = ArxUriPolicy(),
        maxRedirects: Int = DEFAULT_MAX_REDIRECTS,
        connectTimeoutMillis: Int = DEFAULT_CONNECT_TIMEOUT_MILLIS,
        readTimeoutMillis: Int = DEFAULT_READ_TIMEOUT_MILLIS,
        maxBytes: Long = DEFAULT_MAX_BYTES,
    ): ArxFetcher = ArxHttpTransport(
        policy = policy,
        timeouts = ArxHttpTimeouts(connectTimeoutMillis, readTimeoutMillis),
        maxRedirects = maxRedirects,
    ).asFetcher(maxBytes)
}
