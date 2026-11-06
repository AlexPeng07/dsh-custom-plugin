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

import { hexToRgb, inkFor } from './palette.ts'

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
  readonly ranges: AsciiPresetRanges
}

/**
 * System presets. `flow` is the default animated tier; `static` draws one
 * deterministic flow frame (zero rAF). The other four are genuinely different
 * pieces: vertical falling trails, horizontal swells, sparse parallax stars
 * and concentric rings. `density` varies the cell size, so presets that share
 * a charset and a density also share one baked atlas across a switch.
 */
export const ASCII_PRESETS: Record<AsciiPreset, AsciiPresetSpec> = {
  // Ink alpha stays 1: the subtlety comes from `inkFor`'s ΔL, not from fading
  // the whole canvas (which is what made the first live pass read as flat grey).
  flow: {
    density: 0.75, speed: 1, fps: 24, charset: 'blocks', dither: true, opacity: 1, fontPx: 12,
    ranges: { density: { min: 0.5, max: 1.5 }, speed: { min: 0, max: 2 }, fps: { min: 15, max: 30 }, fontPx: { min: 10, max: 16 }, opacity: { min: 0.6, max: 1 } },
  },
  rain: {
    // Classic is the 16-level ramp: a long trail needs the extra steps, and
    // at 16 levels ordered dithering adds grain instead of removing banding.
    density: 1, speed: 1, fps: 24, charset: 'classic', dither: false, opacity: 1, fontPx: 12,
    ranges: { density: { min: 0.75, max: 1.5 }, speed: { min: 0.5, max: 2 }, fps: { min: 15, max: 30 }, fontPx: { min: 10, max: 16 }, opacity: { min: 0.6, max: 1 } },
  },
  ocean: {
    // Bigger cells (density 0.5) and the 5-level dot ramp keep the swell slow
    // and wide; it shares that geometry + ramp with starfield.
    density: 0.5, speed: 0.8, fps: 20, charset: 'dots', dither: true, opacity: 1, fontPx: 12,
    ranges: { density: { min: 0.5, max: 1.25 }, speed: { min: 0.3, max: 1.5 }, fps: { min: 15, max: 24 }, fontPx: { min: 10, max: 16 }, opacity: { min: 0.6, max: 1 } },
  },
  starfield: {
    // Almost all cells stay blank; low fps is invisible on a 0.12-cell/s drift.
    density: 0.5, speed: 0.3, fps: 15, charset: 'dots', dither: false, opacity: 1, fontPx: 12,
    ranges: { density: { min: 0.5, max: 1.25 }, speed: { min: 0, max: 1 }, fps: { min: 10, max: 20 }, fontPx: { min: 10, max: 16 }, opacity: { min: 0.6, max: 1 } },
  },
  ripple: {
    // Same ramp + geometry as flow, so switching between the two never rebakes
    // the atlas. No dither: it would speckle the contour bands.
    density: 0.75, speed: 0.6, fps: 20, charset: 'blocks', dither: false, opacity: 1, fontPx: 12,
    ranges: { density: { min: 0.5, max: 1.5 }, speed: { min: 0.2, max: 1.2 }, fps: { min: 15, max: 24 }, fontPx: { min: 10, max: 16 }, opacity: { min: 0.6, max: 1 } },
  },
  static: {
    density: 0.75, speed: 0, fps: 24, charset: 'blocks', dither: true, opacity: 1, fontPx: 12,
    ranges: { density: { min: 0.5, max: 1.5 }, speed: { min: 0, max: 0 }, fps: { min: 10, max: 30 }, fontPx: { min: 10, max: 16 }, opacity: { min: 0.6, max: 1 } },
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

/** Contrast and gamma stay internal: exposed knobs made every preset look
 * worse. Values are deliberate no-ops until a preset needs them. */
const CONTRAST = 1
const GAMMA = 1

/** Bayer 4×4 ordered dither matrix (row-major). */
const BAYER4 = new Uint8Array([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5])

/** One frame is one ramp-level index per cell. Writing into the caller's
 * buffer keeps the loop allocation-free. */
export type AsciiPiece = (t: number, out: Uint8Array, cols: number, rows: number) => void

/** Quantize a 0..1 field value to a ramp index. Clamping lives here so a
 * piece can never write outside the atlas. */
export function quantizeLevel(value: number, levels: number): number {
  if (levels <= 1) return 0
  if (!Number.isFinite(value) || value <= 0) return 0
  const idx = Math.floor(value * levels)
  return idx >= levels ? levels - 1 : idx
}

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

/**
 * 32-bit integer hash → 0..1. `Math.imul` keeps the multiplications honest;
 * plain `*` would lose the low bits once the product passes 2^53.
 */
function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Smooth value noise; one octave is enough for a decorative drift field. */
function valueNoise(x: number, y: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash2(x0, y0)
  const b = hash2(x0 + 1, y0)
  const c = hash2(x0, y0 + 1)
  const d = hash2(x0 + 1, y0 + 1)
  const ab = a + (b - a) * ux
  const cd = c + (d - c) * ux
  return ab + (cd - ab) * uy
}

/**
 * The `flow` piece: a slowly drifting value-noise field. `t` is already
 * scaled by the preset speed. Dithering only makes sense on short ramps;
 * at 16 levels it adds noise instead of removing banding.
 */
export function createFlowPiece(levels: number, dither: boolean): AsciiPiece {
  return (t, out, cols, rows) => {
    const driftX = t * 0.12
    const driftY = t * 0.05
    let i = 0
    for (let row = 0; row < rows; row++) {
      const y = row * 0.11 + driftY
      for (let col = 0; col < cols; col++, i++) {
        let v = valueNoise(col * 0.08 + driftX, y)
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

/** Shared tail of every piece: clamp, optional Bayer dither, quantize. */
function shade(out: Uint8Array, i: number, v: number, levels: number, dither: boolean, row: number, col: number): void {
  if (v < 0) v = 0
  else if (v > 1) v = 1
  if (dither) {
    v += (BAYER4[(row & 3) * 4 + (col & 3)] / 16 - 0.5) * (1 / levels)
    if (v < 0) v = 0
    else if (v > 1) v = 1
  }
  out[i] = quantizeLevel(v, levels)
}

/**
 * The `rain` piece: falling columns. Each column owns a phase, a fall speed
 * and a trail length derived from its index; roughly one column in seven is
 * dormant, so the rain reads as patchy weather rather than a curtain. The
 * head is the brightest cell and the trail fades quadratically behind it.
 */
export function createRainPiece(levels: number, dither: boolean): AsciiPiece {
  // Column scratch lives in the closure and grows only when the grid widens:
  // one Float64Array assignment per column per frame, no per-frame allocation.
  let capacity = 0
  let head = new Float64Array(0)
  let trail = new Float64Array(0)
  let active = new Uint8Array(0)
  return (t, out, cols, rows) => {
    if (cols > capacity) {
      capacity = cols
      head = new Float64Array(capacity)
      trail = new Float64Array(capacity)
      active = new Uint8Array(capacity)
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
    // The renderer consumes the buffer row-major; write it the same way.
    let i = 0
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++, i++) {
        if (!active[col]) continue
        const behind = head[col] - row
        if (behind < 0 || behind >= trail[col]) continue
        const fade = 1 - behind / trail[col]
        shade(out, i, 0.22 + 0.78 * fade * fade, levels, dither, row, col)
      }
    }
  }
}

/**
 * The `ocean` piece: two low-frequency swells sliding in opposite directions
 * plus a slow vertical bob. A fixed foam speckle (hash of the cell, never of
 * time) adds texture without flicker.
 */
export function createOceanPiece(levels: number, dither: boolean): AsciiPiece {
  return (t, out, cols, rows) => {
    let i = 0
    for (let row = 0; row < rows; row++) {
      const rowPhase = Math.sin(row * 0.16 + t * 0.18) * 0.07
      for (let col = 0; col < cols; col++, i++) {
        let v = 0.46 + rowPhase
        v += Math.sin(col * 0.045 + row * 0.018 + t * 0.55) * 0.26
        v += Math.sin(col * 0.11 - row * 0.032 - t * 0.9) * 0.14
        v += Math.sin(col * 0.21 + t * 1.1) * 0.05
        if (hash2(col, row) > 0.982) v += 0.16
        shade(out, i, v, levels, dither, row, col)
      }
    }
  }
}

/**
 * The `starfield` piece: sparse stars on a mostly blank field, drifting one
 * cell every ~8 s and twinkling slowly. The cells below the star thresholds
 * stay at level 0, so the blit loop skips them and the tier is the cheapest.
 */
export function createStarfieldPiece(levels: number, _dither: boolean): AsciiPiece {
  return (t, out, cols, rows) => {
    out.fill(0)
    const base = Math.floor(t * 0.12)
    let i = 0
    for (let row = 0; row < rows; row++) {
      const sourceRow = row - base
      for (let col = 0; col < cols; col++, i++) {
        const h = hash2(col, sourceRow)
        if (h > 0.962) {
          const twinkle = 0.5 + 0.5 * Math.sin(t * 0.6 + h * 120)
          shade(out, i, 0.62 + 0.3 * twinkle, levels, false, row, col)
        } else if (h > 0.9) {
          const twinkle = 0.5 + 0.5 * Math.sin(t * 0.25 + h * 90)
          shade(out, i, 0.16 + 0.14 * twinkle, levels, false, row, col)
        }
      }
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

/**
 * The `ripple` piece: concentric rings from three fixed origins. Each ring
 * decays with distance from its origin, keeping the field low-contrast —
 * crests brighten, troughs fall back toward the base, nothing saturates.
 * Dithering stays off: the stipple would break the contour lines the rings
 * are read through.
 */
export function createRipplePiece(levels: number, dither: boolean): AsciiPiece {
  return (t, out, cols, rows) => {
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
        shade(out, i, v, levels, dither, row, col)
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
    case 'flow':
    case 'static':
    default:
      return createFlowPiece(levels, dither)
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

/** The slice of `Window` this renderer touches. */
export interface AsciiWinLike {
  readonly devicePixelRatio: number
  readonly innerWidth?: number
  readonly innerHeight?: number
  requestAnimationFrame(callback: (now: number) => void): number
  cancelAnimationFrame(handle: number): void
  matchMedia(query: string): AsciiMediaQueryLike
  ResizeObserver?: new (callback: () => void) => AsciiResizeObserverLike
}

/** One baked glyph atlas: one row of L tiles, already colored and faded. */
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
}

/**
 * Bake one colored tile per ramp level. Level 0 is the blank glyph and the
 * last level is the densest one in **both** themes — pieces write levels, not
 * glyphs, so a level must mean the same thing whichever ink the theme picks.
 * Empty tiles are marked for the draw loop. Per-level alpha is baked here
 * too, which is why the hot loop never touches `globalAlpha`.
 */
export function buildAtlas(options: AtlasOptions): Atlas | null {
  const { chars, ink, dpr, tileW, tileH, fontPx, opacity, createCanvas } = options
  const levels = chars.length
  const canvas = createCanvas()
  const pxW = Math.max(1, Math.round(tileW * dpr))
  const pxH = Math.max(1, Math.round(tileH * dpr))
  canvas.width = levels * pxW
  canvas.height = pxH
  const ctx = canvas.getContext('2d')
  if (ctx === null) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.font = `${fontPx}px ${MONO_STACK}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = ink
  const glyphs: string[] = new Array(levels)
  const empty = new Uint8Array(levels)
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
  return { canvas, tileW, tileH, pxW, pxH, glyphs, empty }
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
  alive: boolean
}

/** Options accepted by {@link createAsciiBackdrop}. */
export interface AsciiBackdropOptions {
  doc: AsciiDocLike
  win: AsciiWinLike
  host: AsciiHostLike
  preset?: AsciiPreset
}

/** Handle owned by the appearance painter. */
export interface AsciiBackdrop {
  /** Re-read motion + tint and paint/resume/stop accordingly. */
  sync(): void
  /** Switch piece; resets the ladder to rung 0 and repaints immediately. The
   * canvas and level buffer survive; the atlas is reused when its key (ramp,
   * ink, theme, dpr, cell size, font, opacity) is unchanged. */
  setPreset(preset: AsciiPreset): void
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
  let surface = FALLBACK_SURFACE
  let ink = inkFor(FALLBACK_SURFACE, false)
  let dark = false
  let atlas: Atlas | null = null
  let atlasKey = ''
  let densityScale = 1
  let dither = ASCII_PRESETS[preset].dither
  let targetFps = ASCII_PRESETS[preset].fps
  let resizeTimer: ReturnType<typeof setTimeout> | null = null
  let resizeObserver: AsciiResizeObserverLike | null = null
  let dprMql: AsciiMediaQueryLike | null = null
  const ladder = createLadder()
  const stats: AsciiBackdropStats = { level: 0, cols: 0, rows: 0, frames: 0, atlasBuilds: 0, alive: true }

  function spec(): AsciiPresetSpec {
    return ASCII_PRESETS[preset]
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
    }
    updatePiece()
    layoutDone = true
    stats.cols = cols
    stats.rows = rows
  }

  function ensureAtlas(): Atlas | null {
    const presetSpec = spec()
    const charset = CHARSET[presetSpec.charset]
    const key = `${presetSpec.charset}|${ink}|${dark ? 'd' : 'l'}|${dpr}|${tileW}|${tileH}|${presetSpec.fontPx}|${presetSpec.opacity}`
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
    })
    atlasKey = key
    if (atlas !== null) {
      atlasBuilds++
      stats.atlasBuilds = atlasBuilds
    }
    return atlas
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
    piece(t, levels, cols, rows)
    const empty = baked.empty
    let i = 0
    for (let row = 0; row < rows; row++) {
      const y = row * cellH
      for (let col = 0; col < cols; col++, i++) {
        const lv = levels[i]
        if (empty[lv] === 1) continue
        ctx.drawImage(baked.canvas, lv * baked.pxW, 0, baked.pxW, baked.pxH, col * cellW, y, baked.tileW, baked.tileH)
      }
    }
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
      ink = inkFor(surface, dark)
      atlasKey = ''
    }
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
    atlasKey = ''
    stats.alive = false
  }

  return { sync, setPreset, destroy, stats }
}
