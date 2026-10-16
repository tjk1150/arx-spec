# ARX 0.1 Extension `ARX_effects` — Particle Effects

This is an informative translation. The Korean text ([ARX_effects.md](ARX_effects.md)) is normative.

Status: draft (2026-10-01). An optional extension under section 10 of the [ARX 0.1 specification](../0.1.en.md). The machine-readable contract is the extension schema [`schema/ext/ARX_effects.schema.json`](../../schema/ext/ARX_effects.schema.json), the preset table [`schema/ext/ARX_effects.presets.json`](../../schema/ext/ARX_effects.presets.json), and the built-in sprites [`schema/ext/sprites/`](../../schema/ext/sprites). The sprites are generated with [`tools/generate_effect_sprites.py`](../../tools/generate_effect_sprites.py). If this document and the two JSON files conflict, the conflict is treated as a bug and one of them is fixed.

## 1. Purpose and declaration

`ARX_effects` adds particle effects to an artwork (five predefined presets: `sparkle`, `rise`, `burst`, `snow`, and `float`). Image and video layers stay as in the 0.1 Core, and effects are an optional feature added on top of them.

| Rule | Content |
|---|---|
| spec value | Stays `"arx/0.1"`. This falls under "Adding an optional extension → Possible as a 0.1 extension" in section 14 of the 0.1 specification |
| Declaration | A manifest that contains effects MUST list `"ARX_effects"` in `extensionsUsed` |
| `extensionsRequired` | `"ARX_effects"` MUST NOT be listed. If it is, a Viewer that does not know this extension refuses the whole artwork (section 10 of the 0.1 specification) |
| Location | Only in the top-level `extensions.ARX_effects`. An `ARX_effects` entry in the `extensions` of `anchor` or of a layer is not data of this extension |
| Implementations that do not know it | As section 10 of the 0.1 specification says, they ignore this extension and run only the image and video layers |

An artwork made of effects alone, with zero layers, cannot be created. As in section 4.2 of the 0.1 specification, `layers` MUST hold one or more entries.

## 2. Shape

```json
{
  "spec": "arx/0.1",
  "anchor": { "type": "image", "src": "assets/target.jpg" },
  "layers": [ { "id": "planet", "type": "image", "src": "assets/planet.png" } ],
  "extensionsUsed": ["ARX_effects"],
  "extensions": {
    "ARX_effects": {
      "effects": [
        {
          "id": "sparkle-1",
          "transform": { "position": [0.1, 0.2, 0.03], "rotation": [0, 0, 0, 1], "scale": [0.2, 0.2, 1] },
          "preset": "sparkle",
          "colors": ["#FF0071", "#18004A"],
          "amount": 1,
          "size": 0.03,
          "speed": 0,
          "sprite": "star"
        }
      ]
    }
  }
}
```

| Field | Required | Range and default | Description |
|---|---|---|---|
| `effects` | MUST | Array, 1 to 8 entries | List of effects. The array order does not guarantee the drawing order |
| `effects[].id` | MUST | 1 to 128 characters | MUST differ from every layer `id` and every other effect `id` |
| `effects[].transform` | MAY | Same shape and defaults as the layer `transform` | Position, rotation, and scale of the emitter (section 3) |
| `effects[].preset` | MUST | `^[a-z][a-z0-9-]{0,31}$`. Values defined by this document: `sparkle`, `rise`, `burst`, `snow`, `float` | Defines the motion (birth region, direction, lifetime, curves) (section 5) |
| `effects[].colors` | MUST | Exactly 2, each `^#[0-9A-Fa-f]{6}$` (sRGB) | Birth color, then death color. For a single color, write the same value twice |
| `effects[].amount` | MAY | 0.1 to 4, default `1` | Multiplier of the preset's particles per second |
| `effects[].size` | MAY | 0.002 to 0.2, default: the preset's `size` | Side length of one particle, in target-width units |
| `effects[].speed` | MAY | 0 to 4, default `1` | Multiplier of the preset's speed |
| `effects[].sprite` | MAY | `^[a-z][a-z0-9-]{0,31}$`. Values defined by this document: `dot`, `soft`, `star`, `glow-star`. Default: the preset's `sprite` | Particle shape (section 8). User images are outside the scope of this extension |

Fields that are not defined in the `ARX_effects` object or in an effect object are rejected by the extension schema (`additionalProperties: false`). The `position`, `rotation`, `scale`, and `transform` definitions of the extension schema are copied unchanged from the 0.1 schema, and the two MUST stay identical.

## 3. Emitter space

The emitter matrix uses the same composition as layers, `E = T × R × S` (section 3.1 of the 0.1 specification, column-major). The axes of emitter space are also those of section 3.1 of the 0.1 specification: +X to the right, +Y toward the top of the picture, +Z toward the viewer. Lengths are in target-width units.

| Subject | Transform it receives |
|---|---|
| Birth point | `E × (shapeSize ∘ u)` (a point, w = 1). `u` is a uniform sample in `[-1, 1]³`, and `∘` is the component-wise product. The scale `S` only widens the birth region |
| Direction, acceleration | Only the rotation `R` |
| Particle size, speed | Not affected by `transform` |

Particles move in the space of the content root (section 6.3 of the 0.1 specification), so they move together with the picture, and their size in meters follows W as layers do. Particles are drawn without lighting, as quads that always face the camera (billboards).

## 4. Validation

### 4.1 When the extension is read

An implementation reads `extensions.ARX_effects` only if it supports this extension and `extensionsUsed` contains `"ARX_effects"`. If `"ARX_effects"` is not in `extensionsUsed`, the implementation only emits the `ARX_EXTENSION_UNDECLARED` warning of section 5 of the 0.1 specification and does not read the effects. An implementation that does not support this extension ignores the effects.

Effect validation runs after the semantic validation of section 5 of the 0.1 specification and after the layers are resolved. The layers have to exist first so that an effect `id` can be checked against the layer `id` values.

### 4.2 Rules

An implementation that knows this extension MUST NOT refuse the whole artwork because of a problem in the effect data. It MUST drop only the faulty part (one effect or all effects), emit a warning, and run the layers unchanged. This ensures that a Viewer that knows the extension never shows less than a Viewer that does not.

| Case | Result | Code | `path` example |
|---|---|---|---|
| `ARX_effects` breaks the outer rules of the extension schema: not an object, `effects` missing or not an array, 0 entries or more than 8, unknown field | All effects dropped | `ARX_EFFECT_INVALID` | `/extensions/ARX_effects` |
| One effect breaks the extension schema: range, color format, name format, missing required field, unknown field | Only that effect dropped | `ARX_EFFECT_INVALID` | `/extensions/ARX_effects/effects/2/amount` |
| Effect rotation with `\|norm(q) - 1\| > 0.01` | Only that effect dropped | `ARX_EFFECT_INVALID` | `/extensions/ARX_effects/effects/0/transform/rotation` |
| `1e-4 < \|norm(q) - 1\| ≤ 0.01` | Normalized and used | `ARX_QUATERNION_DRIFT` warning | `/extensions/ARX_effects/effects/0/transform/rotation` |
| `id` equals a layer `id` or the `id` of an earlier effect that was kept | The later effect dropped | `ARX_EFFECT_INVALID` | `/extensions/ARX_effects/effects/1/id` |
| `preset` or `sprite` is a value this implementation does not know | Only that effect dropped | `ARX_EFFECT_UNSUPPORTED` | `/extensions/ARX_effects/effects/0/preset` |

- If one effect has several problems, the implementation SHOULD report only the first problem it meets, in the order of the table (schema, rotation, `id`, `preset`, `sprite`).
- Both codes are warnings (section 13 of the 0.1 specification). The manifest stays valid when effects are dropped.
- A Viewer that cannot create the resources of one effect (sprite, renderer surface) MUST drop only that effect and show the remaining effects and the layers. It SHOULD release the resources it created for that effect.
- Authoring tools can raise every warning to an error in a strict mode so that they do not export faulty effects (non-normative). Authoring tools write `extensionsUsed` and `extensions.ARX_effects` only when there are effects, and do not write `extensionsRequired`.

### 4.3 Resolved result

For each effect that is kept, the following are filled in: `amount` default `1`, `speed` default `1`, `size` and `sprite` from the preset, `transform` with the same defaults as layers, the rotation normalized, and the emitter matrix `E`. If there are no effects, or the extension is not read, the effect list is empty.

## 5. Preset table

Preset values are written in one file only, [`schema/ext/ARX_effects.presets.json`](../../schema/ext/ARX_effects.presets.json). All renderers MUST follow the values of this file. The numbers are not repeated in this document. If an implementation uses a copy of the file, the copy MUST be byte-identical to the original.

| Field | Unit | Meaning |
|---|---|---|
| `shapeSize` | target width | Half-extent `[x, y, z]` of the birth box, in emitter space (section 3) |
| `direction` | unit vector | Axis of the direction cone, in emitter space |
| `spreadDegrees` | degrees | Half-angle of the cone, 0 to 180. 180 means all directions |
| `emission` | | `{ "kind": "continuous" }` or `{ "kind": "burst", "emitSeconds", "pauseSeconds" }` (section 7.3) |
| `rate` | particles/second | Particles per second while emitting, at `amount = 1` |
| `lifetime` | seconds | Lifetime `[min, max]`, uniform |
| `speed` | target widths/second | Speed at `speed = 1` |
| `speedVariation` | ratio | ± variation of the speed |
| `acceleration` | target widths/second² | Acceleration `[x, y, z]`, in emitter space (rotation only) |
| `size` | target width | Particle side used when the effect has no `size` |
| `sizeVariation` | ratio | ± variation of the size |
| `endSizeScale` | factor | Size factor at the end of the lifetime |
| `angleDegrees` | degrees | Initial rotation angle `[min, max]`, uniform |
| `angularSpeedDegrees` | degrees/second | Rotation speed `[min, max]`, uniform. Positive is counterclockwise as seen by the viewer |
| `alphaCurve` | | Name of the alpha curve (section 6) |
| `sprite` | | Sprite used when the effect has no `sprite` |

Invariant of the table: for every preset, at most 256 particles are alive at once when `amount = 4`. For continuous emission that number is `rate × 4 × lifetime[1]`; for burst emission it is the count emitted in one window, because the longest lifetime is shorter than the period (`emitSeconds + pauseSeconds`). An implementation that caps each effect at 256 particles (MAY) therefore does not change the particle count.

New presets or sprites can be added within this extension. An implementation that does not know such a value drops only that effect (`ARX_EFFECT_UNSUPPORTED`). If a new field is needed, a new extension name (for example `ARX_effects2`) is used.

The default `sprite` of a preset is not written in the manifest; it comes from the Viewer's own preset table. So if the default sprite of an existing preset changes (for example `star` → `glow-star` for `float`), an old Viewer draws an effect without `sprite` with the old sprite of its own table. An effect that names the new sprite directly in the manifest is dropped, alone, by an old Viewer that does not know that value (`ARX_EFFECT_UNSUPPORTED`). In either case the artwork opens and the layers remain (section 4.2). Implementations do not accept a preset table that names an unknown sprite, so a Viewer that changes a default sprite in its table also carries that sprite file. If a sprite file cannot be read, only that effect is dropped, as in section 4.2.

## 6. Particle appearance

`t = age / lifetime` is the fraction of the particle's lifetime that has passed (0 to 1).

| Item | Rule |
|---|---|
| Color | Linear from `colors[0]` to `colors[1]` over `t`. Interpolation is per channel, on the sRGB encoded values (`/255`) |
| Size | `size₀ × (1 + (endSizeScale - 1) × t)`. `size₀` is defined in section 7.4 |
| Alpha | Particle alpha = curve(`t`). Drawn value = sprite alpha × particle alpha |
| Compositing | Normal compositing with straight alpha (source-over). Additive compositing is not used, so that colors that darken do not vanish |
| Order | Particles SHOULD be drawn starting with the one farthest from the camera |

The five alpha curves:

- `linearFadeOut` = `1 - t`
- `easeFadeOut` = `1 - t²`
- `quickFadeInOut` = `min(1, t / 0.1, (1 - t) / 0.1)`
- `gradualFadeInOut` = `min(1, t / 0.3, (1 - t) / 0.3)`
- `constant` = `1`. It stays the same for the whole lifetime; the particle appears in the frame in which it is born and disappears in the frame in which it dies

Adding curves does not conflict with old Viewers. Curve names are not written in the manifest (the manifest names only the preset); they exist only in the `alphaCurve` of the preset table (section 5) that the Viewer carries. An old Viewer draws with the curves of its own table. If a new preset that uses a new curve is added, an old Viewer that does not know that preset drops only that effect (`ARX_EFFECT_UNSUPPORTED`). If the curve of an existing preset changes, an old Viewer draws that effect with the old curve. Neither case refuses the artwork or drops layers, so both agree with the rule of section 4.2 (a Viewer that knows the extension does not show less than a Viewer that does not). Implementations do not accept a preset table that names an unknown curve, so a Viewer whose table uses a new curve also implements that curve.

## 7. Deterministic simulation

An implementation that computes the particles itself MUST follow this section. The same effect has the same particles at the same time. An implementation that leaves the work to an engine's particle system (for example RealityKit `ParticleEmitterComponent`) SHOULD carry over the preset values, and it is enough that the result looks similar. The curves and random numbers of the engine may differ from this section.

### 7.1 Clock

The effect clock `T` (seconds) starts at 0 when the effect is first shown. While the target is not Tracking, the effect is hidden (section 9.2 of the 0.1 specification), and when the target becomes Tracking again, `T` SHOULD restart from 0. So every time the target is found again, the same particle sequence starts again from particle index 0. The state is determined by `T` alone (section 7.5), so a restarted effect has the same particles as a newly created one.

### 7.2 Random numbers and seed

- Seed: FNV-1a 32-bit over the UTF-8 bytes of the effect `id`. Start with `h = 0x811C9DC5`, and for each byte compute `h = (h XOR byte) × 0x01000193 mod 2³²`.
- Random numbers: one mulberry32 sequence per effect, started from its seed. All operations are on unsigned 32-bit integers, and `imul` is the lower 32 bits of the product.

```text
state = seed
next():
  state = (state + 0x6D2B79F5) mod 2³²
  z = imul(state XOR (state >>> 15), state OR 1)
  z = ((z + imul(z XOR (z >>> 7), z OR 61)) mod 2³²) XOR z
  return (z XOR (z >>> 14)) / 2³²          (0 ≤ r < 1)
```

Check values: the seed of the empty string is `0x811C9DC5`, of `"a"` is `0xE40C292C`, and of `"sparkle-1"` is `0xDF005EFB`. The first three values for the seed `0xDF005EFB` are `0.7602949764113873`, `0.79540013987571`, and `0.5259187174960971`.

### 7.3 Birth times

`n = rate × amount` (particles per second).

- `continuous`: particle `k` (`k = 0, 1, 2, …`) is born at `k / n`.
- `burst`: emission window `w` (`w = 0, 1, 2, …`) starts at `w × (emitSeconds + pauseSeconds)`. In each window, `N = max(1, round(emitSeconds × n))` particles are born at `j / n` (`j = 0, …, N - 1`) after the start of the window. `round` rounds 0.5 away from zero.

The particle index is the birth order (starting at 0); for the same time, the smaller `k` or `j` comes first.

### 7.4 Values drawn for each particle

In birth order, each particle draws 10 random numbers in the order below. Even when a range is zero (for example the angle of a preset without rotation), the number MUST still be drawn to keep the order. `lerp(a, b, r) = a + (b - a) × r`.

| Order | Value |
|---|---|
| 1, 2, 3 | `u = [2r₁ - 1, 2r₂ - 1, 2r₃ - 1]`, birth point `p₀ = E × (shapeSize ∘ u)` |
| 4 | `cosφ = 1 - r₄ × (1 - cos(spreadDegrees))` |
| 5 | `α = 2π × r₅` |
| 6 | Speed `s = preset.speed × effect.speed × (1 + speedVariation × (2r₆ - 1))` |
| 7 | Lifetime `L = lerp(lifetime[0], lifetime[1], r₇)` |
| 8 | Size `size₀ = size × (1 + sizeVariation × (2r₈ - 1))` (`size` is the effect's value or the preset's value) |
| 9 | Initial angle `θ₀ = lerp(angleDegrees[0], angleDegrees[1], r₉)` |
| 10 | Rotation speed `ω = lerp(angularSpeedDegrees[0], angularSpeedDegrees[1], r₁₀)` |

Direction: for the axis `a = direction`, let `h = [0, 1, 0]` (when `|a.y| < 0.9`) or `[0, 0, 1]` (otherwise), `e₁ = normalize(h × a)`, `e₂ = a × e₁`, and `sinφ = sqrt(max(0, 1 - cos²φ))`; then

```text
d = sinφ·cosα·e₁ + sinφ·sinα·e₂ + cosφ·a
v = s · (R × d)
g = R × acceleration
```

### 7.5 State

At time `T`, a particle is alive while `birth ≤ T < birth + L`. `age = T - birth`, `t = age / L`.

```text
p = p₀ + v·age + ½·g·age²
angle = θ₀ + ω·age               (degrees)
```

Size, color, and alpha follow the formulas of section 6. The state is computed directly from the birth time, so the particles at the same `T` are the same regardless of the frame interval.

## 8. Built-in sprites

| Name | Shape |
|---|---|
| `dot` | Disc with soft edges |
| `soft` | Round glow, dense in the center and fading outward |
| `star` | Four-pointed sparkle |
| `glow-star` | Four rays that get thinner and fainter toward their tips, over a bright core and a soft round glow |

Every sprite is a 64×64 PNG; all RGB values are white (255), and the shape is carried only by the straight alpha. The particle color multiplies the white. The originals are in [`schema/ext/sprites/`](../../schema/ext/sprites), and an implementation that uses copies MUST keep them byte-identical to the originals. Running the generator again produces the same bytes.

## 9. Warning codes

| Code | Kind | Meaning |
|---|---|---|
| `ARX_EFFECT_INVALID` | warning | Effect data breaks the rules of this extension. That effect or all effects were dropped |
| `ARX_EFFECT_UNSUPPORTED` | warning | `preset` or `sprite` unknown to the implementation. That effect was dropped |

Both codes are also in the table of section 13 of the 0.1 specification.
