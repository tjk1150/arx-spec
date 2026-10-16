import { sha256Integrity } from "./integrity";
import { error, hasErrors, warning, type Issue } from "./issues";
import { composeTrs, layerSize } from "./math";
import { displaySize, probeImage, type ImageProbe } from "./probe/image";
import { probeMp4 } from "./probe/mp4";
import { checkVideoProfile } from "./probe/video-profile";
import { validateManifest } from "./semantic";
import type { AssetSource } from "./source";
import type { LayerGeometry, ResolvedLayer, Vec2 } from "./types";
import { EXTENSION_FORMATS, MIN_TARGET_PIXELS } from "./validate.constants";
import type { ValidateOptions, ValidationResult } from "./validate.types";
import { openPackage, type PackageOptions } from "./zip";

export { MIN_TARGET_PIXELS } from "./validate.constants";
export { type ValidateOptions, type ValidationResult } from "./validate.types";

const readSafely = async (source: AssetSource, url: string) => {
  try {
    return await source.read(url);
  } catch {
    return undefined;
  }
};

const checkTypeMatchesExtension = (url: string, format: string, pointer: string): Issue[] => {
  const extension = new URL(url).pathname.split(".").pop()?.toLowerCase() ?? "";
  const expected = EXTENSION_FORMATS[extension];
  return expected && expected !== format
    ? [warning("ARX_ASSET_TYPE_MISMATCH", pointer, `.${extension} file contains ${format} data`)]
    : [];
};

/** Reads an asset and checks its integrity; returns bytes or reports issues. */
const loadAsset = async (
  source: AssetSource,
  url: string,
  integrity: string | undefined,
  pointerBase: string,
  issues: Issue[],
): Promise<Uint8Array | undefined> => {
  const bytes = await readSafely(source, url);
  if (!bytes) {
    issues.push(error("ARX_ASSET_MISSING", `${pointerBase}/src`, `cannot read ${url}`));
    return undefined;
  }
  if (integrity && (await sha256Integrity(bytes)) !== integrity) {
    issues.push(error("ARX_INTEGRITY_MISMATCH", `${pointerBase}/integrity`, "SHA-256 does not match"));
    return undefined;
  }
  return bytes;
};

const probeStill = (
  bytes: Uint8Array,
  url: string,
  pointer: string,
  issues: Issue[],
): ImageProbe | undefined => {
  const probe = probeImage(bytes);
  if (!probe) {
    issues.push(error("ARX_ASSET_DECODE", pointer, "not a PNG or JPEG image"));
    return undefined;
  }
  issues.push(...checkTypeMatchesExtension(url, probe.format, pointer));
  if (probe.orientation !== 1) {
    issues.push(warning("ARX_IMAGE_ORIENTATION", pointer, `EXIF orientation ${probe.orientation}; bake it into the pixels`));
  }
  return probe;
};

const probeTarget = (bytes: Uint8Array, url: string, issues: Issue[]): Vec2 | undefined => {
  const pointer = "/anchor/src";
  const probe = probeStill(bytes, url, pointer, issues);
  if (!probe) return undefined;
  const size = displaySize(probe);
  if (Math.min(...size) < MIN_TARGET_PIXELS) {
    issues.push(warning("ARX_TARGET_LOW_RESOLUTION", pointer, `${size[0]}x${size[1]} is below 300x300`));
  }
  if (probe.hasAlpha) {
    issues.push(warning("ARX_TARGET_ALPHA", pointer, "transparent target; flatten it onto the printed background"));
  }
  return size;
};

const probeLayer = (
  layer: ResolvedLayer,
  bytes: Uint8Array,
  pointer: string,
  options: ValidateOptions,
  issues: Issue[],
): Vec2 | undefined => {
  if (layer.type === "image") {
    const probe = probeStill(bytes, layer.url, pointer, issues);
    return probe ? displaySize(probe) : undefined;
  }
  const probe = probeMp4(bytes);
  if (!probe) {
    issues.push(error("ARX_ASSET_DECODE", pointer, "not an MP4 file"));
    return undefined;
  }
  const profileIssues = checkVideoProfile(probe, pointer, options.strictVideoProfile);
  issues.push(...profileIssues, ...checkTypeMatchesExtension(layer.url, "mp4", pointer));
  if (hasErrors(profileIssues) || !probe.video) return undefined;
  return [probe.video.width, probe.video.height];
};

/**
 * Full ARX 0.1 validation of an experience: manifest, URI policy, asset
 * presence, integrity, media probing and geometry. The same pipeline serves
 * authoring-time checks and runtime loading.
 */
export const validateExperience = async (
  source: AssetSource,
  options: ValidateOptions = {},
): Promise<ValidationResult> => {
  const manifestBytes = await readSafely(source, source.manifestUrl);
  if (!manifestBytes) {
    return { valid: false, issues: [error("ARX_ASSET_MISSING", "", `cannot read ${source.manifestUrl}`)] };
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch (cause) {
    return { valid: false, issues: [error("ARX_JSON_PARSE", "", String((cause as Error).message))] };
  }

  const { issues, manifest } = validateManifest(json, source.manifestUrl, options);
  if (!manifest) return { valid: false, issues };

  const [targetBytes, ...layerBytes] = await Promise.all([
    loadAsset(source, manifest.anchor.url, manifest.anchor.integrity, "/anchor", issues),
    ...manifest.layers.map((layer, index) =>
      loadAsset(source, layer.url, layer.integrity, `/layers/${index}`, issues),
    ),
  ]);

  const targetPixels = targetBytes ? probeTarget(targetBytes, manifest.anchor.url, issues) : undefined;
  const layers = manifest.layers.map((layer, index): LayerGeometry | undefined => {
    const bytes = layerBytes[index];
    const pixelSize = bytes ? probeLayer(layer, bytes, `/layers/${index}/src`, options, issues) : undefined;
    return pixelSize
      ? { ...layer, pixelSize, size: layerSize(pixelSize), matrix: composeTrs(layer.transform) }
      : undefined;
  });

  if (hasErrors(issues) || !targetPixels || layers.some((layer) => !layer)) {
    return { valid: false, issues };
  }
  return {
    valid: true,
    issues,
    experience: {
      manifest,
      target: {
        url: manifest.anchor.url,
        size: layerSize(targetPixels),
        pixelSize: targetPixels,
        ...(manifest.anchor.physicalWidth !== undefined ? { physicalWidth: manifest.anchor.physicalWidth } : {}),
      },
      layers: layers as LayerGeometry[],
    },
  };
};

/** Opens a `.arx` package safely, then validates the experience inside it. */
export const validatePackage = async (
  bytes: Uint8Array,
  options: ValidateOptions & PackageOptions = {},
): Promise<ValidationResult> => {
  const opened = openPackage(bytes, options);
  if (!opened.source) return { valid: false, issues: opened.issues };
  const result = await validateExperience(opened.source, options);
  return { ...result, issues: [...opened.issues, ...result.issues] };
};
