/**
 * Date helpers and aggregation for the token-usage ledger.
 * @module @alexpeng/dsh-custom-plugin/usage
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { UsageMap, UsageRow } from './protocol.ts'

/** One adapter-reported token accounting record (counters are disjoint). */
export interface UsageRecord {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
}

/** China Standard Time offset: UTC+8, no DST, so fixed-offset arithmetic is
 * exact. The published peak/off-peak schedule and the ledger day buckets are
 * both defined on this clock, independent of the host's local timezone. */
const CST_OFFSET_MS = 8 * 3_600_000
const DAY_MS = 86_400_000

/** Number of Beijing calendar days retained in the local usage ledger. */
export const USAGE_RETENTION_DAYS = 90

interface CSTParts { year: number, month: number, day: number, hour: number, minute: number, weekday: number }

function cstParts(time: number): CSTParts {
  const d = new Date(time + CST_OFFSET_MS)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), weekday: d.getUTCDay() }
}

/** Beijing-time (UTC+8) day key `YYYY-MM-DD`. */
export function dayKey(time?: number): string {
  const p = cstParts(time === undefined ? Date.now() : time)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** DeepSeek peak billing window: Beijing Monday-Friday 09:00-12:00 /
 * 14:00-18:00; all weekend hours are off-peak. Evaluated on China Standard
 * Time so the split matches the published schedule on any host timezone. */
export function isPeakHour(time: number): boolean {
  const { hour, weekday } = cstParts(time)
  return weekday >= 1 && weekday <= 5 && ((hour >= 9 && hour < 12) || (hour >= 14 && hour < 18))
}

/** Remove malformed or expired day buckets from the persisted usage ledger. */
export function pruneUsage(usage: UsageMap, now: number = Date.now(), retentionDays: number = USAGE_RETENTION_DAYS): number {
  const keepDays = Math.max(1, Math.floor(retentionDays))
  const cutoff = dayKey(now - (keepDays - 1) * DAY_MS)
  let removed = 0
  for (const key of Object.keys(usage)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key < cutoff) {
      delete usage[key]
      removed++
    }
  }
  return removed
}

/** Fold one usage record into a ledger row, tracking the peak-hour portion. */
export function foldUsageRecord(row: UsageRow, usage: UsageRecord, peak: boolean): void {
  row.in += usage.inputTokens ?? 0
  row.out += usage.outputTokens ?? 0
  row.cacheIn += usage.cacheReadTokens ?? 0
  row.cacheW += usage.cacheWriteTokens ?? 0
  row.reason += usage.reasoningTokens ?? 0
  row.calls += 1
  if (peak) {
    row.peakIn = (row.peakIn ?? 0) + (usage.inputTokens ?? 0)
    row.peakCacheIn = (row.peakCacheIn ?? 0) + (usage.cacheReadTokens ?? 0)
    row.peakCacheW = (row.peakCacheW ?? 0) + (usage.cacheWriteTokens ?? 0)
    row.peakOut = (row.peakOut ?? 0) + (usage.outputTokens ?? 0)
  }
}

/** Merge one aggregated row into a target row (scan folds per-session rows). */
export function mergeUsageRow(target: UsageRow, source: UsageRow): void {
  target.in += source.in
  target.out += source.out
  target.cacheIn += source.cacheIn
  target.cacheW += source.cacheW
  target.reason += source.reason
  target.calls += source.calls
  target.peakIn = (target.peakIn ?? 0) + (source.peakIn ?? 0)
  target.peakCacheIn = (target.peakCacheIn ?? 0) + (source.peakCacheIn ?? 0)
  target.peakCacheW = (target.peakCacheW ?? 0) + (source.peakCacheW ?? 0)
  target.peakOut = (target.peakOut ?? 0) + (source.peakOut ?? 0)
}

/** Replay a session log and aggregate one day's per-model usage rows.
 * `request/context` events anywhere in the log keep the model tracking in
 * order; only `assistant/message` usage events whose own timestamp falls on
 * `day` are folded, so a session crossing midnight contributes exactly the
 * events it produced that day. */
export function aggregateDayUsage(events: readonly SessionEvent[], day: string): Record<string, UsageRow> {
  const agg: Record<string, UsageRow> = {}
  let model: string | null = null
  for (const event of events) {
    if (event === undefined || event === null) continue
    if (event.type === 'request/context') {
      model = event.data.model ?? null
    } else if (event.type === 'assistant/message' && event.data.usage !== undefined && dayKey(event.time) === day) {
      const key = model ?? 'unknown'
      const row = agg[key] ?? (agg[key] = { in: 0, out: 0, cacheIn: 0, cacheW: 0, reason: 0, calls: 0 })
      foldUsageRecord(row, event.data.usage, isPeakHour(event.time))
    }
  }
  return agg
}
