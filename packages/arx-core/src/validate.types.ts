import type { Issue } from "./issues";
import type { ManifestOptions } from "./semantic";
import type { Experience } from "./types";

export interface ValidateOptions extends ManifestOptions {
  /** Treat Portable Video Profile deviations as errors (publish-time strict mode). */
  readonly strictVideoProfile?: boolean;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: Issue[];
  readonly experience?: Experience;
}
