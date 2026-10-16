import { Inflate } from "fflate";
import { error, warning, type Issue } from "./issues";
import { createLocalSource } from "./source";
import { dataView } from "./utils/bytes";
import {
  CENTRAL_FILE_HEADER,
  DEFAULTS,
  DEFLATED,
  END_OF_CENTRAL_DIRECTORY,
  EXPECTED_EXTENSIONS,
  FILE_TYPE_MASK,
  LOCAL_FILE_HEADER,
  MANIFEST,
  STORED,
  SYMLINK_MODE,
  UNIX_HOST,
} from "./zip.constants";
import type { CentralEntry, PackageLimits, PackageOptions, PackageResult } from "./zip.types";

export { type PackageLimits, type PackageOptions, type PackageResult } from "./zip.types";

class CorruptArchive extends Error {}

const decoder = new TextDecoder("utf-8", { fatal: false });

const readCentralDirectory = (bytes: Uint8Array): CentralEntry[] => {
  const data = dataView(bytes);
  const searchStart = Math.max(0, bytes.length - 22 - 0xffff);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= searchStart; offset--) {
    if (data.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new CorruptArchive("end of central directory not found");
  const count = data.getUint16(end + 10, true);
  const directoryOffset = data.getUint32(end + 16, true);
  if (count === 0xffff || directoryOffset === 0xffffffff) throw new RangeError("ZIP64 archives are not supported");

  const entries: CentralEntry[] = [];
  let offset = directoryOffset;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.length || data.getUint32(offset, true) !== CENTRAL_FILE_HEADER) {
      throw new CorruptArchive("bad central directory entry");
    }
    const nameLength = data.getUint16(offset + 28, true);
    const extraLength = data.getUint16(offset + 30, true);
    const commentLength = data.getUint16(offset + 32, true);
    const host = data.getUint16(offset + 4, true) >> 8;
    const mode = data.getUint32(offset + 38, true) >>> 16;
    entries.push({
      name: decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)),
      flags: data.getUint16(offset + 8, true),
      method: data.getUint16(offset + 10, true),
      compressedSize: data.getUint32(offset + 20, true),
      size: data.getUint32(offset + 24, true),
      localOffset: data.getUint32(offset + 42, true),
      isSymlink: host === UNIX_HOST && (mode & FILE_TYPE_MASK) === SYMLINK_MODE,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
};

const unsafeNameReason = (name: string): string | undefined => {
  if (name.includes("\0")) return "NUL in entry name";
  if (name.includes("\\")) return "backslash in entry name";
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) return "absolute entry name";
  const segments = name.replace(/\/$/, "").split("/");
  if (segments.some((segment) => segment === "..")) return "'..' in entry name";
  if (segments.some((segment) => segment === "")) return "empty path segment";
  return undefined;
};

const inflateBounded = (compressed: Uint8Array, expectedSize: number): Uint8Array => {
  const out = new Uint8Array(expectedSize);
  let written = 0;
  const inflate = new Inflate((chunk) => {
    if (written + chunk.length > expectedSize) throw new CorruptArchive("data exceeds declared size");
    out.set(chunk, written);
    written += chunk.length;
  });
  inflate.push(compressed, true);
  if (written !== expectedSize) throw new CorruptArchive("data is shorter than declared size");
  return out;
};

const extract = (bytes: Uint8Array, entry: CentralEntry): Uint8Array => {
  const data = dataView(bytes);
  const header = entry.localOffset;
  if (header + 30 > bytes.length || data.getUint32(header, true) !== LOCAL_FILE_HEADER) {
    throw new CorruptArchive("bad local header");
  }
  const start = header + 30 + data.getUint16(header + 26, true) + data.getUint16(header + 28, true);
  const compressed = bytes.subarray(start, start + entry.compressedSize);
  if (compressed.length !== entry.compressedSize) throw new CorruptArchive("truncated entry");
  if (entry.method === STORED) {
    if (entry.compressedSize !== entry.size) throw new CorruptArchive("stored size mismatch");
    return compressed.slice();
  }
  return inflateBounded(compressed, entry.size);
};

const checkEntries = (entries: CentralEntry[], limits: Required<PackageLimits>): Issue[] => {
  const issues: Issue[] = [];
  if (entries.length > limits.maxEntries) {
    return [error("ARX_PACKAGE_LIMIT", "zip:", `${entries.length} entries exceed ${limits.maxEntries}`)];
  }
  const seen = new Set<string>();
  let total = 0;
  for (const entry of entries) {
    const path = `zip:${entry.name}`;
    const reason = unsafeNameReason(entry.name);
    if (reason) issues.push(error("ARX_PACKAGE_PATH", path, reason));
    if (entry.isSymlink) issues.push(error("ARX_PACKAGE_PATH", path, "symbolic links are not allowed"));
    if (seen.has(entry.name)) issues.push(error("ARX_PACKAGE_PATH", path, "duplicate entry"));
    seen.add(entry.name);
    if (entry.flags & 1) issues.push(error("ARX_PACKAGE_UNSUPPORTED", path, "encrypted entries are not supported"));
    if (entry.method !== STORED && entry.method !== DEFLATED) {
      issues.push(error("ARX_PACKAGE_UNSUPPORTED", path, `compression method ${entry.method}`));
    }
    if (entry.compressedSize > 0 && entry.size / entry.compressedSize > limits.maxCompressionRatio) {
      issues.push(error("ARX_PACKAGE_LIMIT", path, "compression ratio exceeds the limit"));
    }
    total += entry.size;
    const isFile = !entry.name.endsWith("/");
    if (isFile && !reason && !EXPECTED_EXTENSIONS.test(entry.name)) {
      issues.push(warning("ARX_PACKAGE_UNEXPECTED_FILE", path, "file type is not used by ARX 0.1"));
    }
  }
  if (total > limits.maxTotalUncompressedBytes) {
    issues.push(error("ARX_PACKAGE_LIMIT", "zip:", `uncompressed size ${total} exceeds the limit`));
  }
  const manifest = entries.find((entry) => entry.name === MANIFEST);
  if (!manifest) {
    issues.push(error("ARX_PACKAGE_MANIFEST_MISSING", `zip:${MANIFEST}`, "manifest.json must be at the root"));
  } else if (manifest.size > limits.maxManifestBytes) {
    issues.push(error("ARX_PACKAGE_LIMIT", `zip:${MANIFEST}`, "manifest.json exceeds the limit"));
  }
  return issues;
};

/**
 * Opens a `.arx` package after checking every entry, before any data is
 * decompressed. Returns a source only when no errors were found.
 */
export const openPackage = (bytes: Uint8Array, options: PackageOptions = {}): PackageResult => {
  const limits = { ...DEFAULTS, ...options } as Required<PackageLimits>;
  let entries: CentralEntry[];
  try {
    entries = readCentralDirectory(bytes);
  } catch (cause) {
    const unsupported = cause instanceof RangeError;
    return {
      issues: [error(unsupported ? "ARX_PACKAGE_UNSUPPORTED" : "ARX_PACKAGE_CORRUPT", "zip:", String((cause as Error).message))],
    };
  }

  const issues = checkEntries(entries, limits);
  if (issues.some((issue) => issue.severity === "error")) return { issues };

  const files = new Map<string, Uint8Array>();
  for (const entry of entries.filter((item) => !item.name.endsWith("/"))) {
    try {
      files.set(entry.name, extract(bytes, entry));
    } catch (cause) {
      issues.push(error("ARX_PACKAGE_CORRUPT", `zip:${entry.name}`, String((cause as Error).message)));
    }
  }
  if (issues.some((issue) => issue.severity === "error")) return { issues };

  return {
    issues,
    source: createLocalSource(async (path) => files.get(path), options.fetcher),
  };
};
