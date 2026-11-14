/**
 * starfield interaction: a press lights a small burst of live stars, a drag
 * drops a trail of them, and each spark expires about a second later without
 * changing the sparse baseline.
 * @module @alexpeng/dsh-custom-plugin/tests/bg-starfield
 */

import { describe, expect, it } from 'vitest'
import { createStarfieldPiece, CHARSET } from '../src/client/bg-ascii.ts'
import type { AsciiInput } from '../src/client/bg-field.ts'

const COLS = 90
const ROWS = 34
const LEVELS = CHARSET.dots.length

function render(
  piece: ReturnType<typeof createStarfieldPiece>,
  t: number,
  input?: AsciiInput,
): { levels: Uint8Array; emphasis: Uint8Array } {
  const levels = new Uint8Array(COLS * ROWS)
  const emphasis = new Uint8Array(COLS * ROWS)
  piece(t, levels, COLS, ROWS, input, emphasis)
  return { levels, emphasis }
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

function count(buffer: Uint8Array): number {
  let n = 0
  for (const value of buffer) if (value !== 0) n++
  return n
}

function sum(buffer: Uint8Array): number {
  let n = 0
  for (const value of buffer) n += value
  return n
}

describe('createStarfieldPiece interaction', () => {
  it('is deterministic without input', () => {
    const a = createStarfieldPiece(LEVELS, false)
    const b = createStarfieldPiece(LEVELS, false)
    expect(Array.from(render(a, 4.2).levels)).toEqual(Array.from(render(b, 4.2).levels))
  })

  it('lights a burst on a press and marks it for the calm zone', () => {
    const piece = createStarfieldPiece(LEVELS, false)
    render(piece, 1, inputAt(44, 16))
    const before = render(piece, 1.05, inputAt(44, 16))
    const after = render(piece, 1.05, inputAt(44, 16, { pulseId: 1, pulseX: 44, pulseY: 16 }))
    // Dwelling already marks its own cells; the burst adds many more.
    expect(count(after.emphasis)).toBeGreaterThan(count(before.emphasis))
    expect(Array.from(before.levels)).not.toEqual(Array.from(after.levels))
  })

  it('drops a trail of sparks while dragging', () => {
    const piece = createStarfieldPiece(LEVELS, false)
    let t = 1
    for (let n = 0; n < 8; n++, t += 0.1) {
      render(piece, t, inputAt(10 + n * 6, 16, { vx: 60 }))
    }
    const during = render(piece, t, inputAt(58, 16))
    expect(count(during.emphasis)).toBeGreaterThan(0)
    // The trail keeps glowing after the pointer stops.
    const after = render(piece, t + 0.3)
    expect(count(after.emphasis)).toBeGreaterThan(0)
  })

  it('returns to the sparse baseline once every spark expires', () => {
    const piece = createStarfieldPiece(LEVELS, false)
    render(piece, 1, inputAt(44, 16))
    render(piece, 1.05, inputAt(44, 16, { pulseId: 1, pulseX: 44, pulseY: 16 }))
    const t = 3
    const settled = render(piece, t)
    const fresh = render(createStarfieldPiece(LEVELS, false), t)
    expect(Array.from(settled.levels)).toEqual(Array.from(fresh.levels))
    expect(count(settled.emphasis)).toBe(0)
  })

  it('brightens and clusters the stars where the pointer dwells', () => {
    const piece = createStarfieldPiece(LEVELS, false)
    let t = 1
    for (let n = 0; n < 24; n++, t += 0.05) render(piece, t, inputAt(45, 17))
    const dwell = render(piece, t, inputAt(45, 17))
    const fresh = render(createStarfieldPiece(LEVELS, false), t)
    // The dwell adds a local cluster and lights it through the calm zone.
    expect(count(dwell.emphasis)).toBeGreaterThan(0)
    expect(sum(dwell.levels)).toBeGreaterThan(sum(fresh.levels))
  })

  it('returns to the exact baseline after the pointer leaves', () => {
    const piece = createStarfieldPiece(LEVELS, false)
    let t = 1
    for (let n = 0; n < 24; n++, t += 0.05) render(piece, t, inputAt(45, 17))
    // Two more seconds without input: the heat is under the floor and the
    // parallax easing has returned to the centre, so the frame must match a
    // piece that never saw a pointer at all.
    for (let n = 0; n < 40; n++, t += 0.05) render(piece, t)
    const settled = render(piece, t)
    const fresh = render(createStarfieldPiece(LEVELS, false), t)
    expect(Array.from(settled.levels)).toEqual(Array.from(fresh.levels))
    expect(count(settled.emphasis)).toBe(0)
  })

  it('keeps a long drag inside the spark cap and the ramp', () => {
    const piece = createStarfieldPiece(LEVELS, false)
    let t = 1
    for (let n = 0; n < 100; n++, t += 0.08) {
      const frame = render(piece, t, inputAt(5 + (n % 80), 5 + (n % 24), { vx: 80 }))
      expect(Math.max(...frame.levels)).toBeLessThan(LEVELS)
    }
  })
})
