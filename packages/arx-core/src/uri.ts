import { error, type Issue } from "./issues";
import { LOOPBACK_HOSTS, SCHEME } from "./uri.constants";
import type { Resolution, UriPolicy } from "./uri.types";

export { LOCAL_MANIFEST_URL, LOCAL_ORIGIN } from "./uri.constants";
export { type Resolution, type UriPolicy } from "./uri.types";

const parseIpv4 = (host: string): number[] | undefined => {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return undefined;
  const octets = parts.map(Number);
  return octets.every((octet) => octet <= 255) ? octets : undefined;
};

const isPrivateIpv4 = ([a = 0, b = 0]: number[]): boolean =>
  a === 0 ||
  a === 10 ||
  a === 127 ||
  (a === 100 && b >= 64 && b <= 127) ||
  (a === 169 && b === 254) ||
  (a === 172 && b >= 16 && b <= 31) ||
  (a === 192 && b === 168);

const isPrivateIpv6 = (address: string): boolean => {
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  // IPv4-mapped addresses; WHATWG URL normalizes them to hex form (::ffff:c0a8:1).
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (mapped) {
    const high = parseInt(mapped[1]!, 16);
    const low = parseInt(mapped[2]!, 16);
    return isPrivateIpv4([high >> 8, high & 255, low >> 8, low & 255]);
  }
  const first = parseInt(lower.split(":")[0] || "0", 16);
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
};

/** True for hosts that must not be reachable from an untrusted manifest. */
export const isPrivateHost = (hostname: string): boolean => {
  // "localhost." is the fully qualified spelling of the same host (fixture N017).
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.startsWith("[") && host.endsWith("]")) return isPrivateIpv6(host.slice(1, -1));
  const ipv4 = parseIpv4(host);
  return ipv4 ? isPrivateIpv4(ipv4) : false;
};

/** Checks an absolute URL against the ARX remote-asset policy. */
export const checkAbsoluteUrl = (
  url: URL,
  pointer: string,
  policy: UriPolicy = {},
): Issue | undefined => {
  if (url.protocol === "http:") {
    const allowed = policy.allowInsecureLocalhost && LOOPBACK_HOSTS.has(url.hostname);
    if (!allowed) return error("ARX_URI_SCHEME", pointer, `http is not allowed: ${url.href}`);
  } else if (url.protocol !== "https:") {
    return error("ARX_URI_SCHEME", pointer, `scheme ${url.protocol} is not allowed`);
  }
  if (url.username || url.password) {
    return error("ARX_URI_CREDENTIALS", pointer, "URLs must not embed credentials");
  }
  if (!policy.allowPrivateNetwork && isPrivateHost(url.hostname)) {
    return error("ARX_URI_PRIVATE_NETWORK", pointer, `private or loopback host: ${url.hostname}`);
  }
  return undefined;
};

const checkRelativePath = (src: string, pointer: string): Issue | undefined => {
  const reject = (reason: string) => error("ARX_URI_PATH", pointer, `${reason}: ${src}`);
  if (src.startsWith("/")) return reject("relative src must not start with '/'");
  if (src.includes("\\")) return reject("backslash is not a path separator");
  if (/[?#]/.test(src)) return reject("relative src must not contain a query or fragment");
  const segments = src.split("/");
  const decoded = (segment: string) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  };
  if (segments.some((segment) => decoded(segment) === "..")) {
    return reject("'..' segments are not allowed");
  }
  if (segments.some((segment) => segment === "")) return reject("empty path segment");
  return undefined;
};

/**
 * Resolves `src` against the manifest URL (RFC 3986) after applying the ARX
 * URI policy. Relative references are plain paths below the manifest.
 */
export const resolveSrc = (
  src: string,
  manifestUrl: string,
  pointer: string,
  policy: UriPolicy = {},
): Resolution => {
  if (SCHEME.test(src)) {
    // http(s) needs an authority with a host; WHATWG would read "https:host" as "https://host".
    if (/^https?:/i.test(src) && !/^https?:\/\/[^/\\?#]/i.test(src)) {
      return { issue: error("ARX_URI_SCHEME", pointer, `URL has no host: ${src}`) };
    }
    let url: URL;
    try {
      url = new URL(src);
    } catch {
      return { issue: error("ARX_URI_SCHEME", pointer, `unparseable URL: ${src}`) };
    }
    const issue = checkAbsoluteUrl(url, pointer, policy);
    return issue ? { issue } : { url: url.href };
  }
  const issue = checkRelativePath(src, pointer);
  if (issue) return { issue };
  const url = new URL(src, manifestUrl);
  if (url.protocol !== "arx-package:") {
    const remoteIssue = checkAbsoluteUrl(url, pointer, policy);
    if (remoteIssue) return { issue: remoteIssue };
  }
  return { url: url.href };
};
