# ARX

ARX is a small open format for image-target AR experiences. One package holds a manifest, one image target, and image or video layers that play at a fixed position, rotation and size on top of the recognized target. Recognition, tracking, rendering and video decoding stay with the platform runtimes (ARKit, ARCore, AR Foundation and the like); ARX defines what the content means and what a reader must check before playing it.

This repository holds the 0.1 specification, its JSON Schemas, a set of conformance fixtures, and three validators (TypeScript, Swift, Kotlin) that all pass the same fixtures.

## Why ARX

There are standards that start AR (OpenXR, WebXR) and standards for 3D models (glTF), but no widely used open format for artworks that recognize a picture and lay content over it. Standards that cover image targets do exist (OGC ARML 2.0, ISO/IEC 23000-13 ARAF), yet today's AR authoring tools each use their own format, so an artwork stays tied to the app of the tool that made it. ARX is an open specification that lets any app open such an artwork at the same place and the same size, and it aims to become a standard that many tools and apps share. The schemas, conformance fixtures and three validators are published with it so that independent implementations give the same result.

## Try it

The demo artwork *The village wakes up* is a picture of a sleeping village. Point a phone at it and the same picture comes alive in place: the sky turns to dawn, the sun rises over the hills, the windows go dark and birds fly past, then night returns.

<p><img src="docs/demo/target.jpg" alt="The demo picture: a village at night under a crescent moon" width="480"> <img src="docs/demo/qr.png" alt="QR code of the demo link" width="160"></p>

1. On an Android phone with ARCore, open https://d3vawc7usps1u7.cloudfront.net/w/75vansgdeus3uknks5ylvo6taa (or scan the QR code).
2. If ARX Viewer is not installed, tap **Install the app (Android)** on that page and allow "Install unknown apps" once. On a Galaxy, if "Unknown apps blocked" appears, turn off *Settings > Security and privacy > Auto Blocker* while installing, then turn it back on.
3. Come back to the page and tap **Open in ARX Viewer**.
4. Point the camera at the picture above, on this screen or printed. The video plays on top of the picture, at the same place and size.

There is no public iPhone build yet.

The artwork is also a real ARX file: [`docs/demo/village-wakes-up.arx`](docs/demo/village-wakes-up.arx) (the package the demo link serves). The validators accept it. For example, save this as `check-demo.mts` in the repository root and run `npx tsx check-demo.mts` after `pnpm install`:

```ts
import { readFileSync } from "node:fs";
import { validatePackage } from "./packages/arx-core/src/index";

const result = await validatePackage(new Uint8Array(readFileSync("docs/demo/village-wakes-up.arx")));
console.log(result.valid); // true
```

The picture and the video are drawn by [`tools/generate_demo.py`](tools/generate_demo.py) from shapes and a fixed random seed.

## Specification

| Document | Language | Notes |
|---|---|---|
| [`spec/0.1.md`](spec/0.1.md) | Korean | Normative |
| [`spec/0.1.en.md`](spec/0.1.en.md) | English | Translation, informative; the Korean text decides |
| [`spec/extensions/ARX_effects.md`](spec/extensions/ARX_effects.md) | Korean | `ARX_effects` extension (particle effects), normative |
| [`spec/extensions/ARX_effects.en.md`](spec/extensions/ARX_effects.en.md) | English | Translation, informative |

Results of the three validators per fixture: [`docs/conformance/0.1.md`](docs/conformance/0.1.md).

## Schemas

| Schema | Address | Source file |
|---|---|---|
| ARX 0.1 manifest | https://tjk1150.github.io/arx-spec/0.1/schema.json | [`schema/arx-0.1.schema.json`](schema/arx-0.1.schema.json) |
| `ARX_effects` extension | https://tjk1150.github.io/arx-spec/0.1/ext/ARX_effects.schema.json | [`schema/ext/ARX_effects.schema.json`](schema/ext/ARX_effects.schema.json) |

Passing the schema is not enough to be valid ARX; the specification adds semantic checks (section 5) that the validators implement.

## Layout

| Path | Content |
|---|---|
| `spec/` | Specification and license of the documents |
| `schema/` | JSON Schemas, effect presets, built-in effect sprites |
| `fixtures/positive`, `fixtures/negative` | Conformance fixtures: what must validate and what must be rejected, with expected results |
| `fixtures/effects` | Fixtures and simulation vectors for `ARX_effects` |
| `packages/arx-core` | TypeScript validator |
| `ios/ArxKit` | Swift validator (`ArxCore` package) |
| `android/arx-core` | Kotlin validator (JVM, Gradle) |
| `tools/` | Fixture and sprite generators |

The validators read the schemas and fixtures from this layout, so keep the folders where they are.

## Run the tests

TypeScript (Node 22, pnpm 10, Python 3 with Pillow for the generator checks):

```bash
python3 -m pip install -r tools/requirements.txt
pnpm install
pnpm test
```

Swift (macOS 15 or later, Swift 6):

```bash
cd ios/ArxKit
swift test
```

Kotlin (JDK 21; the Gradle wrapper downloads Gradle and the dependencies):

```bash
cd android
./gradlew :arx-core:test
```

## Regenerate the fixtures

The fixtures are generated; their expected values are written by hand in the generator so they stay an independent contract.

```bash
python3 -m pip install -r tools/requirements.txt   # Pillow
pnpm install                                      # ffmpeg-static provides ffmpeg
pnpm fixtures                                     # tools/generate_fixtures.py
python3 tools/generate_effect_sprites.py          # schema/ext/sprites
python3 tools/effects_reference.py                # fixtures/effects/simulation.json
```

Run the tests afterwards. Regenerating with another Pillow or ffmpeg version, or on another CPU architecture, can change the compressed bytes of images and videos; the tests compare regenerated sprites by their pixels.

## Test data

Every image, video and package under `fixtures/`, `schema/ext/sprites/` and `docs/demo/` is made by the scripts in `tools/`. None of it is a photograph, an artwork or third-party media.

| Data | Made by | Content |
|---|---|---|
| Target and overlay images (`fixtures/positive`, `fixtures/negative`, `fixtures/effects`) | `tools/generate_fixtures.py` | Shapes and lines drawn with Pillow from a fixed random seed |
| Videos | `tools/generate_fixtures.py` with ffmpeg | ffmpeg's built-in `testsrc2` test pattern and a 440 Hz sine tone |
| `.arx` packages | `tools/generate_fixtures.py` | Zip files of the fixtures above, with a fixed date |
| Effect sprites (`schema/ext/sprites`) | `tools/generate_effect_sprites.py` | Dots, soft discs and stars drawn from formulas |
| Effect simulation vectors (`fixtures/effects/simulation.json`) | `tools/effects_reference.py` | Numbers computed from the presets |
| Manifests and expected results (`*.json`) | `tools/generate_fixtures.py` | Written by hand in the generator |
| Demo picture and video (`docs/demo/`) | `tools/generate_demo.py` with ffmpeg | A village at night that turns to morning, drawn from shapes and a fixed random seed; the `.arx` package is the published demo built from them |

Web addresses in the fixtures use reserved test domains (`*.example`) and private or loopback addresses that the validators must reject; nothing is fetched. Deleting all generated media and running the generators gives back the same files.

## Contributing

Issues and pull requests are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md). Open an issue before a larger change, so the direction can be agreed first. A change to the format needs the specification, the schema, the fixtures and all three validators to move together.

## Support

ARX is built and maintained by one person. If it is useful to you, you can support the work through [GitHub Sponsors](https://github.com/sponsors/tjk1150) or [Buy Me a Coffee](https://buymeacoffee.com/tjk1150). Reports, fixes and translations are just as welcome (see [Contributing](#contributing)).

## License

- Code, schemas and fixtures: [Apache License 2.0](LICENSE). Third-party components the validators depend on are listed in [`NOTICE`](NOTICE).
- Specification documents in `spec/`: [Creative Commons Attribution 4.0 International](spec/LICENSE).

Copyright 2026 Jintae Jang.
