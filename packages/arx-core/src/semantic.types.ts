import type { Issue } from "./issues";
import type { ResolvedManifest } from "./types";
import type { UriPolicy } from "./uri";

export interface ManifestOptions extends UriPolicy {
  /** Extension names this implementation understands. */
  readonly supportedExtensions?: readonly string[];
}

export interface ManifestResult {
  readonly issues: Issue[];
  readonly manifest?: ResolvedManifest;
}
