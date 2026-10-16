package dev.arx.core

import java.io.File

/** The shared conformance fixtures live at the repository root (see build.gradle.kts). */
object Fixtures {
    val repoRoot: File = File(checkNotNull(System.getProperty("arx.repoRoot")) { "arx.repoRoot is not set" })
    val root: File = File(repoRoot, "fixtures")

    fun file(relative: String): File = File(root, relative)

    fun bytes(relative: String): ByteArray = file(relative).readBytes()

    /** Fixture directory names of [kind] ("positive" or "negative") that have an expected.json, sorted. */
    fun names(kind: String): List<String> =
        File(root, kind).list().orEmpty().filter { File(root, "$kind/$it/expected.json").isFile }.sorted()
}
