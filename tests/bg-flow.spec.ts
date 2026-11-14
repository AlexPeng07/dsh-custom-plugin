/**
 * flow interaction: the pointer stirs a wake through the noise field, a click
 * sends a ring, and the non-interactive static variant stays allocation-free
 * and identical to the old deterministic frame.
 * @module @alexpeng/dsh-custom-plugin/tests/bg-flow
 */

import { describe, expect, it } from 'vitest'
import { createFlowPiece } from '../src/client/bg-ascii.ts'
import { CHARSET } from '../src/client/bg-ascii.ts'
import type { AsciiInput } from '../src/client/bg-field.ts'

const COLS = 80
const ROWS = 30
const LEVELS = CHARSET.blocks.length

function render(
  piece: ReturnType<typeof createFlowPiece>,
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

describe('createFlowPiece interaction', () => {
  it('is deterministic without input', () => {
    const a = createFlowPiece(LEVELS, true)
    const b = createFlowPiece(LEVELS, true)
    expect(Array.from(render(a, 0.5).levels)).toEqual(Array.from(render(b, 0.5).levels))
  })

  it('stirs the field and marks emphasis when the pointer drags', () => {
    const still = createFlowPiece(LEVELS, true)
    const dragged = createFlowPiece(LEVELS, true)
    render(still, 0.5, inputAt(20, 10))
    render(dragged, 0.5, inputAt(20, 10))
    const calm = render(still, 0.6, inputAt(20, 10))
    const stirred = render(dragged, 0.7, inputAt(40, 12, { vx: 30 }))
    expect(count(calm.emphasis)).toBe(0)
    expect(count(stirred.emphasis)).toBeGreaterThan(0)
    expect(Array.from(calm.levels)).not.toEqual(Array.from(stirred.levels))
  })

  it('turns a click into a ring and marks it for the calm zone', () => {
    const piece = createFlowPiece(LEVELS, true)
    render(piece, 0.5, inputAt(40, 15))
    const before = render(piece, 0.6, inputAt(40, 15))
    const after = render(piece, 0.6, inputAt(40, 15, { pulseId: 1, pulseX: 40, pulseY: 15 }))
    expect(count(before.emphasis)).toBe(0)
    expect(count(after.emphasis)).toBeGreaterThan(0)
    expect(Array.from(before.levels)).not.toEqual(Array.from(after.levels))
  })

  it('keeps every level inside the blocks ramp', () => {
    const piece = createFlowPiece(LEVELS, true)
    for (const t of [0, 0.7, 12.5]) {
      const frame = render(piece, t, inputAt(30, 12))
      for (const value of frame.levels) expect(value).toBeLessThan(LEVELS)
    }
  })

  it('stirs a curl instead of only adding ink', () => {
    const piece = createFlowPiece(LEVELS, true)
    render(piece, 0.5, inputAt(20, 10))
    const dragged = render(piece, 0.6, inputAt(40, 10, { vx: 80 }))
    const fresh = render(createFlowPiece(LEVELS, true), 0.6)
    let lighter = 0
    let darker = 0
    for (let i = 0; i < dragged.levels.length; i++) {
      if (dragged.levels[i] < fresh.levels[i]) lighter++
      else if (dragged.levels[i] > fresh.levels[i]) darker++
    }
    // A dipole has a crest and a trough: one side of the path thickens, the
    // other thins. A plain positive splat would only ever darken cells.
    expect(darker).toBeGreaterThan(0)
    expect(lighter).toBeGreaterThan(0)
  })

  it('grows the splat with pointer speed', () => {
    const slow = createFlowPiece(LEVELS, true)
    const fast = createFlowPiece(LEVELS, true)
    render(slow, 0.5, inputAt(20, 10))
    render(fast, 0.5, inputAt(20, 10))
    const a = render(slow, 0.6, inputAt(40, 10, { vx: 8 }))
    const b = render(fast, 0.6, inputAt(40, 10, { vx: 160 }))
    const fresh = render(createFlowPiece(LEVELS, true), 0.6)
    let slowChanged = 0
    let fastChanged = 0
    for (let i = 0; i < a.levels.length; i++) {
      if (a.levels[i] !== fresh.levels[i]) slowChanged++
      if (b.levels[i] !== fresh.levels[i]) fastChanged++
    }
    expect(fastChanged).toBeGreaterThan(slowChanged)
  })

  it('accumulates a local fog concentration while the pointer rests', () => {
    const piece = createFlowPiece(LEVELS, true)
    let t = 0.5
    for (let n = 0; n < 20; n++, t += 0.06) render(piece, t, inputAt(40, 15))
    const dwelt = render(piece, t, inputAt(40, 15))
    const fresh = render(createFlowPiece(LEVELS, true), t)
    expect(count(dwelt.emphasis)).toBeGreaterThan(0)
    expect(sum(dwelt.levels)).toBeGreaterThan(sum(fresh.levels))
  })

  it('settles back to the baseline after the pointer leaves', () => {
    const piece = createFlowPiece(LEVELS, true)
    let t = 0.5
    for (let n = 0; n < 20; n++, t += 0.06) render(piece, t, inputAt(40, 15))
    t += 5
    render(piece, t)
    t += 0.1
    const settled = render(piece, t)
    const fresh = render(createFlowPiece(LEVELS, true), t)
    expect(Array.from(settled.levels)).toEqual(Array.from(fresh.levels))
    expect(count(settled.emphasis)).toBe(0)
  })

  it('leaves the static variant completely uninfluenced by input', () => {
    const still = createFlowPiece(LEVELS, true, false)
    const withInput = createFlowPiece(LEVELS, true, false)
    const a = render(still, 0)
    const b = render(withInput, 0, inputAt(40, 15, { pulseId: 1, pulseX: 40, pulseY: 15 }))
    expect(Array.from(a.levels)).toEqual(Array.from(b.levels))
    expect(count(b.emphasis)).toBe(0)
  })
})
