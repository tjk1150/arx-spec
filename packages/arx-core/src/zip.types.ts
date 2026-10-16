import type { Issue } from "./issues";
import type { AssetSource, Fetcher } from "./source";

/** Implementation defaults, not format limits: ARX itself sets no size cap. */
export interface PackageLimits {
  readonly maxEntries?: number;
  readonly maxTotalUncompressedBytes?: number;
  readonly maxCompressionRatio?: number;
  readonly maxManifestBytes?: number;
}

export interface PackageOptions extends PackageLimits {
  /** Used for absolute HTTPS assets referenced from inside the package. */
  readonly fetcher?: Fetcher;
}

export interface PackageResult {
  readonly issues: Issue[];
  readonly source?: AssetSource;
}

export interface CentralEntry {
  readonly name: string;
  readonly flags: number;
  readonly method: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly localOffset: number;
  readonly isSymlink: boolean;
}
