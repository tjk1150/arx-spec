/** ARX 0.1 Portable Video Profile limits (authoring recommendations). */
export const PORTABLE_VIDEO = {
  maxLongSide: 1920,
  maxShortSide: 1080,
  maxFrameRate: 30,
  maxBitrate: 8_000_000,
  /** H.264 level_idc 41 = level 4.1. */
  maxLevel: 41,
} as const;

export const H264_CODECS = new Set(["avc1", "avc3"]);
export const BASELINE = 66;
export const MAIN = 77;
export const HIGH = 100;
export const AAC_LC = 2;
export const MPEG4_AUDIO = 0x40;
