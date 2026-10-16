import type { Issue } from "./issues";

export interface UriPolicy {
  /** Development only: permit http://localhost, 127.0.0.1 and [::1]. */
  readonly allowInsecureLocalhost?: boolean;
  /** Enterprise deployments only: permit loopback and private addresses. */
  readonly allowPrivateNetwork?: boolean;
}

export type Resolution = { readonly url: string } | { readonly issue: Issue };
