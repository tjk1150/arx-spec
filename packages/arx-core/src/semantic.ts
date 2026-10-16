import { error, hasErrors, warning, type Issue } from "./issues";
import { normalizeQuat, quatNormDeviation } from "./math";
import { validateEffects } from "./effects/validate-effects";
import { checkSchema } from "./schema";
import { QUATERNION_AUTHORING_TOLERANCE, QUATERNION_TOLERANCE, SPEC_VERSION } from "./semantic.constants";
import type { ManifestOptions, ManifestResult } from "./semantic.types";
import type { Layer, Manifest, ResolvedLayer, Transform } from "./types";
import { resolveSrc } from "./uri";

export { QUATERNION_AUTHORING_TOLERANCE, QUATERNION_TOLERANCE, SPEC_VERSION } from "./semantic.constants";
export { type ManifestOptions, type ManifestResult } from "./semantic.types";

const checkSpecVersion = (input: unknown): Issue | undefined => {
  if (typeof input !== "object" || input === null || !("spec" in input)) return undefined;
  const spec = (input as { spec: unknown }).spec;
  if (typeof spec === "string" && spec !== SPEC_VERSION) {
    return error("ARX_SPEC_VERSION", "/spec", `unsupported spec version ${spec}`);
  }
  return undefined;
};

const checkExtensions = (manifest: Manifest, options: ManifestOptions): Issue[] => {
  const used = new Set(manifest.extensionsUsed ?? []);
  const supported = new Set(options.supportedExtensions ?? []);
  const issues: Issue[] = [];
  (manifest.extensionsRequired ?? []).forEach((name, index) => {
    const pointer = `/extensionsRequired/${index}`;
    if (!used.has(name)) {
      issues.push(error("ARX_EXTENSION_NOT_DECLARED", pointer, `${name} is not in extensionsUsed`));
    } else if (!supported.has(name)) {
      issues.push(error("ARX_EXTENSION_UNSUPPORTED", pointer, `required extension ${name} is not supported`));
    }
  });
  const objects: [string, Record<string, unknown> | undefined][] = [
    ["", manifest.extensions],
    ["/anchor", manifest.anchor.extensions],
    ...manifest.layers.map((layer, index): [string, Record<string, unknown> | undefined] => [
      `/layers/${index}`,
      layer.extensions,
    ]),
  ];
  for (const [prefix, extensions] of objects) {
    for (const name of Object.keys(extensions ?? {})) {
      if (!used.has(name)) {
        issues.push(
          warning("ARX_EXTENSION_UNDECLARED", `${prefix}/extensions/${name}`, `${name} is not in extensionsUsed`),
        );
      }
    }
  }
  return issues;
};

const resolveTransform = (layer: Layer, index: number, issues: Issue[]): Transform => {
  const rotation = layer.transform?.rotation ?? [0, 0, 0, 1];
  const pointer = `/layers/${index}/transform/rotation`;
  const deviation = quatNormDeviation(rotation);
  if (deviation > QUATERNION_TOLERANCE) {
    issues.push(error("ARX_QUATERNION_NOT_UNIT", pointer, `|q| deviates from 1 by ${deviation.toFixed(4)}`));
  } else if (deviation > QUATERNION_AUTHORING_TOLERANCE) {
    issues.push(warning("ARX_QUATERNION_DRIFT", pointer, `|q| deviates from 1 by ${deviation.toFixed(6)}; normalized`));
  }
  return {
    position: layer.transform?.position ?? [0, 0, 0],
    rotation: deviation === 0 ? rotation : normalizeQuat(rotation),
    scale: layer.transform?.scale ?? [1, 1, 1],
  };
};

/**
 * Validates a parsed manifest (schema + semantics) and resolves it: defaults
 * applied, quaternions normalized, every src resolved against `manifestUrl`.
 * Assets are not read here; see validateExperience.
 */
export const validateManifest = (
  input: unknown,
  manifestUrl: string,
  options: ManifestOptions = {},
): ManifestResult => {
  const versionIssue = checkSpecVersion(input);
  if (versionIssue) return { issues: [versionIssue] };
  const schemaIssues = checkSchema(input);
  if (schemaIssues.length > 0) return { issues: schemaIssues };

  const manifest = input as Manifest;
  const issues: Issue[] = [...checkExtensions(manifest, options)];

  const seen = new Set<string>();
  manifest.layers.forEach((layer, index) => {
    if (seen.has(layer.id)) {
      issues.push(error("ARX_DUPLICATE_LAYER_ID", `/layers/${index}/id`, `duplicate layer id ${layer.id}`));
    }
    seen.add(layer.id);
  });

  const resolve = (src: string, pointer: string): string => {
    const result = resolveSrc(src, manifestUrl, pointer, options);
    if ("issue" in result) {
      issues.push(result.issue);
      return "";
    }
    return result.url;
  };

  const anchorUrl = resolve(manifest.anchor.src, "/anchor/src");
  const layers = manifest.layers.map((layer, index): ResolvedLayer => ({
    id: layer.id,
    type: layer.type,
    url: resolve(layer.src, `/layers/${index}/src`),
    ...(layer.integrity ? { integrity: layer.integrity } : {}),
    transform: resolveTransform(layer, index, issues),
    ...(layer.type === "video"
      ? { playback: { autoplay: layer.autoplay ?? false, loop: layer.loop ?? false } }
      : {}),
  }));
  const effectStage = validateEffects(manifest, options);
  issues.push(...effectStage.issues);

  if (hasErrors(issues)) return { issues };
  return {
    issues,
    manifest: {
      ...(manifest.id ? { id: manifest.id } : {}),
      ...(manifest.title ? { title: manifest.title } : {}),
      anchor: {
        url: anchorUrl,
        ...(manifest.anchor.physicalWidth !== undefined
          ? { physicalWidth: manifest.anchor.physicalWidth }
          : {}),
        ...(manifest.anchor.integrity ? { integrity: manifest.anchor.integrity } : {}),
      },
      layers,
      effects: effectStage.effects,
      extensionsUsed: manifest.extensionsUsed ?? [],
      extensionsRequired: manifest.extensionsRequired ?? [],
    },
  };
};
