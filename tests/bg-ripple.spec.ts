/**
 * ripple interaction: a press drops a strong ring where it lands, a drag
 * leaves a trail of weak rings, and the field returns to the untouched
 * baseline once every live source has expired.
 * @module @alexpeng/dsh-custom-plugin/tests/bg-ripple
 */

import { describe, expect, it } from 'vitest'
import { createRipplePiece, CHARSET } from '../src/client/bg-ascii.ts'
import type { AsciiInput } from '../src/client/bg-field.ts'

const COLS = 90
const ROWS = 34
const LEVELS = CHARSET.blocks.length

function render(
  piece: ReturnType<typeof createRipplePiece>,
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

function diff(a: Uint8Array, b: Uint8Array): number {
  let n = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
  return n
}

describe('createRipplePiece interaction', () => {
  it('is deterministic without input', () => {
    const a = createRipplePiece(LEVELS, false)
    const b = createRipplePiece(LEVELS, false)
    expect(Array.from(render(a, 2.5).levels)).toEqual(Array.from(render(b, 2.5).levels))
  })

  it('drops a strong ring on a press and marks it for the calm zone', () => {
    const piece = createRipplePiece(LEVELS, false)
    render(piece, 1, inputAt(40, 12))
    const before = render(piece, 1.05, inputAt(40, 12))
    const after = render(piece, 1.05, inputAt(40, 12, { pulseId: 1, pulseX: 40, pulseY: 12 }))
    expect(count(before.emphasis)).toBe(0)
    expect(count(after.emphasis)).toBeGreaterThan(0)
    expect(Array.from(before.levels)).not.toEqual(Array.from(after.levels))
  })

  it('throws a harder ring when the click carries momentum', () => {
    const base = render(createRipplePiece(LEVELS, false), 1.05)
    const slowPiece = createRipplePiece(LEVELS, false)
    render(slowPiece, 1, inputAt(40, 12))
    const slow = render(slowPiece, 1.05, inputAt(40, 12, { pulseId: 1, pulseX: 40, pulseY: 12 }))
    const fastPiece = createRipplePiece(LEVELS, false)
    render(fastPiece, 1, inputAt(40, 12))
    const fast = render(fastPiece, 1.05, inputAt(40, 12, { pulseId: 1, pulseX: 40, pulseY: 12, vx: 220 }))
    expect(diff(base.levels, fast.levels)).toBeGreaterThan(diff(base.levels, slow.levels))
  })

  it('leaves a trail of rings while dragging and keeps them after the pointer stops', () => {
    const piece = createRipplePiece(LEVELS, false)
    let t = 1
    // A drag at five cells per frame: one drop every 0.22 s, five cells apart.
    for (let n = 0; n < 12; n++, t += 0.1) {
      render(piece, t, inputAt(10 + n * 5, 12, { vx: 50 }))
    }
    const during = render(piece, t, inputAt(70, 12, { vx: 0 }))
    expect(count(during.emphasis)).toBeGreaterThan(0)
    // Dropping the input entirely must not erase the rings already in flight.
    const after = render(piece, t + 0.2)
    expect(count(after.emphasis)).toBeGreaterThan(0)
  })

  it('settles back to the baseline once every live source expires', () => {
    const piece = createRipplePiece(LEVELS, false)
    render(piece, 1, inputAt(40, 12))
    render(piece, 1.05, inputAt(40, 12, { pulseId: 1, pulseX: 40, pulseY: 12 }))
    // Four seconds of life plus a margin, with the pointer gone.
    const t = 5.5
    const settled = render(piece, t)
    const fresh = render(createRipplePiece(LEVELS, false), t)
    expect(Array.from(settled.levels)).toEqual(Array.from(fresh.levels))
    expect(count(settled.emphasis)).toBe(0)
  })

  it('keeps a long drag inside the source cap and the ramp', () => {
    const piece = createRipplePiece(LEVELS, false)
    let t = 1
    for (let n = 0; n < 120; n++, t += 0.08) {
      const frame = render(piece, t, inputAt(5 + (n % 80), 5 + (n % 24), { vx: 80 }))
      expect(Math.max(...frame.levels)).toBeLessThan(LEVELS)
    }
    expect(t).toBeGreaterThan(10)
  })
})
