package dev.arx.core

import java.io.File
import java.io.IOException

/**
 * Content-addressed store for validated asset bytes: `<sha256 hex>.<ext>` in
 * [directory]. An existing file is reused only when its bytes are exactly the
 * validated ones; otherwise it is replaced atomically (temp file, then rename).
 */
internal class ArxAssetCache(private val directory: File) {
    fun store(data: ByteArray, fileExtension: String, path: String, issues: MutableList<ArxIssue>): File? {
        val file = File(directory, "${ArxIntegrity.sha256Hex(data)}.$fileExtension")
        return try {
            if (!directory.isDirectory && !directory.mkdirs() && !directory.isDirectory) {
                throw IOException("cannot create ${directory.path}")
            }
            if (!holds(file, data)) write(file, data)
            file
        } catch (failure: IOException) {
            issues += ArxIssue.error(ArxIssueCode.ASSET_MISSING, path, "cannot cache asset: ${failure.message}")
            null
        } catch (failure: SecurityException) {
            issues += ArxIssue.error(ArxIssueCode.ASSET_MISSING, path, "cannot cache asset: ${failure.message}")
            null
        }
    }

    private fun holds(file: File, data: ByteArray): Boolean =
        file.isFile && file.length() == data.size.toLong() && file.readBytes().contentEquals(data)

    private fun write(file: File, data: ByteArray) {
        val temporary = File.createTempFile("arx-", ".partial", directory)
        try {
            temporary.writeBytes(data)
            if (!temporary.renameTo(file)) throw IOException("cannot move asset into ${file.path}")
        } finally {
            temporary.delete()
        }
    }
}
