"""Writes fixtures/effects/simulation.json: the ARX_effects deterministic particle simulation
(spec/extensions/ARX_effects.md section 7) computed here, independently of the TypeScript and
Kotlin implementations that must reproduce it to 1e-9.

This reference runs the random sequence one draw at a time from the seed and walks every particle
from birth number 0, so it shares no shortcut with the implementations under test.
Preset values come from schema/ext/ARX_effects.presets.json, the single source.
Run: python3 tools/effects_reference.py
"""

import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PRESETS = ROOT / "schema" / "ext" / "ARX_effects.presets.json"
OUTPUT = ROOT / "fixtures" / "effects" / "simulation.json"

TOLERANCE = 1e-9
MAX_PARTICLES = 256
DRAWS_PER_PARTICLE = 10
MASK = 0xFFFFFFFF
DEFAULT_ROTATION = (0.0, 0.0, 0.0, 1.0)


def fnv1a32(text):
    """FNV-1a 32-bit hash of the UTF-8 bytes of text (spec 7.2)."""
    value = 0x811C9DC5
    for byte in text.encode("utf-8"):
        value = ((value ^ byte) * 0x01000193) & MASK
    return value


def imul(left, right):
    return (left * right) & MASK


def mulberry32(seed):
    """Yields the mulberry32 sequence of seed, each value in [0, 1) (spec 7.2)."""
    state = seed & MASK
    while True:
        state = (state + 0x6D2B79F5) & MASK
        first = imul(state ^ (state >> 15), state | 1)
        second = ((first + imul(first ^ (first >> 7), first | 61)) & MASK) ^ first
        yield (second ^ (second >> 14)) / 4294967296


def lerp(start, end, fraction):
    return start + (end - start) * fraction


def cross(left, right):
    return (
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    )


def normalized(vector):
    length = math.sqrt(sum(component * component for component in vector))
    return tuple(component / length for component in vector)


def compose_trs(position, rotation, scale):
    """E = T x R x S, column-major, the formula of packages/arx-core/src/math.ts composeTrs."""
    x, y, z, w = rotation
    sx, sy, sz = scale
    return (
        (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0.0,
        2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0.0,
        2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0.0,
        position[0], position[1], position[2], 1.0,
    )


def transform_point(matrix, point):
    return tuple(matrix[axis] * point[0] + matrix[4 + axis] * point[1] + matrix[8 + axis] * point[2]
                 + matrix[12 + axis] for axis in range(3))


def resolved_rotation(rotation):
    """Layer rule: a rotation whose norm is not exactly 1 is normalized (spec 4.3)."""
    if abs(math.hypot(*rotation) - 1) == 0:
        return tuple(rotation)
    return normalized(rotation)


def alpha_curve(name, life_fraction):
    if name == "linearFadeOut":
        return 1 - life_fraction
    if name == "easeFadeOut":
        return 1 - life_fraction * life_fraction
    if name == "quickFadeInOut":
        return min(1, life_fraction / 0.1, (1 - life_fraction) / 0.1)
    if name == "gradualFadeInOut":
        return min(1, life_fraction / 0.3, (1 - life_fraction) / 0.3)
    if name == "constant":
        return 1
    raise ValueError(f"unknown alpha curve {name}")


def channels(color):
    return tuple(int(color[offset:offset + 2], 16) / 255 for offset in (1, 3, 5))


def round_half_away(value):
    """round() that sends .5 away from zero; the value here is never negative."""
    return math.floor(value + 0.5)


def births(preset, per_second, until):
    """Birth times in birth order, every particle born at or before `until` (spec 7.3)."""
    emission = preset["emission"]
    if emission["kind"] == "continuous":
        birth_number = 0
        while birth_number / per_second <= until:
            yield birth_number / per_second
            birth_number += 1
        return
    period = emission["emitSeconds"] + emission["pauseSeconds"]
    count = max(1, round_half_away(emission["emitSeconds"] * per_second))
    window = 0
    while window * period <= until:
        for in_window in range(count):
            yield window * period + in_window / per_second
        window += 1


def frame(direction):
    """e1, e2 of the direction cone (spec 7.4)."""
    helper = (0.0, 1.0, 0.0) if abs(direction[1]) < 0.9 else (0.0, 0.0, 1.0)
    e1 = normalized(cross(helper, direction))
    return e1, cross(direction, e1)


def particle(draws, preset, effect, emitter, rotation_matrix, birth):
    drawn = [next(draws) for _ in range(DRAWS_PER_PARTICLE)]
    shape = preset["shapeSize"]
    box_point = (2 * drawn[0] - 1, 2 * drawn[1] - 1, 2 * drawn[2] - 1)
    start = transform_point(emitter, (shape[0] * box_point[0], shape[1] * box_point[1], shape[2] * box_point[2]))
    cos_phi = 1 - drawn[3] * (1 - math.cos(preset["spreadDegrees"] * (math.pi / 180)))
    alpha = 2 * math.pi * drawn[4]
    speed = preset["speed"] * effect["speed"] * (1 + preset["speedVariation"] * (2 * drawn[5] - 1))
    lifetime = lerp(preset["lifetime"][0], preset["lifetime"][1], drawn[6])
    size = effect["size"] * (1 + preset["sizeVariation"] * (2 * drawn[7] - 1))
    angle = lerp(preset["angleDegrees"][0], preset["angleDegrees"][1], drawn[8])
    spin = lerp(preset["angularSpeedDegrees"][0], preset["angularSpeedDegrees"][1], drawn[9])
    axis = tuple(float(component) for component in preset["direction"])
    e1, e2 = frame(axis)
    sin_phi = math.sqrt(max(0.0, 1 - cos_phi * cos_phi))
    local = tuple(sin_phi * math.cos(alpha) * e1[index] + sin_phi * math.sin(alpha) * e2[index]
                  + cos_phi * axis[index] for index in range(3))
    turned = transform_point(rotation_matrix, local)
    return {"birth": birth, "start": start, "velocity": tuple(speed * component for component in turned),
            "lifetime": lifetime, "size": size, "angle": angle, "spin": spin}


def state(spawned, preset, effect, gravity, time, index):
    age = time - spawned["birth"]
    life_fraction = age / spawned["lifetime"]
    position = [spawned["start"][axis] + spawned["velocity"][axis] * age + 0.5 * gravity[axis] * age * age
                for axis in range(3)]
    birth_color, death_color = channels(effect["colors"][0]), channels(effect["colors"][1])
    return {
        "index": index,
        "position": position,
        "size": spawned["size"] * (1 + (preset["endSizeScale"] - 1) * life_fraction),
        "angleDegrees": spawned["angle"] + spawned["spin"] * age,
        "color": [birth_color[channel] + (death_color[channel] - birth_color[channel]) * life_fraction
                  for channel in range(3)],
        "alpha": alpha_curve(preset["alphaCurve"], life_fraction),
    }


def simulate(case, presets, time):
    """Live particles at effect time `time`, oldest first, at most MAX_PARTICLES (spec 7.5)."""
    preset = {**presets[case["effect"]["preset"]], **case.get("presetOverrides", {})}
    authored = case["effect"]
    transform = authored.get("transform", {})
    rotation = resolved_rotation(transform.get("rotation", DEFAULT_ROTATION))
    effect = {
        "colors": authored["colors"],
        "speed": authored.get("speed", 1),
        "size": authored.get("size", preset["size"]),
        "amount": authored.get("amount", 1),
    }
    emitter = compose_trs(transform.get("position", (0, 0, 0)), rotation, transform.get("scale", (1, 1, 1)))
    rotation_matrix = compose_trs((0, 0, 0), rotation, (1, 1, 1))
    gravity = transform_point(rotation_matrix, tuple(preset["acceleration"]))
    draws = mulberry32(fnv1a32(authored["id"]))
    alive = []
    for index, birth in enumerate(births(preset, preset["rate"] * effect["amount"], time)):
        spawned = particle(draws, preset, effect, emitter, rotation_matrix, birth)
        if birth <= time < birth + spawned["lifetime"] and len(alive) < MAX_PARTICLES:
            alive.append(state(spawned, preset, effect, gravity, time, index))
    return alive


def sample(alive):
    """The first three live particles and the last one, by their slot in the live list."""
    slots = sorted({slot for slot in (0, 1, 2, len(alive) - 1) if 0 <= slot < len(alive)})
    return [{"slot": slot, **alive[slot]} for slot in slots]


TURN_Y_30 = [0.0, math.sin(math.radians(15)), 0.0, math.cos(math.radians(15))]
TILT = list(normalized((0.2, -0.1, 0.3, 0.9)))

CASES = [
    {
        "name": "sparkle, small emitter",
        "effect": {"id": "sparkle-1", "preset": "sparkle", "colors": ["#FF0071", "#18004A"],
                   "transform": {"position": [0.1, 0.2, 0.03], "rotation": [0, 0, 0, 1], "scale": [0.2, 0.2, 1]},
                   "amount": 1, "size": 0.03, "speed": 0, "sprite": "star"},
        "times": [0, 0.05, 0.5, 1.25, 2.0, 7.3],
    },
    {
        "name": "rise, turned emitter, particle 0 dies exactly at 3 s",
        "effect": {"id": "rise-white", "preset": "rise", "colors": ["#FFFFFF", "#FFFFFF"],
                   "transform": {"position": [0, -0.2, 0], "rotation": TURN_Y_30, "scale": [1, 1, 1]},
                   "amount": 2.5, "speed": 1.5},
        "times": [0, 0.2, 1.0, 3.0, 3.5, 9.99],
    },
    {
        "name": "burst, tilted emitter with gravity, two windows",
        "effect": {"id": "burst-a", "preset": "burst", "colors": ["#FFD700", "#FF4500"],
                   "transform": {"position": [0, 0, 0.05], "rotation": TILT, "scale": [1, 2, 1]},
                   "amount": 0.7, "speed": 2},
        "times": [0, 0.05, 0.1, 0.9, 1.5, 1.55, 2.7, 3.01],
    },
    {
        "name": "snow, UTF-8 id, full amount, wide box",
        "effect": {"id": "눈-☃-1", "preset": "snow", "colors": ["#FFFFFF", "#A0C8FF"],
                   "transform": {"position": [0, 0.6, 0], "rotation": [0, 0, 0, 1], "scale": [2, 1, 1]},
                   "amount": 4, "size": 0.01},
        "times": [0, 0.3, 2.5, 5.0, 8.0, 12.25],
    },
    {
        "name": "cap: 256 oldest live particles are kept",
        "effect": {"id": "cap", "preset": "sparkle", "colors": ["#000000", "#FFFFFF"], "amount": 4},
        "presetOverrides": {"rate": 100, "lifetime": [1.5, 2.0]},
        "times": [0.5, 1.0, 1.75, 3.0],
    },
    {
        "name": "restart: burst found again plays window 0 again from T = 0",
        "effect": {"id": "burst-a", "preset": "burst", "colors": ["#FFD700", "#FF4500"],
                   "transform": {"position": [0, 0, 0.05], "rotation": TILT, "scale": [1, 2, 1]},
                   "amount": 0.7, "speed": 2},
        "times": [0.05, 0.9, 1.55, 2.2, 0.05, 0.9, 1.55],
        "restartBefore": 4,
    },
    {
        "name": "restart: a capped emitter refills from birth 0",
        "effect": {"id": "cap", "preset": "sparkle", "colors": ["#000000", "#FFFFFF"], "amount": 4},
        "presetOverrides": {"rate": 100, "lifetime": [1.5, 2.0]},
        "times": [0.5, 3.0, 0.5, 1.0],
        "restartBefore": 2,
    },
    {
        "name": "constant alpha curve: alpha 1 from birth to death",
        "effect": {"id": "constant-a", "preset": "snow", "colors": ["#37F6BC", "#37F6BC"], "amount": 2},
        "presetOverrides": {"alphaCurve": "constant"},
        "times": [0, 1.0, 4.0, 7.95],
    },
    {
        "name": "float, mint stars: fixed 3 s life, particle 0 dies exactly at 3 s",
        "effect": {"id": "float-mint", "preset": "float", "colors": ["#36F4B8", "#36F4B8"],
                   "transform": {"position": [0, 0, 0.01]}},
        "times": [0, 0.5, 2.99, 3.0, 4.2, 10.5],
    },
]


def main():
    presets = json.loads(PRESETS.read_text())["presets"]
    cases = []
    for case in CASES:
        # The effect state is a function of the effect time alone, so a restart (spec 7.1) only
        # sets the clock back to 0: the rows after it are fresh-simulation rows at their time.
        restart_before = case.get("restartBefore")
        expect = []
        for position, time in enumerate(case["times"]):
            alive = simulate(case, presets, time)
            restart = {"restart": True} if position == restart_before else {}
            expect.append({"time": time, **restart, "count": len(alive), "particles": sample(alive)})
        written = {key: value for key, value in case.items() if key != "restartBefore"}
        cases.append({**written, "expect": expect})
    data = {
        "description": "Deterministic particle simulation of ARX_effects (spec/extensions/ARX_effects.md section "
        "7). Seed = FNV-1a 32-bit of the effect id's UTF-8 bytes; one mulberry32 sequence per effect; each "
        "particle takes 10 draws in birth order: region x, y, z, cone cos(phi), cone alpha, speed, lifetime, "
        "size, first angle, angular speed. Births: continuous k / n; burst window w at w * (emitSeconds + "
        "pauseSeconds) with N = max(1, floor(emitSeconds * n + 0.5)) particles at j / n; n = rate * amount. A "
        "particle is alive when birth <= time < birth + lifetime; at most maxParticles live ones are kept, oldest "
        "(lowest index) first. Each expect row lists the live count and the particles at slots 0, 1, 2 and "
        "count - 1 of the live list in birth order: index (birth number), position (content-root space, "
        "target-width units), size, angleDegrees, color (sRGB 0..1), alpha. presetOverrides replaces fields of the "
        "named preset from schema/ext/ARX_effects.presets.json. An expect row with restart: true restarts the "
        "effect (spec 7.1, target tracked again) before advancing: the effect clock starts again at 0, so the row "
        "is a fresh simulation at its time. Compare every number with an absolute tolerance. "
        "Expected values come from tools/effects_reference.py.",
        "tolerance": TOLERANCE,
        "maxParticles": MAX_PARTICLES,
        "checks": {
            "seeds": {text: fnv1a32(text) for text in ("", "a", "sparkle-1")},
            "sequence": {"seed": 0xDF005EFB, "values": [value for value, _ in zip(mulberry32(0xDF005EFB), range(3))]},
        },
        "cases": cases,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {len(cases)} cases to {OUTPUT}")


if __name__ == "__main__":
    main()
