/**
 * Background palette and the dark-mode derivation shared by the appearance
 * panel and the body/token painting.
 *
 * The 20 families are tuned as light pastels. Dark mode reuses the same hue
 * family instead of disabling them: {@link toDarkRamp} keeps hue and
 * saturation and drops lightness onto a dark-ramp target, so 雾蓝 reads as a
 * dark blue-gray, 裸桃 as a warm dark gray, and so on — the canvas stays
 * readable while the palette's character survives.
 * @module @alexpeng/dsh-custom-plugin/client/palette
 */

/** Palette of 20 muted low-saturation backgrounds (with matching tab colors).
 * 天青灰 leads the list: it is the install default and renders first among
 * the palette swatches, right after 无颜色. */
export const PALETTE: Array<[string, string, string]> = [
  ['天青灰', '#E9EBEE', '#D6DADF'],
  ['暖象牙', '#F5F0E8', '#E8E0D4'],
  ['雾灰绿', '#E9EDE6', '#D7DED3'],
  ['烟熏玫瑰', '#F2EAEC', '#E5D6DA'],
  ['雾蓝', '#E8EDF2', '#D4DDE6'],
  ['薰衣草灰', '#EFEDF4', '#E0DCEB'],
  ['燕麦米', '#F3EEE6', '#E5DED3'],
  ['薄荷雾', '#EAF0ED', '#D7E3DC'],
  ['裸桃', '#F5EDE8', '#E8DCD4'],
  ['石板蓝', '#E6EDF1', '#D2DBE3'],
  ['紫藤灰', '#EEEBF2', '#E1DAE8'],
  ['奶油黄', '#F4F0E6', '#E6E1D5'],
  ['鼠尾草', '#EAEDE5', '#D7DED1'],
  ['腮红粉', '#F3EAEC', '#E6D6DA'],
  ['香草白', '#F3F0E6', '#E5E0D4'],
  ['青灰', '#E7F0F0', '#D3E1E1'],
  ['杏仁白', '#F0ECE8', '#E2DAD3'],
  ['尤加利', '#EAF0ED', '#D7E3DB'],
  ['珍珠灰', '#EDEDEE', '#DCDCDD'],
  ['淡金', '#F4F1E4', '#E6E1D0'],
]

/** Parse a #rrggbb (or bare rrggbb) hex color; malformed input yields the
 * palette's neutral gray rather than throwing. */
export function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim())
  if (match === null) return [235, 238, 242]
  const value = parseInt(match[1], 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function rgbToHsl(rgb: [number, number, number]): [number, number, number] {
  const [r0, g0, b0] = rgb.map((v) => v / 255) as [number, number, number]
  const max = Math.max(r0, g0, b0)
  const min = Math.min(r0, g0, b0)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r0) h = ((g0 - b0) / d + (g0 < b0 ? 6 : 0)) / 6
  else if (max === g0) h = ((b0 - r0) / d + 2) / 6
  else h = ((r0 - g0) / d + 4) / 6
  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t0: number): number => {
    let t = t0
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [
    Math.round(channel(h + 1 / 3) * 255),
    Math.round(channel(h) * 255),
    Math.round(channel(h - 1 / 3) * 255),
  ]
}

/**
 * Map a palette color onto the dark ramp: hue is kept, saturation is
 * compressed by {@link DARK_SATURATION_SCALE}, and lightness is clamped to
 * `lightness`. The compression is not optional polish: HSL saturation at dark
 * lightness reads far stronger for warm hues (gold / rose / peach) than for
 * blue-grays on a dark canvas, so the raw values made most families glare.
 * Invalid input degrades to a neutral gray at the same lightness.
 */
export function toDarkRamp(hex: string, lightness: number): string {
  const l = Math.max(0, Math.min(1, lightness))
  const [h, s] = rgbToHsl(hexToRgb(hex))
  const clampedS = Math.max(0, Math.min(1, s * DARK_SATURATION_SCALE))
  const [r, g, b] = hslToRgb(h, clampedS, l)
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

/**
 * Character ink for the ASCII backdrop: the surface keeps its hue, saturation
 * is compressed the same way the dark ramp compresses it, and lightness moves
 * by a fixed per-theme delta (up on dark surfaces, down on light ones), scaled
 * by the caller (`inkScale`: one value per piece plus the user's strength
 * choice). The target is "clearly on screen but not competing with body text",
 * not WCAG text contrast.
 *
 * The two deltas are calibrated independently, from the composited page rather
 * than the raw canvas, and on 2026-11-08 the light side was re-taken because
 * the previous target was wrong: −0.31 measured 0.15% mean ink mass / 2.99%
 * peak — but through the shell's stacked surfaces (≈10% transmission, see
 * `BACKDROP_ALPHA_*`) and onto the `+` / `*` half of the ramp, whose glyphs
 * cover 5.5% / 4.4% of a cell. The numbers described a picture the user
 * correctly called "根本看不出来". −0.7 lands the ink at 179 luma under the
 * surface (ink luma 55 on 234.8), and with the backdrop alphas and
 * `FLOW_LEVEL_FLOOR` the on/off A/B is now an unmistakable character field in
 * the margins and a faint texture behind the reading column.
 *
 * On the dark canvas (#1c1e21, 29.8 luma) the same *relative* step is
 * perceptually much stronger, and the eye is also less sensitive at low
 * luminance: the DeVries-Rose law puts the threshold contrast at roughly
 * sqrt(234.8 / 29.8) ≈ 2.8× the light one, so a dark patch needs ~2.5–2.8× the
 * light relative modulation to feel equal — not the same number. +0.38
 * delivered 6.7× (9.37% Michelson) and read as the loudest thing on screen;
 * +0.15 measures 2.1–2.7× on mean ink mass across all eight pieces (0.34% dark
 * vs 0.15% light for `flow`; 8.17% vs 2.99% peak), i.e. inside that band.
 * Going lower misses it: +0.10 only reaches 1.4×. Equalising the raw Michelson
 * instead would need a ~1-luma step on dark, which is invisible.
 */
export function inkFor(surfaceHex: string, dark: boolean, scale = 1): string {
  const k = inkScaleFor(scale)
  const [h, s, l] = rgbToHsl(hexToRgb(surfaceHex))
  const targetL = Math.max(0.04, Math.min(0.96, l + (dark ? DARK_INK_DELTA : LIGHT_INK_DELTA) * k))
  const [r, g, b] = hslToRgb(h, Math.max(0, Math.min(1, s * DARK_SATURATION_SCALE)), targetL)
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** Lower bound of the ink-strength multiplier. */
export const INK_SCALE_MIN = 0.4

/** Upper bound of the ink-strength multiplier. */
export const INK_SCALE_MAX = 2.2

/** Clamp an ink-strength multiplier; missing/non-finite means 1 (the
 * calibrated per-theme delta). */
export function inkScaleFor(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 1
  return value < INK_SCALE_MIN ? INK_SCALE_MIN : value > INK_SCALE_MAX ? INK_SCALE_MAX : value
}

/** Ink lightness drop from a light surface. Re-calibrated 2026-11-08 on the
 * live Desktop host after the 1%-Michelson target was rejected by the user as
 * "根本看不出来": the old −0.31 measured its numbers through the shell's ≈10%
 * transmission window and on the light half of the ramp, which is "texture
 * exists", not "texture is seen". −0.7 puts the ink at 179 luma under the
 * surface; the live A/B target (关闭 vs 开启 一眼能分出来) is met together with
 * the backdrop token alphas and `FLOW_LEVEL_FLOOR`. See {@link inkFor}. */
export const LIGHT_INK_DELTA = -0.7

/** Ink lightness lift from a dark surface. Smaller in magnitude than the
 * light drop on purpose: the DeVries-Rose threshold contrast at 29.8 luma is
 * ~2.8× the light one, so dark needs a bigger *relative* step but a smaller
 * absolute one. +0.15 measures 0.34% mean ink mass / 8.17% peak, i.e. 2.1–2.7×
 * the light figure across pieces; the old +0.38 measured 6.7× and glared.
 * See {@link inkFor}. */
export const DARK_INK_DELTA = 0.15

/** Body-canvas lightness for the dark variant of a palette family. */
export const DARK_CANVAS_LIGHTNESS = 0.12

/** How much of a family's HSL saturation survives on the dark ramp. 0.55
 * keeps the families clearly distinguishable while pulling the warm hues
 * (gold / rose / peach) down from "eye-catching" to "ambient" on the dark
 * canvas; 0.4 turned them into mud, 0.7 still glared. */
export const DARK_SATURATION_SCALE = 0.55

/**
 * Surface alpha of each shell background token while a backdrop renderer is
 * mounted. The "veil" that makes the layer reachable at all.
 *
 * The layer is geometrically behind every content surface, so what the eye
 * sees of it is the product of each stacked surface's *complement* alpha.
 * Measured 2026-11-08 on the live Desktop host (1280×822 CSS, dpr 1.5,
 * 天青灰 + glass): the reading column stacks three translucent surfaces
 * (`--dsw-alias-bg-base` twice, `--dsw-alias-bg-layer-1` once) at the shell's
 * glass values 0.5 / 0.5 / 0.6, so only **10%** of the ink reaches the eye —
 * an ink step of 162 raw luma composites to 16 luma, which is why every ΔL
 * calibration from the previous round measured "texture exists" and the user
 * still saw nothing. The sidebar multiplied out to 24% the same way.
 *
 * These three values lower the alphas of the *same* RGB, so the page hue does
 * not move at all (the canvas tint equals the family colour): the reading
 * column now transmits ≈ 0.41 and the sidebar ≈ 0.40, i.e. 4× the ink, and
 * cards / dialogs / the composer keep their own untouched opaque fills so
 * text-heavy surfaces never get texture behind them. Only the three tokens
 * measured in the live stack are overridden (`-bg-layer-2` and `-bg-overlay`
 * are left alone: they paint menus and overlays, and no measured content
 * surface sits behind them). Do not raise these back toward the shell values
 * to "restore the glass look" — that is exactly the 10%-transmission state the
 * user rejected.
 */
export const BACKDROP_ALPHA_BASE = 0.25

/** `--dsw-alias-bg-layer-1` — the frame and the outer content shell. */
export const BACKDROP_ALPHA_LAYER1 = 0.27

/** `--dsw-specific-sidebar-fill` — the sidebar column (tab colour, a notch
 * denser than the base). */
export const BACKDROP_ALPHA_SIDEBAR = 0.27

/**
 * Identity of the theme-token override an appearance repaint would install.
 *
 * Re-registering the very same variables through the theme service is a costly
 * no-op: it re-applies tokens for the whole shell even when the palette and the
 * glass toggle did not move (which is what every slider tick does). The painter
 * compares this key and skips the registration when it has not changed.
 *
 * `'none'` means the painter leaves the shell's own tokens alone; `'neutral'`
 * is the glass-only override; `'backdrop'` is the low-alpha override a mounted
 * renderer needs (no palette); `palette:<name>|glass:<0|1>|backdrop:<0|1>` is a
 * family override (glass changes the alpha form of the same values, and a
 * mounted renderer replaces them with the backdrop alphas, so all three
 * dimensions are part of the key).
 */
export function appearanceTokenKey(bg: string | undefined, glass: boolean, backdrop = false): string {
  if (bg !== undefined && bg !== 'default') return `palette:${bg}|glass:${glass ? 1 : 0}|backdrop:${backdrop ? 1 : 0}`
  if (backdrop) return 'backdrop'
  if (glass) return 'neutral'
  return 'none'
}
