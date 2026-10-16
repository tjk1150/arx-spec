import { describe, expect, it } from "vitest";
import { ascii, dataView } from "../src/utils/bytes";

describe("dataView", () => {
  it("reads from the first byte of a subarray, not of its buffer", () => {
    const whole = new Uint8Array([0xff, 0xff, 0x00, 0x00, 0x01, 0x02, 0xee]);
    const part = whole.subarray(2, 6);
    const view = dataView(part);
    expect(view.byteLength).toBe(4);
    expect(view.getUint32(0)).toBe(0x00000102);
  });

  it("covers only the subarray's bytes", () => {
    const part = new Uint8Array([1, 2, 3, 4, 5, 6]).subarray(1, 3);
    expect(() => dataView(part).getUint32(0)).toThrow(RangeError);
  });
});

describe("ascii", () => {
  const bytes = new TextEncoder().encode("ftypisom");

  it("reads length characters from start", () => {
    expect(ascii(bytes, 0, 4)).toBe("ftyp");
    expect(ascii(bytes, 4, 4)).toBe("isom");
  });

  it("returns a shorter string when the range runs past the end", () => {
    expect(ascii(bytes, 6, 4)).toBe("om");
    expect(ascii(bytes, 8, 4)).toBe("");
  });

  it("reads relative to a subarray", () => {
    expect(ascii(bytes.subarray(4), 0, 4)).toBe("isom");
  });
});
