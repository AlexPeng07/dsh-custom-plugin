/**
 * Unit tests for the palette dark-ramp derivation: dark mode reuses the 20
 * light families by keeping hue and saturation and dropping lightness, so a
 * wrong hue or a too-bright canvas would be visible immediately.
 * @module dsh-custom-plugin/tests/palette
 */

import { describe, expect, it } from 'vitest'
import { appearanceTokenKey, DARK_CANVAS_LIGHTNESS, DARK_SATURATION_SCALE, PALETTE, toDarkRamp } from '../src/client/palette.ts'

function hslOf(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (m === null) throw new Error('not a 6-digit hex: ' + hex)
  const v = parseInt(m[1], 16)
  const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => c / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6
  else if (max === g) h = ((b - r) / d + 2) / 6
  else h = ((r - g) / d + 4) / 6
  return [h, s, l]
}

describe('palette dark ramp', () => {
  it('keeps every family on the dark canvas ramp with its hue intact', () => {
    for (const [name, light] of PALETTE) {
      const dark = toDarkRamp(light, DARK_CANVAS_LIGHTNESS)
      const [hIn, sIn] = hslOf(light)
      const [hOut, sOut, lOut] = hslOf(dark)
      // Hue must survive where the compressed tint is still visible. The
      // tolerance absorbs 8-bit quantization: at S≈0.06 / L≈0.12 a channel
      // step of ±1 shifts the measured hue by ~0.03, while a real hue error
      // (swapped channels, lost family) drifts by 0.2 or more.
      if (sOut > 0.05) expect(Math.abs(hOut - hIn)).toBeLessThan(0.04)
      expect(Math.abs(lOut - DARK_CANVAS_LIGHTNESS)).toBeLessThan(0.01)
      // Saturation is compressed (warm hues must not glare on dark) but a
      // tint survives so families stay distinguishable.
      expect(sOut).toBeGreaterThan(0)
      expect(sOut).toBeLessThanOrEqual(sIn * DARK_SATURATION_SCALE + 0.02)
      expect(sOut).toBeLessThan(0.25)
      expect(name.length).toBeGreaterThan(0)
    }
  })

  it('produces dark, readable canvas values', () => {
    for (const [, light] of PALETTE) {
      const dark = toDarkRamp(light, DARK_CANVAS_LIGHTNESS)
      // All channels far below the light pastel's: it must actually read dark.
      const [, , lOut] = hslOf(dark)
      expect(lOut).toBeLessThan(0.2)
    }
  })

  it('clamps out-of-range lightness and degrades invalid input to the default family', () => {
    // Invalid input falls back to the install default's family (天青灰), still
    // landing exactly on the requested dark-ramp lightness.
    const neutral = toDarkRamp('not-a-color', DARK_CANVAS_LIGHTNESS)
    const [, , l] = hslOf(neutral)
    expect(Math.abs(l - DARK_CANVAS_LIGHTNESS)).toBeLessThan(0.02)
    expect(toDarkRamp('#ffffff', 5).slice(1)).toMatch(/^[0-9a-f]{6}$/)
  })
})

describe('appearance token key', () => {
  it('separates the override shapes and folds glass and backdrop into the palette key', () => {
    // No palette and no glass: the painter must leave the shell tokens alone.
    expect(appearanceTokenKey('default', false)).toBe('none')
    expect(appearanceTokenKey(undefined, false)).toBe('none')
    // Glass without a family overrides only the neutral surface tokens.
    expect(appearanceTokenKey('default', true)).toBe('neutral')
    // A mounted renderer needs the low-alpha backdrop set whether glass is on
    // or off: the shell's stacked surfaces multiply the ink away otherwise.
    expect(appearanceTokenKey('default', false, true)).toBe('backdrop')
    expect(appearanceTokenKey('default', true, true)).toBe('backdrop')
    // A family carries both flags, because glass and the backdrop each change
    // the alpha form of the very same values.
    expect(appearanceTokenKey('雾蓝', false)).toBe('palette:雾蓝|glass:0|backdrop:0')
    expect(appearanceTokenKey('雾蓝', true)).toBe('palette:雾蓝|glass:1|backdrop:0')
    expect(appearanceTokenKey('雾蓝', false, true)).toBe('palette:雾蓝|glass:0|backdrop:1')
  })

  it('is stable for an unchanged configuration and moves with every input it reads', () => {
    // Stability is the whole point: a repaint with the same cfg must not
    // re-register tokens (that reparses the shell's variables).
    for (const [name] of PALETTE) {
      expect(appearanceTokenKey(name, true)).toBe(appearanceTokenKey(name, true))
      expect(appearanceTokenKey(name, false, true)).toBe(appearanceTokenKey(name, false, true))
      const withoutGlass = appearanceTokenKey(name, false)
      expect(withoutGlass).not.toBe(appearanceTokenKey(name, true))
      expect(withoutGlass).not.toBe(appearanceTokenKey(name, false, true))
      if (name !== PALETTE[0][0]) expect(withoutGlass).not.toBe(appearanceTokenKey(PALETTE[0][0], false))
    }
    expect(appearanceTokenKey('default', false)).not.toBe(appearanceTokenKey('default', true))
    expect(appearanceTokenKey('default', false)).not.toBe(appearanceTokenKey('default', false, true))
    expect(appearanceTokenKey('默认以外的未知族', false)).not.toBe(appearanceTokenKey('default', false))
  })
})
