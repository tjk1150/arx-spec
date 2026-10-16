"""Generates the built-in ARX_effects sprites (spec/extensions/ARX_effects.md).

Each sprite is a 64x64 PNG: white RGB everywhere and a straight (not
premultiplied) alpha channel that carries the shape. The shapes are computed
from exact arithmetic (products, quotients, sums and square roots only, with
4x4 supersampling for the hard edges and the thin rays), so two runs write the
same bytes.

Usage: python3 tools/generate_effect_sprites.py [--out DIR]
DIR defaults to schema/ext/sprites.
"""

import argparse
import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "schema" / "ext" / "sprites"

SIZE = 64
CENTER = SIZE / 2
SUPERSAMPLE = 4
DOT_RADIUS = 28.0
SOFT_RADIUS = 31.0
STAR_RADIUS = 31.0
# glow-star: a bright core, a soft round glow of
# about 0.45 sprite widths and four thin rays that reach almost to the edge.
GLOW_STAR_CORE_RADIUS = 16.0
GLOW_STAR_GLOW_RADIUS = 0.45 * SIZE
GLOW_STAR_GLOW_ALPHA = 0.7
GLOW_STAR_RAY_LENGTH = 31.0
GLOW_STAR_RAY_HALF_WIDTH = 5.5


def coverage(inside, x: int, y: int) -> int:
    """Alpha 0..255 from the share of 4x4 sample points of pixel (x, y) inside the shape."""
    hits = 0
    for sub_y in range(SUPERSAMPLE):
        for sub_x in range(SUPERSAMPLE):
            px = x + (sub_x + 0.5) / SUPERSAMPLE - CENTER
            py = y + (sub_y + 0.5) / SUPERSAMPLE - CENTER
            hits += 1 if inside(px, py) else 0
    return (hits * 255 + SUPERSAMPLE * SUPERSAMPLE // 2) // (SUPERSAMPLE * SUPERSAMPLE)


def dot(x: int, y: int) -> int:
    """Solid disk with an anti-aliased edge."""
    return coverage(lambda px, py: px * px + py * py <= DOT_RADIUS * DOT_RADIUS, x, y)


def soft(x: int, y: int) -> int:
    """Round glow: alpha = (1 - r^2 / R^2)^2, zero from R outwards."""
    px = x + 0.5 - CENTER
    py = y + 0.5 - CENTER
    falloff = 1.0 - (px * px + py * py) / (SOFT_RADIUS * SOFT_RADIUS)
    if falloff <= 0.0:
        return 0
    return int(falloff * falloff * 255.0 + 0.5)


def star(x: int, y: int) -> int:
    """Four-point twinkle: sqrt|x| + sqrt|y| <= sqrt(R), anti-aliased."""
    limit = math.sqrt(STAR_RADIUS)
    return coverage(lambda px, py: math.sqrt(abs(px)) + math.sqrt(abs(py)) <= limit, x, y)


def bump(distance_squared: float, radius: float) -> float:
    """(1 - d^2 / R^2)^2 inside the radius, 0 outside: 1 at the center, flat at the edge."""
    falloff = 1.0 - distance_squared / (radius * radius)
    return falloff * falloff if falloff > 0.0 else 0.0


def ray(along: float, across: float) -> float:
    """One ray on the `along` axis: brightness and half width both fall linearly to 0 at the tip."""
    remaining = 1.0 - abs(along) / GLOW_STAR_RAY_LENGTH
    if remaining <= 0.0:
        return 0.0
    return remaining * bump(across * across, GLOW_STAR_RAY_HALF_WIDTH * remaining)


def glow_star_at(px: float, py: float) -> float:
    """Brightest of the core, the glow and the two ray axes at a point (max composite)."""
    distance_squared = px * px + py * py
    core = bump(distance_squared, GLOW_STAR_CORE_RADIUS)
    halo = bump(distance_squared, GLOW_STAR_GLOW_RADIUS)
    glow = GLOW_STAR_GLOW_ALPHA * halo * halo
    return max(core, glow, ray(px, py), ray(py, px))


def glow_star(x: int, y: int) -> int:
    """Glowing four-point star: the mean of glow_star_at over the 4x4 sample points of the pixel."""
    total = 0.0
    for sub_y in range(SUPERSAMPLE):
        for sub_x in range(SUPERSAMPLE):
            px = x + (sub_x + 0.5) / SUPERSAMPLE - CENTER
            py = y + (sub_y + 0.5) / SUPERSAMPLE - CENTER
            total += glow_star_at(px, py)
    return int(total * 255.0 / (SUPERSAMPLE * SUPERSAMPLE) + 0.5)


SPRITES = {"dot": dot, "soft": soft, "star": star, "glow-star": glow_star}


def render(alpha_at) -> Image.Image:
    pixels = bytearray()
    for y in range(SIZE):
        for x in range(SIZE):
            pixels += bytes((255, 255, 255, alpha_at(x, y)))
    return Image.frombytes("RGBA", (SIZE, SIZE), bytes(pixels))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output directory")
    out = parser.parse_args().out
    out.mkdir(parents=True, exist_ok=True)
    for name, alpha_at in SPRITES.items():
        path = out / f"{name}.png"
        render(alpha_at).save(path, format="PNG", optimize=False, compress_level=9)
        print(f"{path} {path.stat().st_size} bytes")


if __name__ == "__main__":
    main()
