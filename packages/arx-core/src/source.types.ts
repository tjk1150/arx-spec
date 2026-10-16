/**
 * Where a manifest and its assets come from. `read` returns undefined when
 * the asset does not exist or cannot be fetched.
 */
export interface AssetSource {
  readonly manifestUrl: string;
  read(url: string): Promise<Uint8Array | undefined>;
}

export type Fetcher = (url: string) => Promise<Uint8Array | undefined>;
