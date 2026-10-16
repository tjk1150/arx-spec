import { existsSync, readFileSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// Public types. Removing any of these from src/index.ts fails `tsc --noEmit`.
import type {
  AssetSource,
  ErrorCode,
  Experience,
  Fetcher,
  ImageAnchor,
  ImageLayer,
  ImageProbe,
  Issue,
  IssueCode,
  Layer,
  LayerGeometry,
  Manifest,
  ManifestOptions,
  ManifestTransform,
  Mat4,
  Mp4Probe,
  PackageLimits,
  PackageOptions,
  Playback,
  Quat,
  ResolvedLayer,
  ResolvedManifest,
  Severity,
  Transform,
  UriPolicy,
  ValidateOptions,
  ValidationResult,
  Vec2,
  Vec3,
  VideoLayer,
  WarningCode,
} from "../src/index";
// Types that must stay private. Exposing any of these fails `tsc --noEmit`.
import type {
  // @ts-expect-error Resolution is not public
  Resolution,
  // @ts-expect-error ManifestResult is not public
  ManifestResult,
  // @ts-expect-error PackageResult is not public
  PackageResult,
  // @ts-expect-error VideoTrack is not public
  VideoTrack,
  // @ts-expect-error AudioTrack is not public
  AudioTrack,
} from "../src/index";
// @ts-expect-error CentralEntry stays inside zip
import type { CentralEntry } from "../src/zip";
// @ts-expect-error Box stays inside probe/mp4
import type { Box } from "../src/probe/mp4";
import type { ImageProbe as SubpathImageProbe, Mp4Probe as SubpathMp4Probe } from "../src/probe/index";
import * as indexModule from "../src/index";
import * as mathModule from "../src/math";
import * as probeModule from "../src/probe/index";
import * as videoProfileModule from "../src/probe/video-profile";

export type PublicTypes = [
  AssetSource,
  ErrorCode,
  Experience,
  Fetcher,
  ImageAnchor,
  ImageLayer,
  ImageProbe,
  Issue,
  IssueCode,
  Layer,
  LayerGeometry,
  Manifest,
  ManifestOptions,
  ManifestTransform,
  Mat4,
  Mp4Probe,
  PackageLimits,
  PackageOptions,
  Playback,
  Quat,
  ResolvedLayer,
  ResolvedManifest,
  Severity,
  Transform,
  UriPolicy,
  ValidateOptions,
  ValidationResult,
  Vec2,
  Vec3,
  VideoLayer,
  WarningCode,
];

export type PrivateTypes = [Resolution, ManifestResult, PackageResult, VideoTrack, AudioTrack, CentralEntry, Box];

export type ProbeSubpathTypes = [SubpathImageProbe, SubpathMp4Probe];

const runtimeKeys = (module: object) => Object.keys(module).sort();

describe("public runtime exports", () => {
  it("src/index exports exactly the public values", async () => {
    expect(runtimeKeys(await import("../src/index"))).toEqual(
      [
        "ERROR_CODES",
        "LOCAL_MANIFEST_URL",
        "PORTABLE_VIDEO",
        "SPEC_VERSION",
        "WARNING_CODES",
        "checkVideoProfile",
        "composeTrs",
        "createHttpFetcher",
        "createLocalSource",
        "createRemoteSource",
        "displaySize",
        "error",
        "hasErrors",
        "isPrivateHost",
        "layerSize",
        "normalizeQuat",
        "openPackage",
        "probeImage",
        "probeMp4",
        "quatNormDeviation",
        "resolveSrc",
        "sha256Integrity",
        "toArCore",
        "toArFoundation",
        "toArKit",
        "transformPoint",
        "validateExperience",
        "validateManifest",
        "validatePackage",
        "warning",
      ].sort(),
    );
  });

  it("src/node/index exports only createDirectorySource", async () => {
    expect(runtimeKeys(await import("../src/node/index"))).toEqual(["createDirectorySource"]);
  });
});

describe("module runtime exports", () => {
  const cases: ReadonlyArray<readonly [string, () => Promise<object>, readonly string[]]> = [
    ["issues", () => import("../src/issues"), ["ERROR_CODES", "WARNING_CODES", "error", "hasErrors", "warning"]],
    ["schema", () => import("../src/schema"), ["checkSchema"]],
    [
      "source",
      () => import("../src/source"),
      ["createHttpFetcher", "createLocalSource", "createRemoteSource", "localPath"],
    ],
    [
      "uri",
      () => import("../src/uri"),
      ["LOCAL_MANIFEST_URL", "LOCAL_ORIGIN", "checkAbsoluteUrl", "isPrivateHost", "resolveSrc"],
    ],
    [
      "semantic",
      () => import("../src/semantic"),
      ["QUATERNION_AUTHORING_TOLERANCE", "QUATERNION_TOLERANCE", "SPEC_VERSION", "validateManifest"],
    ],
    ["validate", () => import("../src/validate"), ["MIN_TARGET_PIXELS", "validateExperience", "validatePackage"]],
    ["zip", () => import("../src/zip"), ["openPackage"]],
    ["probe/index", () => import("../src/probe/index"), ["displaySize", "probeImage", "probeMp4"]],
    ["probe/image", () => import("../src/probe/image"), ["displaySize", "probeImage"]],
    ["probe/mp4", () => import("../src/probe/mp4"), ["probeMp4"]],
    ["probe/video-profile", () => import("../src/probe/video-profile"), ["PORTABLE_VIDEO", "checkVideoProfile"]],
  ];

  it.each(cases)("%s exports exactly its current values", async (_name, load, expected) => {
    expect(runtimeKeys(await load())).toEqual([...expected].sort());
  });
});

describe("public values", () => {
  it("PORTABLE_VIDEO is the probe/video-profile object with the portable limits", () => {
    expect(indexModule.PORTABLE_VIDEO).toBe(videoProfileModule.PORTABLE_VIDEO);
    expect(indexModule.PORTABLE_VIDEO).toEqual({
      maxLongSide: 1920,
      maxShortSide: 1080,
      maxFrameRate: 30,
      maxBitrate: 8_000_000,
      maxLevel: 41,
    });
  });

  it("keeps the spec version, local manifest URL, and code counts", () => {
    expect(indexModule.SPEC_VERSION).toBe("arx/0.1");
    expect(indexModule.LOCAL_MANIFEST_URL).toBe("arx-package://root/manifest.json");
    expect(indexModule.ERROR_CODES.length).toBe(22);
    expect(indexModule.WARNING_CODES.length).toBe(15);
  });
});

describe("subpath entries re-export the root values", () => {
  it("./math and ./probe hand out the same functions as the root", () => {
    expect(mathModule.composeTrs).toBe(indexModule.composeTrs);
    expect(mathModule.layerSize).toBe(indexModule.layerSize);
    expect(probeModule.probeImage).toBe(indexModule.probeImage);
    expect(probeModule.displaySize).toBe(indexModule.displaySize);
    expect(probeModule.probeMp4).toBe(indexModule.probeMp4);
  });
});

// Browser-safe subpath check. Every `exports` entry except the root and ./node must not reach
// the Ajv schema compile or Node built-ins at runtime. Type-only imports are erased, so they are
// not followed.
type ReadSource = (file: string) => string | undefined;

const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));
const SCHEMA_FILE = path.join(PACKAGE_DIR, "src", "schema.ts");
const UNCHECKED_SUBPATHS: ReadonlySet<string> = new Set([".", "./node"]);
const FORBIDDEN_PACKAGES: readonly string[] = ["ajv", "ajv-formats"];
const NODE_BUILTINS: ReadonlySet<string> = new Set(builtinModules);

const STATIC_IMPORT = /^\s*(?:import|export)\s+(type\s+)?(?:[\w$*{},\s]+?\s+from\s+)?["']([^"']+)["']/gm;
const DYNAMIC_IMPORT = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

const readDisk: ReadSource = (file) =>
  existsSync(file) && statSync(file).isFile() ? readFileSync(file, "utf8") : undefined;

const runtimeSpecifiers = (source: string): readonly string[] => [
  ...[...source.matchAll(STATIC_IMPORT)].filter((match) => match[1] === undefined).map((match) => match[2] ?? ""),
  ...[...source.matchAll(DYNAMIC_IMPORT)].map((match) => match[1] ?? ""),
];

const resolveRelative = (from: string, specifier: string, read: ReadSource): string | undefined => {
  const base = path.resolve(path.dirname(from), specifier);
  const candidates = [base, base.replace(/\.js$/, ".ts"), `${base}.ts`, path.join(base, "index.ts")];
  return candidates.find((candidate) => read(candidate) !== undefined);
};

const bareViolation = (specifier: string): string | undefined => {
  if (specifier.startsWith("node:") || NODE_BUILTINS.has(specifier)) return "node built-in";
  const forbidden = FORBIDDEN_PACKAGES.find((name) => specifier === name || specifier.startsWith(`${name}/`));
  return forbidden === undefined ? undefined : `forbidden package ${forbidden}`;
};

/** Walks runtime imports from `entry` and lists every edge that reaches a forbidden module. */
const findForbiddenImports = (entry: string, read: ReadSource): readonly string[] => {
  const label = (file: string) => path.relative(PACKAGE_DIR, file);
  const visit = (file: string, seen: ReadonlySet<string>): { seen: ReadonlySet<string>; found: string[] } => {
    const source = file.endsWith(".ts") ? read(file) : "";
    if (source === undefined) return { seen, found: [`${label(file)}: file missing`] };
    return runtimeSpecifiers(source).reduce(
      (state, specifier) => {
        const edge = `${label(file)} -> ${specifier}`;
        if (!specifier.startsWith(".")) {
          const reason = bareViolation(specifier);
          return reason === undefined ? state : { ...state, found: [...state.found, `${edge} (${reason})`] };
        }
        const target = resolveRelative(file, specifier, read);
        if (target === undefined) return { ...state, found: [...state.found, `${edge} (unresolved)`] };
        if (target === SCHEMA_FILE) return { ...state, found: [...state.found, `${edge} (schema.ts)`] };
        if (state.seen.has(target)) return state;
        const next = visit(target, new Set([...state.seen, target]));
        return { seen: next.seen, found: [...state.found, ...next.found] };
      },
      { seen, found: [] as string[] },
    );
  };
  return visit(entry, new Set([entry])).found;
};

const exportTargets = (value: unknown): readonly string[] => {
  if (typeof value === "string") return [value];
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(exportTargets);
  return [];
};

const packageExports = (): Readonly<Record<string, unknown>> => {
  const manifest = JSON.parse(readFileSync(path.join(PACKAGE_DIR, "package.json"), "utf8")) as {
    exports: Record<string, unknown>;
  };
  return manifest.exports;
};

const exportEntries = Object.entries(packageExports()).flatMap(([subpath, value]) =>
  exportTargets(value).map((target) => [subpath, target] as const),
);
const checkedEntries = exportEntries.filter(([subpath]) => !UNCHECKED_SUBPATHS.has(subpath));

describe("package.json exports", () => {
  it("opens the browser-safe ./math and ./probe subpaths", () => {
    expect(checkedEntries.map(([subpath]) => subpath)).toEqual(expect.arrayContaining(["./math", "./probe"]));
  });

  it.each(exportEntries)("%s target %s exists", (_subpath, target) => {
    expect(readDisk(path.join(PACKAGE_DIR, target))).toBeDefined();
  });

  it.each(checkedEntries)("%s (%s) never reaches schema.ts, Ajv, or Node built-ins", (_subpath, target) => {
    expect(findForbiddenImports(path.join(PACKAGE_DIR, target), readDisk)).toEqual([]);
  });
});

describe("subpath import checker", () => {
  const sampleEntry = path.join(PACKAGE_DIR, "src", "__sample_entry__.ts");
  const withSample =
    (source: string): ReadSource =>
    (file) =>
      file === sampleEntry ? source : readDisk(file);
  const check = (source: string) => findForbiddenImports(sampleEntry, withSample(source));

  it("flags an entry that imports schema.ts", () => {
    expect(check('import { checkSchema } from "./schema";\n')).toEqual([
      "src/__sample_entry__.ts -> ./schema (schema.ts)",
    ]);
  });

  it("flags schema.ts reached through another module", () => {
    expect(check('export { validateManifest } from "./semantic";\n')).toContain(
      "src/semantic.ts -> ./schema (schema.ts)",
    );
  });

  it("flags Ajv, ajv-formats, and Node built-ins", () => {
    const source = [
      'import { Ajv2020 } from "ajv/dist/2020.js";',
      'import addFormats from "ajv-formats";',
      'import { readFile } from "node:fs/promises";',
      'const lazy = () => import("path");',
    ].join("\n");
    expect(check(source)).toEqual([
      "src/__sample_entry__.ts -> ajv/dist/2020.js (forbidden package ajv)",
      "src/__sample_entry__.ts -> ajv-formats (forbidden package ajv-formats)",
      "src/__sample_entry__.ts -> node:fs/promises (node built-in)",
      "src/__sample_entry__.ts -> path (node built-in)",
    ]);
  });

  it("flags a relative import it cannot resolve", () => {
    expect(check('export * from "./does-not-exist";\n')).toEqual([
      "src/__sample_entry__.ts -> ./does-not-exist (unresolved)",
    ]);
  });

  it("follows multi-line imports and ignores type-only ones", () => {
    const source = [
      'import type { Issue } from "./schema";',
      "import {",
      "  composeTrs,",
      "  layerSize,",
      '} from "./math";',
      'export { probeMp4 } from "./probe/mp4";',
    ].join("\n");
    expect(check(source)).toEqual([]);
  });
});
