import { checkAbsoluteUrl, LOCAL_MANIFEST_URL, LOCAL_ORIGIN, type UriPolicy } from "./uri";
import type { AssetSource, Fetcher } from "./source.types";

export { type AssetSource, type Fetcher } from "./source.types";

/**
 * Default HTTPS fetcher. Redirects are followed and the final URL is checked
 * against the same policy as the original.
 */
export const createHttpFetcher =
  (policy: UriPolicy = {}): Fetcher =>
  async (url) => {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) return undefined;
    if (checkAbsoluteUrl(new URL(response.url || url), "", policy)) return undefined;
    return new Uint8Array(await response.arrayBuffer());
  };

/** A manifest served over HTTPS; relative assets resolve against its URL. */
export const createRemoteSource = (manifestUrl: string, fetcher: Fetcher = createHttpFetcher()): AssetSource => ({
  manifestUrl,
  read: fetcher,
});

/** Maps an `arx-package://root/...` URL to its archive or directory path. */
export const localPath = (url: string): string | undefined =>
  url.startsWith(LOCAL_ORIGIN) ? decodeURIComponent(url.slice(LOCAL_ORIGIN.length)) : undefined;

/**
 * A local manifest (package or directory). Local paths go to `readLocal`;
 * absolute HTTPS assets go to `fetcher`.
 */
export const createLocalSource = (
  readLocal: (path: string) => Promise<Uint8Array | undefined>,
  fetcher: Fetcher = createHttpFetcher(),
): AssetSource => ({
  manifestUrl: LOCAL_MANIFEST_URL,
  read: (url) => {
    const path = localPath(url);
    return path === undefined ? fetcher(url) : readLocal(path);
  },
});
