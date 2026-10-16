import Foundation

public struct ArxValidationResult: Sendable {
    public let issues: [ArxIssue]
    public let experience: ArxExperience?
    public var isValid: Bool { experience != nil }
}

/// Thrown by `load` with every issue found when an experience is invalid.
public struct ArxValidationFailure: Error, CustomStringConvertible {
    public let issues: [ArxIssue]

    public init(issues: [ArxIssue]) {
        self.issues = issues
    }

    public var description: String { issues.map(\.description).joined(separator: "\n") }
}

/// Full ARX 0.1 validation and loading (spec 9.1), ported from
/// packages/arx-core/src/validate.ts. Validated asset bytes are written to a
/// content-addressed cache and the experience points at those files, so what
/// plays is exactly what was checked.
public enum ArxExperienceLoader {
    /// ARCore recommends at least 300x300 px reference images.
    public static let minimumTargetPixels = 300

    public static var defaultCacheDirectory: URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("arx-cache", isDirectory: true)
    }

    public static func validate(
        source: any ArxAssetSource, options: ArxValidationOptions = ArxValidationOptions(),
        cacheDirectory: URL = defaultCacheDirectory
    ) async -> ArxValidationResult {
        guard let manifestData = await source.read(source.manifestURL) else {
            return ArxValidationResult(
                issues: [.error(.assetMissing, "", "cannot read \(source.manifestURL.absoluteString)")], experience: nil)
        }
        let (manifestIssues, resolved) = ArxManifestValidator.validate(
            manifestData, manifestURL: source.manifestURL, options: options)
        guard let manifest = resolved,
              let decoded = try? JSONDecoder().decode(ArxManifest.self, from: ArxManifestValidator.withoutByteOrderMark(manifestData))
        else { return ArxValidationResult(issues: manifestIssues, experience: nil) }

        var issues = manifestIssues
        var cache = AssetCache(directory: cacheDirectory)

        let target = await loadTarget(manifest.anchor, source: source, cache: &cache, issues: &issues)
        var layers: [ArxExperience.Layer] = []
        for (index, layer) in manifest.layers.enumerated() {
            if let loaded = await loadLayer(layer, index: index, source: source, options: options, cache: &cache, issues: &issues) {
                layers.append(loaded)
            }
        }
        guard !issues.hasErrors, let target, layers.count == manifest.layers.count else {
            return ArxValidationResult(issues: issues, experience: nil)
        }
        return ArxValidationResult(
            issues: issues, experience: ArxExperience(manifest: decoded, target: target, layers: layers, effects: manifest.effects))
    }

    /// Opens a `.arx` package safely, then validates the experience inside it.
    public static func validatePackage(
        _ data: Data, options: ArxValidationOptions = ArxValidationOptions(),
        limits: ArxPackageLimits = ArxPackageLimits(), fetcher: @escaping ArxFetcher = ArxHTTP.fetcher(),
        cacheDirectory: URL = defaultCacheDirectory
    ) async -> ArxValidationResult {
        let opened = ArxPackage.open(data, limits: limits, fetcher: fetcher)
        guard let source = opened.source else { return ArxValidationResult(issues: opened.issues, experience: nil) }
        let result = await validate(source: source, options: options, cacheDirectory: cacheDirectory)
        return ArxValidationResult(issues: opened.issues + result.issues, experience: result.experience)
    }

    /// Validates and returns the experience, or throws every issue found.
    public static func load(
        source: any ArxAssetSource, options: ArxValidationOptions = ArxValidationOptions(),
        cacheDirectory: URL = defaultCacheDirectory
    ) async throws -> ArxExperience {
        let result = await validate(source: source, options: options, cacheDirectory: cacheDirectory)
        guard let experience = result.experience else { throw ArxValidationFailure(issues: result.issues) }
        return experience
    }

    /// Opens and validates a `.arx` package, or throws every issue found.
    public static func load(
        package data: Data, options: ArxValidationOptions = ArxValidationOptions(),
        fetcher: @escaping ArxFetcher = ArxHTTP.fetcher(), cacheDirectory: URL = defaultCacheDirectory
    ) async throws -> ArxExperience {
        let result = await validatePackage(data, options: options, fetcher: fetcher, cacheDirectory: cacheDirectory)
        guard let experience = result.experience else { throw ArxValidationFailure(issues: result.issues) }
        return experience
    }

    /// Convenience for a manifest.json directory (fixtures, local testing).
    public static func load(directory: URL, cacheDirectory: URL = defaultCacheDirectory) async throws -> ArxExperience {
        try await load(source: ArxLocalSource.directory(directory), cacheDirectory: cacheDirectory)
    }

    // MARK: - Assets

    private static func loadTarget(
        _ anchor: ArxResolvedManifest.Anchor, source: any ArxAssetSource, cache: inout AssetCache, issues: inout [ArxIssue]
    ) async -> ArxExperience.Target? {
        let path = "/anchor/src"
        guard let data = await read(anchor.url, integrity: anchor.integrity, base: "/anchor", source: source, issues: &issues),
              let probe = probeImage(data, url: anchor.url, path: path, issues: &issues)
        else { return nil }
        let display = probe.displaySize
        if min(display.width, display.height) < minimumTargetPixels {
            issues.append(.warning(.targetLowResolution, path, "\(display.width)x\(display.height) is below 300x300"))
        }
        if probe.hasAlpha {
            issues.append(.warning(.targetAlpha, path, "transparent target; flatten it onto the printed background"))
        }
        guard let file = cache.store(data, fileExtension: probe.format == .png ? "png" : "jpg", issues: &issues, path: path) else {
            return nil
        }
        return ArxExperience.Target(
            url: file, sourceURL: anchor.url,
            size: Geometry.planeSize(pixelWidth: Double(display.width), pixelHeight: Double(display.height)),
            pixelWidth: Double(display.width), pixelHeight: Double(display.height),
            physicalWidth: anchor.physicalWidth)
    }

    private static func loadLayer(
        _ layer: ArxResolvedManifest.Layer, index: Int, source: any ArxAssetSource, options: ArxValidationOptions,
        cache: inout AssetCache, issues: inout [ArxIssue]
    ) async -> ArxExperience.Layer? {
        let path = "/layers/\(index)/src"
        guard let data = await read(layer.url, integrity: layer.integrity, base: "/layers/\(index)", source: source, issues: &issues)
        else { return nil }
        let pixels: (width: Double, height: Double)
        let fileExtension: String
        switch layer.type {
        case .image:
            guard let probe = probeImage(data, url: layer.url, path: path, issues: &issues) else { return nil }
            pixels = (Double(probe.displaySize.width), Double(probe.displaySize.height))
            fileExtension = probe.format == .png ? "png" : "jpg"
        case .video:
            guard let probe = ArxMp4Prober.probe(data) else {
                issues.append(.error(.assetDecode, path, "not an MP4 file"))
                return nil
            }
            let profileIssues = ArxVideoProfile.check(probe, path: path, strict: options.strictVideoProfile)
            issues.append(contentsOf: profileIssues)
            issues.append(contentsOf: typeMismatch(layer.url, format: "mp4", path: path))
            guard !profileIssues.hasErrors, let video = probe.video else { return nil }
            pixels = (video.width, video.height)
            fileExtension = "mp4"
        }
        guard let file = cache.store(data, fileExtension: fileExtension, issues: &issues, path: path) else { return nil }
        return ArxExperience.Layer(
            id: layer.id, type: layer.type, url: file, sourceURL: layer.url,
            size: Geometry.planeSize(pixelWidth: pixels.width, pixelHeight: pixels.height),
            transform: layer.transform, playback: layer.playback)
    }

    private static func read(
        _ url: URL, integrity: String?, base: String, source: any ArxAssetSource, issues: inout [ArxIssue]
    ) async -> Data? {
        guard let data = await source.read(url) else {
            issues.append(.error(.assetMissing, "\(base)/src", "cannot read \(url.absoluteString)"))
            return nil
        }
        if let integrity, ArxIntegrity.sha256(data) != integrity {
            issues.append(.error(.integrityMismatch, "\(base)/integrity", "SHA-256 does not match"))
            return nil
        }
        return data
    }

    private static func probeImage(_ data: Data, url: URL, path: String, issues: inout [ArxIssue]) -> ArxImageProbe? {
        guard let probe = ArxImageProber.probe(data) else {
            issues.append(.error(.assetDecode, path, "not a PNG or JPEG image"))
            return nil
        }
        issues.append(contentsOf: typeMismatch(url, format: probe.format.rawValue, path: path))
        if probe.orientation != 1 {
            issues.append(.warning(.imageOrientation, path, "EXIF orientation \(probe.orientation); bake it into the pixels"))
        }
        return probe
    }

    private static let extensionFormats = ["jpg": "jpeg", "jpeg": "jpeg", "png": "png", "mp4": "mp4"]

    private static func typeMismatch(_ url: URL, format: String, path: String) -> [ArxIssue] {
        let fileExtension = url.pathExtension.lowercased()
        guard let expected = extensionFormats[fileExtension], expected != format else { return [] }
        return [.warning(.assetTypeMismatch, path, ".\(fileExtension) file contains \(format) data")]
    }
}

/// Content-addressed store for validated asset bytes.
struct AssetCache {
    let directory: URL

    mutating func store(_ data: Data, fileExtension: String, issues: inout [ArxIssue], path: String) -> URL? {
        let file = directory.appendingPathComponent("\(ArxIntegrity.sha256Hex(data)).\(fileExtension)")
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            if !FileManager.default.fileExists(atPath: file.path) {
                try data.write(to: file, options: .atomic)
            }
            return file
        } catch {
            issues.append(.error(.assetMissing, path, "cannot cache asset: \(error.localizedDescription)"))
            return nil
        }
    }
}
