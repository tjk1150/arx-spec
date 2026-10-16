package dev.arx.core

import java.io.ByteArrayOutputStream
import java.util.zip.DataFormatException
import java.util.zip.Inflater

/** One central directory record, read before anything is decompressed. */
internal class ZipCentralEntry(
    val name: String,
    val flags: Int,
    val method: Int,
    val compressedSize: Long,
    val size: Long,
    val localOffset: Long,
    val isSymlink: Boolean,
) {
    val isDirectory: Boolean get() = name.endsWith("/")
}

/** A structural failure; [unsupported] selects ARX_PACKAGE_UNSUPPORTED over ARX_PACKAGE_CORRUPT. */
internal class ZipFailure(message: String, val unsupported: Boolean = false) : Exception(message) {
    fun issue(path: String): ArxIssue = ArxIssue.error(
        if (unsupported) ArxIssueCode.PACKAGE_UNSUPPORTED else ArxIssueCode.PACKAGE_CORRUPT,
        path,
        message ?: "corrupt archive",
    )
}

/**
 * Minimal ZIP reader over bytes in memory, matching zip.ts: the central directory
 * is parsed by hand so the checks see raw names, flags and external attributes,
 * and inflation stops as soon as the output would exceed the declared size.
 */
internal class ZipReader(private val bytes: ByteArray) {
    private val count: Int get() = bytes.size

    private fun uint16(offset: Long): Long? =
        if (offset >= 0 && offset + 2 <= count) {
            (bytes[offset.toInt()].toLong() and 0xff) or ((bytes[offset.toInt() + 1].toLong() and 0xff) shl 8)
        } else {
            null
        }

    private fun uint32(offset: Long): Long? {
        val low = uint16(offset) ?: return null
        val high = uint16(offset + 2) ?: return null
        return low or (high shl 16)
    }

    /** Clamped like `Uint8Array.subarray`: a range past the end yields fewer (or no) bytes. */
    private fun slice(start: Long, length: Long): ByteArray {
        val lower = start.coerceIn(0, count.toLong())
        val upper = (start + length).coerceIn(lower, count.toLong())
        return bytes.copyOfRange(lower.toInt(), upper.toInt())
    }

    fun readCentralDirectory(): List<ZipCentralEntry> {
        val searchStart = maxOf(0L, count - 22L - 0xffff)
        var end = -1L
        var offset = count - 22L
        while (offset >= searchStart) {
            if (uint32(offset) == END_OF_CENTRAL_DIRECTORY) {
                end = offset
                break
            }
            offset--
        }
        val entryCount = if (end >= 0) uint16(end + 10) else null
        val directoryOffset = if (end >= 0) uint32(end + 16) else null
        if (entryCount == null || directoryOffset == null) throw ZipFailure("end of central directory not found")
        if (entryCount == 0xffffL || directoryOffset == 0xffff_ffffL) {
            throw ZipFailure("ZIP64 archives are not supported", unsupported = true)
        }

        val entries = mutableListOf<ZipCentralEntry>()
        var cursor = directoryOffset
        repeat(entryCount.toInt()) {
            if (cursor + 46 > count || uint32(cursor) != CENTRAL_FILE_HEADER) throw ZipFailure("bad central directory entry")
            val versionMadeBy = uint16(cursor + 4)!!
            val nameLength = uint16(cursor + 28)!!
            val extraLength = uint16(cursor + 30)!!
            val commentLength = uint16(cursor + 32)!!
            val mode = uint32(cursor + 38)!! ushr 16
            entries += ZipCentralEntry(
                name = decodeName(slice(cursor + 46, nameLength)),
                flags = uint16(cursor + 8)!!.toInt(),
                method = uint16(cursor + 10)!!.toInt(),
                compressedSize = uint32(cursor + 20)!!,
                size = uint32(cursor + 24)!!,
                localOffset = uint32(cursor + 42)!!,
                isSymlink = (versionMadeBy shr 8) == UNIX_HOST && (mode and FILE_TYPE_MASK) == SYMLINK_MODE,
            )
            cursor += 46 + nameLength + extraLength + commentLength
        }
        return entries
    }

    fun extract(entry: ZipCentralEntry): ByteArray {
        val header = entry.localOffset
        if (header + 30 > count || uint32(header) != LOCAL_FILE_HEADER) throw ZipFailure("bad local header")
        val start = header + 30 + uint16(header + 26)!! + uint16(header + 28)!!
        val compressed = slice(start, entry.compressedSize)
        if (compressed.size.toLong() != entry.compressedSize) throw ZipFailure("truncated entry")
        if (entry.method == STORED) {
            if (entry.compressedSize != entry.size) throw ZipFailure("stored size mismatch")
            return compressed
        }
        return inflateBounded(compressed, entry.size)
    }

    companion object {
        const val STORED = 0
        const val DEFLATED = 8
        private const val END_OF_CENTRAL_DIRECTORY = 0x0605_4b50L
        private const val CENTRAL_FILE_HEADER = 0x0201_4b50L
        private const val LOCAL_FILE_HEADER = 0x0403_4b50L
        private const val UNIX_HOST = 3L
        private const val SYMLINK_MODE = 0xA000L
        private const val FILE_TYPE_MASK = 0xF000L
        private const val INFLATE_CHUNK_SIZE = 64 * 1024

        /** UTF-8 with replacement characters and a stripped leading BOM, like `new TextDecoder("utf-8")`. */
        fun decodeName(raw: ByteArray): String = String(raw, Charsets.UTF_8).removePrefix("﻿")

        /** Raw DEFLATE that stops as soon as the output would exceed [expectedSize]. */
        fun inflateBounded(compressed: ByteArray, expectedSize: Long): ByteArray {
            if (expectedSize > Int.MAX_VALUE - 8) throw ZipFailure("entry is too large to hold in memory")
            // An empty stream inflates to nothing, as in fflate.
            if (compressed.isEmpty()) {
                if (expectedSize != 0L) throw ZipFailure("data is shorter than declared size")
                return ByteArray(0)
            }
            // Grows with the real output, so a lying size header cannot force a large allocation.
            val output = ByteArrayOutputStream(minOf(expectedSize, INFLATE_CHUNK_SIZE.toLong()).toInt())
            val chunk = ByteArray(INFLATE_CHUNK_SIZE)
            val inflater = Inflater(true)
            try {
                inflater.setInput(compressed)
                var written = 0L
                while (!inflater.finished()) {
                    // Ask for at most one byte beyond the declared size.
                    val room = minOf(expectedSize - written + 1, chunk.size.toLong()).toInt()
                    val produced = inflater.inflate(chunk, 0, room)
                    if (written + produced > expectedSize) throw ZipFailure("data exceeds declared size")
                    output.write(chunk, 0, produced)
                    written += produced
                    if (produced == 0 && !inflater.finished() && (inflater.needsInput() || inflater.needsDictionary())) {
                        throw ZipFailure("unexpected end of deflate data")
                    }
                }
                if (written != expectedSize) throw ZipFailure("data is shorter than declared size")
                return output.toByteArray()
            } catch (failure: DataFormatException) {
                throw ZipFailure("invalid deflate data: ${failure.message}")
            } finally {
                inflater.end()
            }
        }
    }
}
