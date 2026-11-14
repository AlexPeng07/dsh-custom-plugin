/**
 * ASCII character backdrop: the renderer that lives inside `div#vx-bg`.
 *
 * The hot loop never builds strings. Each piece writes one ramp level per
 * cell into a reused `Uint8Array`, and the renderer blits a pre-baked glyph
 * atlas with `drawImage` only — one atlas per (theme, font, dpr, tile size),
 * rebuilt on demand and never per frame. That is what keeps a 15 fps field of
 * ~10k cells free of per-frame allocations and `fillText` metric work.
 *
 * Motion is read from the layer's `data-vx-bg-motion` attribute and the
 * surface from `--vx-bg-tint`; page visibility and the reduced-motion media
 * query are observed here as well. Degradation follows a fixed ladder —
 * frame rate → density → mono → dither → static frame → off — and never
 * climbs back on its own inside one session.
 *
 * Phase 3a ships the ASCII system presets — `flow`, `rain`, `ocean`,
 * `starfield`, `ripple`, plus the zero-rAF `static` tier. Each preset is its
 * own piece (falling trails, horizontal swells, sparse stars, concentric
 * rings), not the flow field with different knobs. Switching presets reuses
 * the canvas and the grid buffer; the atlas is rebuilt only when the ramp,
 * ink, theme or cell geometry changes.
 * @module @alexpeng/dsh-custom-plugin/client/bg-ascii
 */

import { buildFocusCaps, FOCUS_FEATHER_PX, FOCUS_FLOOR, normalizeFocusRect, sameFocusRect, type BgFocusRect } from './bg-focus.ts'
import { BAYER4, CONTRAST, FLOW_LEVEL_FLOOR, GAMMA, hash2, OVERLAY_GLYPHS, quantizeLevel, shade, valueNoise, type AsciiInput, type AsciiPiece } from './bg-field.ts'
import { createWakeField, injectWake, injectWakeRing, injectWakeTrail, stepWake, type BgWakeField } from './bg-wake.ts'
import { attachBgPointer, createBgPointerState, resetBgPointerState, syncBgPointer, type BgPointerEventLike, type BgPointerState, type BgPointerTargetLike } from './bg-pointer.ts'
import { createOceanPiece } from './bg-ocean.ts'
import { hexToRgb, inkFor, inkScaleFor } from './palette.ts'

export { FLOW_LEVEL_FLOOR, quantizeLevel } from './bg-field.ts'
export type { AsciiInput, AsciiPiece } from './bg-field.ts'
export { createOceanPiece } from './bg-ocean.ts'

/** Upper bound for the backing-store scale. */
export const DPR_CAP = 2

/** Hard grid caps: beyond these the cell size grows instead of the grid. */
export const MAX_COLS = 240

/** Hard grid caps: beyond these the cell size grows instead of the grid. */
export const MAX_ROWS = 96

/** Monospace stack; `ui-monospace` resolves locally, so nothing is fetched. */
export const MONO_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Cascadia Mono", "DejaVu Sans Mono", monospace'

/** Glyph ramps. Only guaranteed-monospace ASCII; CJK and box drawing are
 * deliberately excluded because their advance is not 0.6 em in every face. */
export type AsciiCharset = 'classic' | 'blocks' | 'dots'

/** Glyph ramps ordered by increasing ink density. */
export const CHARSET: Record<AsciiCharset, string> = {
  classic: ' .,:;i1tfLCG08@',
  blocks: ' .:-=+*#%@',
  dots: ' .·•●',
}

/** Every ASCII piece id. `static` is the zero-rAF tier. */
export type AsciiPreset = 'flow' | 'rain' | 'ocean' | 'starfield' | 'ripple' | 'static'

/** Inclusive numeric bounds a future settings panel may write. */
export interface AsciiRange {
  readonly min: number
  readonly max: number
}

/** Writable bounds per preset; defaults above sit inside these. */
export interface AsciiPresetRanges {
  readonly density: AsciiRange
  readonly speed: AsciiRange
  readonly fps: AsciiRange
  readonly fontPx: AsciiRange
  readonly opacity: AsciiRange
}

/** Tunables of one preset. */
export interface AsciiPresetSpec {
  readonly density: number
  readonly speed: number
  readonly fps: number
  readonly charset: AsciiCharset
  readonly dither: boolean
  readonly opacity: number
  readonly fontPx: number
  /** Per-piece ink multiplier on the theme's base ΔL. The dense `blocks`
   * pieces need none (1.0); the `dots` pieces carry far less ink per cell, so
   * they lift the ink to reach the same perceived strength. Also multiplied by
   * the user's soft/standard/strong strength choice. */
  readonly inkScale: number
  /** The piece consumes pointer input and may mark interaction cells in the
   * emphasis buffer. `flow` and `ocean` opt in today; `static` deliberately
   * does not, so its one frame stays deterministic. */
  readonly interactive?: boolean
  /** Shape-aware rendering: a cell on a contour swaps its ramp glyph for a
   * directional stroke of similar ink weight (the MIT `glyph-graphics` idea).
   * The `dots` pieces and `rain` keep their plain ramp. */
  readonly shapeAware?: boolean
  readonly ranges: AsciiPresetRanges
}

/**
 * System presets. `flow` is the default animated tier; `static` draws one
 * deterministic flow frame (zero rAF). The other four are genuinely different
 * pieces: vertical falling trails, horizontal swells, sparse parallax stars
 * and concentric rings. `density` varies the cell size, so only `flow` and
 * `static` share one baked atlas today.
 *
 * `inkScale` is the per-piece visibility calibration (measurements in
 * AGENTS.md, 2026-11-08, 1280×822 dpr 1.5, reading column over the composited
 * page): a dot glyph carries ~1/6 of a block glyph's ink, so the dots pieces
 * need a bigger per-cell step to be seen at all, and the sparse starfield
 * needs a brighter point rather than more area. These numbers are measured,
 * not taste: `flow` at 1.0 reads 0.15% mean ink mass / 2.99% peak; `ocean` at
 * 1.4 with density 0.65 reads 0.17% / 4.37%; `ripple` at 1.25 reads 0.11% /
 * 3.11%; `starfield` at 1.6 reads a 5.15% star peak while staying <0.4%
 * covered; `rain` stays at 1.1 because its 13.3% inter-frame change (the
 * highest of the six) is what carries it, not its ink mass.
 */
export const ASCII_PRESETS: Record<AsciiPreset, AsciiPresetSpec> = {
  // 2026-11-11 defaults come from the Desktop verification panel: the ink is
  // drawn at 0.45–0.60 canvas opacity on the shipped grid, one step lighter
  // than the 0.60–0.65 the first verification pass signed off; `ocean` went
  // two steps further down (0.45) because it lives inside the conversation
  // column. The per-piece `inkScale` still carries the theme ΔL.
  flow: {
    density: 0.65, speed: 1, fps: 24, charset: 'blocks', dither: true, opacity: 0.55, fontPx: 12, inkScale: 1, interactive: true, shapeAware: true,
    ranges: { density: { min: 0.3, max: 1.0 }, speed: { min: 0, max: 2 }, fps: { min: 15, max: 33 }, fontPx: { min: 6, max: 18 }, opacity: { min: 0.1, max: 1.0 } },
  },
  rain: {
    // Classic is the 16-level ramp: a long trail needs the extra steps, and
    // at 16 levels ordered dithering adds grain instead of removing banding.
    density: 0.75, speed: 1, fps: 24, charset: 'classic', dither: false, opacity: 0.55, fontPx: 12, inkScale: 1.1, interactive: true,
    ranges: { density: { min: 0.4, max: 1.1 }, speed: { min: 0, max: 2 }, fps: { min: 15, max: 33 }, fontPx: { min: 6, max: 18 }, opacity: { min: 0.1, max: 1.0 } },
  },
  ocean: {
    // 2026-11-11 default, taken from the Desktop verification panel: the looser
    // 0.6 grid read as scattered dots once the fish and contour crests were
    // added, so the shipped grid is 1.5 at 24 fps with 11 px dots and the ink
    // at 0.45 opacity — the conversation-column placement means the sea sits
    // directly behind the copy, so it has to be finer and fainter than a page
    // backdrop. The range pass centres that default in [1.3, 1.7], so the
    // density slider starts mid-track and can still go both ways. The calm
    // zone is still what keeps the reading column quiet; density is not asked
    // to do that.
    density: 1.5, speed: 0.8, fps: 24, charset: 'dots', dither: true, opacity: 0.45, fontPx: 11, inkScale: 1.2, interactive: true,
    ranges: { density: { min: 1.3, max: 1.7 }, speed: { min: 0, max: 1.6 }, fps: { min: 15, max: 33 }, fontPx: { min: 6, max: 16 }, opacity: { min: 0.1, max: 0.8 } },
  },
  starfield: {
    // Almost all cells stay blank; low fps is invisible on a 0.12-cell/s drift.
    // Sparse by design — but sparse is not absent: at fontPx 12 / inkScale 1.25
    // the star peak measured 3.94% over 0.23% coverage and read as nothing
    // (zoom inspection 2026-11-08). fontPx 14 enlarges the dot glyph itself
    // (same cell spacing is not kept — bigger glyph, same density), the 0.95
    // threshold adds companions that are actually above level 0, and 1.6 lifts
    // the point: 5.15% peak at 0.37% coverage, still mostly empty.
    density: 0.65, speed: 0.3, fps: 20, charset: 'dots', dither: false, opacity: 0.55, fontPx: 14, inkScale: 1.6, interactive: true,
    ranges: { density: { min: 0.3, max: 1.0 }, speed: { min: 0, max: 0.6 }, fps: { min: 5, max: 35 }, fontPx: { min: 9, max: 19 }, opacity: { min: 0.1, max: 1.0 } },
  },
  ripple: {
    // Same ramp + geometry as flow, but its own ink step, so a switch between
    // the two rebakes once. No dither: it would speckle the contour bands.
    density: 0.65, speed: 0.6, fps: 24, charset: 'blocks', dither: false, opacity: 0.6, fontPx: 12, inkScale: 1.25, interactive: true, shapeAware: true,
    ranges: { density: { min: 0.3, max: 1.0 }, speed: { min: 0, max: 1.2 }, fps: { min: 15, max: 33 }, fontPx: { min: 6, max: 18 }, opacity: { min: 0.2, max: 1.0 } },
  },
  static: {
    density: 0.65, speed: 0, fps: 24, charset: 'blocks', dither: true, opacity: 0.6, fontPx: 12, inkScale: 1, shapeAware: true,
    ranges: { density: { min: 0.3, max: 1.0 }, speed: { min: 0, max: 0 }, fps: { min: 15, max: 33 }, fontPx: { min: 6, max: 18 }, opacity: { min: 0.2, max: 1.0 } },
  },
}

/** Resolve a stored preset id to an ASCII piece. A shader-tier id (or any
 * unknown string) is a stale combination and falls back to `flow`. */
export function resolveAsciiPreset(preset: string | undefined): AsciiPreset {
  if (preset !== undefined && Object.prototype.hasOwnProperty.call(ASCII_PRESETS, preset)) {
    return preset as AsciiPreset
  }
  return 'flow'
}

/** Panel overrides for one ASCII preset. Every value is clamped into the
 * preset's own `ranges` before it is used, so an out-of-range value (a stale
 * state file, a slider crossing a preset switch) never reaches the grid.
 * `strength` is the user's soft/standard/strong multiplier, applied on top of
 * the piece's own `inkScale`; it is clamped to the ink scale band, not to a
 * preset range. */
export type AsciiParams = Partial<Record<'density' | 'speed' | 'fps' | 'fontPx' | 'opacity' | 'strength', number>>

/** Clamp one override into a preset range; `undefined`/non-finite means "use
 * the preset default". */
function clampOverride(value: number | undefined, range: AsciiRange, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return value < range.min ? range.min : value > range.max ? range.max : value
}

/**
 * Resolve overrides against one preset. Missing or invalid keys fall back to
 * the preset's own default, so a preset switch never inherits a value the new
 * piece cannot honour. The returned `inkScale` is the piece's calibrated value
 * times the user's strength multiplier. Returns the base spec object itself
 * when nothing is overridden (no allocation until the user actually moves a
 * slider).
 */
export function resolveAsciiSpec(preset: AsciiPreset, params: AsciiParams): AsciiPresetSpec {
  const base = ASCII_PRESETS[preset]
  const density = clampOverride(params.density, base.ranges.density, base.density)
  const speed = clampOverride(params.speed, base.ranges.speed, base.speed)
  const fps = clampOverride(params.fps, base.ranges.fps, base.fps)
  const fontPx = clampOverride(params.fontPx, base.ranges.fontPx, base.fontPx)
  const opacity = clampOverride(params.opacity, base.ranges.opacity, base.opacity)
  const inkScale = inkScaleFor(base.inkScale * inkScaleFor(params.strength))
  if (density === base.density && speed === base.speed && fps === base.fps && fontPx === base.fontPx && opacity === base.opacity && inkScale === base.inkScale) {
    return base
  }
  return { ...base, density, speed, fps, fontPx, opacity, inkScale }
}

/** Resize debounce before the grid is rebuilt. */
export const RESIZE_DEBOUNCE_MS = 150

/** Frames per degradation statistics window. */
export const LADDER_WINDOW = 60

/** A window is "over budget" above this multiple of the frame budget. */
export const LADDER_OVER_BUDGET = 1.6

/** Consecutive bad windows before one ladder step. */
export const LADDER_BAD_WINDOWS = 2

/** Last rung: 0 full … 5 static frame, 6 no glyphs (surface only). */
export const DEGRADE_MAX = 6

/** Inside the calm zone, cells an interactive piece marks as part of the
 * effect (a ripple crest, a fish) keep this fraction of the ramp instead of
 * the zone's 0.15 floor. Raised 0.5 → 0.65 on 2026-11-11: the user asked for
 * the pointer response to read more clearly, and a user-caused ripple may sit
 * nearer the column's own contrast than the ambient texture — the ambient
 * stays at the 0.15 floor, so only what the hand just did gets brighter. */
export const EFFECT_FOCUS_FLOOR = 0.65

/**
 * Measure the cell in CSS pixels. `measureText` ignores the current
 * transform, so the probe needs no dpr scaling: 50 glyphs cancel the
 * sub-pixel rounding of a single advance. Row height is 1.15 em, leaving
 * roughly 0.18 em above and below the ink so rows never touch.
 */
export function measureCell(ctx: AsciiCtxLike, fontPx: number): { cellW: number; cellH: number } {
  ctx.font = `${fontPx}px ${MONO_STACK}`
  const advance = ctx.measureText('M'.repeat(50)).width / 50
  return { cellW: Math.round(advance * 100) / 100, cellH: Math.round(fontPx * 1.15 * 100) / 100 }
}

/** A surface counts as dark below this weighted brightness (0..255). */
export function isDarkSurface(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 96
}

/** Splat geometry and dwell bleed for the interactive flow.
 *
 * A drag injects a curl dipole — two opposite lobes either side of the path —
 * instead of only lifting the field, so the fog reads as *stirred* rather than
 * painted on. The splat radius and the swirl both grow with pointer speed, so
 * a slow pass is a thin thread and a flick drags a wide eddy. A hand that
 * rests still feeds a local concentration (`bleed`) that takes about a second
 * to read as thicker fog and fades in roughly two. */
const FLOW_SPLAT_RADIUS = 1.8
const FLOW_SPLAT_RADIUS_MAX = 2.2
const FLOW_CURL_BASE = 0.04
const FLOW_CURL_MAX = 0.09
const FLOW_BLEED_RATE = 0.8
const FLOW_BLEED_TAU = 0.8
const FLOW_BLEED_RADIUS_X = 4
const FLOW_BLEED_RADIUS_Y = 2.2
const FLOW_BLEED_SPEED = 10
const FLOW_BLEED_INK = 0.45
const FLOW_BLEED_EMPHASIS = 0.12
/** Below this the concentration is snapped to zero, so a paused page really
 * returns to the baseline frame instead of carrying a sub-level residue. */
const FLOW_BLEED_FLOOR = 0.002

/**
 * The `flow` piece: a slowly drifting value-noise field. `t` is already
 * scaled by the preset speed. Dithering only makes sense on short ramps;
 * at 16 levels it adds noise instead of removing banding.
 *
 * The field is lifted by {@link FLOW_LEVEL_FLOOR} before quantisation. That
 * lift is the round-1 visibility fix, and it is a *coverage* fix, not an ink
 * fix: value noise spends most of its area near 0.5, which quantises onto the
 * `blocks` ramp's mid glyphs (`+` / `*`) — measured at 12 px those carry only
 * 5.5% / 4.4% of a cell's ink area, against 12% for `#`, 17% for `%` and 23%
 * for `@`. Raising the ink ΔL further does nothing to that (the ink is already
 * near-black and the surface halves it), while the lift moves the typical cell
 * from `+` to `#`-`%`, i.e. 2–3× the ink mass on screen.
 */
export function createFlowPiece(levels: number, dither: boolean, interactive = true): AsciiPiece {
  // `static` reuses the deterministic field without any interaction state; it
  // must stay allocation-free and identical to the old flow frame at t=0.
  if (!interactive) {
    return (t, out, cols, rows) => {
      const driftX = t * 0.12
      const driftY = t * 0.05
      let i = 0
      for (let row = 0; row < rows; row++) {
        const y = row * 0.11 + driftY
        for (let col = 0; col < cols; col++, i++) {
          // Two octaves: the slow swell is the fog's body, the faster one adds
          // filament detail. One octave alone reads as a flat wash at the
          // shipped cell size; the mix keeps the average level (and therefore
          // the ink mass) where it was.
          const n1 = valueNoise(col * 0.07 + driftX, y)
          const n2 = valueNoise(col * 0.19 - driftX * 1.6 + 11.3, y * 1.7 + 4.7)
          let v = FLOW_LEVEL_FLOOR + (1 - FLOW_LEVEL_FLOOR) * (n1 * 0.7 + n2 * 0.3)
          if (CONTRAST !== 1) v = (v - 0.5) * CONTRAST + 0.5
          if (GAMMA !== 1) v = Math.pow(v < 0 ? 0 : v, GAMMA)
          if (dither) {
            v += (BAYER4[(row & 3) * 4 + (col & 3)] / 16 - 0.5) * (1 / levels)
            if (v < 0) v = 0
            else if (v > 1) v = 1
          }
          out[i] = quantizeLevel(v, levels)
        }
      }
    }
  }

  // The interactive flow keeps a small wave tank as a displacement field. The
  // pointer stirs the fog (a wave bends the noise coordinates and adds/subtracts
  // ink), a click sends a ring through it. The tank and the dwell-bleed buffer
  // are page-sized and rebuilt only when the grid changes.
  let wake: BgWakeField | null = null
  let bleed: Float32Array | null = null
  let cols = 0
  let rows = 0
  let lastT = Number.NaN
  let pulseSeen = -1
  let pointerSeen = false
  let lastX = Number.NaN
  let lastY = Number.NaN

  function resetGrid(nextCols: number, nextRows: number): void {
    cols = nextCols
    rows = nextRows
    wake = createWakeField(cols, rows)
    bleed = new Float32Array(cols * rows)
    lastT = Number.NaN
    pulseSeen = -1
    pointerSeen = false
    lastX = Number.NaN
    lastY = Number.NaN
  }

  function stir(input: AsciiInput): void {
    if (wake === null) return
    if (!input.active) {
      pointerSeen = false
      lastX = Number.NaN
      lastY = Number.NaN
      return
    }
    if (pulseSeen < 0) pulseSeen = input.pulseId
    else if (input.pulseId !== pulseSeen) {
      pulseSeen = input.pulseId
      injectWakeRing(wake, input.pulseX, input.pulseY, 3.5, 1.6, 0.5)
      injectWakeRing(wake, input.pulseX, input.pulseY, 8, 2.4, 0.22)
    }
    if (!pointerSeen || !Number.isFinite(lastX)) {
      pointerSeen = true
      lastX = input.x
      lastY = input.y
      return
    }
    const dx = input.x - lastX
    const dy = input.y - lastY
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < 0.5) return
    const speed = Math.sqrt(input.vx * input.vx + input.vy * input.vy)
    // A curl dipole either side of the path: the two opposite lobes make the
    // displacement rotate around the drag instead of only lifting it.
    const radius = FLOW_SPLAT_RADIUS + Math.min(FLOW_SPLAT_RADIUS_MAX, speed * 0.045)
    const push = 0.05 + Math.min(0.1, speed * 0.003)
    const swirl = FLOW_CURL_BASE + Math.min(FLOW_CURL_MAX, speed * 0.002)
    const offset = 1.6 + Math.min(1.4, speed * 0.02)
    const nx = -dy / dist
    const ny = dx / dist
    const steps = Math.min(8, Math.max(1, Math.ceil(dist / 2)))
    for (let k = 1; k <= steps; k++) {
      const u = k / steps
      const px = lastX + dx * u
      const py = lastY + dy * u
      injectWake(wake, px + nx * offset, py + ny * offset, radius, swirl)
      injectWake(wake, px - nx * offset, py - ny * offset, radius, -swirl * 0.9)
      // A little direct lift on the path keeps the trail readable where the
      // two lobes cancel; it is deliberately weaker than the swirl.
      injectWake(wake, px, py, radius, push * 0.4)
    }
    lastX = input.x
    lastY = input.y
  }

  return (t, out, nextCols, nextRows, input, emphasis) => {
    if (wake === null || bleed === null || nextCols !== cols || nextRows !== rows) resetGrid(nextCols, nextRows)
    if (wake === null || bleed === null) return
    const bleedCells = bleed
    // The wake step is clamped so a tab restore cannot explode the tank; the
    // bleed decay uses the real gap, so a pause settles it instead of leaving
    // a frame of heat behind.
    const elapsed = Number.isFinite(lastT) ? Math.max(0, t - lastT) : 0
    const dt = Math.min(0.1, elapsed)
    lastT = t
    if (input !== undefined) stir(input)
    if (dt > 0) stepWake(wake)
    const bleedDecay = elapsed > 0 ? Math.exp(-elapsed / FLOW_BLEED_TAU) : 1
    let dwell = false
    let pointerX = 0
    let pointerY = 0
    if (input !== undefined && input.active) {
      const speed = Math.sqrt(input.vx * input.vx + input.vy * input.vy)
      if (speed < FLOW_BLEED_SPEED) {
        dwell = true
        pointerX = input.x
        pointerY = input.y
      }
    }
    const invBleedX = 1 / FLOW_BLEED_RADIUS_X
    const invBleedY = 1 / FLOW_BLEED_RADIUS_Y
    const bleedRate = FLOW_BLEED_RATE * dt
    const driftX = t * 0.12
    const driftY = t * 0.05
    let i = 0
    for (let row = 0; row < nextRows; row++) {
      const y = row * 0.11 + driftY
      for (let col = 0; col < nextCols; col++, i++) {
        const h = wake.height[i]
        let b = bleedCells[i] * bleedDecay
        if (b < FLOW_BLEED_FLOOR) b = 0
        if (dwell) {
          const bx = (col + 0.5 - pointerX) * invBleedX
          const by = (row + 0.5 - pointerY) * invBleedY
          const d2 = bx * bx + by * by
          if (d2 < 1) b += bleedRate * (1 - d2)
        }
        bleedCells[i] = b
        // The wave bends the noise coordinates, the dwell adds ink: a pointer
        // trail reads as stirred fog rather than a bright brush stroke. The same
        // two-octave field as the static tier keeps switching between them from
        // changing the picture.
        const n1 = valueNoise(col * 0.07 + driftX + h * 1.4, y + h * 0.9)
        const n2 = valueNoise(col * 0.19 - driftX * 1.6 + 11.3, y * 1.7 + 4.7)
        let v = FLOW_LEVEL_FLOOR + (1 - FLOW_LEVEL_FLOOR) * (n1 * 0.7 + n2 * 0.3)
        v += h * 0.18 + b * FLOW_BLEED_INK
        if (CONTRAST !== 1) v = (v - 0.5) * CONTRAST + 0.5
        if (GAMMA !== 1) v = Math.pow(v < 0 ? 0 : v, GAMMA)
        if (dither) {
          v += (BAYER4[(row & 3) * 4 + (col & 3)] / 16 - 0.5) * (1 / levels)
          if (v < 0) v = 0
          else if (v > 1) v = 1
        }
        out[i] = quantizeLevel(v, levels)
        if (emphasis !== undefined && (Math.abs(h) > 0.14 || b > FLOW_BLEED_EMPHASIS)) emphasis[i] = 1
      }
    }
  }
}

/** Columns a pointer flick can bend the rain across, and the widest a single
 * column may be pushed. Cells are ~7 px, so a normal flick lands 2–5 columns. */
const RAIN_WIND_RADIUS = 20
const RAIN_WIND_MAX = 5

/** Columns a press parts the curtain across, and how hard it pushes. */
const RAIN_PUSH_RADIUS = 14
const RAIN_PUSH_STRENGTH = 4.5

/** The pointer carves a repulsion tunnel: columns inside this radius bend
 * away from the cursor and their ink is cut, so the curtain parts around a
 * hand that rests on the page instead of being pushed only while it moves. */
const RAIN_TUNNEL_RADIUS = 8
const RAIN_TUNNEL_PUSH = 2.4
const RAIN_TUNNEL_DIM = 0.9

/**
 * The `rain` piece: falling columns. Each column owns a phase, a fall speed
 * and a trail length derived from its index; roughly one column in seven is
 * dormant, so the rain reads as patchy weather rather than a curtain. The
 * head is the brightest cell and the trail fades quadratically behind it.
 *
 * The pointer bends whole columns sideways instead of editing individual
 * drops: a drag is wind (displacement scaled by pointer speed and falling off
 * with distance), and simply resting on the page parts the curtain into a
 * tunnel around the cursor. A press pushes the nearby columns away and
 * brightens only their heads for a moment — the trail itself is untouched.
 * With no input every weight stays at zero, so the frame is bit-identical to
 * the pre-interaction rain.
 */
export function createRainPiece(levels: number, dither: boolean): AsciiPiece {
  // Column scratch lives in the closure and grows only when the grid widens:
  // one Float64Array assignment per column per frame, no per-frame allocation.
  let capacity = 0
  let head = new Float64Array(0)
  let trail = new Float64Array(0)
  let active = new Uint8Array(0)
  // Interaction weights, also column-sized: the steady wind bend under the
  // pointer, the decaying push from a press, the press's brief head flash and
  // the repulsion that opens the tunnel around a resting pointer.
  let shift = new Float32Array(0)
  let kick = new Float32Array(0)
  let surge = new Float32Array(0)
  let repel = new Float32Array(0)
  let pulseSeen = -1
  return (t, out, cols, rows, input, emphasis) => {
    if (cols > capacity) {
      capacity = cols
      head = new Float64Array(capacity)
      trail = new Float64Array(capacity)
      active = new Uint8Array(capacity)
      shift = new Float32Array(capacity)
      kick = new Float32Array(capacity)
      surge = new Float32Array(capacity)
      repel = new Float32Array(capacity)
      pulseSeen = -1
    }
    out.fill(0)
    const span = rows + 20
    for (let col = 0; col < cols; col++) {
      const seed = hash2(col, 17)
      active[col] = seed < 0.14 ? 0 : 1
      if (!active[col]) continue
      head[col] = (t * (18 + seed * 26) + hash2(col, 43) * span) % span
      trail[col] = Math.max(3, Math.round((0.18 + hash2(col, 73) * 0.42) * rows))
    }
    if (input !== undefined) {
      // A press is a one-shot edge: the first frame only records the id, so a
      // renderer that starts with a pointer already down cannot fire a push.
      if (pulseSeen < 0) pulseSeen = input.pulseId
      else if (input.pulseId !== pulseSeen) {
        pulseSeen = input.pulseId
        for (let col = 0; col < cols; col++) {
          const d = col - input.pulseX
          const fall = 1 - Math.abs(d) / RAIN_PUSH_RADIUS
          if (fall <= 0) continue
          kick[col] += (d < 0 ? -1 : 1) * fall * RAIN_PUSH_STRENGTH
          surge[col] = Math.max(surge[col], fall)
        }
      }
      const wind = input.active ? Math.max(-RAIN_WIND_MAX, Math.min(RAIN_WIND_MAX, input.vx * 0.06)) : 0
      for (let col = 0; col < cols; col++) {
        const fall = Math.max(0, 1 - Math.abs(col - input.x) / RAIN_WIND_RADIUS)
        const target = wind * fall
        // The bend follows the pointer quickly but eases back slowly, so the
        // gust is still readable for about a second after the hand stops; a
        // symmetric tween erased the trail before the eye could find it.
        shift[col] += (target - shift[col]) * (target === 0 ? 0.06 : 0.25)
        if (shift[col] < 0.001 && shift[col] > -0.001) shift[col] = 0
        // The tunnel: each column inside the radius is pushed away from the
        // cursor (the exact centre column picks the right-hand side), and the
        // ink cut is applied on the destination cell below.
        const away = col - input.x
        const near = input.active ? Math.max(0, 1 - Math.abs(away) / RAIN_TUNNEL_RADIUS) : 0
        const repelTarget = (away < 0 ? -1 : 1) * near * RAIN_TUNNEL_PUSH
        repel[col] += (repelTarget - repel[col]) * (repelTarget === 0 ? 0.1 : 0.3)
        if (repel[col] < 0.01 && repel[col] > -0.01) repel[col] = 0
        // Snap the tails to zero instead of decaying forever: a residual below
        // one hundredth of a column is invisible but still changes the level
        // quantisation, so the picture would never settle back exactly.
        kick[col] = Math.abs(kick[col]) < 0.01 ? 0 : kick[col] * 0.93
        surge[col] = surge[col] < 0.02 ? 0 : surge[col] * 0.94
      }
    }
    // The renderer consumes the buffer row-major; write it the same way. A
    // bent column can land on a neighbour's cell (the two columns merge into a
    // denser streak) or outside the grid (the drop is gone for that frame).
    // The top of a trail bends further than its tail, so the drop slants like
    // rain in wind instead of sliding sideways as one rigid line.
    const tunnelX = input !== undefined && input.active ? input.x : Number.NaN
    const tunnelRadius = 1 / RAIN_TUNNEL_RADIUS
    for (let row = 0; row < rows; row++) {
      const base = row * cols
      const shear = 1 - 0.45 * (row / rows)
      for (let col = 0; col < cols; col++) {
        if (!active[col]) continue
        const behind = head[col] - row
        if (behind < 0 || behind >= trail[col]) continue
        const bend = (shift[col] + kick[col] + repel[col]) * shear
        const sx = Math.round(col + bend)
        if (sx < 0 || sx >= cols) continue
        const fade = 1 - behind / trail[col]
        // A press flashes the head (the two leading cells) and nothing else;
        // the trail behind it keeps its own fade.
        const headBoost = behind < 2 ? surge[col] : 0
        // Per-column depth: the far curtain is a little dimmer and slower (the
        // head speed already varies with the column's own hash), so the rain
        // reads as layers instead of one flat sheet.
        const depth = 0.82 + hash2(col, 91) * 0.18
        let v = (0.22 + 0.78 * fade * fade * (1 + headBoost)) * depth
        // The tunnel is a hole in the ink, not a bent column: a destination
        // cell inside the radius loses up to 90% of its level, so the curtain
        // visibly parts around the cursor and closes when it leaves. The
        // smoothstep keeps the rim feathered instead of drawing a hard edge.
        if (Number.isFinite(tunnelX)) {
          let gap = 1 - Math.abs(sx - tunnelX) * tunnelRadius
          if (gap > 0) {
            gap = gap * gap * (3 - 2 * gap)
            v *= 1 - RAIN_TUNNEL_DIM * gap
          }
        }
        shade(out, base + sx, v, levels, dither, row, sx)
        // Wind and press mark their cells; the tunnel is an absence of ink and
        // must not be pushed back up by the calm zone's emphasis floor.
        if (emphasis !== undefined && (Math.abs(shift[col] + kick[col]) * shear > 0.6 || (behind < 2 && surge[col] > 0.2))) {
          emphasis[base + sx] = 1
        }
      }
    }
  }
}

/** Pointer sparks: short-lived bright stars, 28 slots in a fixed ring buffer.
 * A press scatters twenty inside a four-cell disc; a drag drops three every
 * 0.1 s within a few cells of the path. They fade out in 1.2 s. Each spark
 * paints a small plus (centre + four neighbours, one level weaker), which is
 * what makes a single cell of `dots` ramp read as a lit star at all.
 *
 * The disc is small on purpose: starfield runs at `density 0.5`, so one cell
 * is ~28 CSS px — a nine-cell radius scattered its burst across a 500 px
 * circle and read as "a few more stars", not as an answer to the click. */
const STAR_SPARK_MAX = 28
const STAR_SPARK_LIFE = 1.4
const STAR_SPARK_INTERVAL = 0.1
const STAR_SPARK_DISTANCE = 2
const STAR_SPARK_TRAIL = 3
const STAR_BURST_COUNT = 24
const STAR_BURST_RADIUS = 2.5

/** Paint one spark cell if it beats whatever is already there. Bounds are
 * checked here so the caller stays branch-free. */
function paintSpark(
  out: Uint8Array,
  emphasis: Uint8Array | undefined,
  cols: number,
  rows: number,
  x: number,
  y: number,
  level: number,
): void {
  if (level <= 0 || x < 0 || x >= cols || y < 0 || y >= rows) return
  const idx = y * cols + x
  if (level <= out[idx]) return
  out[idx] = level
  if (emphasis !== undefined) emphasis[idx] = 1
}

/** Pointer glow: an ellipse in cells that matches the CSS aspect ratio (one
 * cell is ~13 × 25 CSS px at the shipped density 0.65), so 11 × 6 cells is the
 * 150 px radius the interaction round settled on. Dwelling deposits heat at
 * 1.6/s; the heat decays with a 0.408 s time constant, i.e. ×0.96 per frame at
 * 60 fps, and anything under the floor is left alone so the field really
 * settles instead of keeping a sub-level residue forever. */
const STAR_GLOW_COLS = 11
const STAR_GLOW_ROWS = 6
const STAR_HEAT_RATE = 1.6
const STAR_HEAT_TAU = 0.408
const STAR_HEAT_FLOOR = 0.02

/**
 * The `starfield` piece: sparse stars on a mostly blank field, drifting and
 * twinkling slowly. The cells below the star thresholds stay at level 0, so
 * the blit loop skips them and the tier is the cheapest. The thresholds are
 * calibrated (see `ASCII_PRESETS.starfield`), and the field is split into
 * three depth layers that drift at different speeds — far 0.05 rows/s, mid
 * 0.10, near 0.18 — so the picture has parallax without a second canvas.
 * The pointer shifts those layers by up to 15 px (≈1 cell horizontally) in
 * proportion to its distance from the page centre, eased at 0.12 per frame.
 *
 * The pointer cannot make a sparse field denser without breaking its
 * character, so direct interaction is light: a press scatters a burst of live
 * stars and a drag drops a thin trail. Dwelling adds the slower cue — stars
 * inside a 150 px ellipse brighten, and after about a second a small cluster
 * of near-miss cells has accumulated; both fade out in roughly a second once
 * the pointer leaves, leaving the baseline bit-identical.
 */
export function createStarfieldPiece(levels: number, _dither: boolean): AsciiPiece {
  const sparkX = new Float32Array(STAR_SPARK_MAX)
  const sparkY = new Float32Array(STAR_SPARK_MAX)
  const sparkBorn = new Float32Array(STAR_SPARK_MAX)
  let sparkCount = 0
  let sparkNext = 0
  let sparkSerial = 0
  let lastDropT = -Number.MAX_VALUE
  let lastDropX = Number.NaN
  let lastDropY = Number.NaN
  let pulseSeen = -1
  // Per-cell dwell heat, rebuilt only when the grid changes. Allocation-free
  // per frame; the decay factor is one `exp` for the whole frame.
  let heat: Float32Array | null = null
  let heatCols = 0
  let heatRows = 0
  let lastT = Number.NaN
  // Eased pointer column for the parallax; NaN until the pointer is seen, so
  // a page that never receives a move stays exactly on the baseline frame.
  let gazeX = Number.NaN

  function addSpark(x: number, y: number, born: number): void {
    sparkX[sparkNext] = x
    sparkY[sparkNext] = y
    sparkBorn[sparkNext] = born
    sparkNext = (sparkNext + 1) % STAR_SPARK_MAX
    if (sparkCount < STAR_SPARK_MAX) sparkCount++
  }

  function scatterBurst(x: number, y: number, born: number): void {
    for (let k = 0; k < STAR_BURST_COUNT; k++) {
      // Deterministic golden-angle spread: no Math.random, so the same press
      // sequence is reproducible in tests and no allocation happens here.
      const angle = (k / STAR_BURST_COUNT) * Math.PI * 2 + hash2(sparkSerial, k) * 0.7
      // Linear radius keeps the inner rings denser than the rim, so a press
      // reads as one bright cluster instead of an even sprinkle.
      const radius = ((k + 0.5) / STAR_BURST_COUNT) * STAR_BURST_RADIUS
      addSpark(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, born)
    }
    sparkSerial += STAR_BURST_COUNT
  }

  return (t, out, cols, rows, input, emphasis) => {
    if (input !== undefined) {
      // A press is a one-shot edge; the first frame only records the id.
      if (pulseSeen < 0) pulseSeen = input.pulseId
      else if (input.pulseId !== pulseSeen) {
        pulseSeen = input.pulseId
        scatterBurst(input.pulseX, input.pulseY, t)
        lastDropT = t
        lastDropX = input.pulseX
        lastDropY = input.pulseY
      }
      if (!input.active) {
        lastDropX = Number.NaN
      } else if (!Number.isFinite(lastDropX)) {
        lastDropX = input.x
        lastDropY = input.y
        lastDropT = t
      } else {
        const moved = Math.sqrt((input.x - lastDropX) ** 2 + (input.y - lastDropY) ** 2)
        if (t - lastDropT >= STAR_SPARK_INTERVAL && moved >= STAR_SPARK_DISTANCE) {
          for (let k = 0; k < STAR_SPARK_TRAIL; k++) {
            const jx = (hash2(sparkSerial + k, 11) - 0.5) * 8
            const jy = (hash2(sparkSerial + k, 23) - 0.5) * 6
            addSpark(input.x + jx, input.y + jy, t)
          }
          sparkSerial += STAR_SPARK_TRAIL
          lastDropT = t
          lastDropX = input.x
          lastDropY = input.y
        }
      }
    }
    if (heat === null || heatCols !== cols || heatRows !== rows) {
      heat = new Float32Array(cols * rows)
      heatCols = cols
      heatRows = rows
    }
    const cells = heat
    // Deposits use a clamped step (a tab restore must not dump a second of
    // heat), but the decay uses the real gap: returning after a pause has to
    // find the field settled, not a frame or two behind.
    const elapsed = Number.isFinite(lastT) ? Math.max(0, t - lastT) : 0
    const dt = Math.min(0.1, elapsed)
    lastT = t
    const decay = elapsed > 0 ? Math.exp(-elapsed / STAR_HEAT_TAU) : 1
    let pointerActive = false
    let pointerX = 0
    let pointerY = 0
    if (input !== undefined && input.active) {
      pointerActive = true
      pointerX = input.x
      pointerY = input.y
      if (!Number.isFinite(gazeX)) gazeX = pointerX
      else gazeX += (pointerX - gazeX) * 0.12
    } else if (Number.isFinite(gazeX)) {
      gazeX += (cols / 2 - gazeX) * 0.12
    }
    // 15 px of travel is ~1.2 cells across; rounding keeps each layer on its
    // own lattice, so the near layer hops a cell while the far one stays put.
    const bias = Number.isFinite(gazeX) ? (gazeX - cols / 2) / Math.max(1, cols / 2) : 0
    const shiftFar = Math.round(bias * 0.24)
    const shiftMid = Math.round(bias * 0.72)
    const shiftNear = Math.round(bias * 1.2)
    const baseFar = Math.floor(t * 0.05)
    const baseMid = Math.floor(t * 0.1)
    const baseNear = Math.floor(t * 0.18)
    const invGlowX = 1 / STAR_GLOW_COLS
    const invGlowY = 1 / STAR_GLOW_ROWS
    const heatRate = STAR_HEAT_RATE * dt
    out.fill(0)
    let i = 0
    for (let row = 0; row < rows; row++) {
      const rowFar = row - baseFar
      const rowMid = row - baseMid
      const rowNear = row - baseNear
      for (let col = 0; col < cols; col++, i++) {
        let hv = cells[i] * decay
        if (pointerActive) {
          const dx = (col + 0.5 - pointerX) * invGlowX
          const dy = (row + 0.5 - pointerY) * invGlowY
          const d2 = dx * dx + dy * dy
          if (d2 < 1) hv += heatRate * (1 - d2)
        }
        cells[i] = hv
        let v = -1
        let h = hash2(col - shiftFar, rowFar)
        if (h > 0.975) {
          const twinkle = 0.5 + 0.5 * Math.sin(t * 0.2 + h * 140)
          v = 0.22 + 0.12 * twinkle
        }
        h = hash2(col + 17 - shiftMid, rowMid)
        if (h > 0.966) {
          const twinkle = 0.5 + 0.5 * Math.sin(t * 0.35 + h * 110)
          const level = 0.45 + 0.2 * twinkle
          if (level > v) v = level
        }
        h = hash2(col + 31 - shiftNear, rowNear)
        if (h > 0.956) {
          const twinkle = 0.5 + 0.5 * Math.sin(t * 0.6 + h * 120)
          const level = 0.65 + 0.28 * twinkle
          if (level > v) v = level
        }
        if (hv > STAR_HEAT_FLOOR) {
          if (v >= 0) v += hv * 0.65
          else {
            // Dwell lights a cluster of near-misses inside the ellipse: the
            // stars the hash skipped become visible as the heat accumulates.
            const near = hash2(col + 7, rowMid)
            if (near > 0.84) v = 0.16 + hv * 0.65
          }
        }
        if (v > 0) {
          shade(out, i, v, levels, false, row, col)
          if (hv > STAR_HEAT_FLOOR && emphasis !== undefined) emphasis[i] = 1
        }
      }
    }
    for (let s = 0; s < sparkCount; s++) {
      const age = t - sparkBorn[s]
      if (age < 0 || age >= STAR_SPARK_LIFE) continue
      const sx = Math.round(sparkX[s])
      const sy = Math.round(sparkY[s])
      // A `dots` ramp has only five steps, so a fading spark is invisible
      // against the static stars within a frame or two. Step it down twice
      // instead of vanishing: the plus shrinks with it, which reads as a
      // graceful fade rather than a switched-off cluster.
      const level = age > STAR_SPARK_LIFE * 0.8 ? levels - 3 : age > STAR_SPARK_LIFE * 0.5 ? levels - 2 : levels - 1
      paintSpark(out, emphasis, cols, rows, sx, sy, level)
      paintSpark(out, emphasis, cols, rows, sx - 1, sy, level - 1)
      paintSpark(out, emphasis, cols, rows, sx + 1, sy, level - 1)
      paintSpark(out, emphasis, cols, rows, sx, sy - 1, level - 1)
      paintSpark(out, emphasis, cols, rows, sx, sy + 1, level - 1)
    }
  }
}

/** Row height is 1.15 em against a ~0.6 em advance, so one row spans about
 * 1.9 cells. Correcting that keeps the rings round instead of squashed. */
const CELL_ASPECT = 1.9

/** Three fixed origins in viewport fractions. Fixed (not hashed) so the crop
 * a user actually looks at always contains at least one ring centre. */
const RIPPLE_ORIGINS = [
  { x: 0.3, y: 0.34, phase: 0, rate: 1.15 },
  { x: 0.7, y: 0.64, phase: 2.2, rate: 1.45 },
  { x: 0.52, y: 0.18, phase: 4.4, rate: 0.95 },
]

/** Live ripple sources: the fixed three keep the page alive, the pointer adds
 * up to six more. A source lives 3.2 seconds and covers ~48 cells, so the
 * inner distance gate below skips most cells before `sqrt`/`sin`. */
const RIPPLE_MAX_SOURCES = 6
const RIPPLE_LIFE = 3.2
const RIPPLE_REACH = 48
const RIPPLE_DROP_INTERVAL = 0.22
const RIPPLE_DROP_DISTANCE = 5
/** A pointer ring is more than a brightness offset: inside the wave band the
 * glyph gets one extra step in the wave's direction, so the band reads as a
 * travelling contour. The value is a pure function of the source's age, so a
 * cell the ring has passed returns to the ambient field exactly. */
const RIPPLE_BAND = 0.04
const RIPPLE_BAND_STEP = 0.085

/**
 * The `ripple` piece: concentric rings from three fixed origins, plus rings
 * the pointer drops. Each ring decays with distance from its origin, keeping
 * the field low-contrast — crests brighten, troughs fall back toward the base,
 * nothing saturates. Dithering stays off: the stipple would break the contour
 * lines the rings are read through.
 *
 * A press drops one strong ring where it lands; its amplitude and speed grow
 * with the pointer velocity, so a flick throws a harder splash than a resting
 * click. A drag leaves a trail of weak ones about every 0.22 s and every five
 * cells, so the pointer moves like a fingertip across water. Slots are a fixed
 * ring buffer — no allocation per drop, no growth with drag length.
 */
export function createRipplePiece(levels: number, dither: boolean): AsciiPiece {
  const srcX = new Float32Array(RIPPLE_MAX_SOURCES)
  const srcY = new Float32Array(RIPPLE_MAX_SOURCES)
  const srcBorn = new Float32Array(RIPPLE_MAX_SOURCES)
  const srcAmp = new Float32Array(RIPPLE_MAX_SOURCES)
  const srcRate = new Float32Array(RIPPLE_MAX_SOURCES)
  let srcCount = 0
  let srcNext = 0
  let lastDropT = -Number.MAX_VALUE
  let lastDropX = Number.NaN
  let lastDropY = Number.NaN
  let pulseSeen = -1

  function drop(x: number, y: number, born: number, amp: number, rate: number): void {
    srcX[srcNext] = x
    srcY[srcNext] = y
    srcBorn[srcNext] = born
    srcAmp[srcNext] = amp
    srcRate[srcNext] = rate
    srcNext = (srcNext + 1) % RIPPLE_MAX_SOURCES
    if (srcCount < RIPPLE_MAX_SOURCES) srcCount++
  }

  return (t, out, cols, rows, input, emphasis) => {
    if (input !== undefined) {
      // A press is a one-shot edge; the first frame only records the id.
      if (pulseSeen < 0) pulseSeen = input.pulseId
      else if (input.pulseId !== pulseSeen) {
        pulseSeen = input.pulseId
        // A press spreads fast enough to read as "a drop landed here": the
        // first bright ring is ~4 cells out within 0.1 s, while a drag's trail
        // rings spread slowly and stay in the background. A flick adds
        // momentum: the ring is louder and travels faster.
        const speed = Math.sqrt(input.vx * input.vx + input.vy * input.vy)
        drop(input.pulseX, input.pulseY, t, 0.4 + Math.min(0.26, speed * 0.004), 2.6 + Math.min(1.2, speed * 0.012))
        lastDropT = t
        lastDropX = input.pulseX
        lastDropY = input.pulseY
      }
      if (!input.active) {
        lastDropX = Number.NaN
      } else if (!Number.isFinite(lastDropX)) {
        // First sighting only records where the pointer is; a page that merely
        // loads under a resting cursor must not spawn a ring by itself.
        lastDropX = input.x
        lastDropY = input.y
        lastDropT = t
      } else {
        const moved = Math.sqrt((input.x - lastDropX) ** 2 + (input.y - lastDropY) ** 2)
        if (t - lastDropT >= RIPPLE_DROP_INTERVAL && moved >= RIPPLE_DROP_DISTANCE) {
          drop(input.x, input.y, t, 0.17, 1.7)
          lastDropT = t
          lastDropX = input.x
          lastDropY = input.y
        }
      }
    }
    let i = 0
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++, i++) {
        let v = 0.45
        for (const origin of RIPPLE_ORIGINS) {
          const dx = col - origin.x * cols
          const dy = (row - origin.y * rows) * CELL_ASPECT
          const dist = Math.sqrt(dx * dx + dy * dy)
          v += Math.sin(dist * 0.38 - t * origin.rate + origin.phase) * 0.26 / (1 + dist * 0.07)
        }
        let lifted = 0
        for (let s = 0; s < srcCount; s++) {
          const age = t - srcBorn[s]
          if (age < 0 || age >= RIPPLE_LIFE) continue
          const dx = col - srcX[s]
          const dy = (row - srcY[s]) * CELL_ASPECT
          const d2 = dx * dx + dy * dy
          if (d2 > RIPPLE_REACH * RIPPLE_REACH) continue
          const dist = Math.sqrt(d2)
          const wave = Math.sin(dist * 0.42 - age * srcRate[s]) * srcAmp[s] * (1 - age / RIPPLE_LIFE) / (1 + dist * 0.09)
          v += wave
          if (Math.abs(wave) > RIPPLE_BAND) v += wave > 0 ? RIPPLE_BAND_STEP : -RIPPLE_BAND_STEP
          if (Math.abs(wave) > lifted) lifted = Math.abs(wave)
        }
        shade(out, i, v, levels, dither, row, col)
        if (emphasis !== undefined && lifted > 0.06) emphasis[i] = 1
      }
    }
  }
}

/** Pick the piece for one preset. `static` reuses the flow field at t=0. */
export function createPresetPiece(preset: AsciiPreset, levels: number, dither: boolean): AsciiPiece {
  switch (preset) {
    case 'rain': return createRainPiece(levels, dither)
    case 'ocean': return createOceanPiece(levels, dither)
    case 'starfield': return createStarfieldPiece(levels, dither)
    case 'ripple': return createRipplePiece(levels, dither)
    case 'static': return createFlowPiece(levels, dither, false)
    case 'flow':
    default:
      return createFlowPiece(levels, dither, true)
  }
}

/** Structural canvas surface needed by the renderer and by tests. */
export interface AsciiCtxLike {
  font: string
  textAlign: string
  textBaseline: string
  globalAlpha: number
  fillStyle: string
  imageSmoothingEnabled: boolean
  measureText(text: string): { width: number }
  fillText(text: string, x: number, y: number): void
  fillRect(x: number, y: number, width: number, height: number): void
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void
  drawImage(
    image: AsciiCanvasLike,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void
}

/** Structural canvas surface needed by the renderer and by tests. */
export interface AsciiCanvasLike {
  width: number
  height: number
  className: string
  style: { width: string; height: string }
  getContext(contextId: '2d'): AsciiCtxLike | null
  remove(): void
}

/** The host element (`div#vx-bg`) as the renderer sees it. */
export interface AsciiHostLike {
  readonly clientWidth: number
  readonly clientHeight: number
  getAttribute(name: string): string | null
  appendChild(node: AsciiCanvasLike): unknown
  style: { getPropertyValue(name: string): string }
  /** Optional viewport offset. The page host sits at 0,0; the conversation
   * host is a fixed layer over the column, so pointer CSS px must be shifted
   * into host-local coordinates before they become grid cells. */
  getBoundingClientRect?(): { readonly left: number; readonly top: number }
}

/** The slice of `Document` this renderer touches. */
export interface AsciiDocLike {
  createElement(tag: string): AsciiCanvasLike
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
  readonly hidden: boolean
}

/** The slice of `MediaQueryList` this renderer touches. */
export interface AsciiMediaQueryLike {
  readonly matches: boolean
  addEventListener(type: 'change', listener: () => void): void
  removeEventListener(type: 'change', listener: () => void): void
}

/** The slice of `ResizeObserver` this renderer touches. */
export interface AsciiResizeObserverLike {
  observe(target: unknown): void
  disconnect(): void
}

/** The slice of `Window` this renderer touches. The pointer methods are
 * optional so a minimal fake window (and a host without PointerEvent) simply
 * leaves interaction off instead of failing to boot. */
export interface AsciiWinLike {
  readonly devicePixelRatio: number
  readonly innerWidth?: number
  readonly innerHeight?: number
  requestAnimationFrame(callback: (now: number) => void): number
  cancelAnimationFrame(handle: number): void
  matchMedia(query: string): AsciiMediaQueryLike
  ResizeObserver?: new (callback: () => void) => AsciiResizeObserverLike
  addEventListener?: (type: string, listener: (event: BgPointerEventLike) => void, options?: { passive?: boolean }) => void
  removeEventListener?: (type: string, listener: (event: BgPointerEventLike) => void, options?: { passive?: boolean }) => void
}

/** One baked glyph atlas: the ramp tiles followed by optional directional
 * extras, already coloured and faded. */
export interface Atlas {
  canvas: AsciiCanvasLike
  /** Tile size in CSS px (the destination unit). */
  tileW: number
  tileH: number
  /** Tile size in backing px (the source unit). */
  pxW: number
  pxH: number
  glyphs: string[]
  /** 1 when the glyph is a space; the draw loop skips those tiles. */
  empty: Uint8Array
  /** (level × 5 + direction) → tile index, or null for a plain ramp atlas. */
  chart: Uint8Array | null
}

/** Directional glyphs layered on top of a ramp. The idea comes from Alex
 * Harri Jónsson's "ASCII characters are not pixels" and the MIT
 * `glyph-graphics` implementation: a cell that sits on a contour gets a stroke
 * that follows the contour instead of a denser dot. Each entry is
 * [glyph, direction, approximate ramp level], where direction 1 = vertical
 * stroke, 2 = horizontal, 3 = "/", 4 = "\". */
const SHAPE_EXTRAS: Partial<Record<AsciiCharset, ReadonlyArray<readonly [string, number, number]>>> = {
  blocks: [['_', 2, 2], ['-', 2, 3], ['=', 2, 5], ['!', 1, 2], ['|', 1, 5], ['/', 3, 4], ['\\', 4, 4]],
  classic: [['_', 2, 3], ['-', 2, 5], ['=', 2, 8], ['!', 1, 3], ['|', 1, 8], ['/', 3, 6], ['\\', 4, 6]],
}

/** Build the per-cell tile lookup. Direction 0 always keeps the ramp glyph, so
 * flat areas keep the calibrated look; a directional extra is used only when
 * its ink mass is within one ramp step of the cell's level. */
function buildShapeChart(levels: number, extras: ReadonlyArray<readonly [string, number, number]>): Uint8Array | null {
  if (extras.length === 0) return null
  const chart = new Uint8Array(levels * 5)
  for (let level = 0; level < levels; level++) {
    chart[level * 5] = level
    for (let dir = 1; dir <= 4; dir++) {
      let best = -1
      let bestDiff = 2
      for (let k = 0; k < extras.length; k++) {
        if (extras[k][1] !== dir) continue
        const diff = Math.abs(extras[k][2] - level)
        if (diff < bestDiff) {
          best = k
          bestDiff = diff
        }
      }
      chart[level * 5 + dir] = best >= 0 && bestDiff <= 1 ? levels + best : level
    }
  }
  return chart
}

/** Inputs for {@link buildAtlas}; the canvas factory keeps tests DOM-free. */
export interface AtlasOptions {
  createCanvas: () => AsciiCanvasLike
  chars: string
  ink: string
  dark: boolean
  dpr: number
  tileW: number
  tileH: number
  fontPx: number
  opacity: number
  /** Which ramp this is; selects the directional extras. */
  charset?: AsciiCharset
  /** Bake the directional extras and the chart. */
  shape?: boolean
}

/**
 * Bake one coloured tile per ramp level, plus optional directional extras.
 * Level 0 is the blank glyph and the last ramp level is the densest one in
 * **both** themes — pieces write levels, not glyphs, so a level must mean the
 * same thing whichever ink the theme picks. Empty tiles are marked for the
 * draw loop. Per-level alpha is baked here too, which is why the hot loop
 * never touches `globalAlpha`.
 */
export function buildAtlas(options: AtlasOptions): Atlas | null {
  const { chars, ink, dpr, tileW, tileH, fontPx, opacity, createCanvas, charset, shape } = options
  const levels = chars.length
  const extras = shape === true && charset !== undefined ? SHAPE_EXTRAS[charset] ?? [] : []
  const total = levels + extras.length
  const canvas = createCanvas()
  const pxW = Math.max(1, Math.round(tileW * dpr))
  const pxH = Math.max(1, Math.round(tileH * dpr))
  canvas.width = total * pxW
  canvas.height = pxH
  const ctx = canvas.getContext('2d')
  if (ctx === null) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.font = `${fontPx}px ${MONO_STACK}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = ink
  const glyphs: string[] = new Array(total)
  const empty = new Uint8Array(total)
  const last = levels - 1
  for (let i = 0; i < levels; i++) {
    const glyph = chars[i]
    glyphs[i] = glyph
    if (glyph === ' ') {
      empty[i] = 1
      continue
    }
    // Denser glyphs carry stronger ink in both themes; light surfaces just
    // pick a darker ink colour in `inkFor`.
    ctx.globalAlpha = opacity * (0.55 + 0.45 * (last > 0 ? i / last : 1))
    ctx.fillText(glyph, i * tileW + tileW / 2, tileH / 2)
  }
  for (let k = 0; k < extras.length; k++) {
    const glyph = extras[k][0]
    const index = levels + k
    glyphs[index] = glyph
    ctx.globalAlpha = opacity * (0.55 + 0.45 * (last > 0 ? Math.min(last, extras[k][2]) / last : 1))
    ctx.fillText(glyph, index * tileW + tileW / 2, tileH / 2)
  }
  return { canvas, tileW, tileH, pxW, pxH, glyphs, empty, chart: buildShapeChart(levels, extras) }
}

/** Rolling degradation statistics. Fields stay mutable: no per-window alloc. */
export interface LadderState {
  level: number
  badWindows: number
  sum: number
  count: number
}

/** Fresh ladder pinned to rung 0. */
export function createLadder(): LadderState {
  return { level: 0, badWindows: 0, sum: 0, count: 0 }
}

/**
 * Feed one accepted draw interval. A window closes every
 * {@link LADDER_WINDOW} frames; two consecutive over-budget windows step the
 * ladder down one rung. A good window clears one bad window, so a single
 * spike never degrades. Returns true when a step happened.
 */
export function observeFrame(state: LadderState, interval: number, budget: number): boolean {
  state.sum += interval
  state.count++
  if (state.count < LADDER_WINDOW) return false
  const average = state.sum / state.count
  state.sum = 0
  state.count = 0
  if (average > budget * LADDER_OVER_BUDGET) state.badWindows++
  else state.badWindows = Math.max(0, state.badWindows - 1)
  if (state.badWindows >= LADDER_BAD_WINDOWS && state.level < DEGRADE_MAX) {
    state.level++
    state.badWindows = 0
    return true
  }
  return false
}

/** Observable renderer state; tests and the live probe read this. */
export interface AsciiBackdropStats {
  level: number
  cols: number
  rows: number
  frames: number
  atlasBuilds: number
  /** Cells the last frame marked as interaction effects (ripple crests, fish). */
  emphasisCells: number
  /** Cells the last frame drew as overlay glyphs (small fish directions). */
  overlayCells: number
  alive: boolean
}

/** Options accepted by {@link createAsciiBackdrop}. */
export interface AsciiBackdropOptions {
  doc: AsciiDocLike
  win: AsciiWinLike
  host: AsciiHostLike
  preset?: AsciiPreset
  /** Panel overrides for the boot preset; clamps to its `ranges`. */
  params?: AsciiParams
}

/** Handle owned by the appearance painter. */
export interface AsciiBackdrop {
  /** Re-read motion + tint and paint/resume/stop accordingly. */
  sync(): void
  /** Switch piece; resets the ladder to rung 0 and repaints immediately. The
   * canvas and level buffer survive; the atlas is reused when its key (ramp,
   * ink, theme, dpr, cell size, font, opacity) is unchanged. */
  setPreset(preset: AsciiPreset): void
  /** Replace the panel overrides for the current preset. Values are clamped
   * into that preset's `ranges`; a preset switch keeps the overrides and
   * re-clamps them. Repaints immediately so a dragging slider is visible. */
  setParams(params: AsciiParams): void
  /** Move the calm zone (the reading column). `null` disables the mask. The
   * per-cell caps are rebuilt only when the zone or the grid actually moves. */
  setFocus(rect: BgFocusRect | null): void
  /** Stop everything and free the canvas, listeners, arrays and atlases. */
  destroy(): void
  readonly stats: AsciiBackdropStats
}

const FALLBACK_SURFACE = '#e9ebee'

function readTint(value: string): string {
  const trimmed = value.trim()
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : FALLBACK_SURFACE
}

/**
 * Create the renderer and attach its canvas to the layer. The caller mounts
 * `div#vx-bg` first (so the motion attribute and tint already exist), then
 * calls {@link AsciiBackdrop.sync}.
 */
export function createAsciiBackdrop(options: AsciiBackdropOptions): AsciiBackdrop {
  const { doc, win, host } = options
  const canvas = doc.createElement('canvas')
  canvas.className = 'vx-bg-canvas'
  host.appendChild(canvas)
  const ctx = canvas.getContext('2d')
  const probeCanvas = doc.createElement('canvas')
  probeCanvas.width = 1
  probeCanvas.height = 1
  const probeCtx = probeCanvas.getContext('2d')

  let preset: AsciiPreset = options.preset ?? 'flow'
  let params: AsciiParams = normalizeParams(options.params)
  let current: AsciiPresetSpec = resolveAsciiSpec(preset, params)
  let destroyed = false
  let running = false
  let level = 0
  let raf = 0
  let lastTick = 0
  let lastDraw = 0
  let acc = 0
  let frames = 0
  let atlasBuilds = 0
  let dpr = 1
  let cssW = 0
  let cssH = 0
  let cellW = 0
  let cellH = 0
  let cols = 0
  let rows = 0
  let tileW = 1
  let tileH = 1
  let layoutDone = false
  let levels: Uint8Array | null = null
  let piece: AsciiPiece | null = null
  // Interaction runs on the existing frames only: pointer listeners mutate
  // `pointer`, `drawFrame` maps it onto grid coordinates once, and nothing
  // here schedules a second rAF loop.
  const pointer = createBgPointerState()
  const gridInput: AsciiInput = { x: 0, y: 0, active: false, down: false, vx: 0, vy: 0, pulseId: 0, pulseX: 0, pulseY: 0 }
  let emphasis: Uint8Array | null = null
  let overlay: Uint8Array | null = null
  let detachPointer: (() => void) | null = null
  // Spatial focus mask: the reading column stays calm, the edges keep full ink.
  // `focusCaps` is rebuilt only when the zone or the grid moves (a dirty flag),
  // never per frame, so the hot loop stays allocation-free.
  let focusRect: BgFocusRect | null = null
  let focusCaps: Uint8Array | null = null
  let focusDirty = true
  let surface = FALLBACK_SURFACE
  let ink = inkFor(FALLBACK_SURFACE, false, current.inkScale)
  let inkScale = current.inkScale
  let dark = false
  let atlas: Atlas | null = null
  let atlasKey = ''
  let densityScale = 1
  let dither = current.dither
  let targetFps = current.fps
  let resizeTimer: ReturnType<typeof setTimeout> | null = null
  let resizeObserver: AsciiResizeObserverLike | null = null
  let dprMql: AsciiMediaQueryLike | null = null
  const ladder = createLadder()
  const stats: AsciiBackdropStats = { level: 0, cols: 0, rows: 0, frames: 0, atlasBuilds: 0, emphasisCells: 0, overlayCells: 0, alive: true }
  if (typeof win.addEventListener === 'function' && typeof win.removeEventListener === 'function') {
    detachPointer = attachBgPointer(win as unknown as BgPointerTargetLike, pointer)
  }

  function spec(): AsciiPresetSpec {
    return current
  }

  function normalizeParams(next: AsciiParams | undefined): AsciiParams {
    const out: AsciiParams = {}
    if (next === undefined) return out
    for (const key of ['density', 'speed', 'fps', 'fontPx', 'opacity', 'strength'] as const) {
      const value = next[key]
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
    }
    return out
  }

  function paramsEqual(a: AsciiParams, b: AsciiParams): boolean {
    return a.density === b.density && a.speed === b.speed && a.fps === b.fps
      && a.fontPx === b.fontPx && a.opacity === b.opacity && a.strength === b.strength
  }

  /** Re-derive the ink when the piece or the strength choice moved it. The
   * atlas key carries the ink string, so a changed ink rebakes exactly once. */
  function refreshInk(): void {
    const scale = spec().inkScale
    if (scale === inkScale) return
    inkScale = scale
    ink = inkFor(surface, dark, scale)
    atlasKey = ''
  }

  function resetLadder(): void {
    level = 0
    ladder.level = 0
    ladder.badWindows = 0
    ladder.sum = 0
    ladder.count = 0
    densityScale = 1
    dither = spec().dither
    targetFps = spec().fps
    acc = 0
    lastTick = 0
    lastDraw = 0
    stats.level = 0
  }

  function updatePiece(): void {
    piece = createPresetPiece(preset, CHARSET[spec().charset].length, dither)
  }

  /** Only interactive pieces allocate the two per-cell channels; switching
   * back to a non-interactive preset drops them instead of paying a clear pass
   * forever. The buffers are reused across frames, never reallocated per
   * frame. */
  function ensureInteractionBuffers(): void {
    if (spec().interactive !== true || levels === null) {
      emphasis = null
      overlay = null
      return
    }
    const size = cols * rows
    if (emphasis === null || emphasis.length !== size) emphasis = new Uint8Array(size)
    if (overlay === null || overlay.length !== size) overlay = new Uint8Array(size)
  }

  function layout(force = false): void {
    if (destroyed) return
    const width = host.clientWidth || win.innerWidth || 0
    const height = host.clientHeight || win.innerHeight || 0
    if (width <= 0 || height <= 0) return
    const previousDpr = dpr
    dpr = Math.min(win.devicePixelRatio || 1, DPR_CAP)
    if (previousDpr !== dpr) watchDpr()
    const backingW = Math.round(width * dpr)
    const backingH = Math.round(height * dpr)
    if (canvas.width !== backingW || canvas.height !== backingH) {
      canvas.width = backingW
      canvas.height = backingH
    }
    cssW = width
    cssH = height
    if (ctx !== null) ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (probeCtx === null) return
    const presetSpec = spec()
    const metrics = measureCell(probeCtx, presetSpec.fontPx)
    const density = presetSpec.density * densityScale
    let nextCellW = metrics.cellW / density
    let nextCellH = metrics.cellH / density
    let nextCols = Math.max(1, Math.floor(width / nextCellW))
    let nextRows = Math.max(1, Math.floor(height / nextCellH))
    // Over the hard caps: grow the cell uniformly instead of truncating the
    // grid, so the field still covers the viewport without an empty margin.
    const scale = Math.max(nextCols / MAX_COLS, nextRows / MAX_ROWS, 1)
    if (scale > 1) {
      nextCellW *= scale
      nextCellH *= scale
      nextCols = Math.max(1, Math.floor(width / nextCellW))
      nextRows = Math.max(1, Math.floor(height / nextCellH))
    }
    cellW = nextCellW
    cellH = nextCellH
    tileW = Math.max(1, Math.ceil(nextCellW))
    tileH = Math.max(1, Math.ceil(nextCellH))
    const clampedCols = Math.min(MAX_COLS, nextCols)
    const clampedRows = Math.min(MAX_ROWS, nextRows)
    if (force || clampedCols !== cols || clampedRows !== rows) {
      cols = clampedCols
      rows = clampedRows
      levels = new Uint8Array(cols * rows)
      atlasKey = ''
      // Cell geometry moved under the mask: the cached caps no longer line up
      // with the new grid.
      focusDirty = true
    }
    updatePiece()
    ensureInteractionBuffers()
    layoutDone = true
    stats.cols = cols
    stats.rows = rows
  }

  function ensureAtlas(): Atlas | null {
    const presetSpec = spec()
    const charset = CHARSET[presetSpec.charset]
    const key = `${presetSpec.charset}|${presetSpec.shapeAware === true ? 's' : ''}|${ink}|${dark ? 'd' : 'l'}|${dpr}|${tileW}|${tileH}|${presetSpec.fontPx}|${presetSpec.opacity}`
    if (atlas !== null && atlasKey === key) return atlas
    if (atlas !== null) {
      atlas.canvas.width = 0
      atlas.canvas.height = 0
    }
    atlas = buildAtlas({
      createCanvas: () => doc.createElement('canvas'),
      chars: charset,
      ink,
      dark,
      dpr,
      tileW,
      tileH,
      fontPx: presetSpec.fontPx,
      opacity: presetSpec.opacity,
      charset: presetSpec.charset,
      shape: presetSpec.shapeAware === true,
    })
    atlasKey = key
    if (atlas !== null) {
      atlasBuilds++
      stats.atlasBuilds = atlasBuilds
    }
    return atlas
  }

  /** Level caps for the current grid + zone, rebuilt only when dirty. */
  function focusCapsFor(): Uint8Array | null {
    if (focusRect === null || levels === null || cols <= 0 || rows <= 0) return null
    if (!focusDirty && focusCaps !== null) return focusCaps
    const lastLevel = CHARSET[spec().charset].length - 1
    focusCaps = buildFocusCaps(cols, rows, cellW, cellH, focusRect, FOCUS_FEATHER_PX, FOCUS_FLOOR, lastLevel, focusCaps ?? undefined)
    focusDirty = false
    return focusCaps
  }

  function drawFrame(t: number): void {
    if (destroyed || ctx === null) return
    ctx.fillStyle = surface
    ctx.fillRect(0, 0, cssW, cssH)
    if (level >= DEGRADE_MAX || levels === null || piece === null) {
      frames++
      stats.frames = frames
      return
    }
    const baked = ensureAtlas()
    if (baked === null) {
      frames++
      stats.frames = frames
      return
    }
    // Interaction is sampled once per existing frame. A paused, static or
    // fully degraded frame passes no input, so a page that is not animating
    // cannot be woken up by a pointer move.
    const interactive = spec().interactive === true && computeMotion() === 'animated' && level < 5 && preset !== 'static'
    if (interactive) {
      // One easing/damping step per existing frame: the position keeps
      // converging after the last event and a resting pointer reaches exactly
      // zero force instead of holding its last velocity forever.
      syncBgPointer(pointer)
      const invW = cellW > 0 ? 1 / cellW : 0
      const invH = cellH > 0 ? 1 / cellH : 0
      // The page host is at the viewport origin; the conversation host is a
      // fixed layer over the column. Shift viewport CSS px into host-local
      // coordinates once per frame, so a ripple lands under the pointer in
      // both scopes.
      const origin = host.getBoundingClientRect?.()
      const originX = origin?.left ?? 0
      const originY = origin?.top ?? 0
      gridInput.x = (pointer.x - originX) * invW
      gridInput.y = (pointer.y - originY) * invH
      gridInput.active = pointer.active
      gridInput.down = pointer.down
      gridInput.vx = pointer.vx * invW
      gridInput.vy = pointer.vy * invH
      gridInput.pulseId = pointer.pulseId
      gridInput.pulseX = (pointer.pulseX - originX) * invW
      gridInput.pulseY = (pointer.pulseY - originY) * invH
    }
    if (emphasis !== null) emphasis.fill(0)
    if (overlay !== null) overlay.fill(0)
    piece(t, levels, cols, rows, interactive ? gridInput : undefined, emphasis ?? undefined, overlay ?? undefined)
    const caps = focusCapsFor()
    const empty = baked.empty
    const lastLevel = CHARSET[spec().charset].length - 1
    const effectFloor = Math.round(lastLevel * EFFECT_FOCUS_FLOOR)
    let emphasisCells = 0
    let overlayCells = 0
    let i = 0
    for (let row = 0; row < rows; row++) {
      const y = row * cellH
      for (let col = 0; col < cols; col++, i++) {
        const raw = levels[i]
        // One extra table read and compare per cell; the fade never touches the
        // atlas or the piece, so a masked frame costs what an unmasked one does
        // apart from this branch.
        let lv = caps === null || raw <= caps[i] ? raw : caps[i]
        // A ripple crest or a fish is an interaction the user just caused; the
        // calm zone may reduce it, but not all the way to the 0.15 floor.
        if (emphasis !== null && emphasis[i] === 1) {
          emphasisCells++
          if (caps !== null && lv < effectFloor) lv = effectFloor
        }
        if (overlay !== null && overlay[i] !== 0) overlayCells++
        // Shape-aware tier: read the field's local gradient (raw, pre-mask
        // levels) and swap in a stroke that follows the contour. Two cells each
        // way keeps the direction from flickering on one-level noise; the
        // distance gate leaves genuinely flat cells on their ramp glyph.
        let tile = lv
        const chart = baked.chart
        if (chart !== null) {
          const base = row * cols
          const left = levels[base + (col > 1 ? col - 2 : 0)]
          const right = levels[base + (col + 2 < cols ? col + 2 : cols - 1)]
          const up = levels[(row > 1 ? row - 2 : 0) * cols + col]
          const down = levels[(row + 2 < rows ? row + 2 : rows - 1) * cols + col]
          const gx = left - right
          const gy = up - down
          const ax = gx < 0 ? -gx : gx
          const ay = gy < 0 ? -gy : gy
          let dir = 0
          if (ax + ay >= 2) dir = ax > ay * 2 ? 1 : ay > ax * 2 ? 2 : gx * gy > 0 ? 3 : 4
          tile = chart[lv * 5 + dir]
        }
        if (empty[tile] === 1) continue
        ctx.drawImage(baked.canvas, tile * baked.pxW, 0, baked.pxW, baked.pxH, col * cellW, y, baked.tileW, baked.tileH)
      }
    }
    // Fish direction marks are a handful of cells per frame; drawing them with
    // fillText avoids a second baked atlas while keeping the per-cell blit for
    // the thousands of water cells.
    if (overlay !== null && overlayCells > 0) {
      ctx.font = `${spec().fontPx}px ${MONO_STACK}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = ink
      let j = 0
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++, j++) {
          const slot = overlay[j]
          if (slot === 0) continue
          const glyph = OVERLAY_GLYPHS[slot]
          if (glyph === undefined || glyph === '') continue
          const weight = caps === null ? 1 : Math.max(EFFECT_FOCUS_FLOOR, caps[j] / Math.max(1, lastLevel))
          ctx.globalAlpha = weight * spec().opacity
          ctx.fillText(glyph, (col + 0.5) * cellW, (row + 0.5) * cellH)
        }
      }
      ctx.globalAlpha = 1
    }
    stats.emphasisCells = emphasisCells
    stats.overlayCells = overlayCells
    frames++
    stats.frames = frames
  }

  function drawStaticFrame(): void {
    if (!layoutDone) layout()
    if (layoutDone && ctx !== null) drawFrame(0)
  }

  function drawSurfaceOnly(): void {
    if (ctx === null) return
    ctx.fillStyle = surface
    ctx.fillRect(0, 0, cssW, cssH)
    frames++
    stats.frames = frames
  }

  function schedule(): void {
    if (!running || raf !== 0 || destroyed) return
    raf = win.requestAnimationFrame(onFrame)
  }

  function stopLoop(): void {
    running = false
    if (raf !== 0) {
      win.cancelAnimationFrame(raf)
      raf = 0
    }
    lastTick = 0
    lastDraw = 0
  }

  function startLoop(): void {
    if (running || destroyed) return
    running = true
    lastTick = 0
    lastDraw = 0
    schedule()
  }

  function setLevel(next: number): void {
    const clamped = Math.max(0, Math.min(DEGRADE_MAX, next))
    if (clamped === level) return
    level = clamped
    stats.level = level
    const presetSpec = spec()
    const nextDensity = clamped >= 2 ? 0.75 : 1
    const nextDither = clamped >= 4 ? false : presetSpec.dither
    let relayout = false
    if (nextDensity !== densityScale) {
      densityScale = nextDensity
      relayout = true
    }
    if (nextDither !== dither) {
      dither = nextDither
      updatePiece()
    }
    // Fixed order, one action per rung: L1 fps (24 → 15), L2 density ×0.75,
    // L3 mono (already satisfied: this tier bakes one ink colour), L4 dither
    // off, L5 static frame, L6 surface only.
    targetFps = clamped >= 1 ? Math.min(presetSpec.fps, 15) : presetSpec.fps
    if (relayout) layout(true)
    if (clamped === 5) {
      stopLoop()
      drawStaticFrame()
    } else if (clamped === DEGRADE_MAX) {
      // L6 is not reachable from the automatic ladder: L5 already stops rAF,
      // so there is no frame left to observe. It exists for the explicit off
      // path (a preset switch or the future panel) and for `destroy` bookkeeping.
      stopLoop()
      drawSurfaceOnly()
    }
  }

  function onFrame(now: number): void {
    raf = 0
    if (!running || destroyed) return
    if (lastTick !== 0) acc += Math.min(now - lastTick, 100)
    lastTick = now
    const budget = 1000 / Math.max(1, targetFps)
    if (now - lastDraw < budget - 2) {
      schedule()
      return
    }
    const interval = lastDraw === 0 ? budget : now - lastDraw
    lastDraw = now
    drawFrame((acc / 1000) * spec().speed)
    if (level < 5 && observeFrame(ladder, interval, budget)) setLevel(ladder.level)
    if (level >= 5 || destroyed) {
      running = false
      return
    }
    schedule()
  }

  function computeMotion(): 'animated' | 'static' | 'paused' {
    const attr = host.getAttribute('data-vx-bg-motion')
    if (doc.hidden || attr === 'paused') return 'paused'
    if (reducedMql.matches || attr === 'static') return 'static'
    return 'animated'
  }

  function applyMotion(): void {
    if (destroyed) return
    const motion = computeMotion()
    if (motion === 'paused') {
      stopLoop()
      return
    }
    if (motion === 'static' || preset === 'static' || level >= 5) {
      stopLoop()
      drawStaticFrame()
      return
    }
    if (!layoutDone) {
      sync()
      return
    }
    if (!running) {
      drawFrame((acc / 1000) * spec().speed)
      startLoop()
    }
  }

  function sync(): void {
    if (destroyed) return
    const nextSurface = readTint(host.style.getPropertyValue('--vx-bg-tint'))
    if (nextSurface !== surface) {
      surface = nextSurface
      dark = isDarkSurface(surface)
      inkScale = spec().inkScale
      ink = inkFor(surface, dark, inkScale)
      atlasKey = ''
    }
    refreshInk()
    if (!layoutDone) layout()
    if (!layoutDone) return
    const motion = computeMotion()
    if (motion === 'paused') {
      stopLoop()
      return
    }
    if (motion === 'static' || preset === 'static' || level >= 5) {
      stopLoop()
      drawStaticFrame()
      return
    }
    // Paint one frame now: while the layer is mounted `body` is transparent,
    // so an empty canvas would flash the browser's default background.
    drawFrame((acc / 1000) * spec().speed)
    if (!running) startLoop()
  }

  function setPreset(next: AsciiPreset): void {
    if (destroyed || next === preset) return
    preset = next
    // The overrides travel with the switch: each value re-clamps against the
    // new preset's own ranges, so nothing the new piece cannot honour leaks in.
    current = resolveAsciiSpec(preset, params)
    refreshInk()
    resetLadder()
    // Re-derive the grid for the new density/fontPx. When the geometry did not
    // move, `layout` keeps the existing `levels` buffer and the atlas key
    // (ramp, ink, theme, cell size, font, opacity) stays the same, so the
    // baked atlas is reused; only the piece is replaced.
    layout()
    if (!layoutDone) return
    const motion = computeMotion()
    if (motion === 'paused') {
      stopLoop()
      return
    }
    if (motion === 'static' || preset === 'static' || level >= 5) {
      stopLoop()
      drawStaticFrame()
      return
    }
    // Repaint the new piece now: the opaque surface fill below the switch
    // would otherwise stay stale until the next scheduled frame.
    drawFrame((acc / 1000) * spec().speed)
    if (!running) startLoop()
  }

  function setParams(next: AsciiParams): void {
    if (destroyed) return
    const normalized = normalizeParams(next)
    if (paramsEqual(normalized, params)) return
    params = normalized
    current = resolveAsciiSpec(preset, params)
    refreshInk()
    resetLadder()
    // Density/fontPx move the grid, opacity/font feed the atlas key; a change
    // in either must relayout before the immediate repaint. `layout` keeps the
    // atlas and the level buffer when the geometry did not move.
    layout()
    if (!layoutDone) return
    const motion = computeMotion()
    if (motion === 'paused') {
      stopLoop()
      return
    }
    if (motion === 'static' || preset === 'static' || level >= 5) {
      stopLoop()
      drawStaticFrame()
      return
    }
    drawFrame((acc / 1000) * spec().speed)
    if (!running) startLoop()
  }

  function setFocus(next: BgFocusRect | null): void {
    if (destroyed) return
    const rect = normalizeFocusRect(next)
    if (sameFocusRect(rect, focusRect)) return
    focusRect = rect
    // The old caps stay allocated for the next build (same grid → same length);
    // the dirty flag is what stops a stale table from being used.
    focusDirty = true
    if (!layoutDone || running) return
    // A paused page must not be woken up just because the layout settled; the
    // next visible frame rebuilds and repaints with the new zone.
    if (computeMotion() === 'paused') return
    drawStaticFrame()
  }

  function onVisibility(): void {
    applyMotion()
  }

  const reducedMql = win.matchMedia('(prefers-reduced-motion: reduce)')
  const onReduced = (): void => {
    applyMotion()
  }

  function onDpr(): void {
    if (destroyed) return
    // `layout` re-registers the resolution query when the effective dpr moves.
    layout(true)
    sync()
  }

  function watchDpr(): void {
    if (dprMql !== null) {
      dprMql.removeEventListener('change', onDpr)
      dprMql = null
    }
    try {
      const next = win.matchMedia(`(resolution: ${dpr}dppx)`)
      next.addEventListener('change', onDpr)
      dprMql = next
    } catch {
      // Engines without resolution queries simply keep the boot dpr.
    }
  }

  doc.addEventListener('visibilitychange', onVisibility)
  reducedMql.addEventListener('change', onReduced)
  watchDpr()
  const Observer = win.ResizeObserver
  if (typeof Observer === 'function') {
    resizeObserver = new Observer(() => {
      if (resizeTimer !== null) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        resizeTimer = null
        if (destroyed) return
        layout(true)
        sync()
      }, RESIZE_DEBOUNCE_MS)
    })
    resizeObserver.observe(host)
  }

  function destroy(): void {
    if (destroyed) return
    destroyed = true
    stopLoop()
    if (detachPointer !== null) {
      detachPointer()
      detachPointer = null
    }
    resetBgPointerState(pointer)
    emphasis = null
    overlay = null
    if (resizeTimer !== null) {
      clearTimeout(resizeTimer)
      resizeTimer = null
    }
    if (resizeObserver !== null) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
    doc.removeEventListener('visibilitychange', onVisibility)
    reducedMql.removeEventListener('change', onReduced)
    if (dprMql !== null) {
      dprMql.removeEventListener('change', onDpr)
      dprMql = null
    }
    if (atlas !== null) {
      atlas.canvas.width = 0
      atlas.canvas.height = 0
      atlas = null
    }
    probeCanvas.width = 0
    probeCanvas.height = 0
    canvas.width = 0
    canvas.height = 0
    canvas.remove()
    levels = null
    piece = null
    focusCaps = null
    atlasKey = ''
    stats.alive = false
  }

  return { sync, setPreset, setParams, setFocus, destroy, stats }
}
