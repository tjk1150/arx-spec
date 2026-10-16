package dev.arx.core.effects

import java.nio.CharBuffer
import java.nio.charset.CodingErrorAction

/**
 * Seed and random sequence of the deterministic simulation (spec/extensions/ARX_effects.md 7.2),
 * ported from packages/arx-core/src/effects/utils/random.ts. Unsigned 32-bit values are held in
 * Int bit patterns: Int multiplication keeps the low 32 bits of a product like Math.imul, and
 * `ushr` is `>>>`.
 */
object EffectRandom {
    private const val FNV_OFFSET = 0x811C9DC5L.toInt()
    private const val FNV_PRIME = 0x01000193
    private const val GOLDEN_STEP = 0x6D2B79F5
    private const val TWO_TO_32 = 4294967296.0

    /** U+FFFD, the bytes TextEncoder writes for a lone surrogate. */
    private val REPLACEMENT = byteArrayOf(0xEF.toByte(), 0xBF.toByte(), 0xBD.toByte())

    /**
     * UTF-8 bytes of [text] as the browser TextEncoder writes them: a lone surrogate becomes U+FFFD,
     * where String.toByteArray would write '?'.
     */
    private fun utf8(text: String): ByteArray {
        val encoder = Charsets.UTF_8.newEncoder()
            .onMalformedInput(CodingErrorAction.REPLACE)
            .onUnmappableCharacter(CodingErrorAction.REPLACE)
            .replaceWith(REPLACEMENT)
        val buffer = encoder.encode(CharBuffer.wrap(text))
        return ByteArray(buffer.remaining()).also { buffer.get(it) }
    }

    /** FNV-1a 32-bit hash of the UTF-8 bytes of [text] (the seed of an effect id), as an Int bit pattern. */
    fun fnv1a32(text: String): Int =
        utf8(text).fold(FNV_OFFSET) { hash, byte -> (hash xor (byte.toInt() and 0xFF)) * FNV_PRIME }

    /**
     * Value [position] (0-based) of the mulberry32 sequence of [seed], in [0, 1). The state before
     * output `position` is seed + (position + 1) * 0x6D2B79F5 mod 2^32, so any position is read
     * directly; `toInt` keeps `position + 1` mod 2^32 as Math.imul does, so positions past 2^32
     * wrap the same way.
     */
    fun mulberry32At(seed: Int, position: Long): Double {
        val state = seed + (position + 1).toInt() * GOLDEN_STEP
        val first = (state xor (state ushr 15)) * (state or 1)
        val second = (first + (first xor (first ushr 7)) * (first or 61)) xor first
        val output = second xor (second ushr 14)
        return (output.toLong() and 0xFFFFFFFFL).toDouble() / TWO_TO_32
    }
}
