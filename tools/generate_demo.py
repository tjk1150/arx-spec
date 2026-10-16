"""Generates the ARX demo artwork: a sleeping village (the target picture) that wakes up into morning (the video layer).

The video starts as an exact copy of the picture, so in AR the picture itself seems to come alive at the same place and
size. Everything is drawn from shapes with a fixed random seed: no photographs, fonts or third-party media.

    python3 tools/generate_demo.py [--ffmpeg PATH]

Writes docs/demo/target.jpg and docs/demo/video.mp4 (1200x900, 4:3, so the video covers the target at scale 1).
"""
import argparse
import math
import random
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "demo"
WIDTH, HEIGHT = 1200, 900
FPS = 30
SECONDS = 8
SEED = 20261016

NIGHT_TOP, NIGHT_BOTTOM = (10, 14, 46), (38, 44, 98)
DAWN_TOP, DAWN_BOTTOM = (70, 80, 150), (250, 150, 90)
DAY_TOP, DAY_BOTTOM = (90, 160, 235), (190, 225, 250)
WINDOW_ON, WINDOW_OFF = (255, 214, 102), (70, 60, 50)


def lerp(start, end, t):
    return tuple(round(a + (b - a) * t) for a, b in zip(start, end))


def smooth(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def sky(top, bottom):
    image = Image.new("RGB", (WIDTH, HEIGHT))
    draw = ImageDraw.Draw(image)
    for y in range(HEIGHT):
        draw.line([(0, y), (WIDTH, y)], fill=lerp(top, bottom, y / HEIGHT))
    return image


def make_stars(rng):
    """Bright points and small crosses of varied size: rich detail for image tracking."""
    layer = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    for _ in range(420):
        x, y = rng.uniform(0, WIDTH), rng.uniform(0, HEIGHT * 0.62)
        size = rng.choice([1, 1, 1, 2, 2, 3])
        shade = rng.randint(170, 255)
        draw.ellipse([x - size, y - size, x + size, y + size], fill=(shade, shade, rng.randint(200, 255), 255))
        if size == 3:
            draw.line([(x - 8, y), (x + 8, y)], fill=(255, 255, 255, 200), width=1)
            draw.line([(x, y - 8), (x, y + 8)], fill=(255, 255, 255, 200), width=1)
    return layer


def hill_points(rng, base, amplitude, waves):
    phases = [rng.uniform(0, math.tau) for _ in waves]
    points = []
    for x in range(0, WIDTH + 1, 8):
        y = base + sum(amplitude * math.sin(x / WIDTH * math.tau * w + p) / (i + 1) for i, (w, p) in enumerate(zip(waves, phases)))
        points.append((x, y))
    return points + [(WIDTH, HEIGHT), (0, HEIGHT)]


def make_land(rng):
    """Hills, grass strokes, a road, trees and houses. Returns (land RGBA, window boxes)."""
    land = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(land)
    layers = [(560, 55, (1, 2.3), (30, 52, 70)), (640, 45, (1.6, 3.1), (28, 66, 58)), (730, 35, (2.2, 4.0), (34, 84, 52))]
    for base, amplitude, waves, color in layers:
        draw.polygon(hill_points(rng, base, amplitude, waves), fill=color + (255,))
    for _ in range(1400):  # grass strokes over the near hills
        x, y = rng.uniform(0, WIDTH), rng.uniform(690, HEIGHT)
        length = rng.uniform(6, 16)
        draw.line([(x, y), (x + rng.uniform(-4, 4), y - length)], fill=(60, rng.randint(110, 150), 70, 255), width=2)
    road = [(560, HEIGHT), (640, HEIGHT), (600, 800), (650, 740), (610, 700), (585, 700), (560, 740), (520, 800)]
    draw.polygon(road, fill=(120, 100, 80, 255))
    for _ in range(26):  # trees: trunk and layered crown
        x, y = rng.uniform(20, WIDTH - 20), rng.uniform(640, 860)
        height = rng.uniform(40, 80)
        draw.rectangle([x - 3, y - height * 0.3, x + 3, y], fill=(70, 50, 35, 255))
        for step in range(3):
            width = height * (0.45 - step * 0.1)
            top = y - height * (0.3 + 0.25 * (step + 1))
            draw.polygon([(x - width, top + height * 0.3), (x + width, top + height * 0.3), (x, top)], fill=(20, 70 + step * 15, 45, 255))
    windows = []
    for index in range(9):  # houses with lit windows
        x = 120 + index * 120 + rng.uniform(-25, 25)
        y = 640 + rng.uniform(-30, 40)
        w, h = rng.uniform(70, 100), rng.uniform(55, 80)
        wall = (rng.randint(150, 210), rng.randint(110, 160), rng.randint(90, 130), 255)
        draw.rectangle([x, y - h, x + w, y], fill=wall)
        draw.polygon([(x - 10, y - h), (x + w + 10, y - h), (x + w / 2, y - h - rng.uniform(35, 55))], fill=(140, 50, 45, 255))
        for row in range(2):
            for column in range(2):
                box = (x + 12 + column * (w / 2 - 6), y - h + 10 + row * (h / 2 - 4), x + 4 + (column + 1) * (w / 2 - 6), y - h + 4 + (row + 1) * (h / 2 - 4))
                windows.append(box)
        draw.rectangle([x + w / 2 - 8, y - 26, x + w / 2 + 8, y], fill=(80, 55, 40, 255))
    return land, windows


def draw_windows(image, windows, light):
    draw = ImageDraw.Draw(image)
    color = lerp(WINDOW_OFF, WINDOW_ON, light)
    for box in windows:
        draw.rectangle(box, fill=color)
        draw.line([((box[0] + box[2]) / 2, box[1]), ((box[0] + box[2]) / 2, box[3])], fill=(60, 45, 35), width=2)


def moon(image, alpha):
    if alpha <= 0:
        return
    layer = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    draw.ellipse([900, 90, 1010, 200], fill=(250, 240, 200, round(255 * alpha)))
    draw.ellipse([930, 75, 1040, 185], fill=(0, 0, 0, 0))
    image.alpha_composite(layer)


def sun(image, rise):
    """rise 0: hidden behind the hills; 1: high in the sky."""
    if rise <= 0:
        return
    cx, cy = 320, 640 - rise * 420
    glow = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([cx - 150, cy - 150, cx + 150, cy + 150], fill=(255, 220, 140, 110))
    image.alpha_composite(glow.filter(ImageFilter.GaussianBlur(40)))
    ImageDraw.Draw(image).ellipse([cx - 62, cy - 62, cx + 62, cy + 62], fill=(255, 205, 90, 255))


def birds(image, t):
    if not 0.35 < t < 0.75:
        return
    draw = ImageDraw.Draw(image)
    progress = (t - 0.35) / 0.4
    for index in range(4):
        x = -60 + progress * (WIDTH + 120) - index * 45
        y = 260 + index * 22 + math.sin(progress * 12 + index) * 8
        wing = 10 + 4 * math.sin(progress * 40 + index)
        draw.line([(x - 14, y - wing / 2), (x, y), (x + 14, y - wing / 2)], fill=(40, 40, 50), width=3)


def frame(t, stars, land, windows):
    """t in [0, 1): 0 and the end are night; morning peaks in the middle."""
    if t < 0.08 or t > 0.92:
        day = 0.0
    elif t < 0.5:
        day = smooth((t - 0.08) / 0.42)
    else:
        day = smooth((0.92 - t) / 0.42)
    top = lerp(NIGHT_TOP, DAWN_TOP, min(1, day * 2)) if day < 0.5 else lerp(DAWN_TOP, DAY_TOP, day * 2 - 1)
    bottom = lerp(NIGHT_BOTTOM, DAWN_BOTTOM, min(1, day * 2)) if day < 0.5 else lerp(DAWN_BOTTOM, DAY_BOTTOM, day * 2 - 1)
    image = sky(top, bottom).convert("RGBA")
    star_layer = stars.copy()
    star_layer.putalpha(star_layer.getchannel("A").point(lambda a: round(a * (1 - day))))
    image.alpha_composite(star_layer)
    moon(image, 1 - day)
    sun(image, day)
    image.alpha_composite(land)
    draw_windows(image, windows, 1 - day)
    birds(image, t)
    return image.convert("RGB")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ffmpeg", default=shutil.which("ffmpeg"))
    args = parser.parse_args()
    if not args.ffmpeg:
        raise SystemExit("ffmpeg not found: pass --ffmpeg (pnpm install provides node_modules/ffmpeg-static/ffmpeg)")
    rng = random.Random(SEED)
    stars = make_stars(rng)
    land, windows = make_land(rng)
    OUT.mkdir(parents=True, exist_ok=True)
    frame(0.0, stars, land, windows).save(OUT / "target.jpg", quality=92, optimize=True)
    with tempfile.TemporaryDirectory() as tmp:
        total = FPS * SECONDS
        for index in range(total):
            frame(index / total, stars, land, windows).save(Path(tmp) / f"f{index:04d}.png")
        subprocess.run(
            [args.ffmpeg, "-y", "-loglevel", "error", "-framerate", str(FPS), "-i", str(Path(tmp) / "f%04d.png"),
             "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-profile:v", "high",
             "-movflags", "+faststart", "-an", str(OUT / "video.mp4")],
            check=True,
        )
    print(f"wrote {OUT / 'target.jpg'} and {OUT / 'video.mp4'}")


if __name__ == "__main__":
    main()
