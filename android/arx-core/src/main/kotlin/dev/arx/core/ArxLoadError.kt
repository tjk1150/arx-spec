package dev.arx.core

/** Runtime failures after validation (validation itself reports [ArxIssue] values). */
sealed class ArxLoadError(message: String) : Exception(message) {
    class UnreadableImage(val name: String) : ArxLoadError("cannot decode image $name")
}
