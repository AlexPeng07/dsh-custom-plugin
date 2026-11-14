/**
 * rain interaction: a moving pointer bends whole columns like wind, a resting
 * pointer carves a repulsion tunnel, a press parts the curtain and flashes the
 * heads, and everything settles back to the untouched frame afterwards.
 * @module @alexpeng/dsh-custom-plugin/tests/bg-rain
 */

import { describe, expect, it } from 'vitest'
import { createRainPiece, CHARSET } from '../src/client/bg-ascii.ts'
import type { AsciiInput } from '../src/client/bg-field.ts'

const COLS = 100
const ROWS = 40
const LEVELS = CHARSET.classic.length

function render(
  piece: ReturnType<typeof createRainPiece>,
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

/** Drive a piece through the same frame times, one drag speed. */
function drive(vx: number): Uint8Array {
  const piece = createRainPiece(LEVELS, false)
  for (let n = 0; n <= 8; n++) render(piece, 1.2 + n * 0.05, inputAt(60, 12, { vx }))
  return render(piece, 1.65, inputAt(60, 12, { vx })).levels
}

describe('createRainPiece interaction', () => {
  it('stays bit-identical to the untouched frame without input', () => {
    const a = createRainPiece(LEVELS, false)
    const b = createRainPiece(LEVELS, false)
    expect(Array.from(render(a, 0.8).levels)).toEqual(Array.from(render(b, 0.8).levels))
  })

  it('carves a repulsion tunnel around a resting pointer', () => {
    const piece = createRainPiece(LEVELS, false)
    let t = 1.8
    for (let n = 0; n < 8; n++, t += 0.05) render(piece, t, inputAt(50, 12))
    const tunnel = render(piece, t, inputAt(50, 12))
    const base = render(createRainPiece(LEVELS, false), t)
    let dimmed = 0
    for (let row = 0; row < ROWS; row++) {
      for (let col = 44; col <= 56; col++) {
        const i = row * COLS + col
        if (tunnel.levels[i] < base.levels[i]) dimmed++
      }
    }
    expect(dimmed).toBeGreaterThan(0)
    // The mirror shadow of the tunnel is lateral only: no column outside the
    // pushed band may move, and the repulsion is not marked for the calm zone.
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (col >= 38 && col <= 62) continue
        expect(tunnel.levels[row * COLS + col]).toBe(base.levels[row * COLS + col])
      }
    }
    expect(count(tunnel.emphasis)).toBe(0)
  })

  it('bends columns under a moving pointer and leaves distant columns alone', () => {
    const still = drive(0)
    const blown = drive(60)
    expect(Array.from(still)).not.toEqual(Array.from(blown))
    // The wind radius is 16 columns around x=60; outside 40..80 nothing moves.
    let outside = 0
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (col >= 40 && col <= 80) continue
        if (still[row * COLS + col] !== blown[row * COLS + col]) outside++
      }
    }
    expect(outside).toBe(0)
  })

  it('parts the curtain on a press and marks it for the calm zone', () => {
    const piece = createRainPiece(LEVELS, false)
    render(piece, 1.2, inputAt(50, 12))
    const before = render(piece, 1.25, inputAt(50, 12))
    const after = render(piece, 1.25, inputAt(50, 12, { pulseId: 1, pulseX: 50, pulseY: 12 }))
    expect(count(before.emphasis)).toBe(0)
    expect(count(after.emphasis)).toBeGreaterThan(0)
    expect(Array.from(before.levels)).not.toEqual(Array.from(after.levels))
  })

  it('settles back to the untouched frame after the pointer stops', () => {
    const piece = createRainPiece(LEVELS, false)
    render(piece, 1.2, inputAt(50, 12))
    render(piece, 1.25, inputAt(50, 12, { pulseId: 1, pulseX: 50, pulseY: 12 }))
    let t = 1.3
    // The gust eases back at 0.94 per frame, so it needs ~2 more seconds than
    // the click push before the frame is bit-identical again.
    for (let n = 0; n < 180; n++, t += 0.05) render(piece, t, inputAt(50, 12, { active: false }))
    const settled = render(piece, t, inputAt(50, 12, { active: false }))
    const fresh = render(createRainPiece(LEVELS, false), t, inputAt(50, 12, { active: false }))
    expect(Array.from(settled.levels)).toEqual(Array.from(fresh.levels))
    expect(count(settled.emphasis)).toBe(0)
  })

  it('keeps every level inside the classic ramp', () => {
    const piece = createRainPiece(LEVELS, false)
    for (const t of [0, 0.9, 15.5]) {
      const frame = render(piece, t, inputAt(30, 20, { vx: 90 }))
      for (const value of frame.levels) expect(value).toBeLessThan(LEVELS)
    }
  })
})
