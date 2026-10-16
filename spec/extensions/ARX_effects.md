# ARX 0.1 확장 `ARX_effects` — 파티클 효과

상태: 초안 (2026-10-01, 2026-10-16 문구 명확화. ARX 0.1.1 14.1). [ARX 0.1 명세](../0.1.md) 10장의 선택 확장이다. 기계 판독용 계약은 확장 스키마 [`schema/ext/ARX_effects.schema.json`](../../schema/ext/ARX_effects.schema.json), 프리셋 표 [`schema/ext/ARX_effects.presets.json`](../../schema/ext/ARX_effects.presets.json), 내장 스프라이트 [`schema/ext/sprites/`](../../schema/ext/sprites)이다. 스프라이트는 [`tools/generate_effect_sprites.py`](../../tools/generate_effect_sprites.py)로 만든다. 이 문서와 두 JSON 파일이 충돌하면 버그로 보고 어느 한쪽을 고친다.

## 1. 목적과 선언

`ARX_effects`는 작품에 파티클 효과(미리 정한 프리셋 다섯: `sparkle` 반짝임, `rise` 피어오름, `burst` 터짐, `snow` 눈, `float` 떠다님)를 싣는다. 이미지·영상 레이어는 0.1 Core 그대로이고, 효과는 그 위에 더해지는 선택 기능이다.

| 규칙 | 내용 |
|---|---|
| spec 값 | `"arx/0.1"` 그대로다. 0.1 명세 14장 "선택 확장 추가 → 0.1 확장으로 가능"에 해당한다 |
| 선언 | 효과를 담은 manifest는 `extensionsUsed`에 `"ARX_effects"`를 넣어야 한다(MUST) |
| `extensionsRequired` | `"ARX_effects"`를 넣어서는 안 된다(MUST NOT). 넣으면 이 확장을 모르는 Viewer가 작품 전체를 거절한다(0.1 명세 10장) |
| 자리 | 최상위 `extensions.ARX_effects`에만 둔다. `anchor`나 레이어의 `extensions`에 둔 `ARX_effects`는 이 확장의 데이터가 아니다 |
| 모르는 구현 | 0.1 명세 10장대로 이 확장을 무시하고 이미지·영상 레이어만 실행한다 |

레이어 0개와 효과만으로 된 작품은 만들 수 없다. `layers`는 0.1 명세 4.2절대로 1개 이상이어야 한다(MUST).

## 2. 모양

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

| 필드 | 필수 | 범위·기본값 | 설명 |
|---|---|---|---|
| `effects` | MUST | 배열, 1~8개 | 효과 목록. 배열 순서는 그리는 순서를 보장하지 않는다 |
| `effects[].id` | MUST | 1~128자 | 레이어 `id`, 다른 효과 `id`와 겹치지 않아야 한다(MUST) |
| `effects[].transform` | MAY | 레이어의 `transform`과 같은 모양과 기본값 | 에미터의 위치·회전·크기(3장) |
| `effects[].preset` | MUST | `^[a-z][a-z0-9-]{0,31}$`. 이 문서가 정한 값은 `sparkle`, `rise`, `burst`, `snow`, `float` | 움직임(태어나는 영역, 방향, 수명, 곡선)을 정한다(5장) |
| `effects[].colors` | MUST | 정확히 2개, 각 `^#[0-9A-Fa-f]{6}$` (sRGB) | 태어날 때 색, 죽을 때 색. 한 색만 쓰려면 같은 값을 두 번 적는다 |
| `effects[].amount` | MAY | 0.1~4, 기본값 `1` | 프리셋의 초당 개수에 곱한다 |
| `effects[].size` | MAY | 0.002~0.2, 기본값은 프리셋의 `size` | 입자 한 변의 길이, 타깃 너비 단위 |
| `effects[].speed` | MAY | 0~4, 기본값 `1` | 프리셋의 속도에 곱한다 |
| `effects[].sprite` | MAY | `^[a-z][a-z0-9-]{0,31}$`. 이 문서가 정한 값은 `dot`, `soft`, `star`, `glow-star`. 기본값은 프리셋의 `sprite` | 입자 모양(8장). 사용자 이미지는 이 확장의 범위 밖이다 |

이 표의 MUST를 어긴 효과는 manifest를 무효로 만들지 않으며 4.2절대로 빠진다.

`ARX_effects` 객체와 효과 객체에 정의되지 않은 필드는 확장 스키마에서 거부된다(`additionalProperties: false`). 확장 스키마의 `position`, `rotation`, `scale`, `transform` 정의는 0.1 schema의 것을 그대로 복사한 것이며, 둘이 같아야 한다(MUST).

## 3. 에미터 공간

에미터 행렬은 레이어와 같은 합성 `E = T × R × S`다(0.1 명세 3.1절, 열 우선). 에미터 공간의 축도 0.1 명세 3.1절과 같다: +X 오른쪽, +Y 그림 위쪽, +Z 보는 사람 쪽. 길이는 타깃 너비 단위다.

| 대상 | 받는 변환 |
|---|---|
| 태어나는 점 | `E × (shapeSize ∘ u)` (점, w = 1). `u`는 `[-1, 1]³` 안의 균등 표본, `∘`는 성분별 곱이다. 크기 `S`는 태어나는 영역만 넓힌다 |
| 방향, 가속도 | 회전 `R`만 받는다 |
| 입자 크기, 속력 | `transform`의 영향을 받지 않는다 |

입자는 콘텐츠 루트(0.1 명세 6.3절) 공간에서 움직이므로 그림을 따라 함께 움직이고, 미터 크기는 레이어처럼 W를 따른다. 입자는 조명 없이 항상 카메라를 향하는 사각형(빌보드)으로 그린다.

## 4. 검증

### 4.1 읽는 조건

구현이 이 확장을 지원하고 `extensionsUsed`에 `"ARX_effects"`가 있을 때만 `extensions.ARX_effects`를 읽는다. `extensionsUsed`에 없으면 0.1 명세 5장의 `ARX_EXTENSION_UNDECLARED` 경고만 내고 효과는 읽지 않는다. 이 확장을 지원하지 않는 구현은 효과를 무시한다.

효과 검증은 0.1 명세 5장의 의미 검증과 레이어 해석이 끝난 뒤에 한다. 레이어 `id`와 겹치는지 보려면 레이어가 먼저 있어야 한다.

### 4.2 규칙

이 확장을 아는 구현은 효과 데이터의 문제로 작품 전체를 거절해서는 안 된다(MUST NOT). 문제가 있는 부분(효과 하나 또는 효과 전부)만 빼고 경고를 내며, 레이어는 그대로 실행한다(MUST). 확장을 아는 Viewer가 확장을 모르는 Viewer보다 적게 보여 주는 경우가 없게 하기 위해서다.

| 경우 | 결과 | 코드 | `path` 예 |
|---|---|---|---|
| `ARX_effects`가 확장 스키마의 바깥 규칙을 어김: 객체가 아님, `effects`가 없거나 배열이 아님, 0개 또는 8개 초과, 모르는 필드 | 효과 전부 뺌 | `ARX_EFFECT_INVALID` | `/extensions/ARX_effects` |
| 한 효과가 확장 스키마를 어김: 범위, 색 형식, 이름 형식, 필수 필드 없음, 모르는 필드 | 그 효과만 뺌 | `ARX_EFFECT_INVALID` | `/extensions/ARX_effects/effects/2/amount` |
| 효과 회전의 `\|norm(q) - 1\| > 0.01` | 그 효과만 뺌 | `ARX_EFFECT_INVALID` | `/extensions/ARX_effects/effects/0/transform/rotation` |
| `1e-4 < \|norm(q) - 1\| ≤ 0.01` | 정규화하고 쓴다 | `ARX_QUATERNION_DRIFT` 경고 | `/extensions/ARX_effects/effects/0/transform/rotation` |
| `id`가 레이어 `id` 또는 앞서 남은 효과의 `id`와 같음 | 뒤의 효과를 뺌 | `ARX_EFFECT_INVALID` | `/extensions/ARX_effects/effects/1/id` |
| `preset` 또는 `sprite`가 이 구현이 모르는 값 | 그 효과만 뺌 | `ARX_EFFECT_UNSUPPORTED` | `/extensions/ARX_effects/effects/0/preset` |

- 한 효과에 문제가 여럿이면 표의 순서(스키마, 회전, `id`, `preset`, `sprite`)로 처음 만난 문제 하나를 보고한다(SHOULD).
- 두 코드는 모두 경고(warning)다(0.1 명세 13장). 효과를 빼도 manifest는 유효하다.
- 효과 하나의 자원(스프라이트, 렌더러 표면)을 만들지 못한 Viewer는 그 효과만 빼고 나머지 효과와 레이어를 보여야 한다(MUST). 그 효과를 위해 만든 자원은 해제한다(SHOULD).
- 제작 도구는 엄격(strict) 모드에서 모든 경고를 오류로 올려 틀린 효과를 내보내지 않을 수 있다(비규범). 제작 도구는 효과가 있을 때만 `extensionsUsed`와 `extensions.ARX_effects`를 쓰고 `extensionsRequired`는 쓰지 않는다.

### 4.3 해석 결과

남은 효과마다 다음을 채운다: `amount` 기본값 `1`, `speed` 기본값 `1`, `size`와 `sprite`는 프리셋의 값, `transform`은 레이어와 같은 기본값, 회전은 정규화, 에미터 행렬 `E`. 효과가 없거나 확장을 읽지 않으면 효과 목록은 비어 있다.

## 5. 프리셋 표

프리셋 값은 [`schema/ext/ARX_effects.presets.json`](../../schema/ext/ARX_effects.presets.json) 한 파일에만 적는다. 모든 렌더러는 이 파일의 값을 따른다(MUST). 수치는 이 문서에 다시 적지 않는다. 구현이 파일을 복사해 쓰면 원본과 바이트가 같아야 한다(MUST).

| 필드 | 단위 | 뜻 |
|---|---|---|
| `shapeSize` | 타깃 너비 | 태어나는 상자의 반폭 `[x, y, z]`, 에미터 공간 (3장) |
| `direction` | 단위 벡터 | 방향 원뿔의 축, 에미터 공간 |
| `spreadDegrees` | 도 | 원뿔의 반각, 0~180. 180이면 모든 방향 |
| `emission` | | `{ "kind": "continuous" }` 또는 `{ "kind": "burst", "emitSeconds", "pauseSeconds" }` (7.3절) |
| `rate` | 개/초 | `amount = 1`일 때 방출 중의 초당 개수 |
| `lifetime` | 초 | 수명 `[최소, 최대]`, 균등 |
| `speed` | 타깃 너비/초 | `speed = 1`일 때의 속력 |
| `speedVariation` | 비율 | 속력의 ± 편차 |
| `acceleration` | 타깃 너비/초² | 가속도 `[x, y, z]`, 에미터 공간(회전만 받음) |
| `size` | 타깃 너비 | 효과에 `size`가 없을 때 쓰는 입자 한 변 |
| `sizeVariation` | 비율 | 크기의 ± 편차 |
| `endSizeScale` | 배율 | 수명 끝에서의 크기 배율 |
| `angleDegrees` | 도 | 첫 회전각 `[최소, 최대]`, 균등 |
| `angularSpeedDegrees` | 도/초 | 회전 속도 `[최소, 최대]`, 균등. 양수는 보는 사람에게 반시계 방향 |
| `alphaCurve` | | 알파 곡선 이름 (6장) |
| `sprite` | | 효과에 `sprite`가 없을 때 쓰는 스프라이트 |

표의 불변식: 모든 프리셋에서 `amount = 4`일 때 동시에 살아 있는 입자는 256개 이하다. 연속 방출은 `rate × 4 × lifetime[1]`, 터짐 방출은 수명의 최대가 주기(`emitSeconds + pauseSeconds`)보다 짧아 한 번 방출한 개수다. 그래서 구현이 효과마다 256개 상한을 두어도(MAY) 입자 수는 달라지지 않는다.

프리셋이나 스프라이트를 새로 더하는 것은 이 확장 안에서 할 수 있다. 그 값을 모르는 구현은 그 효과만 뺀다(`ARX_EFFECT_UNSUPPORTED`). 새 필드가 필요하면 새 확장 이름(예: `ARX_effects2`)을 쓴다.

프리셋의 기본 `sprite`는 manifest에 적히지 않고 Viewer가 가진 자기 프리셋 표에서 온다. 그래서 있던 프리셋의 기본 스프라이트를 바꾸어도(예: `float`의 `star` → `glow-star`) 옛 Viewer는 `sprite`가 없는 효과를 자기 표의 옛 스프라이트로 그린다. manifest에 새 스프라이트를 직접 적은 효과는 그 값을 모르는 옛 Viewer가 그 효과만 뺀다(`ARX_EFFECT_UNSUPPORTED`). 어느 경우에도 작품은 열리고 레이어는 남는다(4.2절). 구현은 모르는 스프라이트 이름이 있는 프리셋 표를 받아들이지 않으므로, 표의 기본 스프라이트를 바꾸는 Viewer는 그 스프라이트 파일도 함께 가진다. 스프라이트 파일을 읽지 못하면 4.2절대로 그 효과만 뺀다.

## 6. 입자의 모습

`t = age / lifetime`은 입자 수명 비율(0~1)이다.

| 항목 | 규칙 |
|---|---|
| 색 | `colors[0]`에서 `colors[1]`로 `t`에 따라 선형. 보간은 sRGB 부호값(`/255`)의 채널별로 한다 |
| 크기 | `size₀ × (1 + (endSizeScale - 1) × t)`. `size₀`는 7.4절 |
| 알파 | 입자 알파 = 곡선(`t`). 그리는 값 = 스프라이트 알파 × 입자 알파 |
| 합성 | straight 알파의 보통 합성(source-over). 더하기 합성은 쓰지 않는다. 어두워지는 색이 사라지지 않게 하기 위해서다 |
| 순서 | 카메라에서 먼 입자부터 그리는 것을 권장한다(SHOULD) |

알파 곡선 다섯:

- `linearFadeOut` = `1 - t`
- `easeFadeOut` = `1 - t²`
- `quickFadeInOut` = `min(1, t / 0.1, (1 - t) / 0.1)`
- `gradualFadeInOut` = `min(1, t / 0.3, (1 - t) / 0.3)`
- `constant` = `1`. 수명 내내 그대로이고, 입자는 태어나는 프레임에 나타나 죽는 프레임에 사라진다

곡선을 더해도 옛 Viewer와 충돌하지 않는다. 곡선 이름은 manifest에 적히지 않고(manifest는 프리셋 이름만 적는다), Viewer가 가진 프리셋 표(5장)의 `alphaCurve`에만 있다. 옛 Viewer는 자기 표의 곡선대로 그린다. 새 곡선을 쓰는 프리셋을 새로 더하면 그 프리셋을 모르는 옛 Viewer는 그 효과만 뺀다(`ARX_EFFECT_UNSUPPORTED`). 있던 프리셋의 곡선을 바꾸면 옛 Viewer는 옛 곡선으로 그 효과를 그린다. 어느 쪽도 작품을 거절하거나 레이어를 빼지 않으므로 4.2절의 규칙(확장을 아는 Viewer가 모르는 Viewer보다 적게 보여 주지 않음)과 맞는다. 구현은 모르는 곡선 이름이 있는 프리셋 표를 받아들이지 않으므로, 표에 새 곡선을 쓰는 Viewer는 그 곡선도 함께 구현한다.

## 7. 결정적 시뮬레이션

입자를 직접 계산하는 구현은 이 장을 따라야 한다(MUST). 같은 효과는 같은 시각에 같은 입자를 가진다. 엔진의 파티클 시스템(예: RealityKit `ParticleEmitterComponent`)에 맡기는 구현에는 7.2~7.5절이 걸리지 않는다. 이런 구현은 5장의 프리셋 값을 엔진 설정으로 옮겨 써야 하며(SHOULD), 결과는 비슷해 보이면 된다. 엔진의 곡선과 난수는 이 장과 같지 않을 수 있다.

### 7.1 시계

효과 시계 `T`(초)는 효과를 처음 보일 때 0에서 시작한다. 타깃이 Tracking이 아닐 때는 효과를 숨기고(0.1 명세 9.2절), 다시 Tracking이 되면 `T`를 0부터 다시 시작한다(SHOULD). 그래서 타깃을 다시 찾을 때마다 같은 입자 열이 입자 번호 0부터 다시 나온다. 상태는 `T`만으로 정해지므로(7.5절) 다시 시작한 효과는 새로 만든 효과와 같은 입자를 가진다.

### 7.2 난수와 씨앗

- 씨앗: 효과 `id`의 UTF-8 바이트에 대한 FNV-1a 32비트. `h = 0x811C9DC5`에서 시작해 바이트마다 `h = (h XOR byte) × 0x01000193 mod 2³²`.
- 난수: 효과마다 씨앗 하나로 시작하는 mulberry32 수열 하나. 모든 연산은 부호 없는 32비트이고, `imul`은 곱의 아래 32비트다.

```text
state = seed
next():
  state = (state + 0x6D2B79F5) mod 2³²
  z = imul(state XOR (state >>> 15), state OR 1)
  z = ((z + imul(z XOR (z >>> 7), z OR 61)) mod 2³²) XOR z
  return (z XOR (z >>> 14)) / 2³²          (0 ≤ r < 1)
```

확인값: 빈 문자열의 씨앗은 `0x811C9DC5`, `"a"`는 `0xE40C292C`, `"sparkle-1"`은 `0xDF005EFB`. 씨앗 `0xDF005EFB`의 처음 세 값은 `0.7602949764113873`, `0.79540013987571`, `0.5259187174960971`이다.

### 7.3 탄생 시각

`n = rate × amount`(초당 개수).

- `continuous`: `k`번째 입자(`k = 0, 1, 2, …`)는 `k / n`에 태어난다.
- `burst`: 방출 창 `w`(`w = 0, 1, 2, …`)는 `w × (emitSeconds + pauseSeconds)`에 시작한다. 창마다 `N = max(1, round(emitSeconds × n))`개가 창 시작에서 `j / n`(`j = 0, …, N - 1`)에 태어난다. `round`는 0.5를 0에서 먼 쪽으로 올린다.

입자 번호는 탄생 순서(0부터)이고, 같은 시각이면 `k`나 `j`가 작은 쪽이 먼저다.

### 7.4 입자마다 뽑는 값

입자는 탄생 순서대로 난수 10개를 아래 순서로 뽑는다. 값이 0인 범위(예: 회전이 없는 프리셋의 각도)여도 뽑아서 순서를 지킨다(MUST). `lerp(a, b, r) = a + (b - a) × r`.

| 순서 | 값 |
|---|---|
| 1, 2, 3 | `u = [2r₁ - 1, 2r₂ - 1, 2r₃ - 1]`, 태어나는 점 `p₀ = E × (shapeSize ∘ u)` |
| 4 | `cosφ = 1 - r₄ × (1 - cos(spreadDegrees))` |
| 5 | `α = 2π × r₅` |
| 6 | 속력 `s = preset.speed × effect.speed × (1 + speedVariation × (2r₆ - 1))` |
| 7 | 수명 `L = lerp(lifetime[0], lifetime[1], r₇)` |
| 8 | 크기 `size₀ = size × (1 + sizeVariation × (2r₈ - 1))` (`size`는 효과의 값 또는 프리셋의 값) |
| 9 | 첫 각도 `θ₀ = lerp(angleDegrees[0], angleDegrees[1], r₉)` |
| 10 | 회전 속도 `ω = lerp(angularSpeedDegrees[0], angularSpeedDegrees[1], r₁₀)` |

방향: 축 `a = direction`에 대해 `h = [0, 1, 0]`(`|a.y| < 0.9`일 때) 또는 `[0, 0, 1]`(그 밖), `e₁ = normalize(h × a)`, `e₂ = a × e₁`, `sinφ = sqrt(max(0, 1 - cos²φ))`로 두고

```text
d = sinφ·cosα·e₁ + sinφ·sinα·e₂ + cosφ·a
v = s · (R × d)
g = R × acceleration
```

### 7.5 상태

시각 `T`에서 입자는 `birth ≤ T < birth + L`일 때 살아 있다. `age = T - birth`, `t = age / L`.

```text
p = p₀ + v·age + ½·g·age²
angle = θ₀ + ω·age               (도)
```

크기, 색, 알파는 6장의 식이다. 상태는 탄생 시각에서 바로 계산하므로 프레임 간격과 상관없이 같은 `T`의 입자는 같다.

## 8. 내장 스프라이트

| 이름 | 모양 |
|---|---|
| `dot` | 가장자리가 부드러운 원판 |
| `soft` | 가운데가 진하고 바깥으로 흐려지는 둥근 빛 |
| `star` | 네 갈래 반짝임 |
| `glow-star` | 밝은 중심과 부드러운 둥근 빛 위에, 끝으로 갈수록 가늘고 흐려지는 네 갈래 빛줄기 |

모든 스프라이트는 64×64 PNG, RGB는 모두 흰색(255), 모양은 straight 알파에만 있다. 입자 색은 흰색에 곱해진다. 원본은 [`schema/ext/sprites/`](../../schema/ext/sprites)이고, 구현이 복사해 쓰면 원본과 바이트가 같아야 한다(MUST). 생성기를 다시 돌려도 같은 바이트가 나온다.

## 9. 경고 코드

| 코드 | 종류 | 의미 |
|---|---|---|
| `ARX_EFFECT_INVALID` | warning | 효과 데이터가 이 확장의 규칙을 어김. 그 효과 또는 효과 전부를 뺐다 |
| `ARX_EFFECT_UNSUPPORTED` | warning | 구현이 모르는 `preset` 또는 `sprite`. 그 효과를 뺐다 |

두 코드는 0.1 명세 13장 표에도 있다.
