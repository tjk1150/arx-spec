import type { ErrorCode, Issue, WarningCode } from "./issues.types";

export { ERROR_CODES, WARNING_CODES } from "./issues.constants";
export { type ErrorCode, type Issue, type IssueCode, type Severity, type WarningCode } from "./issues.types";

export const error = (code: ErrorCode, path: string, message: string): Issue => ({
  code,
  severity: "error",
  path,
  message,
});

export const warning = (code: WarningCode, path: string, message: string): Issue => ({
  code,
  severity: "warning",
  path,
  message,
});

export const hasErrors = (issues: readonly Issue[]): boolean =>
  issues.some((issue) => issue.severity === "error");
