import { ascii, dataView } from "../utils/bytes";
import { IDENTITY_MATRIX } from "./mp4.constants";
import type { AudioTrack, Box, Mp4Probe, VideoTrack } from "./mp4.types";

export { type AudioTrack, type Mp4Probe, type VideoTrack } from "./mp4.types";

class Reader {
  readonly data: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.data = dataView(bytes);
  }

  fourcc(offset: number): string {
    return ascii(this.bytes, offset, 4);
  }

  boxes(start: number, end: number): Box[] {
    const found: Box[] = [];
    let offset = start;
    while (offset + 8 <= end) {
      let size = this.data.getUint32(offset);
      let header = 8;
      if (size === 1) {
        if (offset + 16 > end) break;
        size = Number(this.data.getBigUint64(offset + 8));
        header = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < header || offset + size > end) break;
      found.push({ type: this.fourcc(offset + 4), start: offset + header, end: offset + size });
      offset += size;
    }
    return found;
  }

  child(box: Box | undefined, type: string, skip = 0): Box | undefined {
    return box ? this.boxes(box.start + skip, box.end).find((item) => item.type === type) : undefined;
  }

  /** Follows a path of container boxes. */
  path(box: Box | undefined, ...types: string[]): Box | undefined {
    return types.reduce<Box | undefined>((current, type) => this.child(current, type), box);
  }

  /** Returns [timescale, duration] from an mvhd or mdhd full box. */
  timing(box: Box | undefined): [number, number] | undefined {
    if (!box) return undefined;
    const version = this.bytes[box.start];
    return version === 1
      ? [this.data.getUint32(box.start + 20), Number(this.data.getBigUint64(box.start + 24))]
      : [this.data.getUint32(box.start + 12), this.data.getUint32(box.start + 16)];
  }
}

/** Reads a descriptor length (1-4 bytes, 7 bits each). */
const descriptorLength = (reader: Reader, offset: number): [number, number] => {
  let length = 0;
  let cursor = offset;
  for (let index = 0; index < 4; index++) {
    const byte = reader.bytes[cursor++] ?? 0;
    length = (length << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) break;
  }
  return [length, cursor];
};

const parseEsds = (reader: Reader, esds: Box): Pick<AudioTrack, "objectType" | "audioObjectType" | "bitrate"> => {
  let offset = esds.start + 4;
  if (reader.bytes[offset] !== 0x03) return {};
  [, offset] = descriptorLength(reader, offset + 1);
  const flags = reader.bytes[offset + 2] ?? 0;
  offset += 3;
  if (flags & 0x80) offset += 2;
  if (flags & 0x40) offset += 1 + (reader.bytes[offset] ?? 0);
  if (flags & 0x20) offset += 2;
  if (reader.bytes[offset] !== 0x04) return {};
  [, offset] = descriptorLength(reader, offset + 1);
  const objectType = reader.bytes[offset];
  // DecoderConfigDescriptor: objectType, streamType, bufferSizeDB (3), maxBitrate (4), avgBitrate (4).
  const averageBitrate = offset + 13 <= esds.end ? reader.data.getUint32(offset + 9) : 0;
  const common = {
    ...(objectType !== undefined ? { objectType } : {}),
    ...(averageBitrate > 0 ? { bitrate: averageBitrate } : {}),
  };
  offset += 13;
  if (reader.bytes[offset] !== 0x05) return common;
  [, offset] = descriptorLength(reader, offset + 1);
  const audioObjectType = (reader.bytes[offset] ?? 0) >> 3;
  return { ...common, audioObjectType };
};

/**
 * Reads the colr tags from a visual sample entry's child boxes: `nclx` (ISO, with a range flag) or `nclc`
 * (QuickTime, what a .mov muxer writes, without one).
 */
const parseColor = (
  reader: Reader,
  entry: Box,
): Pick<VideoTrack, "colorPrimaries" | "transferCharacteristics" | "matrixCoefficients" | "fullRange"> => {
  const colr = reader.boxes(entry.start + 78, entry.end).find((box) => box.type === "colr");
  // Payload: type (4), primaries (2), transfer (2), matrix (2), and for nclx a range flag (1).
  if (!colr) return {};
  const kind = reader.fourcc(colr.start);
  const size = colr.end - colr.start;
  if (!((kind === "nclx" && size >= 11) || (kind === "nclc" && size >= 10))) return {};
  const tags = {
    colorPrimaries: reader.data.getUint16(colr.start + 4),
    transferCharacteristics: reader.data.getUint16(colr.start + 6),
    matrixCoefficients: reader.data.getUint16(colr.start + 8),
  };
  return kind === "nclx" ? { ...tags, fullRange: (reader.bytes[colr.start + 10]! & 0x80) !== 0 } : tags;
};

/** Total sample bytes from stsz, or undefined when the table is absent, empty or cut short. */
const sampleBytes = (reader: Reader, stsz: Box | undefined): number | undefined => {
  if (!stsz || stsz.end - stsz.start < 12) return undefined;
  const constantSize = reader.data.getUint32(stsz.start + 4);
  const count = reader.data.getUint32(stsz.start + 8);
  if (count === 0) return undefined;
  if (constantSize > 0) return constantSize * count;
  if (stsz.start + 12 + count * 4 > stsz.end) return undefined;
  let total = 0;
  for (let index = 0; index < count; index++) total += reader.data.getUint32(stsz.start + 12 + index * 4);
  return total;
};

const parseVideo = (reader: Reader, trak: Box, entry: Box): VideoTrack => {
  const tkhd = reader.child(trak, "tkhd");
  let width = 0;
  let height = 0;
  let identityMatrix = true;
  if (tkhd) {
    const matrixOffset = tkhd.start + (reader.bytes[tkhd.start] === 1 ? 52 : 40);
    identityMatrix = IDENTITY_MATRIX.every(
      (value, index) => reader.data.getInt32(matrixOffset + index * 4) === value,
    );
    width = reader.data.getUint32(matrixOffset + 36) / 65536;
    height = reader.data.getUint32(matrixOffset + 40) / 65536;
  }
  // VisualSampleEntry: 78 bytes before child boxes; coded size at 24/26.
  if (!width || !height) {
    width = reader.data.getUint16(entry.start + 24);
    height = reader.data.getUint16(entry.start + 26);
  }
  const avcC = reader.boxes(entry.start + 78, entry.end).find((box) => box.type === "avcC");
  const mdia = reader.child(trak, "mdia");
  const timing = reader.timing(reader.child(mdia, "mdhd"));
  const stts = reader.path(mdia, "minf", "stbl", "stts");
  let frameRate: number | undefined;
  let variableFrameRate: boolean | undefined;
  if (timing && stts && timing[1] > 0) {
    const entries = reader.data.getUint32(stts.start + 4);
    let samples = 0;
    const deltas = new Set<number>();
    for (let index = 0; index < entries; index++) {
      const count = reader.data.getUint32(stts.start + 8 + index * 8);
      samples += count;
      // Encoders often end the table with one frame of a different length (the final frame's duration); it does not make the stream variable.
      if (index === entries - 1 && count === 1) continue;
      deltas.add(reader.data.getUint32(stts.start + 12 + index * 8));
    }
    frameRate = samples / (timing[1] / timing[0]);
    if (entries > 0) variableFrameRate = deltas.size > 1;
  }
  const totalBytes = sampleBytes(reader, reader.path(mdia, "minf", "stbl", "stsz"));
  const trackBitrate =
    totalBytes !== undefined && timing && timing[0] > 0 && timing[1] > 0
      ? (totalBytes * 8) / (timing[1] / timing[0])
      : undefined;
  return {
    codec: entry.type,
    width,
    height,
    identityMatrix,
    ...(frameRate !== undefined ? { frameRate } : {}),
    ...(variableFrameRate !== undefined ? { variableFrameRate } : {}),
    ...(trackBitrate !== undefined ? { bitrate: trackBitrate } : {}),
    ...parseColor(reader, entry),
    ...(avcC
      ? { avcProfile: reader.bytes[avcC.start + 1] ?? 0, avcLevel: reader.bytes[avcC.start + 3] ?? 0 }
      : {}),
  };
};

const parseAudio = (reader: Reader, entry: Box): AudioTrack => {
  // AudioSampleEntry (version 0): 28 bytes before child boxes.
  const esds = reader.boxes(entry.start + 28, entry.end).find((box) => box.type === "esds");
  // Versions 0 and 1 share the channel count (offset 16) and 16.16 sample rate (offset 24); version 2 differs.
  const layout = reader.data.getUint16(entry.start + 8) < 2;
  return {
    codec: entry.type,
    ...(layout
      ? { channelCount: reader.data.getUint16(entry.start + 16), sampleRate: reader.data.getUint32(entry.start + 24) >>> 16 }
      : {}),
    ...(esds ? parseEsds(reader, esds) : {}),
  };
};

/** Header-only MP4 probe: returns undefined when the bytes are not ISO BMFF. */
export const probeMp4 = (bytes: Uint8Array): Mp4Probe | undefined => {
  try {
    const reader = new Reader(bytes);
    const top = reader.boxes(0, bytes.length);
    if (top[0]?.type !== "ftyp") return undefined;
    const moovIndex = top.findIndex((box) => box.type === "moov");
    if (moovIndex < 0) return undefined;
    const mdatIndex = top.findIndex((box) => box.type === "mdat");
    const moov = top[moovIndex]!;

    let video: VideoTrack | undefined;
    let audio: AudioTrack | undefined;
    for (const trak of reader.boxes(moov.start, moov.end).filter((box) => box.type === "trak")) {
      const mdia = reader.child(trak, "mdia");
      const hdlr = reader.child(mdia, "hdlr");
      const handler = hdlr ? reader.fourcc(hdlr.start + 8) : "";
      // stsd is a full box followed by an entry count.
      const stsd = reader.path(mdia, "minf", "stbl", "stsd");
      const entry = stsd ? reader.boxes(stsd.start + 8, stsd.end)[0] : undefined;
      if (!entry) continue;
      if (handler === "vide" && !video) video = parseVideo(reader, trak, entry);
      if (handler === "soun" && !audio) audio = parseAudio(reader, entry);
    }

    const timing = reader.timing(reader.child(moov, "mvhd"));
    const durationSeconds = timing && timing[0] > 0 ? timing[1] / timing[0] : undefined;
    return {
      faststart: mdatIndex < 0 || moovIndex < mdatIndex,
      ...(durationSeconds ? { durationSeconds, bitrate: (bytes.length * 8) / durationSeconds } : {}),
      ...(video ? { video } : {}),
      ...(audio ? { audio } : {}),
    };
  } catch {
    return undefined;
  }
};
