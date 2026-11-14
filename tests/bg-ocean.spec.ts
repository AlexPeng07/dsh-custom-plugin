/**
 * ocean 2.0: deterministic water, pointer wakes, click rings, fish overlay and
 * the startle-then-regroup behaviour. The piece is a pure function of time plus
 * an injected input, so every assertion here runs without a DOM.
 * @module @alexpeng/dsh-custom-plugin/tests/bg-ocean
 */

import { describe, expect, it } from 'vitest'
import { createOceanPiece } from '../src/client/bg-ocean.ts'
import { CHARSET, createOceanPiece as reexported } from '../src/client/bg-ascii.ts'
import type { AsciiInput } from '../src/client/bg-field.ts'

const COLS = 60
const ROWS = 24
const LEVELS = CHARSET.dots.length

function render(
  piece: ReturnType<typeof createOceanPiece>,
  t: number,
  input?: AsciiInput,
): { levels: Uint8Array; emphasis: Uint8Array; overlay: Uint8Array } {
  const levels = new Uint8Array(COLS * ROWS)
  const emphasis = new Uint8Array(COLS * ROWS)
  const overlay = new Uint8Array(COLS * ROWS)
  piece(t, levels, COLS, ROWS, input, emphasis, overlay)
  return { levels, emphasis, overlay }
}

function count(buffer: Uint8Array): number {
  let n = 0
  for (const value of buffer) if (value !== 0) n++
  return n
}

function inputAt(x: number, y: number, overrides: Partial<AsciiInput> = {}): AsciiInput {
  return {
    x,
    y,
    active: true,
    down: false,
    vx: 0,
    vy: 0,
    pulseId: 0,
    pulseX: 0,
    pulseY: 0,
    ...overrides,
  }
}

describe('createOceanPiece', () => {
  it('is deterministic for the same seed and time', () => {
    const a = createOceanPiece(LEVELS, true)
    const b = createOceanPiece(LEVELS, true)
    const fa = render(a, 0.5)
    const fb = render(b, 0.5)
    expect(Array.from(fa.levels)).toEqual(Array.from(fb.levels))
    expect(Array.from(fa.overlay)).toEqual(Array.from(fb.overlay))
  })

  it('keeps every level inside the dots ramp', () => {
    const piece = createOceanPiece(LEVELS, true)
    for (const t of [0, 0.6, 12.5]) {
      const frame = render(piece, t, inputAt(20, 10))
      for (const value of frame.levels) expect(value).toBeLessThan(LEVELS)
    }
  })

  it('draws a small-fish overlay and marks fish as interaction cells', () => {
    const piece = createOceanPiece(LEVELS, true)
    const frame = render(piece, 0.5)
    // Eighteen two-cell fish plus the multi-cell koi silhouettes.
    expect(count(frame.overlay)).toBeGreaterThanOrEqual(18)
    expect(count(frame.emphasis)).toBeGreaterThanOrEqual(20)
  })

  it('injects a wake when the pointer drags across the surface', () => {
    const still = createOceanPiece(LEVELS, true)
    const dragged = createOceanPiece(LEVELS, true)
    render(still, 0.5, inputAt(20, 10))
    render(dragged, 0.5, inputAt(20, 10))
    const a = render(still, 0.62, inputAt(20, 10))
    const b = render(dragged, 0.62, inputAt(28, 10, { vx: 40 }))
    expect(Array.from(a.levels)).not.toEqual(Array.from(b.levels))
    // The drag marks ripple cells; the still pointer leaves only the fish.
    expect(count(b.emphasis)).toBeGreaterThan(count(a.emphasis))
  })

  it('turns a click into a ring and startles the school away from it', () => {
    const calm = createOceanPiece(LEVELS, true)
    const startled = createOceanPiece(LEVELS, true)
    // Warm both pieces to the same state without a press.
    render(calm, 0.5, inputAt(30, 12))
    render(startled, 0.5, inputAt(30, 12))
    const calm0 = render(calm, 0.6, inputAt(30, 12))
    const startled0 = render(startled, 0.6, inputAt(30, 12, { pulseId: 1, pulseX: 30, pulseY: 12 }))
    // The click itself already changes the frame (ring + fear).
    expect(Array.from(calm0.levels)).not.toEqual(Array.from(startled0.levels))
    for (let t = 0.7; t <= 1.1; t += 0.1) {
      render(calm, t)
      render(startled, t)
    }
    const calmEnd = render(calm, 1.2)
    const startledEnd = render(startled, 1.2)
    const meanDistance = (frame: { overlay: Uint8Array }): number => {
      let sum = 0
      let n = 0
      for (let i = 0; i < frame.overlay.length; i++) {
        // 1–6 are the small-fish direction marks; koi body slots are 8+.
        if (frame.overlay[i] < 1 || frame.overlay[i] > 6) continue
        const x = i % COLS
        const y = Math.floor(i / COLS)
        sum += Math.hypot(x - 30, y - 12)
        n++
      }
      return n === 0 ? 0 : sum / n
    }
    expect(meanDistance(startledEnd)).toBeGreaterThan(meanDistance(calmEnd))
  })

  it('keeps the public re-export pointing at the same factory', () => {
    expect(reexported).toBe(createOceanPiece)
  })
})
