package dev.arx.core

/**
 * Portable ARX 0.1 issue codes (spec 13). The raw values match the TypeScript
 * and Swift validators exactly, so fixtures assert the same codes on every platform.
 */
enum class ArxIssueCode(val raw: String) {
    // Errors
    JSON_PARSE("ARX_JSON_PARSE"),
    SPEC_VERSION("ARX_SPEC_VERSION"),
    SCHEMA("ARX_SCHEMA"),
    DUPLICATE_LAYER_ID("ARX_DUPLICATE_LAYER_ID"),
    QUATERNION_NOT_UNIT("ARX_QUATERNION_NOT_UNIT"),
    EXTENSION_NOT_DECLARED("ARX_EXTENSION_NOT_DECLARED"),
    EXTENSION_UNSUPPORTED("ARX_EXTENSION_UNSUPPORTED"),
    URI_SCHEME("ARX_URI_SCHEME"),
    URI_PATH("ARX_URI_PATH"),
    URI_CREDENTIALS("ARX_URI_CREDENTIALS"),
    URI_PRIVATE_NETWORK("ARX_URI_PRIVATE_NETWORK"),
    ASSET_MISSING("ARX_ASSET_MISSING"),
    ASSET_DECODE("ARX_ASSET_DECODE"),
    INTEGRITY_MISMATCH("ARX_INTEGRITY_MISMATCH"),
    VIDEO_CODEC("ARX_VIDEO_CODEC"),
    VIDEO_PIXEL_FORMAT("ARX_VIDEO_PIXEL_FORMAT"),
    AUDIO_CODEC("ARX_AUDIO_CODEC"),
    PACKAGE_PATH("ARX_PACKAGE_PATH"),
    PACKAGE_LIMIT("ARX_PACKAGE_LIMIT"),
    PACKAGE_CORRUPT("ARX_PACKAGE_CORRUPT"),
    PACKAGE_UNSUPPORTED("ARX_PACKAGE_UNSUPPORTED"),
    PACKAGE_MANIFEST_MISSING("ARX_PACKAGE_MANIFEST_MISSING"),

    // Warnings
    QUATERNION_DRIFT("ARX_QUATERNION_DRIFT"),
    EXTENSION_UNDECLARED("ARX_EXTENSION_UNDECLARED"),
    TARGET_LOW_RESOLUTION("ARX_TARGET_LOW_RESOLUTION"),
    TARGET_ALPHA("ARX_TARGET_ALPHA"),
    IMAGE_ORIENTATION("ARX_IMAGE_ORIENTATION"),
    ASSET_TYPE_MISMATCH("ARX_ASSET_TYPE_MISMATCH"),
    VIDEO_NOT_FASTSTART("ARX_VIDEO_NOT_FASTSTART"),
    VIDEO_PROFILE("ARX_VIDEO_PROFILE"),
    VIDEO_RESOLUTION("ARX_VIDEO_RESOLUTION"),
    VIDEO_FRAME_RATE("ARX_VIDEO_FRAME_RATE"),
    VIDEO_BITRATE("ARX_VIDEO_BITRATE"),
    VIDEO_ROTATION("ARX_VIDEO_ROTATION"),
    PACKAGE_UNEXPECTED_FILE("ARX_PACKAGE_UNEXPECTED_FILE"),

    // Warnings of the ARX_effects extension (spec/extensions/ARX_effects.md section 9)
    EFFECT_INVALID("ARX_EFFECT_INVALID"),
    EFFECT_UNSUPPORTED("ARX_EFFECT_UNSUPPORTED"),
    ;

    override fun toString(): String = raw
}

data class ArxIssue(
    val code: ArxIssueCode,
    val severity: Severity,
    /** JSON Pointer into the manifest, or `zip:<entry>` for package entries. */
    val path: String,
    val message: String,
) {
    enum class Severity(val raw: String) {
        ERROR("error"),
        WARNING("warning"),
        ;

        override fun toString(): String = raw
    }

    override fun toString(): String = "${severity.raw} ${code.raw} $path: $message"

    companion object {
        fun error(code: ArxIssueCode, path: String, message: String) =
            ArxIssue(code, Severity.ERROR, path, message)

        fun warning(code: ArxIssueCode, path: String, message: String) =
            ArxIssue(code, Severity.WARNING, path, message)
    }
}

val List<ArxIssue>.hasErrors: Boolean
    get() = any { it.severity == ArxIssue.Severity.ERROR }
