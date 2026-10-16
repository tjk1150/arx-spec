import { ascii, dataView } from "../utils/bytes";
import { PNG_SIGNATURE } from "./image.constants";
import type { ImageProbe } from "./image.types";

export { type ImageProbe } from "./image.types";

const probePng = (bytes: Uint8Array): ImageProbe | undefined => {
  const data = dataView(bytes);
  if (bytes.length < 33 || ascii(bytes, 12, 4) !== "IHDR") return undefined;
  const width = data.getUint32(16);
  const height = data.getUint32(20);
  const colorType = bytes[25];
  let hasAlpha = colorType === 4 || colorType === 6;
  // A tRNS chunk before the image data also adds transparency.
  let offset = 8;
  while (!hasAlpha && offset + 8 <= bytes.length) {
    const length = data.getUint32(offset);
    const type = ascii(bytes, offset + 4, 4);
    if (type === "tRNS") hasAlpha = true;
    if (type === "IDAT" || type === "IEND") break;
    offset += 12 + length;
  }
  return { format: "png", width, height, orientation: 1, hasAlpha };
};

/** Reads tag 0x0112 from IFD0 of a TIFF block (the EXIF payload). */
const readExifOrientation = (tiff: Uint8Array): number => {
  if (tiff.length < 8) return 1;
  const data = dataView(tiff);
  const little = ascii(tiff, 0, 2) === "II";
  if (!little && ascii(tiff, 0, 2) !== "MM") return 1;
  const ifd = data.getUint32(4, little);
  if (ifd + 2 > tiff.length) return 1;
  const count = data.getUint16(ifd, little);
  for (let index = 0; index < count; index++) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > tiff.length) break;
    if (data.getUint16(entry, little) === 0x0112) {
      const value = data.getUint16(entry + 8, little);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
};

const isStartOfFrame = (marker: number) =>
  marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

const probeJpeg = (bytes: Uint8Array): ImageProbe | undefined => {
  const data = dataView(bytes);
  let orientation = 1;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1]!;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    const length = data.getUint16(offset + 2);
    const segment = offset + 4;
    if (marker === 0xe1 && ascii(bytes, segment, 6) === "Exif\0\0") {
      orientation = readExifOrientation(bytes.subarray(segment + 6, offset + 2 + length));
    }
    if (isStartOfFrame(marker) && segment + 5 <= bytes.length) {
      return {
        format: "jpeg",
        height: data.getUint16(segment + 1),
        width: data.getUint16(segment + 3),
        orientation,
        hasAlpha: false,
      };
    }
    if (marker === 0xd9 || marker === 0xda) return undefined;
    offset += 2 + length;
  }
  return undefined;
};

/** Header-only probe for the PNG and JPEG formats ARX 0.1 allows. */
export const probeImage = (bytes: Uint8Array): ImageProbe | undefined => {
  try {
    if (PNG_SIGNATURE.every((value, index) => bytes[index] === value)) return probePng(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return probeJpeg(bytes);
  } catch {
    return undefined;
  }
  return undefined;
};

/** Display size after applying EXIF orientation (5-8 swap the axes). */
export const displaySize = (probe: ImageProbe): readonly [number, number] =>
  probe.orientation >= 5 ? [probe.height, probe.width] : [probe.width, probe.height];
