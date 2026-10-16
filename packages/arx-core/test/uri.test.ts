import { describe, expect, it } from "vitest";
import { LOCAL_MANIFEST_URL, resolveSrc } from "../src/uri";

const REMOTE = "https://cdn.arx.example/e/abc/manifest.json";

const codeOf = (src: string, base = REMOTE, options = {}) => {
  const result = resolveSrc(src, base, "/layers/0/src", options);
  return "issue" in result ? result.issue.code : result.url;
};

describe("resolveSrc", () => {
  it("resolves relative paths against the manifest URL", () => {
    expect(codeOf("assets/video.mp4")).toBe("https://cdn.arx.example/e/abc/assets/video.mp4");
    expect(codeOf("./assets/a.png")).toBe("https://cdn.arx.example/e/abc/assets/a.png");
    expect(codeOf("assets/a.png", LOCAL_MANIFEST_URL)).toBe("arx-package://root/assets/a.png");
  });

  it("accepts https, including presigned query strings", () => {
    const signed = "https://bucket.s3.amazonaws.com/a.mp4?X-Amz-Signature=abc";
    expect(codeOf(signed)).toBe(signed);
  });

  it.each([
    ["../a.png", "ARX_URI_PATH"],
    ["assets/../../a.png", "ARX_URI_PATH"],
    ["assets/%2e%2e/a.png", "ARX_URI_PATH"],
    ["/assets/a.png", "ARX_URI_PATH"],
    ["assets\\a.png", "ARX_URI_PATH"],
    ["assets/a.png?x=1", "ARX_URI_PATH"],
    ["assets/a.png#frag", "ARX_URI_PATH"],
    ["//evil.example/a.png", "ARX_URI_PATH"],
    ["javascript:alert(1)", "ARX_URI_SCHEME"],
    ["data:image/png;base64,AAAA", "ARX_URI_SCHEME"],
    ["file:///etc/passwd", "ARX_URI_SCHEME"],
    ["http://cdn.arx.example/a.png", "ARX_URI_SCHEME"],
    ["https://user:pass@cdn.arx.example/a.png", "ARX_URI_CREDENTIALS"],
    ["https://localhost/a.png", "ARX_URI_PRIVATE_NETWORK"],
    ["https://127.0.0.1/a.png", "ARX_URI_PRIVATE_NETWORK"],
    ["https://10.1.2.3/a.png", "ARX_URI_PRIVATE_NETWORK"],
    ["https://172.20.0.1/a.png", "ARX_URI_PRIVATE_NETWORK"],
    ["https://169.254.169.254/latest/meta-data", "ARX_URI_PRIVATE_NETWORK"],
    ["https://[::1]/a.png", "ARX_URI_PRIVATE_NETWORK"],
    ["https://[fd00::1]/a.png", "ARX_URI_PRIVATE_NETWORK"],
    ["https://[::ffff:192.168.0.1]/a.png", "ARX_URI_PRIVATE_NETWORK"],
  ])("rejects %s with %s", (src, code) => {
    expect(codeOf(src)).toBe(code);
  });

  it("allows public addresses that merely look similar", () => {
    expect(codeOf("https://172.32.0.1/a.png")).toBe("https://172.32.0.1/a.png");
    expect(codeOf("https://8.8.8.8/a.png")).toBe("https://8.8.8.8/a.png");
  });

  it("allows http://localhost only in development mode", () => {
    const options = { allowInsecureLocalhost: true, allowPrivateNetwork: true };
    expect(codeOf("http://localhost:3000/a.png", REMOTE, options)).toBe(
      "http://localhost:3000/a.png",
    );
    expect(codeOf("http://example.com/a.png", REMOTE, options)).toBe("ARX_URI_SCHEME");
  });
});
