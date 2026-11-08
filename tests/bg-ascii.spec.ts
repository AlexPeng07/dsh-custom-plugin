/**
 * Invariant tests for the ASCII backdrop renderer: ramp quantization, one
 * baked atlas reused across frames, the one-way degradation ladder, the
 * pause/static motion states, and full teardown. The DOM is faked structurally
 * because vitest runs in a node environment and the renderer deliberately
 * touches only a handful of DOM operations.
 * @module @alexpeng/dsh-custom-plugin/tests/bg-ascii
 */

import { describe, expect, it } from 'vitest'
import {
  ASCII_PRESETS,
  buildAtlas,
  CHARSET,
  createAsciiBackdrop,
  createFlowPiece,
  createLadder,
  createPresetPiece,
  DEGRADE_MAX,
  FLOW_LEVEL_FLOOR,
  isDarkSurface,
  LADDER_BAD_WINDOWS,
  LADDER_WINDOW,
  MAX_COLS,
  MAX_ROWS,
  observeFrame,
  quantizeLevel,
  type AsciiCanvasLike,
  type AsciiCtxLike,
  type AsciiDocLike,
  type AsciiHostLike,
  type AsciiMediaQueryLike,
  type AsciiPreset,
  type AsciiResizeObserverLike,
  type AsciiWinLike,
} from '../src/client/bg-ascii.ts'
import { hexToRgb, INK_SCALE_MAX, INK_SCALE_MIN, inkFor, inkScaleFor } from '../src/client/palette.ts'

/**
 * A 2D context that records the calls the draw contract cares about: how many
 * glyphs were baked (atlas builds) and how many tiles were blitted (frames).
 */
interface FakeCtx extends AsciiCtxLike {
  fillTextCount: number
  drawImageCount: number
  fillRectCount: number
  transforms: number
  advance: number
}

function fakeCtx(advance = 7.2): FakeCtx {
  const ctx: FakeCtx = {
    font: '',
    textAlign: '',
    textBaseline: '',
    globalAlpha: 1,
    fillStyle: '',
    imageSmoothingEnabled: true,
    fillTextCount: 0,
    drawImageCount: 0,
    fillRectCount: 0,
    transforms: 0,
    advance,
    measureText(text: string) { return { width: text.length * ctx.advance } },
    fillText() { ctx.fillTextCount++ },
    fillRect() { ctx.fillRectCount++ },
    setTransform() { ctx.transforms++ },
    drawImage() { ctx.drawImageCount++ },
  }
  return ctx
}

interface FakeCanvas extends AsciiCanvasLike {
  ctx: FakeCtx
  removed: boolean
}

function fakeCanvas(advance = 7.2): FakeCanvas {
  const ctx = fakeCtx(advance)
  const canvas: FakeCanvas = {
    width: 0,
    height: 0,
    className: '',
    style: { width: '', height: '' },
    ctx,
    removed: false,
    getContext() { return ctx },
    remove() { canvas.removed = true },
  }
  return canvas
}

interface FakeHost extends AsciiHostLike {
  clientWidth: number
  clientHeight: number
  children: FakeCanvas[]
  attrs: Map<string, string>
  props: Map<string, string>
}

function fakeHost(width = 1440, height = 900): FakeHost {
  const host: FakeHost = {
    clientWidth: width,
    clientHeight: height,
    children: [],
    attrs: new Map<string, string>(),
    props: new Map<string, string>([['--vx-bg-tint', '#e9ebee']]),
    getAttribute(name: string) { return host.attrs.get(name) ?? null },
    appendChild(node: unknown) { host.children.push(node as FakeCanvas); return node },
    style: { getPropertyValue(name: string) { return host.props.get(name) ?? '' } },
  }
  return host
}

interface FakeDoc extends AsciiDocLike {
  hidden: boolean
  created: FakeCanvas[]
  listeners: Map<string, Array<() => void>>
}

function fakeDoc(): FakeDoc {
  const listeners = new Map<string, Array<() => void>>()
  const doc: FakeDoc = {
    hidden: false,
    created: [],
    listeners,
    createElement() { const canvas = fakeCanvas(); doc.created.push(canvas); return canvas },
    addEventListener(type: string, listener: () => void) {
      const list = listeners.get(type) ?? []
      list.push(listener)
      listeners.set(type, list)
    },
    removeEventListener(type: string, listener: () => void) {
      const list = listeners.get(type) ?? []
      listeners.set(type, list.filter((entry) => entry !== listener))
    },
  }
  return doc
}

/** Fire a recorded document event (visibilitychange in practice). */
function fire(doc: FakeDoc, type: string): void {
  for (const listener of [...(doc.listeners.get(type) ?? [])]) listener()
}

interface FakeMql extends AsciiMediaQueryLike {
  matches: boolean
  listeners: Array<() => void>
}

function fakeMql(matches = false): FakeMql {
  const mql: FakeMql = {
    matches,
    listeners: [],
    addEventListener(_type: string, listener: () => void) { mql.listeners.push(listener) },
    removeEventListener(_type: string, listener: () => void) {
      mql.listeners = mql.listeners.filter((entry) => entry !== listener)
    },
  }
  return mql
}

interface FakeWin extends AsciiWinLike {
  devicePixelRatio: number
  rafCallbacks: Map<number, (now: number) => void>
  rafCanceled: number[]
  queries: FakeMql[]
  observers: FakeResizeObserver[]
}

interface FakeResizeObserver extends AsciiResizeObserverLike {
  disconnected: boolean
  observed: unknown[]
}

function fakeWin(dpr = 1, reduced = false): FakeWin {
  let handle = 1
  const win: FakeWin = {
    devicePixelRatio: dpr,
    innerWidth: 1440,
    innerHeight: 900,
    rafCallbacks: new Map(),
    rafCanceled: [],
    queries: [],
    observers: [],
    requestAnimationFrame(callback: (now: number) => void) {
      const id = handle++
      win.rafCallbacks.set(id, callback)
      return id
    },
    cancelAnimationFrame(id: number) {
      win.rafCanceled.push(id)
      win.rafCallbacks.delete(id)
    },
    matchMedia(query: string) {
      // Boot reads the reduced-motion query first, then the dpr query.
      const mql = fakeMql(query.includes('prefers-reduced-motion') ? reduced : false)
      win.queries.push(mql)
      return mql
    },
    ResizeObserver: class implements AsciiResizeObserverLike {
      readonly disconnected = false
      readonly observed: unknown[] = []
      private readonly callback: () => void
      constructor(callback: () => void) {
        this.callback = callback
        win.observers.push(this as unknown as FakeResizeObserver)
      }
      observe(target: unknown) { this.observed.push(target) }
      disconnect() { (this as unknown as { disconnected: boolean }).disconnected = true }
    } as unknown as new (callback: () => void) => AsciiResizeObserverLike,
  }
  return win
}

/** Drive the pending rAF callback with a synthetic timestamp. */
function tick(win: FakeWin, now: number): void {
  const pending = [...win.rafCallbacks.entries()]
  win.rafCallbacks.clear()
  for (const [, callback] of pending) callback(now)
}

describe('quantizeLevel', () => {
  it('maps a 0..1 field value onto the ramp index', () => {
    expect(quantizeLevel(0, 10)).toBe(0)
    expect(quantizeLevel(0.05, 10)).toBe(0)
    expect(quantizeLevel(0.15, 10)).toBe(1)
    expect(quantizeLevel(0.99, 10)).toBe(9)
  })

  it('clamps so a piece can never index outside the atlas', () => {
    expect(quantizeLevel(1, 10)).toBe(9)
    expect(quantizeLevel(4, 10)).toBe(9)
    expect(quantizeLevel(-3, 10)).toBe(0)
    expect(quantizeLevel(Number.NaN, 10)).toBe(0)
    expect(quantizeLevel(0.5, 1)).toBe(0)
  })
})

describe('createFlowPiece', () => {
  it('writes one in-range level per cell into the caller buffer and reuses it', () => {
    const cols = 12
    const rows = 8
    const buf = new Uint8Array(cols * rows)
    const piece = createFlowPiece(10, true)
    piece(0.25, buf, cols, rows)
    const first = Array.from(buf)
    piece(3.5, buf, cols, rows)
    expect(buf).toHaveLength(cols * rows)
    for (const value of buf) expect(value).toBeGreaterThanOrEqual(0)
    for (const value of buf) expect(value).toBeLessThan(10)
    // Same buffer, new contents: the loop never allocates a replacement.
    expect(Array.from(buf)).not.toEqual(first)
  })

  it('never emits the blank / hairline half of the ramp — ink area is the visibility lever', () => {
    // Value noise sits near 0.5, so without the lift most cells quantise onto
    // the ramp's light glyphs (`+` / `*`, 5.5% / 4.4% ink area at 12 px) and the
    // composited page reads as a flat wash. FLOW_LEVEL_FLOOR moves the darkest
    // cell to the middle of the ramp, so `#`–`%` (12–17% ink area) carry the
    // field. The floor is a *coverage* contract: asserting the minimum level
    // (and the mean) is what stops a later "make it subtler" edit from silently
    // putting the page back to the state the user rejected.
    const cols = 40
    const rows = 20
    const buf = new Uint8Array(cols * rows)
    createFlowPiece(10, false)(5.5, buf, cols, rows)
    const levels = Array.from(buf)
    const floorLevel = Math.floor(FLOW_LEVEL_FLOOR * 10)
    expect(Math.min(...levels)).toBeGreaterThanOrEqual(floorLevel)
    const mean = levels.reduce((sum, v) => sum + v, 0) / levels.length
    // Average noise ≈ 0.5 → lifted ≈ 0.72 → level 7 (`#`); allow the field's
    // own variation, but pin it above the old `+` band (level 5).
    expect(mean).toBeGreaterThanOrEqual(6)
    expect(Math.max(...levels)).toBeLessThan(10)
  })
})

/** Render one preset frame into a fresh buffer at a fixed test grid. */
function presetFrame(preset: AsciiPreset, t: number, cols = 60, rows = 24): { buf: Uint8Array; levels: number } {
  const spec = ASCII_PRESETS[preset]
  const levels = CHARSET[spec.charset].length
  const buf = new Uint8Array(cols * rows)
  createPresetPiece(preset, levels, spec.dither)(t, buf, cols, rows)
  return { buf, levels }
}

/** How many distinct ramp levels a frame uses. */
function distinctLevels(buf: Uint8Array): number {
  return new Set(buf).size
}

describe('preset pieces', () => {
  const animated: AsciiPreset[] = ['flow', 'rain', 'ocean', 'starfield', 'ripple']

  it('writes in-range levels at both grid extremes for every preset', () => {
    for (const preset of [...animated, 'static'] as AsciiPreset[]) {
      const spec = ASCII_PRESETS[preset]
      const levels = CHARSET[spec.charset].length
      for (const [cols, rows] of [[1, 1], [MAX_COLS, MAX_ROWS], [1, MAX_ROWS], [MAX_COLS, 1]]) {
        const buf = new Uint8Array(cols * rows)
        // Two very different times exercise the modulo/drift arithmetic.
        for (const t of [0, 12345.678]) {
          createPresetPiece(preset, levels, spec.dither)(t, buf, cols, rows)
          expect(buf).toHaveLength(cols * rows)
          for (const value of buf) expect(value).toBeLessThan(levels)
        }
      }
    }
  })

  it('uses a non-degenerate level distribution for the dense presets', () => {
    const flow = presetFrame('flow', 1)
    expect(distinctLevels(flow.buf)).toBeGreaterThanOrEqual(4)

    const rain = presetFrame('rain', 1)
    expect(distinctLevels(rain.buf)).toBeGreaterThanOrEqual(6)
    // The falling head must reach the top of the 16-level ramp.
    expect(Math.max(...rain.buf)).toBeGreaterThanOrEqual(rain.levels - 2)

    const ocean = presetFrame('ocean', 1)
    expect(distinctLevels(ocean.buf)).toBeGreaterThanOrEqual(3)

    const ripple = presetFrame('ripple', 1)
    expect(distinctLevels(ripple.buf)).toBeGreaterThanOrEqual(3)
  })

  it('paints rain trails down columns, not across rows', () => {
    const cols = 6
    const rows = 12
    const buf = new Uint8Array(cols * rows)
    createPresetPiece('rain', CHARSET.classic.length, false)(0, buf, cols, rows)
    expect(buf.some((value) => value > 0)).toBe(true)
    for (let col = 0; col < cols; col++) {
      const lit: number[] = []
      for (let row = 0; row < rows; row++) {
        if (buf[row * cols + col] > 0) lit.push(row)
      }
      // Every lit run in one column is contiguous: a transposed (column-major)
      // write would scatter the trail across rows instead.
      for (let k = 1; k < lit.length; k++) expect(lit[k]).toBe(lit[k - 1] + 1)
    }
  })

  it('keeps starfield mostly blank while still placing bright stars', () => {
    const { buf } = presetFrame('starfield', 3)
    const blank = buf.reduce((count, value) => count + (value === 0 ? 1 : 0), 0)
    expect(blank / buf.length).toBeGreaterThan(0.5)
    expect(buf.some((value) => value >= 3)).toBe(true)
    // Sparse is not empty: the primary band plus its companions must light at
    // least 4% of cells, which is what the 2026-11-08 host measurement read as
    // "there are stars" instead of "a blank backdrop".
    expect(1 - blank / buf.length).toBeGreaterThan(0.04)
  })

  it('draws the same field for static at t=0 as flow at t=0', () => {
    const stat = presetFrame('static', 0)
    const flow = presetFrame('flow', 0)
    expect(Array.from(stat.buf)).toEqual(Array.from(flow.buf))
  })

  it('keeps every preset default inside its writable bounds', () => {
    for (const preset of Object.keys(ASCII_PRESETS) as AsciiPreset[]) {
      const spec = ASCII_PRESETS[preset]
      expect(spec.density).toBeGreaterThanOrEqual(spec.ranges.density.min)
      expect(spec.density).toBeLessThanOrEqual(spec.ranges.density.max)
      expect(spec.speed).toBeGreaterThanOrEqual(spec.ranges.speed.min)
      expect(spec.speed).toBeLessThanOrEqual(spec.ranges.speed.max)
      expect(spec.fps).toBeGreaterThanOrEqual(spec.ranges.fps.min)
      expect(spec.fps).toBeLessThanOrEqual(spec.ranges.fps.max)
      expect(spec.fontPx).toBeGreaterThanOrEqual(spec.ranges.fontPx.min)
      expect(spec.fontPx).toBeLessThanOrEqual(spec.ranges.fontPx.max)
      expect(spec.opacity).toBeGreaterThanOrEqual(spec.ranges.opacity.min)
      expect(spec.opacity).toBeLessThanOrEqual(spec.ranges.opacity.max)
      // Ink scale is calibrated per piece (dot glyphs carry far less ink per
      // cell), not a free knob: the band keeps it inside a readable range.
      expect(spec.inkScale).toBeGreaterThanOrEqual(0.8)
      expect(spec.inkScale).toBeLessThanOrEqual(1.6)
    }
  })

  it('pins the per-piece visibility calibration', () => {
    // Measured 2026-11-08 on a live host (see AGENTS.md). These are the values
    // that bring every piece inside one perceived-strength band; `rain` stays
    // below the dots pieces because its 13.3% inter-frame change carries it,
    // and `starfield` pays for its sparse field with the brightest points.
    const ink: Record<AsciiPreset, number> = {
      flow: 1, static: 1, rain: 1.1, ripple: 1.25, ocean: 1.4, starfield: 1.6,
    }
    for (const [preset, value] of Object.entries(ink)) {
      expect(ASCII_PRESETS[preset as AsciiPreset].inkScale).toBe(value)
    }
    // The two dot pieces needed cell-level fixes on top of the ink step:
    // ocean's swell was 1/3 of flow's ink mass at density 0.5, and starfield's
    // 12 px dots read as nothing at 0.23% coverage.
    expect(ASCII_PRESETS.ocean.density).toBe(0.65)
    expect(ASCII_PRESETS.starfield.fontPx).toBe(14)
  })
})

describe('buildAtlas', () => {
  it('bakes one tile per level once and keeps level 0 blank in both themes', () => {
    const created: FakeCanvas[] = []
    const atlas = buildAtlas({
      createCanvas: () => { const canvas = fakeCanvas(); created.push(canvas); return canvas },
      chars: ' .:-=+*#%@',
      ink: '#333333',
      dark: false,
      dpr: 2,
      tileW: 10,
      tileH: 14,
      fontPx: 12,
      opacity: 0.35,
    })
    expect(atlas).not.toBeNull()
    expect(created).toHaveLength(1)
    expect(created[0].width).toBe(10 * 20)
    expect(created[0].height).toBe(28)
    // Level 0 is always the blank glyph; the theme only changes the ink.
    expect(atlas?.glyphs[0]).toBe(' ')
    expect(atlas?.glyphs[9]).toBe('@')
    expect(atlas?.empty[0]).toBe(1)
    expect(atlas?.empty[9]).toBe(0)
    // Exactly the non-space tiles were painted into the atlas.
    expect(created[0].ctx.fillTextCount).toBe(9)
  })
})

describe('observeFrame', () => {
  const budget = 1000 / 15
  const slow = budget * 1.8

  it('needs two consecutive bad windows before stepping one rung', () => {
    const ladder = createLadder()
    for (let i = 0; i < LADDER_WINDOW; i++) expect(observeFrame(ladder, slow, budget)).toBe(false)
    expect(ladder.level).toBe(0)
    expect(ladder.badWindows).toBe(1)
    const second = Array.from({ length: LADDER_WINDOW }, () => observeFrame(ladder, slow, budget))
    expect(second.some(Boolean)).toBe(true)
    expect(ladder.level).toBe(1)
    expect(ladder.badWindows).toBe(0)
  })

  it('lets a good window clear one bad window so a single spike never degrades', () => {
    const ladder = createLadder()
    for (let i = 0; i < LADDER_WINDOW; i++) observeFrame(ladder, slow, budget)
    expect(ladder.badWindows).toBe(1)
    for (let i = 0; i < LADDER_WINDOW; i++) observeFrame(ladder, budget, budget)
    expect(ladder.badWindows).toBe(0)
    expect(ladder.level).toBe(0)
  })

  it('never climbs back up on its own and stops at the last rung', () => {
    const ladder = createLadder()
    for (let i = 0; i < LADDER_WINDOW * LADDER_BAD_WINDOWS * 20; i++) observeFrame(ladder, slow, budget)
    expect(ladder.level).toBe(DEGRADE_MAX)
    for (let i = 0; i < LADDER_WINDOW * 10; i++) observeFrame(ladder, budget * 0.9, budget)
    expect(ladder.level).toBe(DEGRADE_MAX)
  })
})

describe('inkFor', () => {
  it('moves away from the surface: darker on light, lighter on dark', () => {
    const light = '#e9ebee'
    const dark = '#12151c'
    const lightInk = inkFor(light, false)
    const darkInk = inkFor(dark, true)
    const brightness = (hex: string): number => {
      const [r, g, b] = hexToRgb(hex)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    expect(brightness(lightInk)).toBeLessThan(brightness(light))
    expect(brightness(darkInk)).toBeGreaterThan(brightness(dark))
    expect(isDarkSurface(dark)).toBe(true)
    expect(isDarkSurface(light)).toBe(false)
  })

  it('calibrates each theme to its own delta, not one shared number', () => {
    // Round 1 (2026-11-08) replaced the 1%-Michelson target with "关闭 vs 开启
    // 一眼能分出来". Two independent findings from the live host: (1) the ink
    // step is not the binding constraint — at −0.31 the raw step was already
    // 89 luma, halved by the 0.5-alpha content surface; what kept the page
    // looking flat was the *glyph ink area* (see FLOW_LEVEL_FLOOR), and (2)
    // pushing the light step to −0.7 (179 luma, ink luma 55 on a 234.8 surface)
    // is what makes the surviving glyph strokes read as texture at 1:1.
    // The dark surface is perceptually different rather than merely darker:
    // DeVries-Rose puts its threshold contrast at sqrt(234.8/29.8) ≈ 2.8× the
    // light one, so +0.15 (a 38-luma step) stays the equal-strength point — do
    // not grow it to match the light magnitude, that is the "steals attention"
    // regression. These bounds pin both calibrations.
    const brightness = (hex: string): number => {
      const [r, g, b] = hexToRgb(hex)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const light = '#e9ebee'
    const dark = '#1c1e21'
    const lightStep = brightness(light) - brightness(inkFor(light, false))
    const darkStep = brightness(inkFor(dark, true)) - brightness(dark)
    expect(lightStep).toBeGreaterThanOrEqual(165)
    expect(lightStep).toBeLessThanOrEqual(195)
    expect(darkStep).toBeGreaterThanOrEqual(28)
    expect(darkStep).toBeLessThanOrEqual(48)
    // The dark step stays smaller in magnitude than the light one: equal
    // numbers would make the dark layer either invisible or glaring.
    expect(darkStep).toBeLessThan(lightStep / 1.5)
  })

  it('scales the ink step linearly and clamps the multiplier', () => {
    const brightness = (hex: string): number => {
      const [r, g, b] = hexToRgb(hex)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const surface = '#e9ebee'
    const base = brightness(surface) - brightness(inkFor(surface, false))
    const half = brightness(surface) - brightness(inkFor(surface, false, 0.5))
    const double = brightness(surface) - brightness(inkFor(surface, false, 2))
    // HSL lightness is not linear in luma once the ink nears black, so the
    // half step lands within 2% of base/2 rather than exactly on it.
    expect(Math.abs(half - base / 2)).toBeLessThan(base * 0.02)
    // 2× is clamped into the light delta's own headroom (L ≥ 0.04): the step
    // grows but can never exceed the surface's own luma.
    expect(double).toBeGreaterThan(base)
    expect(double).toBeLessThanOrEqual(brightness(surface))
    // Missing / non-finite / out-of-band multipliers fall back to the
    // calibrated value rather than producing an unreadable ink.
    expect(inkFor(surface, false, Number.NaN)).toBe(inkFor(surface, false))
    expect(inkFor(surface, false, 0)).toBe(inkFor(surface, false, INK_SCALE_MIN))
    expect(inkScaleFor(9)).toBe(INK_SCALE_MAX)
  })
})

describe('createAsciiBackdrop', () => {
  it('lays out a capped grid, honours the dpr cap, and reuses one atlas across frames', () => {
    const doc = fakeDoc()
    const win = fakeWin(3)
    const host = fakeHost()
    host.attrs.set('data-vx-bg-motion', 'animated')
    const backdrop = createAsciiBackdrop({ doc, win, host })

    backdrop.sync()
    const main = doc.created[0]
    // created[1] is the measuring probe, created[2] the glyph atlas.
    const atlas = doc.created[2]
    expect(main.width).toBe(2880)
    expect(main.height).toBe(1800)
    expect(backdrop.stats.frames).toBe(1)
    expect(backdrop.stats.atlasBuilds).toBe(1)
    expect(atlas.ctx.fillTextCount).toBe(9)
    expect(backdrop.stats.cols).toBeLessThanOrEqual(MAX_COLS)
    expect(backdrop.stats.rows).toBeLessThanOrEqual(MAX_ROWS)

    for (let i = 1; i <= 5; i++) tick(win, i * 80)
    expect(backdrop.stats.frames).toBe(6)
    // One atlas for all frames; only drawImage runs per tile.
    expect(backdrop.stats.atlasBuilds).toBe(1)
    expect(atlas.ctx.fillTextCount).toBe(9)
    expect(main.ctx.fillTextCount).toBe(0)
    expect(main.ctx.drawImageCount).toBeGreaterThan(0)
    // At most one blit per cell per frame; spaces are skipped, never extra work.
    expect(main.ctx.drawImageCount).toBeLessThanOrEqual(backdrop.stats.cols * backdrop.stats.rows * backdrop.stats.frames)

    backdrop.destroy()
  })

  it('reuses the canvas, grid and atlas across presets that share ramp, geometry and ink', () => {
    const doc = fakeDoc()
    const win = fakeWin(1)
    const host = fakeHost()
    host.attrs.set('data-vx-bg-motion', 'animated')
    const backdrop = createAsciiBackdrop({ doc, win, host })
    backdrop.sync()
    const main = doc.created[0]
    expect(backdrop.stats.frames).toBe(1)
    expect(backdrop.stats.atlasBuilds).toBe(1)

    // flow ↔ static use blocks at density 0.75 / 12 px and the same calibrated
    // ink scale, so their atlas key never moves: zero rebakes, one repaint each.
    backdrop.setPreset('static')
    expect(backdrop.stats.atlasBuilds).toBe(1)
    expect(backdrop.stats.frames).toBe(2)
    expect(win.rafCallbacks.size).toBe(0)

    backdrop.setPreset('flow')
    expect(backdrop.stats.atlasBuilds).toBe(1)
    expect(backdrop.stats.frames).toBe(3)
    expect(win.rafCallbacks.size).toBe(1)

    // ripple shares the geometry too, but its calibrated ink step is higher,
    // so the key moves once per crossing of that pair.
    backdrop.setPreset('ripple')
    expect(backdrop.stats.atlasBuilds).toBe(2)
    expect(backdrop.stats.frames).toBe(4)
    backdrop.setPreset('flow')
    expect(backdrop.stats.atlasBuilds).toBe(3)
    expect(backdrop.stats.frames).toBe(5)

    // One canvas stayed attached; the switch never recreated it.
    expect(host.children).toHaveLength(1)
    expect(doc.created[0]).toBe(main)
    expect(main.ctx.fillRectCount).toBe(5)
    backdrop.destroy()
  })

  it('rebakes exactly once when the strength multiplier moves the ink', () => {
    const doc = fakeDoc()
    const win = fakeWin(1)
    const host = fakeHost()
    host.attrs.set('data-vx-bg-motion', 'animated')
    const backdrop = createAsciiBackdrop({ doc, win, host })
    backdrop.sync()
    expect(backdrop.stats.atlasBuilds).toBe(1)
    expect(backdrop.stats.frames).toBe(1)

    const params = { density: 0.75, speed: 1, fps: 24, fontPx: 12, opacity: 1 }
    // "明显": one rebake, one immediate repaint.
    backdrop.setParams({ ...params, strength: 1.4 })
    expect(backdrop.stats.atlasBuilds).toBe(2)
    expect(backdrop.stats.frames).toBe(2)

    // Same multiplier again: params compare equal, so nothing rebakes or repaints.
    backdrop.setParams({ ...params, strength: 1.4 })
    expect(backdrop.stats.atlasBuilds).toBe(2)
    expect(backdrop.stats.frames).toBe(2)

    // "柔和": another single rebake.
    backdrop.setParams({ ...params, strength: 0.62 })
    expect(backdrop.stats.atlasBuilds).toBe(3)
    expect(backdrop.stats.frames).toBe(3)
    backdrop.destroy()
  })

  it('rebakes exactly once per ramp or cell-geometry change, then reuses it', () => {
    const doc = fakeDoc()
    const win = fakeWin(1)
    const host = fakeHost()
    host.attrs.set('data-vx-bg-motion', 'animated')
    const backdrop = createAsciiBackdrop({ doc, win, host })
    backdrop.sync()
    expect(backdrop.stats.atlasBuilds).toBe(1)
    expect(backdrop.stats.frames).toBe(1)

    // rain: 16-level classic ramp at density 1 (new grid, new ink scale) → one
    // rebake.
    backdrop.setPreset('rain')
    expect(backdrop.stats.atlasBuilds).toBe(2)
    expect(backdrop.stats.frames).toBe(2)

    // ocean: dots ramp at density 0.65, 12 px, own ink step → one more rebake.
    backdrop.setPreset('ocean')
    expect(backdrop.stats.atlasBuilds).toBe(3)

    // starfield: still the dots ramp, but 14 px cells and its own ink step, so
    // its atlas key differs from ocean's and it rebakes once too.
    backdrop.setPreset('starfield')
    expect(backdrop.stats.atlasBuilds).toBe(4)
    expect(backdrop.stats.frames).toBe(4)

    // ripple returns to blocks at density 0.75 with its own ink step → one rebake.
    backdrop.setPreset('ripple')
    expect(backdrop.stats.atlasBuilds).toBe(5)
    backdrop.destroy()
  })

  it('grows the cell instead of truncating the grid past the hard caps', () => {
    const doc = fakeDoc()
    const win = fakeWin(1)
    const host = fakeHost(12000, 12000)
    host.attrs.set('data-vx-bg-motion', 'animated')
    const backdrop = createAsciiBackdrop({ doc, win, host })
    backdrop.sync()
    expect(backdrop.stats.cols).toBeLessThanOrEqual(MAX_COLS)
    expect(backdrop.stats.rows).toBeLessThanOrEqual(MAX_ROWS)
    // The tall cell aspect makes rows the binding constraint; the cell grew
    // uniformly on both axes instead of the grid being truncated.
    expect(backdrop.stats.rows).toBe(MAX_ROWS)
    expect(backdrop.stats.cols).toBeLessThan(MAX_COLS)
    backdrop.destroy()
  })

  it('draws exactly one frame and no rAF when the preset is static', () => {
    const doc = fakeDoc()
    const win = fakeWin(1)
    const host = fakeHost()
    host.attrs.set('data-vx-bg-motion', 'animated')
    const backdrop = createAsciiBackdrop({ doc, win, host, preset: 'static' })
    backdrop.sync()
    expect(backdrop.stats.frames).toBe(1)
    expect(win.rafCallbacks.size).toBe(0)
    backdrop.destroy()
  })

  it('draws a still frame under reduced motion instead of leaving a blank canvas', () => {
    const doc = fakeDoc()
    const win = fakeWin(1, true)
    const host = fakeHost()
    host.attrs.set('data-vx-bg-motion', 'static')
    const backdrop = createAsciiBackdrop({ doc, win, host })
    backdrop.sync()
    expect(backdrop.stats.frames).toBe(1)
    expect(win.rafCallbacks.size).toBe(0)
    backdrop.destroy()
  })

  it('stops the loop while hidden and resumes on return', () => {
    const doc = fakeDoc()
    const win = fakeWin(1)
    const host = fakeHost()
    host.attrs.set('data-vx-bg-motion', 'animated')
    const backdrop = createAsciiBackdrop({ doc, win, host })
    backdrop.sync()
    expect(win.rafCallbacks.size).toBe(1)

    doc.hidden = true
    fire(doc, 'visibilitychange')
    expect(win.rafCallbacks.size).toBe(0)
    expect(win.rafCanceled.length).toBe(1)
    const framesWhileHidden = backdrop.stats.frames

    doc.hidden = false
    fire(doc, 'visibilitychange')
    expect(win.rafCallbacks.size).toBe(1)
    expect(backdrop.stats.frames).toBe(framesWhileHidden + 1)
    backdrop.destroy()
  })

  it('paints one frame on a theme flip even in static mode', () => {
    const doc = fakeDoc()
    const win = fakeWin(1)
    const host = fakeHost()
    host.attrs.set('data-vx-bg-motion', 'static')
    const backdrop = createAsciiBackdrop({ doc, win, host })
    backdrop.sync()
    expect(backdrop.stats.atlasBuilds).toBe(1)

    host.props.set('--vx-bg-tint', '#12151c')
    backdrop.sync()
    expect(backdrop.stats.atlasBuilds).toBe(2)
    expect(backdrop.stats.frames).toBe(2)
    expect(win.rafCallbacks.size).toBe(0)
    backdrop.destroy()
  })

  it('tears down canvas, rAF, listeners, observer and atlas', () => {
    const doc = fakeDoc()
    const win = fakeWin(1)
    const host = fakeHost()
    host.attrs.set('data-vx-bg-motion', 'animated')
    const backdrop = createAsciiBackdrop({ doc, win, host })
    backdrop.sync()
    expect(win.rafCallbacks.size).toBe(1)
    expect(win.observers).toHaveLength(1)
    const main = doc.created[0]

    backdrop.destroy()
    expect(backdrop.stats.alive).toBe(false)
    expect(win.rafCallbacks.size).toBe(0)
    expect(win.rafCanceled.length).toBe(1)
    expect(win.observers[0].disconnected).toBe(true)
    expect(doc.listeners.get('visibilitychange') ?? []).toHaveLength(0)
    for (const query of win.queries) expect(query.listeners).toHaveLength(0)
    expect(main.width).toBe(0)
    expect(main.height).toBe(0)
    expect(main.removed).toBe(true)
    // Exactly the one frame painted before teardown; destroy paints none.
    expect(main.ctx.fillRectCount).toBe(1)
    // Idempotent: a second destroy is a no-op.
    expect(() => backdrop.destroy()).not.toThrow()
    expect(win.rafCanceled.length).toBe(1)
    expect(ASCII_PRESETS.flow.fps).toBeGreaterThan(0)
  })
})
