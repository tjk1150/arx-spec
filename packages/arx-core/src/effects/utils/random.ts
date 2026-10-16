// Seed and random sequence of the deterministic simulation (spec/extensions/ARX_effects.md 7.2).
// All arithmetic is unsigned 32-bit; Math.imul keeps the low 32 bits of a product.

const utf8 = new TextEncoder();

/** FNV-1a 32-bit hash of the UTF-8 bytes of `text`: the seed of an effect id. */
export const fnv1a32 = (text: string): number =>
  utf8.encode(text).reduce((hash, byte) => Math.imul(hash ^ byte, 0x01000193) >>> 0, 0x811c9dc5);

/**
 * Value `position` (0-based) of the mulberry32 sequence of `seed`, in [0, 1). The state before
 * output `position` is seed + (position + 1) * 0x6D2B79F5 mod 2^32, so any position is read
 * directly; Math.imul reduces `position + 1` mod 2^32 first, which keeps the product exact.
 */
export const mulberry32At = (seed: number, position: number): number => {
  const state = (seed + Math.imul(position + 1, 0x6d2b79f5)) >>> 0;
  const first = Math.imul(state ^ (state >>> 15), state | 1);
  const second = ((first + Math.imul(first ^ (first >>> 7), first | 61)) >>> 0) ^ first;
  return ((second ^ (second >>> 14)) >>> 0) / 4294967296;
};

/** The mulberry32 sequence of `seed` as a generator function, one value per call. */
export const mulberry32 = (seed: number): (() => number) => {
  let position = 0;
  return () => {
    const value = mulberry32At(seed, position);
    position += 1;
    return value;
  };
};
