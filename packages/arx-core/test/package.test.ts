import { deflateSync } from "fflate";
import { describe, expect, it } from "vitest";
import { openPackage } from "../src/zip";

interface Entry {
  name: string;
  data?: Uint8Array;
  /** Overrides the declared uncompressed size, to simulate a lying header. */
  declaredSize?: number;
  deflate?: boolean;
  symlink?: boolean;
  encrypted?: boolean;
}

const encoder = new TextEncoder();
const MANIFEST = encoder.encode('{"spec":"arx/0.1"}');

/** Minimal ZIP writer so tests can build archives that real tools refuse to. */
const buildZip = (entries: Entry[]): Uint8Array => {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = entry.data ?? new Uint8Array();
    const body = entry.deflate ? deflateSync(raw) : raw;
    const name = encoder.encode(entry.name);
    const size = entry.declaredSize ?? raw.length;
    const flags = entry.encrypted ? 1 : 0;
    const method = entry.deflate ? 8 : 0;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, flags, true);
    local.setUint16(8, method, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    locals.push(new Uint8Array(local.buffer), name, body);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, (3 << 8) | 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, flags, true);
    central.setUint16(10, method, true);
    central.setUint32(20, body.length, true);
    central.setUint32(24, size, true);
    central.setUint16(28, name.length, true);
    central.setUint32(38, ((entry.symlink ? 0o120777 : 0o100644) << 16) >>> 0, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
};

const codes = (bytes: Uint8Array, options = {}) =>
  openPackage(bytes, options).issues.map((issue) => `${issue.code} ${issue.path}`);

describe("openPackage", () => {
  it("opens a well-formed package and reads entries", async () => {
    const result = openPackage(
      buildZip([
        { name: "manifest.json", data: MANIFEST, deflate: true },
        { name: "assets/" },
        { name: "assets/a.png", data: new Uint8Array([1, 2, 3]) },
      ]),
    );
    expect(result.issues).toEqual([]);
    expect(await result.source!.read("arx-package://root/assets/a.png")).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(await result.source!.read("arx-package://root/assets/missing.png")).toBeUndefined();
  });

  it.each([
    ["../evil.png", "ARX_PACKAGE_PATH zip:../evil.png"],
    ["assets/../../evil.png", "ARX_PACKAGE_PATH zip:assets/../../evil.png"],
    ["/etc/evil.png", "ARX_PACKAGE_PATH zip:/etc/evil.png"],
    ["C:/evil.png", "ARX_PACKAGE_PATH zip:C:/evil.png"],
    ["assets\\evil.png", "ARX_PACKAGE_PATH zip:assets\\evil.png"],
  ])("rejects the unsafe entry name %s", (name, issue) => {
    expect(codes(buildZip([{ name: "manifest.json", data: MANIFEST }, { name, data: MANIFEST }]))).toContain(
      issue,
    );
  });

  it("rejects duplicate entries", () => {
    const bytes = buildZip([
      { name: "manifest.json", data: MANIFEST },
      { name: "assets/a.png", data: MANIFEST },
      { name: "assets/a.png", data: MANIFEST },
    ]);
    expect(codes(bytes)).toContain("ARX_PACKAGE_PATH zip:assets/a.png");
  });

  it("rejects symbolic links and encrypted entries", () => {
    const bytes = buildZip([
      { name: "manifest.json", data: MANIFEST },
      { name: "assets/link.png", data: encoder.encode("/etc/passwd"), symlink: true },
      { name: "assets/secret.png", data: MANIFEST, encrypted: true },
    ]);
    expect(codes(bytes)).toEqual(
      expect.arrayContaining([
        "ARX_PACKAGE_PATH zip:assets/link.png",
        "ARX_PACKAGE_UNSUPPORTED zip:assets/secret.png",
      ]),
    );
  });

  it("requires manifest.json at the archive root", () => {
    const bytes = buildZip([{ name: "nested/manifest.json", data: MANIFEST }]);
    expect(codes(bytes)).toContain("ARX_PACKAGE_MANIFEST_MISSING zip:manifest.json");
  });

  it("enforces implementation limits before decompressing", () => {
    const bomb = new Uint8Array(1_000_000);
    const bytes = buildZip([
      { name: "manifest.json", data: MANIFEST },
      { name: "assets/zeros.png", data: bomb, deflate: true },
    ]);
    expect(codes(bytes)).toContain("ARX_PACKAGE_LIMIT zip:assets/zeros.png");
    expect(codes(bytes, { maxTotalUncompressedBytes: 1000, maxCompressionRatio: 1e9 })).toContain(
      "ARX_PACKAGE_LIMIT zip:",
    );
    expect(
      codes(buildZip([{ name: "manifest.json", data: MANIFEST }, { name: "a.png" }]), { maxEntries: 1 }),
    ).toContain("ARX_PACKAGE_LIMIT zip:");
  });

  it("rejects entries whose data does not match the declared size", () => {
    const bytes = buildZip([
      { name: "manifest.json", data: MANIFEST },
      { name: "assets/a.png", data: new Uint8Array(4000), deflate: true, declaredSize: 10 },
    ]);
    expect(codes(bytes, { maxCompressionRatio: 1e9 })).toContain("ARX_PACKAGE_CORRUPT zip:assets/a.png");
  });

  it("warns about files an ARX package does not use", () => {
    const bytes = buildZip([
      { name: "manifest.json", data: MANIFEST },
      { name: "run.sh", data: MANIFEST },
    ]);
    const result = openPackage(bytes);
    expect(result.source).toBeDefined();
    expect(result.issues.map((issue) => `${issue.severity} ${issue.code}`)).toEqual([
      "warning ARX_PACKAGE_UNEXPECTED_FILE",
    ]);
  });

  it("rejects bytes that are not a ZIP archive", () => {
    expect(codes(new Uint8Array([1, 2, 3]))).toEqual(["ARX_PACKAGE_CORRUPT zip:"]);
  });
});
