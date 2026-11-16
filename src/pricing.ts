/**
 * DeepSeek cost-estimation helpers shared by the host-facing usage model and
 * the browser panel. Prices are the official peak CNY rates per 1M tokens;
 * off-peak is exactly half (Beijing weekdays 09–12 / 14–18 are peak, weekends
 * and Chinese statutory holidays are off-peak all day).
 * @module @alexpeng/dsh-custom-plugin/pricing
 */

import { hasKnownPeakSplit } from './usage.ts'
import type { UsageRow } from './protocol.ts'

/** Official source used for the built-in estimate and shown in the panel. */
export const DEEPSEEK_PRICING_SOURCE_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'
/** Date on which the built-in rule was checked against the official page. */
export const DEEPSEEK_PRICING_CHECKED_ON = '2026-11-14'
/** One-line tariff summary shown under the usage tables. */
export const DEEPSEEK_PRICING_NOTE = '官方峰谷价（每百万 tokens）：Flash 峰时输入 ¥2 / 缓存命中 ¥0.04 / 输出 ¥8，Pro ¥9 / ¥0.30 / ¥27；空闲时段半价（工作日 9–12、14–18 为峰时，周末与法定节假日全天空闲）'

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

const FLASH_PRICE: DeepSeekUnitPrice = { input: 2, cacheHit: 0.04, output: 8 }
const PRO_PRICE: DeepSeekUnitPrice = { input: 9, cacheHit: 0.3, output: 27 }

/** Official peak prices, in CNY per 1M tokens. Off-peak is exactly half. */
const PEAK_PRICES: Readonly<Record<string, DeepSeekUnitPrice>> = {
  'deepseek-flash': FLASH_PRICE,
  'deepseek-v4-flash': FLASH_PRICE,
  'deepseek-v4-flash-vision-exp': FLASH_PRICE,
  'deepseek-pro': PRO_PRICE,
  'deepseek-v4-pro': PRO_PRICE,
  // Retired names remain readable for older session logs; the official page
  // maps them onto v4-flash's non-thinking / thinking modes.
  'deepseek-chat': FLASH_PRICE,
  'deepseek-reasoner': FLASH_PRICE,
}

/** Resolve a model's peak price. Exact ids first; any other `*pro*` id uses
 *  Pro pricing, and everything else falls back to Flash (the shipped default). */
export function priceOf(model: string): DeepSeekUnitPrice {
  const exact = PEAK_PRICES[model]
  if (exact !== undefined) return exact
  if (/pro/i.test(model)) return PRO_PRICE
  return FLASH_PRICE
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
