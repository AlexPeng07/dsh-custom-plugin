/**
 * Geometry tests for anchored popovers.
 * @module @alexpeng/dsh-custom-plugin/tests/anchor
 */

import { describe, expect, it } from 'vitest'
import { anchorFrame, type AnchorRect } from '../src/client/ui/anchor.ts'

function rect(left: number, top: number, width: number, height: number): AnchorRect {
  return { left, top, width, height, right: left + width, bottom: top + height }
}

describe('anchorFrame', () => {
  it('opens below the trigger when there is room', () => {
    const frame = anchorFrame(rect(100, 40, 80, 28), { width: 380, height: 400 }, { width: 1280, height: 822 })
    expect(frame.placement).toBe('bottom')
    expect(frame.left).toBe(100)
    expect(frame.top).toBe(76)
    expect(frame.maxHeight).toBe(822 - 68 - 8 - 8)
    expect(frame.origin).toBe('left top')
  })

  it('flips above when the bottom side cannot fit the surface', () => {
    const frame = anchorFrame(rect(100, 700, 80, 28), { width: 380, height: 400 }, { width: 1280, height: 822 })
    expect(frame.placement).toBe('top')
    expect(frame.top).toBe(700 - 8 - 400)
    expect(frame.origin).toBe('left bottom')
  })

  it('keeps the roomier side and caps height when neither side fits', () => {
    const frame = anchorFrame(rect(100, 300, 80, 28), { width: 380, height: 600 }, { width: 1280, height: 800 })
    // below = 800 - 328 - 16 = 456; above = 300 - 16 = 284
    expect(frame.placement).toBe('bottom')
    expect(frame.maxHeight).toBe(456)
    expect(frame.top).toBe(336)
  })

  it('aligns to the trigger end and clamps into the viewport', () => {
    const frame = anchorFrame(
      rect(1200, 40, 60, 28),
      { width: 380, height: 200 },
      { width: 1280, height: 800 },
      { align: 'end' },
    )
    expect(frame.left).toBe(1260 - 380)
  })

  it('never leaves a negative top when the preferred side is above', () => {
    const frame = anchorFrame(
      rect(20, 10, 40, 20),
      { width: 300, height: 500 },
      { width: 900, height: 700 },
      { preferred: 'top' },
    )
    expect(frame.placement).toBe('bottom')
    expect(frame.top).toBeGreaterThanOrEqual(8)
  })

  it('downsizes the width on a narrow viewport', () => {
    const frame = anchorFrame(
      rect(10, 40, 40, 20),
      { width: 380, height: 300 },
      { width: 360, height: 700 },
    )
    expect(frame.left).toBe(8)
    expect(frame.maxHeight).toBeGreaterThan(0)
  })
})
