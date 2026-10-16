import { readFile } from "node:fs/promises";
import path from "node:path";
import { createLocalSource, type AssetSource, type Fetcher } from "../source";

/**
 * A manifest.json in a local directory. Reads never leave `directory`, even
 * if a path slipped past the URI policy.
 */
export const createDirectorySource = (directory: string, fetcher?: Fetcher): AssetSource => {
  const root = path.resolve(directory);
  return createLocalSource(async (relative) => {
    const file = path.resolve(root, relative);
    if (file !== root && !file.startsWith(root + path.sep)) return undefined;
    try {
      return new Uint8Array(await readFile(file));
    } catch {
      return undefined;
    }
  }, fetcher);
};
