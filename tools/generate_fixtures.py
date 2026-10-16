"""Generates the ARX 0.1 conformance fixtures.

Assets are synthesized (Pillow for images, ffmpeg for video) and every
expected value below is a hand-computed literal, so the fixtures stay an
independent contract for every runtime (TS validator, Unity SDK, SceneView).

Run through `pnpm fixtures`, which provides ARX_FFMPEG.
"""

import base64
import hashlib
import json
import os
import random
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "fixtures"
FFMPEG = os.environ.get("ARX_FFMPEG", "ffmpeg")

H = 0.70710678  # sin(45 deg) = cos(45 deg), used by the 90 degree rotations
IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
ZIP_DATE = (2026, 1, 1, 0, 0, 0)

EFFECTS = "ARX_effects"
EFFECTS_ROOT = "/extensions/ARX_effects"
# The pink sparkle, as in the example of spec/extensions/ARX_effects.md section 2.
PINK_SPARKLE = {
    "id": "pink-sparkle",
    "transform": {"position": [0.1, 0.2, 0.03], "rotation": [0, 0, 0, 1], "scale": [0.2, 0.2, 1]},
    "preset": "sparkle",
    "colors": ["#FF0071", "#18004A"],
    "amount": 1,
    "size": 0.03,
    "speed": 0,
    "sprite": "star",
}


# ---------------------------------------------------------------- assets


def make_target(path: Path, seed: int, size=(1000, 750)) -> None:
    """High-contrast, non-repeating pattern so the target is trackable."""
    rng = random.Random(seed)
    image = Image.new("RGB", size, (245, 240, 230))
    draw = ImageDraw.Draw(image)
    width, height = size
    for _ in range(260):
        color = tuple(rng.randrange(0, 256) for _ in range(3))
        kind = rng.randrange(3)
        x0, y0 = rng.randrange(width), rng.randrange(height)
        x1, y1 = x0 + rng.randrange(8, 160), y0 + rng.randrange(8, 160)
        if kind == 0:
            draw.rectangle([x0, y0, x1, y1], fill=color)
        elif kind == 1:
            draw.ellipse([x0, y0, x1, y1], fill=color, outline=(0, 0, 0))
        else:
            points = [(rng.randrange(width), rng.randrange(height)) for _ in range(3)]
            draw.polygon(points, fill=color)
    for _ in range(60):
        draw.line(
            [(rng.randrange(width), rng.randrange(height)) for _ in range(2)],
            fill=(0, 0, 0),
            width=rng.randrange(1, 5),
        )
    image.save(path, "JPEG", quality=92)


def make_overlay(path: Path, size, seed: int) -> None:
    """RGBA overlay with a transparent border, so alpha handling is visible."""
    rng = random.Random(seed)
    width, height = size
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    inset = min(width, height) // 10
    draw.rectangle([inset, inset, width - inset, height - inset], fill=(20, 110, 220, 200))
    for _ in range(12):
        x0, y0 = rng.randrange(inset, width - inset), rng.randrange(inset, height - inset)
        draw.ellipse([x0 - 12, y0 - 12, x0 + 12, y0 + 12], fill=(255, 210, 0, 255))
    # Axis markers: red arrow toward +X (right), green toward +Y (up).
    cx, cy = width // 2, height // 2
    draw.line([(cx, cy), (width - inset, cy)], fill=(230, 30, 30, 255), width=8)
    draw.line([(cx, cy), (cx, inset)], fill=(30, 200, 60, 255), width=8)
    image.save(path, "PNG")


def run_ffmpeg(args: list) -> None:
    subprocess.run(
        [FFMPEG, "-y", "-hide_banner", "-loglevel", "error", *args],
        check=True,
    )


def make_video(path: Path, faststart: bool) -> None:
    run_ffmpeg([
        "-f", "lavfi", "-i", "testsrc2=size=480x270:rate=30:duration=2",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
        "-c:v", "libx264", "-profile:v", "main", "-level:v", "3.0",
        "-pix_fmt", "yuv420p", "-b:v", "500k",
        "-c:a", "aac", "-b:a", "128k", "-ac", "2", "-ar", "48000",
        "-map_metadata", "-1", "-fflags", "+bitexact",
        "-flags:v", "+bitexact", "-flags:a", "+bitexact",
        *(["-movflags", "+faststart"] if faststart else []),
        "-shortest", str(path),
    ])


def make_mpeg4_video(path: Path) -> None:
    run_ffmpeg([
        "-f", "lavfi", "-i", "testsrc2=size=480x270:rate=30:duration=1",
        "-c:v", "mpeg4", "-an", "-map_metadata", "-1",
        "-fflags", "+bitexact", "-flags:v", "+bitexact",
        "-movflags", "+faststart", str(path),
    ])


def sri(data: bytes) -> str:
    return "sha256-" + base64.b64encode(hashlib.sha256(data).digest()).decode()


# ---------------------------------------------------------------- helpers


def translation(x, y, z, sx=1, sy=1, sz=1):
    """Column-major T x S matrix for layers without rotation."""
    return [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, x, y, z, 1]


def adapters(position, rotation, scale, af_rotation, arcore_rotation):
    """Hand-written basis-change results.

    AR Foundation tracked image (Unity, left-handed): X right, Y out of the
    image, Z toward the image top. ARX (x, y, z) -> (x, z, y).
    ARCore AugmentedImage (right-handed): X right, Y out, Z toward the image
    bottom. ARX (x, y, z) -> (x, z, -y).
    Scale is (sx, sz, sy) for both.
    """
    x, y, z = position
    sx, sy, sz = scale
    return {
        "arFoundation": {
            "position": [x, z, y],
            "rotation": af_rotation,
            "scale": [sx, sz, sy],
        },
        "arcore": {
            "position": [x, z, -y if y else 0],
            "rotation": arcore_rotation,
            "scale": [sx, sz, sy],
        },
        # ARKit ARImageAnchor (right-handed) uses the same axes as ARCore:
        # x right, y out of the image, z toward the image bottom.
        "arkit": {
            "position": [x, z, -y if y else 0],
            "rotation": arcore_rotation,
            "scale": [sx, sz, sy],
        },
    }


def identity_adapters(position=(0, 0, 0), scale=(1, 1, 1)):
    return adapters(position, None, scale, [0, 0, 0, 1], [0, 0, 0, 1])


def layer_expect(layer_id, size, matrix, adapter, playback=None):
    entry = {"id": layer_id, "size": size, "matrix": matrix, **adapter}
    if playback is not None:
        entry["playback"] = playback
    return entry


def write_json(path: Path, value) -> None:
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


class Assets:
    def __init__(self, cache: Path):
        self.cache = cache
        make_target(cache / "target.jpg", seed=7)
        make_overlay(cache / "overlay-square.png", (800, 800), seed=11)
        make_overlay(cache / "overlay-4x3.png", (400, 300), seed=13)
        make_video(cache / "video-16x9.mp4", faststart=True)
        make_video(cache / "video-no-faststart.mp4", faststart=False)
        make_mpeg4_video(cache / "video-mpeg4.mp4")

    def path(self, name: str) -> Path:
        return self.cache / name

    def bytes(self, name: str) -> bytes:
        return self.path(name).read_bytes()


def fixture_dir(kind: str, name: str) -> Path:
    directory = FIXTURES / kind / name
    directory.mkdir(parents=True)
    return directory


def copy_assets(directory: Path, assets: Assets, mapping: dict) -> None:
    for relative, source in mapping.items():
        destination = directory / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(assets.path(source), destination)


def write_zip(path: Path, entries: dict) -> None:
    """entries maps archive name -> bytes. Fixed timestamps keep it stable."""
    with zipfile.ZipFile(path, "w") as archive:
        for name, data in entries.items():
            info = zipfile.ZipInfo(name, date_time=ZIP_DATE)
            is_media = name.endswith((".mp4", ".jpg", ".png"))
            info.compress_type = zipfile.ZIP_STORED if is_media else zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)


def manifest(fixture_id, anchor, layers, **extra):
    return {"spec": "arx/0.1", "id": f"fixture.{fixture_id}", "anchor": anchor, "layers": layers, **extra}


def target_anchor(width=0.2, src="assets/target.jpg", **extra):
    """width=None omits physicalWidth, which is optional."""
    anchor = {"type": "image", "src": src, **extra}
    return anchor if width is None else {**anchor, "physicalWidth": width}


# ---------------------------------------------------------------- positive


def positive(assets: Assets) -> None:
    target = {"assets/target.jpg": "target.jpg"}
    # Sizes are in target-width units: the target is 1 wide, 1000x750 px.
    target_size = [1, 0.75]

    def simple(name, layers, files, expected_layers, warnings=(), anchor_width=0.2):
        directory = fixture_dir("positive", name)
        copy_assets(directory, assets, {**target, **files})
        write_json(directory / "manifest.json", manifest(name[:4], target_anchor(anchor_width), layers))
        write_json(directory / "expected.json", {
            "valid": True,
            "warnings": list(warnings),
            "target": {"size": target_size, "physicalWidth": anchor_width},
            "layers": expected_layers,
        })

    square = {"assets/overlay.png": "overlay-square.png"}
    four_three = {"assets/overlay.png": "overlay-4x3.png"}
    video = {"assets/video.mp4": "video-16x9.mp4"}
    image_layer = {"id": "overlay", "type": "image", "src": "assets/overlay.png"}
    video_size = [1, 0.5625]  # 480x270

    simple("C001-minimal-image", [image_layer], square, [
        layer_expect("overlay", [1, 1], IDENTITY, identity_adapters()),
    ])

    for name, autoplay, loop in (
        ("C002-video-once", True, False),
        ("C003-video-loop", True, True),
    ):
        simple(name, [{
            "id": "clip", "type": "video", "src": "assets/video.mp4",
            "transform": {"position": [0, 0, 0.01]},
            "autoplay": autoplay, "loop": loop,
        }], video, [
            layer_expect("clip", video_size, translation(0, 0, 0.01),
                         identity_adapters(position=(0, 0, 0.01)),
                         {"autoplay": autoplay, "loop": loop}),
        ])

    simple("C004-video-manual", [
        {"id": "clip", "type": "video", "src": "assets/video.mp4"},
    ], video, [
        layer_expect("clip", video_size, IDENTITY, identity_adapters(),
                     {"autoplay": False, "loop": False}),
    ])

    simple("C005-translate", [
        {**image_layer, "transform": {"position": [0.5, 0.25, 0.01]}},
    ], four_three, [
        layer_expect("overlay", [1, 0.75], translation(0.5, 0.25, 0.01),
                     identity_adapters(position=(0.5, 0.25, 0.01))),
    ])

    rz90 = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    simple("C006-rotate-z-90", [
        {**image_layer, "transform": {"rotation": [0, 0, H, H]}},
    ], four_three, [
        layer_expect("overlay", [1, 0.75], rz90,
                     adapters((0, 0, 0), None, (1, 1, 1), [0, -H, 0, H], [0, H, 0, H])),
    ])

    simple("C007-scale-half", [
        {**image_layer, "transform": {"scale": [0.5, 0.5, 1]}},
    ], four_three, [
        layer_expect("overlay", [1, 0.75], translation(0, 0, 0, 0.5, 0.5, 1),
                     identity_adapters(scale=(0.5, 0.5, 1))),
    ])

    # C008: a different physicalWidth leaves the unit geometry unchanged.
    simple("C008-physical-width-independent", [
        {"id": "clip", "type": "video", "src": "assets/video.mp4", "autoplay": True, "loop": True},
    ], video, [
        layer_expect("clip", video_size, IDENTITY, identity_adapters(),
                     {"autoplay": True, "loop": True}),
    ], anchor_width=0.4)

    simple("C009-multi-layer-z", [
        {**image_layer, "id": "frame", "transform": {"position": [0, 0, 0.005]}},
        {"id": "clip", "type": "video", "src": "assets/video.mp4",
         "transform": {"position": [0, 0, 0.015], "scale": [0.92, 0.92, 1]},
         "autoplay": True, "loop": True},
    ], {**square, **video}, [
        layer_expect("frame", [1, 1], translation(0, 0, 0.005),
                     identity_adapters(position=(0, 0, 0.005))),
        layer_expect("clip", video_size, translation(0, 0, 0.015, 0.92, 0.92, 1),
                     identity_adapters(position=(0, 0, 0.015), scale=(0.92, 0.92, 1)),
                     {"autoplay": True, "loop": True}),
    ])

    # C010: remote manifest. The test harness serves URLs from local files.
    directory = fixture_dir("positive", "C010-remote-https")
    copy_assets(directory, assets, {**target, "assets/overlay.png": "overlay-4x3.png"})
    base = "https://cdn.arx.example/fixtures/C010/"
    remote_overlay = "https://media.arx.example/shared/overlay.png"
    write_json(directory / "manifest.json", manifest("C010", target_anchor(), [
        {"id": "overlay", "type": "image", "src": remote_overlay},
    ]))
    write_json(directory / "expected.json", {
        "valid": True,
        "warnings": [],
        "manifestUrl": base + "manifest.json",
        "serve": {
            base + "manifest.json": "manifest.json",
            base + "assets/target.jpg": "assets/target.jpg",
            remote_overlay: "assets/overlay.png",
        },
        "resolved": {
            "/anchor/src": base + "assets/target.jpg",
            "/layers/0/src": remote_overlay,
        },
        "target": {"size": target_size, "physicalWidth": 0.2},
        "layers": [layer_expect("overlay", [1, 0.75], IDENTITY, identity_adapters())],
    })

    # C011: offline .arx package with integrity on every asset.
    directory = fixture_dir("positive", "C011-package-relative")
    package_manifest = manifest("C011", target_anchor(integrity=sri(assets.bytes("target.jpg"))), [
        {"id": "overlay", "type": "image", "src": "assets/overlay.png",
         "integrity": sri(assets.bytes("overlay-square.png")),
         "transform": {"position": [0, 0, 0.005]}},
        {"id": "clip", "type": "video", "src": "assets/video.mp4",
         "integrity": sri(assets.bytes("video-16x9.mp4")),
         "transform": {"position": [0, 0, 0.01], "scale": [0.5, 0.5, 1]},
         "autoplay": True, "loop": True},
    ])
    write_zip(directory / "experience.arx", {
        "manifest.json": (json.dumps(package_manifest, indent=2) + "\n").encode(),
        "assets/target.jpg": assets.bytes("target.jpg"),
        "assets/overlay.png": assets.bytes("overlay-square.png"),
        "assets/video.mp4": assets.bytes("video-16x9.mp4"),
    })
    write_json(directory / "expected.json", {
        "valid": True,
        "warnings": [],
        "package": "experience.arx",
        "target": {"size": target_size, "physicalWidth": 0.2},
        "layers": [
            layer_expect("overlay", [1, 1], translation(0, 0, 0.005),
                         identity_adapters(position=(0, 0, 0.005))),
            layer_expect("clip", video_size, translation(0, 0, 0.01, 0.5, 0.5, 1),
                         identity_adapters(position=(0, 0, 0.01), scale=(0.5, 0.5, 1)),
                         {"autoplay": True, "loop": True}),
        ],
    })

    # C012: non-uniform scale exposes a wrong T x R x S order.
    simple("C012-trs-composite", [
        {**image_layer, "transform": {
            "position": [0.1, 0.2, 0.3], "rotation": [0, 0, H, H], "scale": [0.5, 0.25, 1]}},
    ], four_three, [
        layer_expect("overlay", [1, 0.75],
                     [0, 0.5, 0, 0, -0.25, 0, 0, 0, 0, 0, 1, 0, 0.1, 0.2, 0.3, 1],
                     adapters((0.1, 0.2, 0.3), None, (0.5, 0.25, 1), [0, -H, 0, H], [0, H, 0, H])),
    ])

    # C013: |q| = 0.99702, within the 1% tolerance: normalized with a warning.
    simple("C013-quaternion-near-unit", [
        {**image_layer, "transform": {"rotation": [0, 0, 0.705, 0.705]}},
    ], four_three, [
        layer_expect("overlay", [1, 0.75], rz90,
                     adapters((0, 0, 0), None, (1, 1, 1), [0, -H, 0, H], [0, H, 0, H])),
    ], warnings=["ARX_QUATERNION_DRIFT"])

    simple("C014-video-no-faststart", [
        {"id": "clip", "type": "video", "src": "assets/video.mp4", "autoplay": True},
    ], {"assets/video.mp4": "video-no-faststart.mp4"}, [
        layer_expect("clip", video_size, IDENTITY, identity_adapters(),
                     {"autoplay": True, "loop": False}),
    ], warnings=["ARX_VIDEO_NOT_FASTSTART"])

    # C015: +90 deg about X stands the layer up; its top points out of the image.
    simple("C015-rotate-x-90", [
        {**image_layer, "transform": {"rotation": [H, 0, 0, H]}},
    ], four_three, [
        layer_expect("overlay", [1, 0.75],
                     [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1],
                     adapters((0, 0, 0), None, (1, 1, 1), [-H, 0, 0, H], [H, 0, 0, H])),
    ])

    # C017: 30 deg about Z with non-uniform scale. Every rotation-matrix term is
    # non-zero, so a scale applied to the wrong axis shows up (C012's 90 deg hides it).
    # cos 30 = 0.8660254, sin 30 = 0.5, q = [0, 0, sin 15, cos 15].
    simple("C017-rotate-z-30-nonuniform", [
        {**image_layer, "transform": {
            "position": [0.1, -0.05, 0.01], "rotation": [0, 0, 0.25881905, 0.96592583],
            "scale": [0.5, 0.25, 1]}},
    ], four_three, [
        layer_expect("overlay", [1, 0.75],
                     [0.4330127, 0.25, 0, 0, -0.125, 0.21650635, 0, 0, 0, 0, 1, 0, 0.1, -0.05, 0.01, 1],
                     adapters((0.1, -0.05, 0.01), None, (0.5, 0.25, 1),
                              [0, -0.25881905, 0, 0.96592583], [0, 0.25881905, 0, 0.96592583])),
    ])

    # C018: a manifest saved with a UTF-8 byte order mark (common from Windows editors)
    # is the same manifest. JSON.parse-compatible readers strip one leading BOM.
    simple("C018-manifest-utf8-bom", [image_layer], square, [
        layer_expect("overlay", [1, 1], IDENTITY, identity_adapters()),
    ])
    bom_manifest = FIXTURES / "positive" / "C018-manifest-utf8-bom" / "manifest.json"
    bom_manifest.write_bytes(b"\xef\xbb\xbf" + bom_manifest.read_bytes())

    # C016: physicalWidth is optional; the runtime uses the tracker's estimate.
    simple("C016-no-physical-width", [
        {**image_layer, "transform": {"position": [0, 0, 0.005]}},
    ], four_three, [
        layer_expect("overlay", [1, 0.75], translation(0, 0, 0.005),
                     identity_adapters(position=(0, 0, 0.005))),
    ], anchor_width=None)

    # C019: C001 plus declared ARX_effects data. An implementation that does not read the extension
    # (no supported extensions) opens it like C001: no warning,
    # no effects (spec 10, spec/extensions/ARX_effects.md 1).
    directory = fixture_dir("positive", "C019-unknown-extension-ignored")
    copy_assets(directory, assets, {**target, **square})
    write_json(directory / "manifest.json", manifest("C019", target_anchor(), [image_layer],
                                                     extensionsUsed=[EFFECTS],
                                                     extensions={EFFECTS: {"effects": [PINK_SPARKLE]}}))
    write_json(directory / "expected.json", {
        "valid": True,
        "warnings": [],
        "target": {"size": target_size, "physicalWidth": 0.2},
        "layers": [layer_expect("overlay", [1, 1], IDENTITY, identity_adapters())],
        "effects": [],
    })


# ---------------------------------------------------------------- negative


def negative(assets: Assets) -> None:
    base_files = {"assets/target.jpg": "target.jpg", "assets/overlay.png": "overlay-4x3.png"}
    overlay = {"id": "overlay", "type": "image", "src": "assets/overlay.png"}

    def case(name, code, path, layers=None, anchor=None, files=None, errors=None, **extra):
        directory = fixture_dir("negative", name)
        copy_assets(directory, assets, files if files is not None else base_files)
        write_json(directory / "manifest.json",
                   manifest(name[:4], anchor or target_anchor(), layers or [overlay], **extra))
        write_json(directory / "expected.json", {
            "valid": False,
            "errors": errors or [{"code": code, "path": path}],
        })
        return directory

    case("N001-width-zero", "ARX_SCHEMA", "/anchor/physicalWidth", anchor=target_anchor(0))
    case("N002-bad-quaternion", "ARX_QUATERNION_NOT_UNIT", "/layers/0/transform/rotation",
         layers=[{**overlay, "transform": {"rotation": [0, 0, 0.5, 0.5]}}])
    case("N003-duplicate-id", "ARX_DUPLICATE_LAYER_ID", "/layers/1/id",
         layers=[overlay, {**overlay, "transform": {"position": [0, 0, 0.001]}}])
    case("N004-unsafe-uri", "ARX_URI_SCHEME", "/layers/0/src",
         layers=[{**overlay, "src": "javascript:alert(1)"}])
    case("N005-missing-asset", "ARX_ASSET_MISSING", "/layers/0/src",
         layers=[{**overlay, "src": "assets/missing.png"}])
    wrong = "sha256-" + base64.b64encode(hashlib.sha256(b"not the overlay").digest()).decode()
    case("N006-hash-mismatch", "ARX_INTEGRITY_MISMATCH", "/layers/0/integrity",
         layers=[{**overlay, "integrity": wrong}])
    case("N007-bad-video", "ARX_VIDEO_CODEC", "/layers/0/src",
         layers=[{"id": "clip", "type": "video", "src": "assets/video.mp4"}],
         files={"assets/target.jpg": "target.jpg", "assets/video.mp4": "video-mpeg4.mp4"})

    directory = fixture_dir("negative", "N008-zip-slip")
    good = manifest("N008", target_anchor(), [overlay])
    write_zip(directory / "experience.arx", {
        "manifest.json": (json.dumps(good, indent=2) + "\n").encode(),
        "assets/target.jpg": assets.bytes("target.jpg"),
        "assets/overlay.png": assets.bytes("overlay-4x3.png"),
        "../evil.png": assets.bytes("overlay-4x3.png"),
    })
    write_json(directory / "expected.json", {
        "valid": False,
        "package": "experience.arx",
        "errors": [{"code": "ARX_PACKAGE_PATH", "path": "zip:../evil.png"}],
    })

    case("N009-extension-unsupported", "ARX_EXTENSION_UNSUPPORTED", "/extensionsRequired/0",
         extensionsUsed=["VENDOR_future_feature"], extensionsRequired=["VENDOR_future_feature"])
    case("N010-extension-not-declared", "ARX_EXTENSION_NOT_DECLARED", "/extensionsRequired/0",
         extensionsUsed=[], extensionsRequired=["VENDOR_future_feature"])
    case("N011-path-escape", "ARX_URI_PATH", "/layers/0/src",
         layers=[{**overlay, "src": "../shared/overlay.png"}])
    case("N012-http-remote", "ARX_URI_SCHEME", "/layers/0/src",
         layers=[{**overlay, "src": "http://cdn.arx.example/overlay.png"}])
    directory = case("N013-spec-version", "ARX_SPEC_VERSION", "/spec")
    spec_manifest = json.loads((directory / "manifest.json").read_text())
    write_json(directory / "manifest.json", {**spec_manifest, "spec": "arx/0.2"})
    case("N014-target-not-image", "ARX_ASSET_DECODE", "/anchor/src",
         anchor=target_anchor(src="assets/video.mp4"),
         files={**base_files, "assets/video.mp4": "video-16x9.mp4"})
    case("N015-private-network", "ARX_URI_PRIVATE_NETWORK", "/layers/0/src",
         layers=[{**overlay, "src": "https://192.168.0.10/overlay.png"}])
    # A space is not allowed in a URI reference; every implementation must reject it
    # in the schema step (format: uri-reference, RFC 3986).
    case("N016-src-not-uri-reference", "ARX_SCHEMA", "/layers/0/src",
         layers=[{**overlay, "src": "assets/over lay.png"}])
    # Loopback written in forms URL parsers normalize (WHATWG shorthand, decimal, hex and
    # octal IPv4, uncompressed IPv6, the fully qualified "localhost."). Every one is the
    # same private host as 127.0.0.1 or ::1 and must be refused (spec 7).
    loopback_forms = [
        "https://127.1/overlay.png",
        "https://2130706433/overlay.png",
        "https://0x7f.0.0.1/overlay.png",
        "https://0177.0.0.1/overlay.png",
        "https://[0:0:0:0:0:0:0:1]/overlay.png",
        "https://localhost./overlay.png",
    ]
    case("N017-loopback-spellings", None, None,
         layers=[{**overlay, "id": f"overlay{index}", "src": src} for index, src in enumerate(loopback_forms)],
         errors=[{"code": "ARX_URI_PRIVATE_NETWORK", "path": f"/layers/{index}/src"}
                 for index in range(len(loopback_forms))])
    # An https URL without an authority has no host (RFC 9110 says to reject it as invalid).
    # WHATWG parsers would turn these into https://cdn.arx.example/..., so the raw text decides.
    hostless_forms = [
        "https:cdn.arx.example/overlay.png",
        "https:/cdn.arx.example/overlay.png",
        "https:///cdn.arx.example/overlay.png",
    ]
    case("N018-https-without-host", None, None,
         layers=[{**overlay, "id": f"overlay{index}", "src": src} for index, src in enumerate(hostless_forms)],
         errors=[{"code": "ARX_URI_SCHEME", "path": f"/layers/{index}/src"}
                 for index in range(len(hostless_forms))])


# ---------------------------------------------------------------- effects


def effect_expect(effect_id, preset, colors, amount, size, speed, sprite, matrix):
    """Resolved effect (spec/extensions/ARX_effects.md 4.3): defaults filled, emitter matrix E."""
    return {"id": effect_id, "preset": preset, "colors": colors, "amount": amount,
            "size": size, "speed": speed, "sprite": sprite, "matrix": matrix}


def warn(code, pointer):
    return {"code": code, "path": pointer}


def effects(assets: Assets) -> None:
    """ARX_effects conformance fixtures, validated with supportedExtensions = [ARX_effects].

    Every fixture is valid (spec/extensions/ARX_effects.md 4.2): bad effect data drops that effect, or every effect,
    with a warning, and the C001 layer stays. Expected effects are hand-written literals;
    the preset defaults are sparkle 0.03/star, rise 0.015/dot, burst 0.02/soft,
    snow 0.012/soft, float 0.05/glow-star (schema/ext/ARX_effects.presets.json).
    """
    files = {"assets/target.jpg": "target.jpg", "assets/overlay.png": "overlay-square.png"}
    overlay = {"id": "overlay", "type": "image", "src": "assets/overlay.png"}
    overlay_expect = layer_expect("overlay", [1, 1], IDENTITY, identity_adapters())
    gold = ["#FFD700", "#FFFFFF"]

    def case(name, arx_effects, expected_effects, warnings=(), declared=True):
        directory = fixture_dir("effects", name)
        copy_assets(directory, assets, files)
        extra = {"extensionsUsed": [EFFECTS]} if declared else {}
        write_json(directory / "manifest.json",
                   manifest(name[:4], target_anchor(), [overlay], **extra,
                            extensions={EFFECTS: arx_effects}))
        write_json(directory / "expected.json", {
            "valid": True,
            "warnings": list(warnings),
            "target": {"size": [1, 0.75], "physicalWidth": 0.2},
            "layers": [overlay_expect],
            "effects": expected_effects,
        })

    def at(index, field=""):
        return f"{EFFECTS_ROOT}/effects/{index}{field}"

    sparkle = {"id": "glow", "preset": "sparkle", "colors": gold}
    sparkle_expect = effect_expect("glow", "sparkle", gold, 1, 0.03, 1, "star", IDENTITY)

    # E001: no optional field; every default is filled and E is the identity.
    case("E001-sparkle-defaults", {"effects": [{"id": "sparkle-defaults", "preset": "sparkle", "colors": gold}]},
         [effect_expect("sparkle-defaults", "sparkle", gold, 1, 0.03, 1, "star", IDENTITY)])

    # E002: the five presets with different transforms and optional fields.
    # rise: +90 deg about Z. burst: +90 deg about X with scale (0.5, 0.25, 1), as C015.
    # snow: 30 deg about Z (cos 0.8660254, sin 0.5) with scale (1, 0.5, 2).
    # float: mint stars, no optional field, at its own height z 0.01;
    # its default sprite is glow-star.
    white_blue = ["#FFFFFF", "#3060FF"]
    mint = ["#36F4B8", "#36F4B8"]
    case("E002-all-presets", {"effects": [
        {"id": "sparkle-a", "preset": "sparkle", "colors": gold,
         "transform": {"position": [0.1, 0.2, 0.03], "scale": [0.2, 0.2, 1]}},
        {"id": "rise-a", "preset": "rise", "colors": white_blue, "amount": 2, "speed": 0.5, "sprite": "star",
         "transform": {"position": [-0.25, 0, 0.02], "rotation": [0, 0, H, H]}},
        {"id": "burst-a", "preset": "burst", "colors": ["#FF0071", "#18004A"], "size": 0.05,
         "transform": {"position": [0, 0.3, 0.05], "rotation": [H, 0, 0, H], "scale": [0.5, 0.25, 1]}},
        {"id": "snow-a", "preset": "snow", "colors": white_blue, "amount": 0.1, "speed": 0,
         "transform": {"position": [0, 0.4, 0.1], "rotation": [0, 0, 0.25881905, 0.96592583],
                       "scale": [1, 0.5, 2]}},
        {"id": "float-a", "preset": "float", "colors": mint, "transform": {"position": [0, 0, 0.01]}},
    ]}, [
        effect_expect("sparkle-a", "sparkle", gold, 1, 0.03, 1, "star", translation(0.1, 0.2, 0.03, 0.2, 0.2, 1)),
        effect_expect("rise-a", "rise", white_blue, 2, 0.015, 0.5, "star",
                      [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, -0.25, 0, 0.02, 1]),
        effect_expect("burst-a", "burst", ["#FF0071", "#18004A"], 1, 0.05, 1, "soft",
                      [0.5, 0, 0, 0, 0, 0, 0.25, 0, 0, -1, 0, 0, 0, 0.3, 0.05, 1]),
        effect_expect("snow-a", "snow", white_blue, 0.1, 0.012, 0, "soft",
                      [0.8660254, 0.5, 0, 0, -0.25, 0.4330127, 0, 0, 0, 0, 2, 0, 0, 0.4, 0.1, 1]),
        effect_expect("float-a", "float", mint, 1, 0.05, 1, "glow-star", translation(0, 0, 0.01)),
    ])

    # E003, E004: two reference effects (a white particle spread and the pink sparkle), also the
    # input of the on-device check of the same effects.
    white = ["#FFFFFF", "#FFFFFF"]
    case("E003-white-cone", {"effects": [
        {"id": "white-cone", "preset": "rise", "colors": white, "amount": 1,
         "transform": {"position": [0, 0, 0.01]}},
    ]}, [effect_expect("white-cone", "rise", white, 1, 0.015, 1, "dot", translation(0, 0, 0.01))])
    case("E004-pink-sparkle", {"effects": [PINK_SPARKLE]}, [
        effect_expect("pink-sparkle", "sparkle", ["#FF0071", "#18004A"], 1, 0.03, 0, "star",
                      translation(0.1, 0.2, 0.03, 0.2, 0.2, 1)),
    ])

    # E009: the most effects (8), each snow at amount 4, the performance-budget input.
    snow_colors = ["#FFFFFF", "#C8E6FF"]
    snow_x = [-0.35, -0.25, -0.15, -0.05, 0.05, 0.15, 0.25, 0.35]
    case("E009-worst-case", {"effects": [
        {"id": f"snow-{index}", "preset": "snow", "colors": snow_colors, "amount": 4,
         "transform": {"position": [x, 0.3, 0.02]}}
        for index, x in enumerate(snow_x)
    ]}, [
        effect_expect(f"snow-{index}", "snow", snow_colors, 4, 0.012, 1, "soft", translation(x, 0.3, 0.02))
        for index, x in enumerate(snow_x)
    ])

    # D001: unknown preset and sprite values are ARX_EFFECT_UNSUPPORTED. A dropped effect does
    # not reserve its id; "constructor" is not a preset; preset is reported before sprite.
    case("D001-unknown-preset", {"effects": [
        {"id": "glow", "preset": "firefly", "colors": gold},
        sparkle,
        {"id": "heart-rise", "preset": "rise", "colors": gold, "sprite": "heart"},
        {"id": "inherited", "preset": "constructor", "colors": gold},
        {"id": "both-unknown", "preset": "firefly", "colors": gold, "sprite": "heart"},
    ]}, [sparkle_expect], [
        warn("ARX_EFFECT_UNSUPPORTED", at(0, "/preset")),
        warn("ARX_EFFECT_UNSUPPORTED", at(2, "/sprite")),
        warn("ARX_EFFECT_UNSUPPORTED", at(3, "/preset")),
        warn("ARX_EFFECT_UNSUPPORTED", at(4, "/preset")),
    ])

    # D002: amount below 0.1 and above 4. The schema problem is reported before the preset.
    case("D002-amount-range", {"effects": [
        {**sparkle, "id": "low", "amount": 0.05},
        sparkle,
        {**sparkle, "id": "high", "preset": "firefly", "amount": 5},
    ]}, [sparkle_expect], [
        warn("ARX_EFFECT_INVALID", at(0, "/amount")),
        warn("ARX_EFFECT_INVALID", at(2, "/amount")),
    ])

    case("D003-bad-color", {"effects": [
        {**sparkle, "id": "short", "colors": ["#FFF", "#18004A"]},
        sparkle,
        {**sparkle, "id": "no-hash", "colors": ["#FF0071", "FF0071"]},
    ]}, [sparkle_expect], [
        warn("ARX_EFFECT_INVALID", at(0, "/colors/0")),
        warn("ARX_EFFECT_INVALID", at(2, "/colors/1")),
    ])

    # D004: an unknown field is reported at the object that has it.
    case("D004-extra-field", {"effects": [
        sparkle,
        {**sparkle, "id": "faded", "opacity": 1},
        {**sparkle, "id": "skewed", "transform": {"skew": 1}},
    ]}, [sparkle_expect], [
        warn("ARX_EFFECT_INVALID", at(1)),
        warn("ARX_EFFECT_INVALID", at(2, "/transform")),
    ])

    # D005: an id equal to a layer id or to a kept effect's id drops the later effect.
    # The id is reported before the preset.
    case("D005-duplicate-id", {"effects": [
        {**sparkle, "id": "overlay"},
        sparkle,
        {**sparkle, "preset": "firefly"},
    ]}, [sparkle_expect], [
        warn("ARX_EFFECT_INVALID", at(0, "/id")),
        warn("ARX_EFFECT_INVALID", at(2, "/id")),
    ])

    # D006, D007: a bad extension object drops every effect with one warning at its root.
    case("D006-not-array", {"effects": sparkle}, [], [warn("ARX_EFFECT_INVALID", EFFECTS_ROOT)])
    case("D007-too-many", {"effects": [{**sparkle, "id": f"glow-{index}"} for index in range(9)]},
         [], [warn("ARX_EFFECT_INVALID", EFFECTS_ROOT)])

    # D008: |q| = 1.05 drops the effect (the rotation is reported before the id); a component
    # above 1 is a schema problem. |q| = 1.00499 is normalized with ARX_QUATERNION_DRIFT:
    # q = (0, 0, 0.1, 1) / sqrt(1.01) gives cos = 0.99 / 1.01 = 0.98019802, sin = 0.2 / 1.01 = 0.1980198.
    # |q| = 1.00005 is normalized silently: cos = 0.9999 / 1.0001 = 0.99980002, sin = 0.02 / 1.0001 = 0.019998.
    case("D008-quaternion", {"effects": [
        {**sparkle, "id": "overlay", "transform": {"rotation": [0, 0, 0.32015621, 1]}},
        {**sparkle, "id": "drifted", "transform": {"position": [0.2, 0, 0.02], "rotation": [0, 0, 0.1, 1]}},
        {**sparkle, "id": "near-unit", "transform": {"position": [-0.2, 0, 0.02], "rotation": [0, 0, 0.01, 1]}},
        {**sparkle, "id": "over-one", "transform": {"rotation": [0, 0, 0, 1.05]}},
    ]}, [
        effect_expect("drifted", "sparkle", gold, 1, 0.03, 1, "star",
                      [0.98019802, 0.1980198, 0, 0, -0.1980198, 0.98019802, 0, 0, 0, 0, 1, 0, 0.2, 0, 0.02, 1]),
        effect_expect("near-unit", "sparkle", gold, 1, 0.03, 1, "star",
                      [0.99980002, 0.019998, 0, 0, -0.019998, 0.99980002, 0, 0, 0, 0, 1, 0, -0.2, 0, 0.02, 1]),
    ], [
        warn("ARX_EFFECT_INVALID", at(0, "/transform/rotation")),
        warn("ARX_QUATERNION_DRIFT", at(1, "/transform/rotation")),
        warn("ARX_EFFECT_INVALID", at(3, "/transform/rotation/3")),
    ])

    # D009: effect data without "ARX_effects" in extensionsUsed is not read.
    case("D009-undeclared", {"effects": [sparkle]}, [],
         [warn("ARX_EXTENSION_UNDECLARED", EFFECTS_ROOT)], declared=False)


def main() -> None:
    for kind in ("positive", "negative"):
        shutil.rmtree(FIXTURES / kind, ignore_errors=True)
    # fixtures/effects also holds files of other tools (simulation.json from effects_reference.py,
    # emitter-settings.json), so only the E and D fixture folders are rebuilt.
    for directory in sorted((FIXTURES / "effects").glob("[ED][0-9][0-9][0-9]-*")):
        shutil.rmtree(directory)
    with tempfile.TemporaryDirectory() as cache:
        assets = Assets(Path(cache))
        positive(assets)
        negative(assets)
        effects(assets)
    count = sum(1 for _ in FIXTURES.glob("*/*/expected.json"))
    print(f"generated {count} fixtures in {FIXTURES}")


if __name__ == "__main__":
    main()
