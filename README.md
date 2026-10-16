# ARX

ARX is a small open format for image-target AR experiences. One package holds a manifest, one image target, and image or video layers that play at a fixed position, rotation and size on top of the recognized target. Recognition, tracking, rendering and video decoding stay with the platform runtimes (ARKit, ARCore, AR Foundation and the like); ARX defines what the content means and what a reader must check before playing it.

This repository holds the 0.1 specification, its JSON Schemas, a set of conformance fixtures, and three validators (TypeScript, Swift, Kotlin) that all pass the same fixtures.

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

Run the tests afterwards. Regenerating on another Pillow or ffmpeg version can change image or video bytes.

## Contributing

Open an issue before a larger change, so the direction can be agreed first. A change to the format needs the specification, the schema, the fixtures and all three validators to move together, and all three test suites must pass. Corrections to the specification text and the English translation are welcome.

## License

- Code, schemas and fixtures: [Apache License 2.0](LICENSE). Third-party components the validators depend on are listed in [`NOTICE`](NOTICE).
- Specification documents in `spec/`: [Creative Commons Attribution 4.0 International](spec/LICENSE).

Copyright 2026 Jintae Jang.
