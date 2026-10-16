export const DEFAULTS = {
  maxEntries: 1000,
  maxTotalUncompressedBytes: 1024 ** 3,
  maxCompressionRatio: 100,
  maxManifestBytes: 1024 ** 2,
} as const;

export const MANIFEST = "manifest.json";
export const EXPECTED_EXTENSIONS = /\.(json|jpe?g|png|mp4)$/i;
export const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
export const CENTRAL_FILE_HEADER = 0x02014b50;
export const LOCAL_FILE_HEADER = 0x04034b50;
export const STORED = 0;
export const DEFLATED = 8;
export const UNIX_HOST = 3;
export const SYMLINK_MODE = 0o120000;
export const FILE_TYPE_MASK = 0o170000;
