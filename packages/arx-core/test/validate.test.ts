import { describe, expect, it } from "vitest";
import { createRemoteSource, validateExperience } from "../src/index";
import type { Issue } from "../src/issues";

const BASE = "https://example.com/experience/";
const MANIFEST_URL = `${BASE}manifest.json`;

const bytes = (...parts: number[][]) => new Uint8Array(parts.flat());
const u32 = (value: number) => [value >>> 24, (value >> 16) & 255, (value >> 8) & 255, value & 255];

const pngChunk = (type: string, data: number[]) => [
  ...u32(data.length),
  ...Array.from(type, (char) => char.charCodeAt(0)),
  ...data,
  ...u32(0),
];

/** Opaque RGB PNG header with the given size (color type 2). */
const png = (width: number, height: number) =>
  bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    pngChunk("IHDR", [...u32(width), ...u32(height), 8, 2, 0, 0, 0]),
    pngChunk("IDAT", []),
    pngChunk("IEND", []),
  );

/** Serves a one-layer image experience from memory. */
const validate = (files: { target: [string, Uint8Array]; layer: [string, Uint8Array] }) => {
  const manifest = {
    spec: "arx/0.1",
    id: "test.validate",
    anchor: { type: "image", src: files.target[0], physicalWidth: 0.2 },
    layers: [{ id: "overlay", type: "image", src: files.layer[0] }],
  };
  const served: Record<string, Uint8Array> = {
    [MANIFEST_URL]: new TextEncoder().encode(JSON.stringify(manifest)),
    [`${BASE}${files.target[0]}`]: files.target[1],
    [`${BASE}${files.layer[0]}`]: files.layer[1],
  };
  return validateExperience(createRemoteSource(MANIFEST_URL, async (url) => served[url]));
};

const codesAt = (issues: readonly Issue[], path: string) =>
  issues.filter((issue) => issue.path === path).map((issue) => `${issue.severity} ${issue.code}`);

describe("validateExperience target resolution", () => {
  it("warns when the smaller target side is below 300 px", async () => {
    const result = await validate({ target: ["target.png", png(299, 299)], layer: ["overlay.png", png(64, 64)] });
    expect(result.valid).toBe(true);
    expect(codesAt(result.issues, "/anchor/src")).toEqual(["warning ARX_TARGET_LOW_RESOLUTION"]);
    expect(result.issues.find((issue) => issue.code === "ARX_TARGET_LOW_RESOLUTION")?.message).toBe(
      "299x299 is below 300x300",
    );
  });

  it("warns when only one side is below 300 px", async () => {
    const result = await validate({ target: ["target.png", png(400, 299)], layer: ["overlay.png", png(64, 64)] });
    expect(codesAt(result.issues, "/anchor/src")).toEqual(["warning ARX_TARGET_LOW_RESOLUTION"]);
  });

  it("accepts a 300x300 target without warnings", async () => {
    const result = await validate({ target: ["target.png", png(300, 300)], layer: ["overlay.png", png(64, 64)] });
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.experience?.target.pixelSize).toEqual([300, 300]);
  });
});

describe("validateExperience extension check", () => {
  it("warns when a .jpg layer contains PNG data", async () => {
    const result = await validate({ target: ["target.png", png(300, 300)], layer: ["overlay.jpg", png(64, 64)] });
    expect(result.valid).toBe(true);
    expect(codesAt(result.issues, "/layers/0/src")).toEqual(["warning ARX_ASSET_TYPE_MISMATCH"]);
    expect(result.issues[0]?.message).toBe(".jpg file contains png data");
  });

  it("matches the extension case-insensitively and knows .jpeg", async () => {
    const result = await validate({ target: ["target.png", png(300, 300)], layer: ["overlay.JPEG", png(64, 64)] });
    expect(codesAt(result.issues, "/layers/0/src")).toEqual(["warning ARX_ASSET_TYPE_MISMATCH"]);
    expect(result.issues[0]?.message).toBe(".jpeg file contains png data");
  });

  it("does not warn for a matching or unknown extension", async () => {
    const matching = await validate({ target: ["target.png", png(300, 300)], layer: ["overlay.png", png(64, 64)] });
    const unknown = await validate({ target: ["target.png", png(300, 300)], layer: ["overlay.img", png(64, 64)] });
    expect(matching.issues).toEqual([]);
    expect(unknown.issues).toEqual([]);
  });
});
