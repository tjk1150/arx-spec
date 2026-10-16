const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

/** Subresource-Integrity style SHA-256 digest: `sha256-<base64>`. */
export const sha256Integrity = async (bytes: Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return `sha256-${toBase64(new Uint8Array(digest))}`;
};
