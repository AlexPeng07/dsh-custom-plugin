/**
 * DeepSeek cost-estimation helpers shared by the host-facing usage model and
 * the browser panel. Prices are CNY per 1M tokens at peak rate; off-peak is
 * applied to the portion without a peak counter.
 * @module @alexpeng/dsh-custom-plugin/pricing
 */

import { hasKnownPeakSplit } from './usage.ts'
import type { UsageRow } from './protocol.ts'

/** Official source used for the built-in estimate and shown in the panel. */
export const DEEPSEEK_PRICING_SOURCE_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'
/** Date on which the built-in rule was checked against the official page. */
export const DEEPSEEK_PRICING_CHECKED_ON = '2026-08-26'

export interface DeepSeekUnitPrice {
  /** Uncached input / cache-miss input price. */
  input: number
  /** Cache-hit input price. */
  cacheHit: number
  /** Output price; reasoning is an output subdivision in DSH usage. */
  output: number
}

export interface UsageCostBreakdown {
  /** False for pre-split rows whose tariff allocation is not recoverable. */
  exact: boolean
  peakTokens: number
  offPeakTokens: number
  peakCostCny: number
  offPeakCostCny: number
  totalCostCny: number
}

const FLASH_PRICE: DeepSeekUnitPrice = { input: 3, cacheHit: 0.1, output: 9 }

/** Current official peak prices, in CNY per 1M tokens. */
const PEAK_PRICES: Readonly<Record<string, DeepSeekUnitPrice>> = {
  'deepseek-v4-flash': FLASH_PRICE,
  'deepseek-v4-flash-vision-exp': FLASH_PRICE,
  'deepseek-v4-pro': { input: 9, cacheHit: 0.3, output: 27 },
  // Retired names remain readable for older session logs.
  'deepseek-chat': FLASH_PRICE,
  'deepseek-reasoner': FLASH_PRICE,
}

/** Resolve a model's peak price, falling back to Flash for unknown/legacy rows. */
export function priceOf(model: string): DeepSeekUnitPrice {
  return PEAK_PRICES[model] ?? FLASH_PRICE
}

/**
 * Split one row into peak/off-peak token volume and CNY cost. Rows without
 * peak counters retain the old all-off-peak numeric fallback for compatibility,
 * but `exact` is false until a rescan rebuilds the row with split counters.
 */
export function usageCostBreakdown(row: UsageRow, model: string): UsageCostBreakdown {
  const price = priceOf(model)
  const peakIn = row.peakIn ?? 0
  const peakCacheIn = row.peakCacheIn ?? 0
  const peakCacheW = row.peakCacheW ?? 0
  const peakOut = row.peakOut ?? 0
  const peakCost = peakIn * price.input
    + peakCacheIn * price.cacheHit
    + peakCacheW * price.input
    + peakOut * price.output
  const offPeakCost = (row.in - peakIn) * price.input
    + (row.cacheIn - peakCacheIn) * price.cacheHit
    + (row.cacheW - peakCacheW) * price.input
    + (row.out - peakOut) * price.output
  return {
    exact: hasKnownPeakSplit(row),
    peakTokens: peakIn + peakCacheIn + peakCacheW + peakOut,
    offPeakTokens: (row.in - peakIn) + (row.cacheIn - peakCacheIn) + (row.cacheW - peakCacheW) + (row.out - peakOut),
    peakCostCny: peakCost / 1e6,
    offPeakCostCny: offPeakCost / 2e6,
    totalCostCny: (peakCost + offPeakCost / 2) / 1e6,
  }
}

/** Estimate one row's total CNY cost. */
export function estimateUsageCostCny(row: UsageRow, model: string): number {
  return usageCostBreakdown(row, model).totalCostCny
}
