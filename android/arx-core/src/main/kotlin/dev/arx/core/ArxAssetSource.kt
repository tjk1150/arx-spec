package dev.arx.core

import java.io.File
import java.io.IOException

/** Reads bytes for an absolute URL; null when missing or unreachable. May block. */
typealias ArxFetcher = (String) -> ByteArray?

/** Base URL for manifests read from a local directory or a `.arx` package. */
object ArxLocal {
    const val MANIFEST_URL = "arx-package://root/manifest.json"
    const val ORIGIN = "arx-package://root/"

    /** Maps an `arx-package://root/...` URL to its percent-decoded relative path, or null for other URLs. */
    fun relativePath(url: String): String? =
        if (url.startsWith(ORIGIN)) ArxUri.percentDecode(url.substring(ORIGIN.length)) else null
}

/** Where a manifest and its assets come from (spec 9.1). */
interface ArxAssetSource {
    val manifestUrl: String

    /** Bytes at an absolute URL, or null when missing or unreachable. May block. */
    fun read(url: String): ByteArray?
}

/** A manifest served over HTTPS; relative assets resolve against its URL. */
class ArxRemoteSource(
    override val manifestUrl: String,
    private val fetcher: ArxFetcher = ArxHttp.fetcher(),
) : ArxAssetSource {
    override fun read(url: String): ByteArray? = fetcher(url)
}

/**
 * A local manifest (directory, package or app assets). Package-relative paths go
 * to [readLocal], which receives only the decoded relative path such as
 * `assets/target.jpg`; absolute HTTPS assets go to [fetcher].
 */
class ArxLocalSource(
    private val readLocal: (String) -> ByteArray?,
    private val fetcher: ArxFetcher = ArxHttp.fetcher(),
) : ArxAssetSource {
    override val manifestUrl: String = ArxLocal.MANIFEST_URL

    override fun read(url: String): ByteArray? {
        if (!url.startsWith(ArxLocal.ORIGIN)) return fetcher(url)
        val path = ArxLocal.relativePath(url) ?: return null
        return readLocal(path)
    }

    companion object {
        /** A manifest.json directory; reads never leave [directory], even through symlinks. */
        fun directory(directory: File, fetcher: ArxFetcher = ArxHttp.fetcher()): ArxLocalSource {
            val root = directory.canonicalFile
            return ArxLocalSource(
                readLocal = { relative ->
                    try {
                        val file = File(root, relative).canonicalFile
                        val inside = file == root || file.path.startsWith(root.path + File.separator)
                        if (inside && file.isFile) file.readBytes() else null
                    } catch (_: IOException) {
                        null
                    } catch (_: SecurityException) {
                        null
                    }
                },
                fetcher = fetcher,
            )
        }
    }
}
