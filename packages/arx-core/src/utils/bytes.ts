/** A DataView over exactly the bytes of `bytes`, honoring its offset into the buffer. */
export const dataView = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** `length` bytes from `start` as Latin-1 characters; shorter when the range runs past the end. */
export const ascii = (bytes: Uint8Array, start: number, length: number) =>
  String.fromCharCode(...bytes.subarray(start, start + length));
