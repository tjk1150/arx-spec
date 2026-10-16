package dev.arx.core

import java.io.ByteArrayOutputStream
import java.util.zip.Deflater

/** One archive entry for [TestZip.build]; mirrors the `Entry` helper in package.test.ts. */
data class TestZipEntry(
    val name: String,
    val data: ByteArray = ByteArray(0),
    /** Overrides the declared uncompressed size, to simulate a lying header. */
    val declaredSize: Long? = null,
    val deflate: Boolean = false,
    val symlink: Boolean = false,
    val encrypted: Boolean = false,
    /** Stored as-is instead of [data] (compressed when [deflate]), for crafted streams. */
    val body: ByteArray? = null,
)

/** Minimal ZIP writer so tests can build archives that real tools refuse to. */
object TestZip {
    val manifestBytes = """{"spec":"arx/0.1"}""".toByteArray()

    /** Raw DEFLATE (no zlib header), as stored in ZIP entries. */
    fun deflateRaw(raw: ByteArray): ByteArray {
        val deflater = Deflater(Deflater.BEST_COMPRESSION, true)
        try {
            deflater.setInput(raw)
            deflater.finish()
            val output = ByteArrayOutputStream()
            val buffer = ByteArray(8192)
            while (!deflater.finished()) output.write(buffer, 0, deflater.deflate(buffer))
            return output.toByteArray()
        } finally {
            deflater.end()
        }
    }

    fun build(entries: List<TestZipEntry>): ByteArray {
        val locals = ByteArrayOutputStream()
        val centrals = ByteArrayOutputStream()
        for (entry in entries) {
            val body = entry.body ?: if (entry.deflate) deflateRaw(entry.data) else entry.data
            val name = entry.name.toByteArray(Charsets.UTF_8)
            val size = entry.declaredSize ?: entry.data.size.toLong()
            val flags = if (entry.encrypted) 1 else 0
            val method = if (entry.deflate) 8 else 0
            val offset = locals.size().toLong()

            locals.u32(0x0403_4b50)
            locals.u16(20)
            locals.u16(flags)
            locals.u16(method)
            locals.zeros(8) // time, date, crc32
            locals.u32(body.size.toLong())
            locals.u32(size)
            locals.u16(name.size)
            locals.u16(0)
            locals.write(name)
            locals.write(body)

            centrals.u32(0x0201_4b50)
            centrals.u16(3 shl 8 or 20)
            centrals.u16(20)
            centrals.u16(flags)
            centrals.u16(method)
            centrals.zeros(8) // time, date, crc32
            centrals.u32(body.size.toLong())
            centrals.u32(size)
            centrals.u16(name.size)
            centrals.zeros(8) // extra, comment, disk, internal attributes
            centrals.u32((if (entry.symlink) 0xA1FFL else 0x81A4L) shl 16) // 0o120777 / 0o100644
            centrals.u32(offset)
            centrals.write(name)
        }
        val end = ByteArrayOutputStream()
        end.u32(0x0605_4b50)
        end.zeros(4)
        end.u16(entries.size)
        end.u16(entries.size)
        end.u32(centrals.size().toLong())
        end.u32(locals.size().toLong())
        end.u16(0)
        return locals.toByteArray() + centrals.toByteArray() + end.toByteArray()
    }

    private fun ByteArrayOutputStream.u16(value: Int) {
        write(value and 0xff)
        write(value shr 8 and 0xff)
    }

    private fun ByteArrayOutputStream.u32(value: Long) {
        for (shift in listOf(0, 8, 16, 24)) write((value shr shift and 0xff).toInt())
    }

    private fun ByteArrayOutputStream.zeros(count: Int) = write(ByteArray(count))
}
