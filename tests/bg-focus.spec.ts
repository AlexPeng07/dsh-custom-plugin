import { describe, expect, it } from 'vitest'
import { buildFocusCaps, FOCUS_FEATHER_PX, FOCUS_FLOOR, focusWeight, normalizeFocusRect, sameFocusRect } from '../src/client/bg-focus.ts'

describe('calm-zone calibration', () => {
  it('keeps the shipped floor and feather inside the measured band', () => {
    // Both values were picked from live A/B shots (2026-11-08): a floor below
    // 0.4 read as a clean page at 1:1 and one above 0.5 started competing with
    // body copy; a feather under 120 left a visible seam at the column edge and
    // one over 180 pushed the full-strength rim out of the 1280-wide margins.
    // Pin the band, not the exact numbers, so a deliberate retune still passes
    // while a drive-by "make it fainter" edit fails.
    expect(FOCUS_FLOOR).toBeGreaterThanOrEqual(0.4)
    expect(FOCUS_FLOOR).toBeLessThanOrEqual(0.5)
    expect(FOCUS_FEATHER_PX).toBeGreaterThanOrEqual(120)
    expect(FOCUS_FEATHER_PX).toBeLessThanOrEqual(180)
  })
})

describe('normalizeFocusRect', () => {
  it('rejects absent and non-finite geometry', () => {
    expect(normalizeFocusRect(null)).toBeNull()
    expect(normalizeFocusRect(undefined)).toBeNull()
    expect(normalizeFocusRect({ x: 0, y: 0, w: 0, h: 100 })).toBeNull()
    expect(normalizeFocusRect({ x: 0, y: 0, w: 100, h: -1 })).toBeNull()
    expect(normalizeFocusRect({ x: Number.NaN, y: 0, w: 100, h: 100 })).toBeNull()
  })

  it('passes a usable rect through unchanged', () => {
    const rect = { x: 420, y: 116, w: 708, h: 578 }
    expect(normalizeFocusRect(rect)).toEqual(rect)
  })
})

describe('sameFocusRect', () => {
  it('compares by geometry, treating two absences as equal', () => {
    const rect = { x: 1, y: 2, w: 3, h: 4 }
    expect(sameFocusRect(rect, { ...rect })).toBe(true)
    expect(sameFocusRect(null, null)).toBe(true)
    expect(sameFocusRect(rect, null)).toBe(false)
    expect(sameFocusRect(rect, { ...rect, w: 5 })).toBe(false)
  })
})

describe('focusWeight', () => {
  const rect = { x: 400, y: 100, w: 700, h: 500 }

  it('holds the floor inside the rect and reaches full strength outside the feather', () => {
    expect(focusWeight(700, 300, rect, 116, FOCUS_FLOOR)).toBe(FOCUS_FLOOR)
    expect(focusWeight(rect.x, rect.y, rect, 116, FOCUS_FLOOR)).toBe(FOCUS_FLOOR)
    expect(focusWeight(rect.x - 116, 300, rect, 116, FOCUS_FLOOR)).toBe(1)
    expect(focusWeight(1100 + 200, 300, rect, 116, FOCUS_FLOOR)).toBe(1)
  })

  it('ramps monotonically across the feather band', () => {
    const samples = [116, 90, 60, 30, 10, 0].map((d) => focusWeight(400 - d, 300, rect, 116, FOCUS_FLOOR))
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeLessThanOrEqual(samples[i - 1] + 1e-9)
    expect(samples[samples.length - 1]).toBe(FOCUS_FLOOR)
  })

  it('measures distance from the corner diagonally, not per-axis', () => {
    // 58 px out on both axes is hypot(58, 58) ≈ 82 px away — a diagonal
    // distance, not the 58 px a per-axis min() would give.
    const w = focusWeight(rect.x - 58, rect.y - 58, rect, 116, FOCUS_FLOOR)
    const t = Math.hypot(58, 58) / 116
    const eased = t * t * (3 - 2 * t)
    expect(w).toBeCloseTo(FOCUS_FLOOR + (1 - FOCUS_FLOOR) * eased, 6)
  })

  it('treats a zero feather as a hard edge', () => {
    expect(focusWeight(700, 300, rect, 0, FOCUS_FLOOR)).toBe(FOCUS_FLOOR)
    expect(focusWeight(399, 300, rect, 0, FOCUS_FLOOR)).toBe(1)
  })
})

describe('buildFocusCaps', () => {
  const rect = { x: 400, y: 100, w: 700, h: 500 }

  it('caps cells inside the column and leaves outside cells uncapped', () => {
    const cols = 80
    const rows = 40
    const cellW = 20
    const cellH = 20
    const lastLevel = 8
    const caps = buildFocusCaps(cols, rows, cellW, cellH, rect, 116, FOCUS_FLOOR, lastLevel)
    expect(caps).toHaveLength(cols * rows)
    // Centre cell: far inside the rect, so its cap is the floor (plus dither).
    const cx = Math.floor((rect.x + rect.w / 2) / cellW)
    const cy = Math.floor((rect.y + rect.h / 2) / cellH)
    expect(caps[cy * cols + cx]).toBeLessThanOrEqual(Math.round(lastLevel * FOCUS_FLOOR) + 1)
    // Far left edge cell: outside the feather, so it may use the full ramp.
    expect(caps[0]).toBe(lastLevel)
    // Every cap stays inside the ramp.
    for (const cap of caps) {
      expect(cap).toBeGreaterThanOrEqual(0)
      expect(cap).toBeLessThanOrEqual(lastLevel)
    }
  })

  it('reuses the caller buffer instead of allocating per rebuild', () => {
    const out = new Uint8Array(4 * 2)
    const first = buildFocusCaps(4, 2, 20, 20, rect, 116, FOCUS_FLOOR, 8, out)
    expect(first).toBe(out)
    const second = buildFocusCaps(4, 2, 20, 20, { ...rect, x: 0 }, 116, FOCUS_FLOOR, 8, out)
    expect(second).toBe(out)
    // A differently sized grid cannot reuse the old buffer.
    expect(buildFocusCaps(5, 2, 20, 20, rect, 116, FOCUS_FLOOR, 8, out)).not.toBe(out)
  })
})
