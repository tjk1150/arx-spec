// Runs a Python fixture generator with the ffmpeg binary from ffmpeg-static.
// Usage: node tools/run-fixture-generator.mjs [scriptName]
// scriptName defaults to generate_fixtures.py.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const ffmpegPath = require("ffmpeg-static");
if (!ffmpegPath) {
  console.error("ffmpeg-static did not provide a binary for this platform");
  process.exit(1);
}

const scriptName = process.argv[2] ?? "generate_fixtures.py";
const script = path.join(path.dirname(fileURLToPath(import.meta.url)), scriptName);
const result = spawnSync("python3", [script], {
  stdio: "inherit",
  env: { ...process.env, ARX_FFMPEG: ffmpegPath },
});
process.exit(result.status ?? 1);
