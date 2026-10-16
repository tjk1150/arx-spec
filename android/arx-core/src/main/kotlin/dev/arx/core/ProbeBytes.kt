package dev.arx.core

/**
 * Byte access for the media probes, mirroring the TypeScript semantics:
 * multi-byte reads past the end throw (like `DataView`), single-byte reads
 * return null (like indexing a `Uint8Array`), and [ascii]/[slice] clamp to the
 * available bytes (like `subarray`). Offsets are Long so 32-bit sizes never wrap.
 */
internal class ProbeBytes(val bytes: ByteArray) {
    class OutOfBounds : Exception()

    val count: Int get() = bytes.size

    fun byte(offset: Long): Int? = if (offset >= 0 && offset < bytes.size) bytes[offset.toInt()].toInt() and 0xff else null

    fun unsigned(offset: Long, width: Int, little: Boolean = false): Long {
        if (offset < 0 || offset > bytes.size - width) throw OutOfBounds()
        var value = 0L
        for (index in 0 until width) {
            val position = (if (little) offset + width - 1 - index else offset + index).toInt()
            value = (value shl 8) or (bytes[position].toLong() and 0xff)
        }
        return value
    }

    fun uint16(offset: Long, little: Boolean = false): Long = unsigned(offset, 2, little)

    fun uint32(offset: Long, little: Boolean = false): Long = unsigned(offset, 4, little)

    fun int32(offset: Long): Long = unsigned(offset, 4).toInt().toLong()

    /** Raw 64 bits; values of 2^63 and above come back negative. */
    fun uint64(offset: Long): Long = unsigned(offset, 8)

    /** Bytes `start until end`, clamped to the array; empty when the range is inverted. */
    fun slice(start: Long, end: Long): ProbeBytes {
        val lower = start.coerceIn(0, bytes.size.toLong())
        val upper = end.coerceIn(lower, bytes.size.toLong())
        return ProbeBytes(bytes.copyOfRange(lower.toInt(), upper.toInt()))
    }

    /** Each byte as one Latin-1 character, like `String.fromCharCode`. */
    fun ascii(start: Long, length: Int): String =
        String(slice(start, start + length).bytes, Charsets.ISO_8859_1)

    fun startsWith(prefix: ByteArray): Boolean =
        bytes.size >= prefix.size && prefix.indices.all { bytes[it] == prefix[it] }
}
