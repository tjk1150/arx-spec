package dev.arx.core

import java.io.File

data class ArxValidationResult(val issues: List<ArxIssue>, val experience: ArxExperience?) {
    val isValid: Boolean get() = experience != null
}

/** Thrown by [ArxExperienceLoader.load] with every issue found when an experience is invalid. */
class ArxValidationFailure(val issues: List<ArxIssue>) : Exception(issues.joinToString("\n"))

/**
 * Full ARX 0.1 validation and loading (spec 9.1), ported from validate.ts and
 * ArxExperienceLoader.swift. Validated asset bytes are written to a
 * content-addressed cache in the caller's directory and the experience points
 * at those files, so what plays is exactly what was checked.
 *
 * Every function blocks (network and disk); call them off the main thread.
 */
object ArxExperienceLoader {
    /** ARCore recommends at least 300x300 px reference images. */
    const val MINIMUM_TARGET_PIXELS = 300

    fun validate(
        source: ArxAssetSource,
        cacheDir: File,
        options: ArxValidationOptions = ArxValidationOptions(),
    ): ArxValidationResult {
        val manifestData = readSafely(source, source.manifestUrl) ?: return ArxValidationResult(
            listOf(ArxIssue.error(ArxIssueCode.ASSET_MISSING, "", "cannot read ${source.manifestUrl}")),
            null,
        )
        val validation = ArxManifestValidator.validate(manifestData, source.manifestUrl, options)
        val manifest = validation.manifest
        val decoded = validation.decoded
        if (manifest == null || decoded == null) return ArxValidationResult(validation.issues, null)

        val issues = validation.issues.toMutableList()
        val loading = AssetLoading(source, options, ArxAssetCache(cacheDir), issues)
        val target = loading.loadTarget(manifest.anchor)
        val layers = manifest.layers.mapIndexedNotNull { index, layer -> loading.loadLayer(layer, index) }
        if (issues.hasErrors || target == null || layers.size != manifest.layers.size) {
            return ArxValidationResult(issues, null)
        }
        return ArxValidationResult(issues, ArxExperience(decoded, target, layers, manifest.effects))
    }

    /** Opens a `.arx` package safely, then validates the experience inside it. */
    fun validatePackage(
        packageBytes: ByteArray,
        cacheDir: File,
        options: ArxValidationOptions = ArxValidationOptions(),
        limits: ArxPackageLimits = ArxPackageLimits(),
        fetcher: ArxFetcher = ArxHttp.fetcher(options.uriPolicy),
    ): ArxValidationResult {
        val opened = ArxPackage.open(packageBytes, limits, fetcher)
        val source = opened.source ?: return ArxValidationResult(opened.issues, null)
        val result = validate(source, cacheDir, options)
        return ArxValidationResult(opened.issues + result.issues, result.experience)
    }

    /** Validates and returns the experience, or throws [ArxValidationFailure] with every issue found. */
    fun load(
        source: ArxAssetSource,
        cacheDir: File,
        options: ArxValidationOptions = ArxValidationOptions(),
    ): ArxExperience = validate(source, cacheDir, options).orThrow()

    fun load(source: ArxAssetSource, cacheDir: File, policy: ArxUriPolicy): ArxExperience =
        load(source, cacheDir, ArxValidationOptions(uriPolicy = policy))

    /** Opens and validates a `.arx` package, or throws [ArxValidationFailure]. */
    fun load(
        packageBytes: ByteArray,
        cacheDir: File,
        options: ArxValidationOptions = ArxValidationOptions(),
    ): ArxExperience = validatePackage(packageBytes, cacheDir, options).orThrow()

    /** A manifest.json directory (fixtures, local testing), or throws [ArxValidationFailure]. */
    fun load(
        directory: File,
        cacheDir: File,
        options: ArxValidationOptions = ArxValidationOptions(),
    ): ArxExperience =
        load(ArxLocalSource.directory(directory, ArxHttp.fetcher(options.uriPolicy)), cacheDir, options)

    private fun ArxValidationResult.orThrow(): ArxExperience = experience ?: throw ArxValidationFailure(issues)

    /** A source that throws is treated like one that returns nothing, as in validate.ts. */
    internal fun readSafely(source: ArxAssetSource, url: String): ByteArray? = try {
        source.read(url)
    } catch (_: Exception) {
        null
    }
}

/** Per-load asset reading, probing and caching; appends to [issues]. */
private class AssetLoading(
    private val source: ArxAssetSource,
    private val options: ArxValidationOptions,
    private val cache: ArxAssetCache,
    private val issues: MutableList<ArxIssue>,
) {
    fun loadTarget(anchor: ArxResolvedManifest.Anchor): ArxExperience.Target? {
        val path = "/anchor/src"
        val data = read(anchor.url, anchor.integrity, "/anchor") ?: return null
        val probe = probeImage(data, anchor.url, path) ?: return null
        val display = probe.displaySize
        if (minOf(display.width, display.height) < ArxExperienceLoader.MINIMUM_TARGET_PIXELS) {
            issues += ArxIssue.warning(
                ArxIssueCode.TARGET_LOW_RESOLUTION, path, "${display.width}x${display.height} is below 300x300",
            )
        }
        if (probe.hasAlpha) {
            issues += ArxIssue.warning(
                ArxIssueCode.TARGET_ALPHA, path, "transparent target; flatten it onto the printed background",
            )
        }
        val file = cache.store(data, imageExtension(probe), path, issues) ?: return null
        val width = display.width.toDouble()
        val height = display.height.toDouble()
        return ArxExperience.Target(
            file = file,
            sourceUrl = anchor.url,
            size = Geometry.planeSize(width, height),
            pixelWidth = width,
            pixelHeight = height,
            physicalWidth = anchor.physicalWidth,
        )
    }

    fun loadLayer(layer: ArxResolvedManifest.Layer, index: Int): ArxExperience.Layer? {
        val path = "/layers/$index/src"
        val data = read(layer.url, layer.integrity, "/layers/$index") ?: return null
        val width: Double
        val height: Double
        val fileExtension: String
        when (layer.type) {
            ArxManifest.LayerType.IMAGE -> {
                val probe = probeImage(data, layer.url, path) ?: return null
                width = probe.displaySize.width.toDouble()
                height = probe.displaySize.height.toDouble()
                fileExtension = imageExtension(probe)
            }
            ArxManifest.LayerType.VIDEO -> {
                val probe = ArxMp4Prober.probe(data) ?: run {
                    issues += ArxIssue.error(ArxIssueCode.ASSET_DECODE, path, "not an MP4 file")
                    return null
                }
                val profileIssues = ArxVideoProfile.check(probe, path, options.strictVideoProfile)
                issues += profileIssues
                issues += typeMismatch(layer.url, "mp4", path)
                val video = probe.video
                if (profileIssues.hasErrors || video == null) return null
                width = video.width
                height = video.height
                fileExtension = "mp4"
            }
        }
        val file = cache.store(data, fileExtension, path, issues) ?: return null
        return ArxExperience.Layer(
            id = layer.id,
            type = layer.type,
            file = file,
            sourceUrl = layer.url,
            size = Geometry.planeSize(width, height),
            transform = layer.transform,
            playback = layer.playback,
        )
    }

    /** Reads an asset and checks its integrity before anything decodes it (spec 8.2). */
    private fun read(url: String, integrity: String?, base: String): ByteArray? {
        val data = ArxExperienceLoader.readSafely(source, url) ?: run {
            issues += ArxIssue.error(ArxIssueCode.ASSET_MISSING, "$base/src", "cannot read $url")
            return null
        }
        if (integrity != null && ArxIntegrity.sha256(data) != integrity) {
            issues += ArxIssue.error(ArxIssueCode.INTEGRITY_MISMATCH, "$base/integrity", "SHA-256 does not match")
            return null
        }
        return data
    }

    private fun probeImage(data: ByteArray, url: String, path: String): ArxImageProbe? {
        val probe = ArxImageProber.probe(data) ?: run {
            issues += ArxIssue.error(ArxIssueCode.ASSET_DECODE, path, "not a PNG or JPEG image")
            return null
        }
        issues += typeMismatch(url, probe.format.raw, path)
        if (probe.orientation != 1) {
            issues += ArxIssue.warning(
                ArxIssueCode.IMAGE_ORIENTATION, path, "EXIF orientation ${probe.orientation}; bake it into the pixels",
            )
        }
        return probe
    }

    private fun imageExtension(probe: ArxImageProbe): String =
        if (probe.format == ArxImageProbe.Format.PNG) "png" else "jpg"

    private fun typeMismatch(url: String, format: String, path: String): List<ArxIssue> {
        val fileExtension = pathExtension(url)
        val expected = extensionFormats[fileExtension] ?: return emptyList()
        if (expected == format) return emptyList()
        return listOf(ArxIssue.warning(ArxIssueCode.ASSET_TYPE_MISMATCH, path, ".$fileExtension file contains $format data"))
    }

    /** Lowercased extension of the last path segment, or "" when it has none. */
    private fun pathExtension(url: String): String {
        val path = ArxUri.parse(url)?.let { it.path ?: it.schemeSpecificPart } ?: url
        val lastSegment = path.substringAfterLast('/')
        return if (lastSegment.contains('.')) lastSegment.substringAfterLast('.').lowercase() else ""
    }

    private companion object {
        val extensionFormats = mapOf("jpg" to "jpeg", "jpeg" to "jpeg", "png" to "png", "mp4" to "mp4")
    }
}
