package dev.arx.core.open

import dev.arx.core.ArxIssue
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean

/** Failure codes of opening a work that are not about its content; validation failures use [dev.arx.core.ArxIssueCode] raw values instead. */
enum class ArxViewerCode(val raw: String) {
    NOT_ARX("VIEWER_NOT_ARX"),
    LINK_TOO_LONG("VIEWER_LINK_TOO_LONG"),
    DOWNLOAD_FAILED("VIEWER_DOWNLOAD_FAILED"),
    DOWNLOAD_TOO_LARGE("VIEWER_DOWNLOAD_TOO_LARGE"),
    CANCELLED("VIEWER_CANCELLED"),

    /** A video layer failed to play (spec 9.3); raised by the app, not the opener. */
    PLAYBACK_FAILED("VIEWER_PLAYBACK_FAILED"),

    /** The tracker refused the target image (too few features); raised by the app. */
    TARGET_UNUSABLE("VIEWER_TARGET_UNUSABLE"),

    /** An unexpected, non-ARX failure; also the message shown for a code without one. */
    UNKNOWN("VIEWER_UNKNOWN"),

    /** The bundle of works is malformed. */
    EXHIBITION_INVALID("VIEWER_EXHIBITION_INVALID"),

    /** The bundle of works uses a format version this app does not support. */
    EXHIBITION_UNSUPPORTED("VIEWER_EXHIBITION_UNSUPPORTED"),

    /** The bundle of works has more works than the app opens. */
    EXHIBITION_TOO_LARGE("VIEWER_EXHIBITION_TOO_LARGE"),

    /** The bundle of works has no work the app can recognise. */
    EXHIBITION_EMPTY("VIEWER_EXHIBITION_EMPTY"),

    /** The bundle of works was taken down. */
    EXHIBITION_CLOSED("VIEWER_EXHIBITION_CLOSED"),
    ;

    override fun toString(): String = raw

    companion object {
        fun fromRaw(raw: String): ArxViewerCode? = entries.firstOrNull { it.raw == raw }
    }
}

/**
 * Why a link could not be opened. [code] is an [ArxViewerCode] raw value or an
 * [dev.arx.core.ArxIssueCode] raw value; for an invalid work it is the first
 * error's code and [issues] holds every issue the validator reported.
 */
class ArxOpenFailure(
    val code: String,
    val issues: List<ArxIssue> = emptyList(),
    message: String? = null,
    cause: Throwable? = null,
) : Exception(message ?: describe(code, issues), cause) {
    constructor(code: ArxViewerCode, message: String? = null, cause: Throwable? = null) :
        this(code.raw, emptyList(), message, cause)

    /** The [ArxViewerCode], or null when [code] comes from validation. */
    val viewerCode: ArxViewerCode? get() = ArxViewerCode.fromRaw(code)

    private companion object {
        fun describe(code: String, issues: List<ArxIssue>): String =
            if (issues.isEmpty()) code else "$code\n" + issues.joinToString("\n")
    }
}

/**
 * Thread-safe cancellation token. [cancel] may be called from any thread; the
 * transport checks it between chunks, and registered handlers (for example
 * closing a blocked connection) run once when it fires.
 */
class ArxCancellation {
    private val cancelled = AtomicBoolean(false)
    private val handlers = CopyOnWriteArrayList<() -> Unit>()

    val isCancelled: Boolean get() = cancelled.get()

    fun cancel() {
        if (!cancelled.compareAndSet(false, true)) return
        for (handler in handlers) runHandler(handler)
    }

    /** Runs [handler] on cancellation (at once if already cancelled) until the returned handle is closed. */
    internal fun onCancel(handler: () -> Unit): AutoCloseable {
        handlers += handler
        if (isCancelled && handlers.remove(handler)) runHandler(handler)
        return AutoCloseable { handlers.remove(handler) }
    }

    internal fun throwIfCancelled() {
        if (isCancelled) throw ArxOpenFailure(ArxViewerCode.CANCELLED)
    }

    private fun runHandler(handler: () -> Unit) {
        try {
            handler()
        } catch (_: Exception) {
            // A handler only speeds up cancellation; the flag is what callers check.
        }
    }
}
