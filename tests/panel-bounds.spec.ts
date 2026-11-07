import { describe, expect, it } from 'vitest'
import { COMPOSER_CLEARANCE, panelFrame, pickComposerTop } from '../src/client/panel-bounds.ts'

const METRICS = { width: 430, maxHeight: 660, minHeight: 240, margin: 12, preferred: { right: 76, top: 74 } } as const

describe('panelFrame', () => {
  it('keeps the panel clear of the composer at 1280×822', () => {
    // Measured live: composer card 694..792, so the protected strip starts at
    // 694 - COMPOSER_CLEARANCE and the panel may not cross it.
    const frame = panelFrame({ ...METRICS, viewport: { w: 1280, h: 822 }, safeBottom: 694 - COMPOSER_CLEARANCE, pos: null })
    expect(frame.height).toBe(610)
    expect(frame.top + frame.height).toBeLessThanOrEqual(694)
    expect(frame.left).toBe(774)
    expect(frame.width).toBe(430)
  })

  it('shrinks from the bottom for the higher hero composer', () => {
    const frame = panelFrame({ ...METRICS, viewport: { w: 1280, h: 822 }, safeBottom: 424 - COMPOSER_CLEARANCE, pos: null })
    expect(frame.top).toBe(74)
    expect(frame.height).toBe(340)
    expect(frame.top + frame.height).toBeLessThanOrEqual(424)
  })

  it('falls back to the viewport budget when no composer is on the page', () => {
    const frame = panelFrame({ ...METRICS, viewport: { w: 1280, h: 822 }, safeBottom: null, pos: null })
    expect(frame.height).toBe(660)
    expect(frame.top).toBe(74)
  })

  it('slides a dragged panel up instead of letting it cover the composer', () => {
    const frame = panelFrame({ ...METRICS, viewport: { w: 1280, h: 822 }, safeBottom: 684, pos: { x: 900, y: 800 } })
    // 684 - minHeight is the lowest top that still leaves a usable body above
    // the composer; the panel never overlaps it, it just stops growing.
    expect(frame.top).toBe(444)
    expect(frame.height).toBe(240)
    expect(frame.top + frame.height).toBe(684)
  })

  it('clamps a dragged panel back inside the viewport on both axes', () => {
    const frame = panelFrame({ ...METRICS, viewport: { w: 1280, h: 822 }, safeBottom: 684, pos: { x: -30, y: -40 } })
    expect(frame.left).toBe(12)
    expect(frame.top).toBe(12)
  })

  it('clamps width and left edge on a narrow window', () => {
    const frame = panelFrame({ ...METRICS, viewport: { w: 420, h: 700 }, safeBottom: null, pos: null })
    expect(frame.width).toBe(396)
    expect(frame.left).toBe(12)
  })

  it('keeps a minimum body height on a very short window', () => {
    const frame = panelFrame({ ...METRICS, viewport: { w: 1280, h: 300 }, safeBottom: 240, pos: null })
    expect(frame.height).toBe(240)
  })
})

describe('pickComposerTop', () => {
  it('returns the lowest usable editable box', () => {
    const top = pickComposerTop([
      { top: 40, bottom: 84, width: 300, height: 44 },
      { top: 700, bottom: 736, width: 700, height: 36 },
      { top: 120, bottom: 160, width: 200, height: 40 },
    ], { w: 1280, h: 822 })
    expect(top).toBe(700)
  })

  it('ignores boxes too small to be the composer', () => {
    const top = pickComposerTop([
      { top: 12, bottom: 40, width: 120, height: 28 },
      { top: 700, bottom: 716, width: 100, height: 16 },
    ], { w: 1280, h: 822 })
    expect(top).toBeNull()
  })

  it('ignores boxes that sit outside the viewport', () => {
    const top = pickComposerTop([
      { top: 900, bottom: 940, width: 700, height: 40 },
    ], { w: 1280, h: 822 })
    expect(top).toBeNull()
  })

  it('returns null when the page has no editable box', () => {
    expect(pickComposerTop([], { w: 1280, h: 822 })).toBeNull()
  })
})
