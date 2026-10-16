package dev.arx.core

import java.security.MessageDigest
import java.util.Base64

/** SHA-256 digests for asset integrity (spec 8.2) and content-addressed cache names. */
object ArxIntegrity {
    /** Subresource-Integrity style digest: `sha256-<base64>`. */
    fun sha256(data: ByteArray): String = "sha256-" + Base64.getEncoder().encodeToString(digest(data))

    /** Lowercase hex digest, used for cache file names. */
    fun sha256Hex(data: ByteArray): String = digest(data).joinToString("") { "%02x".format(it) }

    private fun digest(data: ByteArray): ByteArray = MessageDigest.getInstance("SHA-256").digest(data)
}
