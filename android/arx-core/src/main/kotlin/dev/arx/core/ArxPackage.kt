package dev.arx.core

/** Implementation defaults, not format limits: ARX itself sets no size cap (spec 8.3). */
data class ArxPackageLimits(
    val maxEntries: Int = 1000,
    val maxTotalUncompressedBytes: Long = 1L shl 30,
    val maxCompressionRatio: Double = 100.0,
    val maxManifestBytes: Long = 1L shl 20,
)

data class ArxPackageResult(
    val issues: List<ArxIssue>,
    /** Present only when there are no errors. */
    val source: ArxLocalSource?,
)

/**
 * Safe reader for `.arx` packages (spec 8.3), matching the TypeScript `openPackage`
 * and ArxPackage.swift: every central directory entry is checked before anything
 * is decompressed.
 */
object ArxPackage {
    private const val MANIFEST_NAME = "manifest.json"
    private val expectedExtensions = listOf(".json", ".jpg", ".jpeg", ".png", ".mp4")

    fun open(
        data: ByteArray,
        limits: ArxPackageLimits = ArxPackageLimits(),
        fetcher: ArxFetcher = ArxHttp.fetcher(),
    ): ArxPackageResult {
        val reader = ZipReader(data)
        val entries = try {
            reader.readCentralDirectory()
        } catch (failure: ZipFailure) {
            return ArxPackageResult(listOf(failure.issue("zip:")), null)
        }

        val issues = checkEntries(entries, limits).toMutableList()
        if (issues.hasErrors) return ArxPackageResult(issues, null)

        val files = HashMap<String, ByteArray>()
        for (entry in entries) {
            if (entry.isDirectory) continue
            try {
                files[entry.name] = reader.extract(entry)
            } catch (failure: ZipFailure) {
                issues += ArxIssue.error(ArxIssueCode.PACKAGE_CORRUPT, "zip:${entry.name}", failure.message ?: "corrupt entry")
            }
        }
        if (issues.hasErrors) return ArxPackageResult(issues, null)

        val source = ArxLocalSource(readLocal = { path -> files[path]?.copyOf() }, fetcher = fetcher)
        return ArxPackageResult(issues, source)
    }

    private fun checkEntries(entries: List<ZipCentralEntry>, limits: ArxPackageLimits): List<ArxIssue> {
        if (entries.size > limits.maxEntries) {
            return listOf(
                ArxIssue.error(ArxIssueCode.PACKAGE_LIMIT, "zip:", "${entries.size} entries exceed ${limits.maxEntries}"),
            )
        }
        val issues = mutableListOf<ArxIssue>()
        val seen = HashSet<String>()
        var total = 0L
        for (entry in entries) {
            val path = "zip:${entry.name}"
            val reason = unsafeNameReason(entry.name)
            if (reason != null) issues += ArxIssue.error(ArxIssueCode.PACKAGE_PATH, path, reason)
            if (entry.isSymlink) issues += ArxIssue.error(ArxIssueCode.PACKAGE_PATH, path, "symbolic links are not allowed")
            if (!seen.add(entry.name)) issues += ArxIssue.error(ArxIssueCode.PACKAGE_PATH, path, "duplicate entry")
            if (entry.flags and 1 != 0) {
                issues += ArxIssue.error(ArxIssueCode.PACKAGE_UNSUPPORTED, path, "encrypted entries are not supported")
            }
            if (entry.method != ZipReader.STORED && entry.method != ZipReader.DEFLATED) {
                issues += ArxIssue.error(ArxIssueCode.PACKAGE_UNSUPPORTED, path, "compression method ${entry.method}")
            }
            if (entry.compressedSize > 0 && entry.size.toDouble() / entry.compressedSize > limits.maxCompressionRatio) {
                issues += ArxIssue.error(ArxIssueCode.PACKAGE_LIMIT, path, "compression ratio exceeds the limit")
            }
            total += entry.size
            if (!entry.isDirectory && reason == null && !hasExpectedExtension(entry.name)) {
                issues += ArxIssue.warning(ArxIssueCode.PACKAGE_UNEXPECTED_FILE, path, "file type is not used by ARX 0.1")
            }
        }
        if (total > limits.maxTotalUncompressedBytes) {
            issues += ArxIssue.error(ArxIssueCode.PACKAGE_LIMIT, "zip:", "uncompressed size $total exceeds the limit")
        }
        val manifest = entries.firstOrNull { it.name == MANIFEST_NAME }
        if (manifest == null) {
            issues += ArxIssue.error(ArxIssueCode.PACKAGE_MANIFEST_MISSING, "zip:$MANIFEST_NAME", "manifest.json must be at the root")
        } else if (manifest.size > limits.maxManifestBytes) {
            issues += ArxIssue.error(ArxIssueCode.PACKAGE_LIMIT, "zip:$MANIFEST_NAME", "manifest.json exceeds the limit")
        }
        return issues
    }

    internal fun unsafeNameReason(name: String): String? {
        if (name.contains('\u0000')) return "NUL in entry name"
        if (name.contains('\\')) return "backslash in entry name"
        if (name.startsWith("/") || hasDriveLetter(name)) return "absolute entry name"
        val segments = name.removeSuffix("/").split("/")
        if (segments.any { it == ".." }) return "'..' in entry name"
        if (segments.any { it.isEmpty() }) return "empty path segment"
        return null
    }

    /** `/^[A-Za-z]:/` */
    private fun hasDriveLetter(name: String): Boolean =
        name.length >= 2 && name[1] == ':' && (name[0] in 'A'..'Z' || name[0] in 'a'..'z')

    /** `/\.(json|jpe?g|png|mp4)$/i`, folding ASCII letters only as a non-Unicode JavaScript regex does. */
    private fun hasExpectedExtension(name: String): Boolean {
        val folded = String(CharArray(name.length) { index -> name[index].let { if (it in 'A'..'Z') it + 32 else it } })
        return expectedExtensions.any { folded.endsWith(it) }
    }
}
