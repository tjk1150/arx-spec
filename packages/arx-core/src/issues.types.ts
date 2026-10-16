import type { ERROR_CODES, WARNING_CODES } from "./issues.constants";

export type ErrorCode = (typeof ERROR_CODES)[number];
export type WarningCode = (typeof WARNING_CODES)[number];
export type IssueCode = ErrorCode | WarningCode;
export type Severity = "error" | "warning";

export interface Issue {
  readonly code: IssueCode;
  readonly severity: Severity;
  /** JSON Pointer into the manifest, or `zip:<entry>` for package entries. */
  readonly path: string;
  readonly message: string;
}
