import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { displaySize, probeImage } from "../src/probe/image";
import { probeMp4 } from "../src/probe/mp4";
import { checkVideoProfile } from "../src/probe/video-profile";

const FIXTURES = path.resolve(__dirname, "../../../fixtures/positive");
const fixture = (relative: string) => new Uint8Array(readFileSync(path.join(FIXTURES, relative)));

const bytes = (...parts: number[][]) => new Uint8Array(parts.flat());
const u16 = (value: number) => [value >> 8, value & 255];
const u32 = (value: number) => [value >>> 24, (value >> 16) & 255, (value >> 8) & 255, value & 255];

/** SOI, APP1 Exif with IFD0 orientation, SOF0 with the given size, EOI. */
const jpegWithOrientation = (width: number, height: number, orientation: number) => {
  const tiff = [
    ...[0x4d, 0x4d, 0x00, 0x2a], ...u32(8), // big-endian TIFF header, IFD0 at 8
    ...u16(1), // one entry
    ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0,
    ...u32(0),
  ];
  const app1 = [...Array.from("Exif\0\0", (char) => char.charCodeAt(0)), ...tiff];
  const sof = [8, ...u16(height), ...u16(width), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return bytes(
    [0xff, 0xd8],
    [0xff, 0xe1, ...u16(app1.length + 2), ...app1],
    [0xff, 0xc0, ...u16(sof.length + 2), ...sof],
    [0xff, 0xd9],
  );
};

const pngChunk = (type: string, data: number[]) => [
  ...u32(data.length),
  ...Array.from(type, (char) => char.charCodeAt(0)),
  ...data,
  ...u32(0),
];

const png = (width: number, height: number, colorType: number, extra: number[] = []) =>
  bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    pngChunk("IHDR", [...u32(width), ...u32(height), 8, colorType, 0, 0, 0]),
    extra,
    pngChunk("IDAT", []),
    pngChunk("IEND", []),
  );


const ascii4 = (type: string) => Array.from(type, (char) => char.charCodeAt(0));
const mp4Box = (type: string, ...payload: number[][]) => {
  const body = payload.flat();
  return [...u32(body.length + 8), ...ascii4(type), ...body];
};

interface TrackSpec {
  readonly handler: "vide" | "soun";
  readonly timescale: number;
  readonly duration: number;
  readonly entry: number[];
  /** Raw stts entries as [sampleCount, sampleDelta]. */
  readonly stts?: ReadonlyArray<readonly [number, number]>;
  /** Raw stsz: a constant sample size, or a size per sample. */
  readonly stsz?: { readonly constant: number; readonly count: number } | { readonly sizes: readonly number[] };
}

const trackBox = (spec: TrackSpec) => {
  const tkhd = mp4Box("tkhd", [0, 0, 0, 3], u32(0), u32(0), u32(1), u32(0), u32(0), new Array(8).fill(0),
    u16(0), u16(0), u16(0), u16(0),
    [0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000].flatMap((value) => u32(value)),
    u32(480 * 65536), u32(270 * 65536));
  const mdhd = mp4Box("mdhd", [0, 0, 0, 0], u32(0), u32(0), u32(spec.timescale), u32(spec.duration), u16(0), u16(0));
  const hdlr = mp4Box("hdlr", [0, 0, 0, 0], u32(0), ascii4(spec.handler), new Array(12).fill(0), [0]);
  const stsd = mp4Box("stsd", [0, 0, 0, 0], u32(1), spec.entry);
  const stts = spec.stts
    ? mp4Box("stts", [0, 0, 0, 0], u32(spec.stts.length), spec.stts.flatMap(([count, delta]) => [...u32(count), ...u32(delta)]))
    : [];
  const stsz = spec.stsz
    ? mp4Box("stsz", [0, 0, 0, 0],
        "sizes" in spec.stsz
          ? [...u32(0), ...u32(spec.stsz.sizes.length), ...spec.stsz.sizes.flatMap((size) => u32(size))]
          : [...u32(spec.stsz.constant), ...u32(spec.stsz.count)])
    : [];
  const stbl = mp4Box("stbl", stsd, stts, stsz);
  return mp4Box("trak", tkhd, mp4Box("mdia", mdhd, hdlr, mp4Box("minf", stbl)));
};

const avcEntry = (colr: number[] = []) => {
  const avcC = mp4Box("avcC", [1, 77, 0, 40, 0xff, 0xe1]);
  return mp4Box("avc1", new Array(6).fill(0), u16(1), new Array(16).fill(0), u16(480), u16(270),
    u32(0x480000), u32(0x480000), u32(0), u16(1), new Array(32).fill(0), u16(0x18), u16(0xffff), avcC, colr);
};

const nclx = (primaries: number, transfer: number, matrix: number, fullRange = false) =>
  mp4Box("colr", ascii4("nclx"), u16(primaries), u16(transfer), u16(matrix), [fullRange ? 0x80 : 0]);

interface EsdsSpec {
  readonly averageBitrate: number;
  readonly maxBitrate?: number;
  /** Cuts the box payload to this many bytes to simulate a truncated descriptor. */
  readonly truncateAt?: number;
}

const audioEntry = (channels: number, sampleRate: number, esds?: EsdsSpec) => {
  const config = [0x12, 0x10];
  const decoderConfig = [0x40, 0x15, 0, 0, 0, ...u32(esds?.maxBitrate ?? 0), ...u32(esds?.averageBitrate ?? 0),
    0x05, config.length, ...config];
  const esDescriptor = [0, 1, 0, 0x04, decoderConfig.length, ...decoderConfig];
  const payload = [0, 0, 0, 0, 0x03, esDescriptor.length, ...esDescriptor];
  const esdsBox = esds ? mp4Box("esds", esds.truncateAt === undefined ? payload : payload.slice(0, esds.truncateAt)) : [];
  return mp4Box("mp4a", new Array(6).fill(0), u16(1), u16(0), u16(0), u32(0), u16(channels), u16(16), u16(0), u16(0),
    u32(sampleRate * 65536), esdsBox);
};

const buildMp4 = (...tracks: TrackSpec[]) => {
  const mvhd = mp4Box("mvhd", [0, 0, 0, 0], u32(0), u32(0), u32(1000), u32(2000), new Array(80).fill(0));
  return bytes(
    mp4Box("ftyp", ascii4("isom"), u32(0), ascii4("isom")),
    mp4Box("moov", mvhd, ...tracks.map(trackBox)),
    mp4Box("mdat", [0, 0, 0, 0]),
  );
};

const videoSpec = (overrides: Partial<TrackSpec> = {}): TrackSpec => ({
  handler: "vide", timescale: 30000, duration: 60000, entry: avcEntry(), stts: [[60, 1000]], ...overrides,
});
const audioSpec = (overrides: Partial<TrackSpec> = {}): TrackSpec => ({
  handler: "soun", timescale: 48000, duration: 96000, entry: audioEntry(2, 48000, { averageBitrate: 96000 }), ...overrides,
});

const TRANSFER_PQ = 16;
const TRANSFER_HLG = 18;

describe("probeImage", () => {
  it("reads JPEG size and applies EXIF orientation to the display size", () => {
    const probe = probeImage(jpegWithOrientation(300, 200, 6))!;
    expect(probe).toMatchObject({ format: "jpeg", width: 300, height: 200, orientation: 6 });
    expect(displaySize(probe)).toEqual([200, 300]);
    expect(displaySize(probeImage(jpegWithOrientation(300, 200, 1))!)).toEqual([300, 200]);
  });

  it("detects PNG transparency from the color type or a tRNS chunk", () => {
    expect(probeImage(png(10, 20, 2))).toMatchObject({ format: "png", width: 10, height: 20, hasAlpha: false });
    expect(probeImage(png(10, 20, 6))?.hasAlpha).toBe(true);
    expect(probeImage(png(10, 20, 2, pngChunk("tRNS", [0, 0])))?.hasAlpha).toBe(true);
  });

  it("reads the generated fixtures", () => {
    expect(probeImage(fixture("C001-minimal-image/assets/target.jpg"))).toMatchObject({
      format: "jpeg",
      width: 1000,
      height: 750,
      hasAlpha: false,
    });
    expect(probeImage(fixture("C001-minimal-image/assets/overlay.png"))).toMatchObject({
      format: "png",
      width: 800,
      height: 800,
      hasAlpha: true,
    });
  });

  it("rejects other formats and truncated data", () => {
    expect(probeImage(new TextEncoder().encode("GIF89a"))).toBeUndefined();
    expect(probeImage(new Uint8Array([0xff, 0xd8, 0xff]))).toBeUndefined();
    expect(probeImage(fixture("C002-video-once/assets/video.mp4"))).toBeUndefined();
  });
});

describe("probeMp4", () => {
  it("reads the portable H.264/AAC fixture", () => {
    const probe = probeMp4(fixture("C002-video-once/assets/video.mp4"))!;
    expect(probe.faststart).toBe(true);
    expect(probe.durationSeconds).toBeCloseTo(2, 1);
    expect(probe.video).toMatchObject({ codec: "avc1", width: 480, height: 270, avcProfile: 77, avcLevel: 30 });
    expect(probe.video?.frameRate).toBeCloseTo(30, 0);
    expect(probe.video?.identityMatrix).toBe(true);
    expect(probe.audio).toMatchObject({ codec: "mp4a", objectType: 0x40, audioObjectType: 2 });
    expect(checkVideoProfile(probe, "/layers/0/src")).toEqual([]);
  });

  it("detects a moov box placed after mdat", () => {
    expect(probeMp4(fixture("C014-video-no-faststart/assets/video.mp4"))?.faststart).toBe(false);
  });

  it("returns undefined for data that is not ISO BMFF", () => {
    expect(probeMp4(fixture("C001-minimal-image/assets/target.jpg"))).toBeUndefined();
    expect(probeMp4(new Uint8Array(4))).toBeUndefined();
  });
});

describe("probeMp4 delivery facts", () => {
  const videoOf = (spec: Partial<TrackSpec>) => probeMp4(buildMp4(videoSpec(spec)))?.video;

  it("reads the colr nclx tags: primaries, transfer, matrix and full range", () => {
    expect(videoOf({ entry: avcEntry(nclx(1, 1, 1)) })).toMatchObject({
      colorPrimaries: 1, transferCharacteristics: 1, matrixCoefficients: 1, fullRange: false,
    });
    expect(videoOf({ entry: avcEntry(nclx(9, TRANSFER_HLG, 9)) })).toMatchObject({
      colorPrimaries: 9, transferCharacteristics: TRANSFER_HLG, matrixCoefficients: 9, fullRange: false,
    });
    expect(videoOf({ entry: avcEntry(nclx(9, TRANSFER_PQ, 9, true)) })).toMatchObject({
      transferCharacteristics: TRANSFER_PQ, fullRange: true,
    });
  });

  it("reads the QuickTime colr nclc tags (a .mov muxer's form): primaries, transfer, matrix, no range flag", () => {
    const nclc = mp4Box("colr", ascii4("nclc"), u16(9), u16(TRANSFER_HLG), u16(9));
    const video = videoOf({ entry: avcEntry(nclc) })!;
    expect(video).toMatchObject({ colorPrimaries: 9, transferCharacteristics: TRANSFER_HLG, matrixCoefficients: 9 });
    expect(video).not.toHaveProperty("fullRange");
  });

  it("leaves the color fields out when there is no nclx colr box", () => {
    const untagged = videoOf({})!;
    expect(untagged).not.toHaveProperty("transferCharacteristics");
    expect(untagged).not.toHaveProperty("colorPrimaries");
    expect(untagged).not.toHaveProperty("matrixCoefficients");
    expect(untagged).not.toHaveProperty("fullRange");
    // An ICC-profile colr box carries no nclx fields.
    const icc = videoOf({ entry: avcEntry(mp4Box("colr", ascii4("prof"), [1, 2, 3, 4, 5, 6, 7, 8])) })!;
    expect(icc).not.toHaveProperty("transferCharacteristics");
  });

  it("tells constant from variable frame rate by the stts deltas and keeps the average rate", () => {
    const constant = videoOf({ stts: [[60, 1000]] })!;
    expect(constant.variableFrameRate).toBe(false);
    expect(constant.frameRate).toBeCloseTo(30, 5);
    const variable = videoOf({ stts: [[30, 1000], [27, 2000], [1, 1000]], duration: 30000 + 27 * 2000 + 1000 })!;
    expect(variable.variableFrameRate).toBe(true);
    expect(variable.frameRate).toBeCloseTo(58 / (85000 / 30000), 5);
    // Two entries with the same delta are still constant.
    expect(videoOf({ stts: [[30, 1000], [30, 1000]] })?.variableFrameRate).toBe(false);
  });

  it("ignores a one-sample final stts entry when deciding variable frame rate", () => {
    const kind = (stts: Array<[number, number]>) => videoOf({ stts, duration: 460800 })?.variableFrameRate;
    expect(kind([[899, 512], [1, 500]])).toBe(false);
    expect(kind([[450, 512], [449, 500]])).toBe(true);
    expect(kind([[900, 512]])).toBe(false);
    // A single one-sample entry is constant, and a differing delta before the last entry still counts.
    expect(kind([[1, 512]])).toBe(false);
    expect(kind([[400, 512], [499, 500], [1, 512]])).toBe(true);
    // The average rate still counts the final sample.
    expect(videoOf({ stts: [[899, 512], [1, 500]], duration: 460800 })?.frameRate).toBeCloseTo(900 / (460800 / 30000), 5);
  });

  it("leaves the frame-rate kind out when there is no sample table", () => {
    expect(videoOf({ stts: undefined })).not.toHaveProperty("variableFrameRate");
    expect(videoOf({ stts: [] })).not.toHaveProperty("variableFrameRate");
  });

  it("reads the video-only average bitrate from stsz over the track duration", () => {
    // 60 samples of 5000 bytes over 2 seconds = 1.2 Mbps, whichever way stsz stores the sizes.
    expect(videoOf({ stsz: { constant: 5000, count: 60 } })?.bitrate).toBeCloseTo(1.2e6, 0);
    expect(videoOf({ stsz: { sizes: new Array(60).fill(5000) } })?.bitrate).toBeCloseTo(1.2e6, 0);
    expect(videoOf({ stsz: { sizes: [100000, ...new Array(59).fill(1000)] } })?.bitrate).toBeCloseTo(636000, 0);
    expect(videoOf({ stsz: { sizes: [] } })).not.toHaveProperty("bitrate");
    expect(videoOf({ stsz: undefined })).not.toHaveProperty("bitrate");
  });

  it("does not use the audio track when counting the video bitrate", () => {
    const probe = probeMp4(buildMp4(
      videoSpec({ stsz: { constant: 5000, count: 60 } }),
      audioSpec({ stsz: { constant: 100000, count: 100 } }),
    ))!;
    expect(probe.video?.bitrate).toBeCloseTo(1.2e6, 0);
  });

  it("reads audio channels, sample rate and the esds average bitrate", () => {
    const stereo = probeMp4(buildMp4(videoSpec(), audioSpec()))!.audio!;
    expect(stereo).toMatchObject({ channelCount: 2, sampleRate: 48000, bitrate: 96000, objectType: 0x40, audioObjectType: 2 });
    const mono = probeMp4(buildMp4(videoSpec(), audioSpec({ entry: audioEntry(1, 44100, { averageBitrate: 64000, maxBitrate: 70000 }) })))!.audio!;
    expect(mono).toMatchObject({ channelCount: 1, sampleRate: 44100, bitrate: 64000 });
  });

  it("leaves the audio bitrate out when esds is missing, zero, or cut short", () => {
    const audioOf = (entry: number[]) => probeMp4(buildMp4(videoSpec(), audioSpec({ entry })))!.audio!;
    expect(audioOf(audioEntry(2, 48000))).toMatchObject({ channelCount: 2, sampleRate: 48000 });
    expect(audioOf(audioEntry(2, 48000))).not.toHaveProperty("bitrate");
    expect(audioOf(audioEntry(2, 48000, { averageBitrate: 0, maxBitrate: 128000 }))).not.toHaveProperty("bitrate");
    // Cut inside the DecoderConfigDescriptor: the probe still succeeds and the fields stay empty.
    const cut = audioOf(audioEntry(2, 48000, { averageBitrate: 96000, truncateAt: 14 }));
    expect(cut).not.toHaveProperty("bitrate");
    expect(cut).toMatchObject({ channelCount: 2, sampleRate: 48000 });
  });

  it("keeps the earlier fields when stsz claims more samples than it holds", () => {
    const bytesOf = buildMp4(videoSpec({ stsz: { sizes: [5000, 5000, 5000] } }));
    // Raise the stsz sample count from 3 to 3000 in place: the table no longer fits its box.
    const text = Buffer.from(bytesOf).toString("latin1");
    const countOffset = text.indexOf("stsz") + 4 + 4 + 4;
    new DataView(bytesOf.buffer).setUint32(countOffset, 3000);
    const video = probeMp4(bytesOf)?.video;
    expect(video).toMatchObject({ codec: "avc1", width: 480, height: 270 });
    expect(video).not.toHaveProperty("bitrate");
  });

  it("ignores a colr box too short to hold the nclx fields", () => {
    const video = probeMp4(buildMp4(videoSpec({ entry: avcEntry(mp4Box("colr", ascii4("nclx"), u16(9), u16(18))) })))?.video;
    expect(video).toMatchObject({ codec: "avc1" });
    expect(video).not.toHaveProperty("transferCharacteristics");
  });

  it("does not read channels or sample rate from a version 2 audio entry", () => {
    const entry = audioEntry(2, 48000, { averageBitrate: 96000 });
    entry[8 + 8 + 1] = 2; // sample entry version (offset 8 of the payload, after the box header)
    const audio = probeMp4(buildMp4(videoSpec(), audioSpec({ entry })))!.audio!;
    expect(audio).not.toHaveProperty("channelCount");
    expect(audio).not.toHaveProperty("sampleRate");
    expect(audio).toMatchObject({ codec: "mp4a", objectType: 0x40, audioObjectType: 2 });
  });

  it("reads the portable fixture's audio and video facts", () => {
    const probe = probeMp4(fixture("C002-video-once/assets/video.mp4"))!;
    expect(probe.video).toMatchObject({ variableFrameRate: false });
    expect(probe.video?.bitrate).toBeGreaterThan(0);
    expect(probe.audio?.channelCount).toBeGreaterThan(0);
    expect(probe.audio?.sampleRate).toBeGreaterThan(0);
    // The fixture's AAC esds stores an average of 128390 b/s (just above 128 kb/s).
    expect(probe.audio?.bitrate).toBe(128390);
  });
});

const ffmpegBinary = (): string | undefined => {
  try {
    const found = createRequire(path.resolve(__dirname, "../../../package.json"))("ffmpeg-static") as string | null;
    return found && existsSync(found) ? found : undefined;
  } catch {
    return undefined;
  }
};
const FFMPEG = ffmpegBinary();

describe.skipIf(!FFMPEG)("probeMp4 on ffmpeg-made files", () => {
  const workDir = mkdtempSync(path.join(tmpdir(), "arx-probe-"));
  afterAll(() => rmSync(workDir, { recursive: true, force: true }));
  const make = (name: string, inputs: string[], codecArgs: string[]) => {
    const output = path.join(workDir, name);
    execFileSync(FFMPEG!, ["-v", "error", "-y", ...inputs, ...codecArgs, output]);
    return probeMp4(new Uint8Array(readFileSync(output)))!;
  };
  const picture = ["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=2"];
  const tone = ["-f", "lavfi", "-i", "sine=frequency=440:duration=2:sample_rate=44100"];
  const h264 = ["-c:v", "libx264", "-pix_fmt", "yuv420p"];
  const tags = (matrix: string, primaries: string, transfer: string) =>
    ["-colorspace", matrix, "-color_primaries", primaries, "-color_trc", transfer];

  it("reads HLG, PQ and BT.709 tags and an untagged video", () => {
    expect(make("hlg.mp4", picture, [...h264, ...tags("bt2020nc", "bt2020", "arib-std-b67")]).video)
      .toMatchObject({ colorPrimaries: 9, transferCharacteristics: TRANSFER_HLG, matrixCoefficients: 9 });
    expect(make("pq.mp4", picture, [...h264, ...tags("bt2020nc", "bt2020", "smpte2084"), "-color_range", "pc"]).video)
      .toMatchObject({ transferCharacteristics: TRANSFER_PQ, fullRange: true });
    expect(make("709.mp4", picture, [...h264, ...tags("bt709", "bt709", "bt709")]).video)
      .toMatchObject({ colorPrimaries: 1, transferCharacteristics: 1, matrixCoefficients: 1 });
    expect(make("plain.mp4", picture, h264).video).not.toHaveProperty("transferCharacteristics");
  });

  it("tells a constant from a variable frame rate", () => {
    expect(make("cfr.mp4", picture, h264).video?.variableFrameRate).toBe(false);
    const slowed = ["-vf", "setpts='if(lt(N,30),N/30/TB,(30+(N-30)*2)/30/TB)'", "-fps_mode", "vfr"];
    expect(make("vfr.mp4", picture, [...slowed, ...h264]).video?.variableFrameRate).toBe(true);
  });

  it("reads stereo and mono audio facts and the video-only bitrate", () => {
    const stereo = make("stereo.mp4", [...picture, ...tone], [...h264, "-c:a", "aac", "-b:a", "96k", "-ac", "2"]);
    expect(stereo.audio).toMatchObject({ channelCount: 2, sampleRate: 44100 });
    expect(stereo.audio?.bitrate).toBeGreaterThan(80000);
    expect(stereo.audio?.bitrate).toBeLessThan(110000);
    const mono = make("mono.mp4", [...picture, ...tone], [...h264, "-c:a", "aac", "-b:a", "64k", "-ac", "1"]);
    expect(mono.audio).toMatchObject({ channelCount: 1, sampleRate: 44100 });
    // The video track carries less than the whole file, because the file also holds the audio.
    expect(stereo.video?.bitrate).toBeGreaterThan(0);
    expect(stereo.video!.bitrate!).toBeLessThan(stereo.bitrate!);
    expect(make("silent.mp4", picture, h264).audio).toBeUndefined();
  });
});

describe("checkVideoProfile", () => {
  const base = {
    faststart: true,
    bitrate: 5e6,
    video: { codec: "avc1", width: 1920, height: 1080, frameRate: 30, avcProfile: 77, avcLevel: 41, identityMatrix: true },
  };
  const codes = (probe: object, strict = false) =>
    checkVideoProfile(probe as never, "/p", strict).map((issue) => `${issue.severity} ${issue.code}`);

  it("accepts the portable profile limits exactly", () => {
    expect(codes(base)).toEqual([]);
  });

  it("warns on deviations and escalates them in strict mode", () => {
    const heavy = { ...base, bitrate: 12e6, video: { ...base.video, width: 3840, height: 2160, frameRate: 60 } };
    expect(codes(heavy)).toEqual([
      "warning ARX_VIDEO_RESOLUTION",
      "warning ARX_VIDEO_FRAME_RATE",
      "warning ARX_VIDEO_BITRATE",
    ]);
    expect(codes(heavy, true)).toEqual([
      "error ARX_VIDEO_RESOLUTION",
      "error ARX_VIDEO_FRAME_RATE",
      "error ARX_VIDEO_BITRATE",
    ]);
  });

  it("rejects 10-bit profiles and non-AAC-LC audio", () => {
    expect(codes({ ...base, video: { ...base.video, avcProfile: 110 } })).toEqual(["error ARX_VIDEO_PIXEL_FORMAT"]);
    expect(codes({ ...base, audio: { codec: "mp4a", objectType: 0x40, audioObjectType: 5 } })).toEqual([
      "error ARX_AUDIO_CODEC",
    ]);
  });
});
