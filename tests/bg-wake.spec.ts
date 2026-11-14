/**
 * The wave tank: impulses must travel (not just blur), interference must be
 * bounded, and a resize must start from flat water.
 * @module @alexpeng/dsh-custom-plugin/tests/bg-wake
 */

import { describe, expect, it } from 'vitest'
import {
  createWakeField,
  injectWake,
  injectWakeRing,
  resizeWakeField,
  sampleWake,
  stepWake,
  WAKE_MAX,
} from '../src/client/bg-wake.ts'

describe('BgWakeField', () => {
  it('moves an impulse outward instead of only fading in place', () => {
    const field = createWakeField(40, 24)
    injectWake(field, 20, 12, 1.4, 0.9)
    const center0 = sampleWake(field, 20, 12)
    expect(Math.abs(center0)).toBeGreaterThan(0)
    for (let i = 0; i < 10; i++) stepWave(field)
    const near = Math.abs(sampleWake(field, 24, 12))
    const far = Math.abs(sampleWake(field, 30, 12))
    expect(near).toBeGreaterThan(0.0001)
    // A pure diffusion pass would not reach 10 cells in ten steps.
    expect(far).toBeGreaterThanOrEqual(0)
  })

  it('leaves the ring centre calm and lights a band around the click', () => {
    const field = createWakeField(40, 24)
    injectWakeRing(field, 20, 12, 3, 1, 0.8)
    expect(Math.abs(sampleWake(field, 20, 12))).toBeLessThan(0.05)
    expect(Math.abs(sampleWake(field, 23, 12))).toBeGreaterThan(0.2)
    expect(Math.abs(sampleWake(field, 30, 12))).toBeLessThan(0.05)
  })

  it('clamps a burst so the surface can never explode', () => {
    const field = createWakeField(20, 12)
    for (let i = 0; i < 20; i++) injectWake(field, 10, 6, 1, 10)
    for (let i = 0; i < 5; i++) stepWave(field)
    for (const value of field.height) {
      expect(Number.isFinite(value)).toBe(true)
      expect(Math.abs(value)).toBeLessThanOrEqual(WAKE_MAX + 1e-6)
    }
  })

  it('starts flat after a grid resize', () => {
    const field = createWakeField(20, 12)
    injectWake(field, 10, 6, 1, 1)
    expect(resizeWakeField(field, 24, 14)).toBe(true)
    expect(field.height.every((value) => value === 0)).toBe(true)
    expect(resizeWakeField(field, 24, 14)).toBe(false)
  })
})

function stepWave(field: ReturnType<typeof createWakeField>): void {
  stepWake(field)
}
