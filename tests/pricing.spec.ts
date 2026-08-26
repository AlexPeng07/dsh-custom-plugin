/** Unit tests for the DeepSeek cost-estimation helpers. */

import { describe, expect, it } from 'vitest'
import { DEEPSEEK_PRICING_SOURCE_URL, estimateUsageCostCny, priceOf, usageCostBreakdown } from '../src/pricing.ts'

const fullRow = {
  in: 1_000_000,
  out: 1_000_000,
  cacheIn: 1_000_000,
  cacheW: 1_000_000,
  reason: 100,
  calls: 1,
}

describe('DeepSeek pricing', () => {
  it('exposes a traceable official pricing source', () => {
    expect(DEEPSEEK_PRICING_SOURCE_URL).toContain('api-docs.deepseek.com')
  })

  it('covers the vision model and legacy aliases', () => {
    expect(priceOf('deepseek-v4-flash-vision-exp')).toEqual({ input: 3, cacheHit: 0.1, output: 9 })
    expect(priceOf('deepseek-chat')).toEqual(priceOf('deepseek-v4-flash'))
    expect(priceOf('unknown-model')).toEqual(priceOf('deepseek-v4-flash'))
  })

  it('applies the half-price off-peak multiplier to every counter', () => {
    expect(estimateUsageCostCny(fullRow, 'deepseek-v4-flash')).toBeCloseTo(7.55, 8)
    const peak = usageCostBreakdown({ ...fullRow, peakIn: 1_000_000, peakCacheIn: 1_000_000, peakCacheW: 1_000_000, peakOut: 1_000_000 }, 'deepseek-v4-flash')
    expect(peak.peakTokens).toBe(4_000_000)
    expect(peak.offPeakTokens).toBe(0)
    expect(peak.totalCostCny).toBeCloseTo(15.1, 8)
  })
})
