/**
 * Unit tests for the usage ledger helpers (day key, peak window, aggregation).
 * @module @alexpeng/dsh-custom-plugin/tests/usage
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { aggregateDayUsage, dayKey, isPeakHour, pruneUsage } from '../src/usage.ts'

/** Timestamp whose Beijing (UTC+8) wall clock reads the given fields, so tests
 * are independent of the host timezone. */
function T(year: number, month: number, day: number, hour: number, minute = 0): number {
  return Date.UTC(year, month - 1, day, hour - 8, minute, 0, 0)
}

function requestContext(seq: number, time: number, model: string): SessionEvent {
  return { type: 'request/context', seq, time, data: { model } } as never
}

function usageEvent(seq: number, time: number, usage: { inputTokens?: number, outputTokens?: number, cacheReadTokens?: number, cacheWriteTokens?: number }): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      turn: 1,
      step: 1,
      message: { id: `a${seq}`, role: 'assistant', content: [], source: { kind: 'model' } },
      usage,
    },
  } as never
}

describe('isPeakHour', () => {
  it('matches the Beijing 9-12 / 14-18 windows with half-open bounds', () => {
    expect(isPeakHour(T(2026, 8, 21, 9))).toBe(true)
    expect(isPeakHour(T(2026, 8, 21, 11, 59))).toBe(true)
    expect(isPeakHour(T(2026, 8, 21, 12))).toBe(false)
    expect(isPeakHour(T(2026, 8, 21, 13, 59))).toBe(false)
    expect(isPeakHour(T(2026, 8, 21, 14))).toBe(true)
    expect(isPeakHour(T(2026, 8, 21, 17, 59))).toBe(true)
    expect(isPeakHour(T(2026, 8, 21, 18))).toBe(false)
  })

  it('uses Beijing time regardless of the host timezone', () => {
    // 2026-08-21 01:00 UTC == 09:00 Beijing: peak even where the local clock reads 01:00.
    expect(isPeakHour(Date.UTC(2026, 7, 21, 1, 0))).toBe(true)
    // 2026-08-21 10:00 UTC == 18:00 Beijing: off-peak even where the local clock reads 10:00.
    expect(isPeakHour(Date.UTC(2026, 7, 21, 10, 0))).toBe(false)
  })

  it('treats all weekend hours as off-peak', () => {
    expect(isPeakHour(T(2026, 8, 22, 10))).toBe(false) // Saturday
    expect(isPeakHour(T(2026, 8, 23, 15))).toBe(false) // Sunday
    expect(isPeakHour(T(2026, 8, 24, 10))).toBe(true) // Monday
  })

  it('buckets days on the Beijing calendar', () => {
    // 2026-08-20 16:30 UTC == 2026-08-21 00:30 Beijing.
    expect(dayKey(Date.UTC(2026, 7, 20, 16, 30))).toBe('2026-08-21')
  })
})

describe('aggregateDayUsage', () => {
  it('keeps only the scanned day across a midnight-crossing session', () => {
    const events = [
      requestContext(1, T(2026, 8, 20, 23, 0), 'deepseek-v4-flash'),
      usageEvent(2, T(2026, 8, 20, 23, 30), { inputTokens: 100, outputTokens: 50 }),
      usageEvent(3, T(2026, 8, 21, 0, 30), { inputTokens: 200, outputTokens: 20 }),
    ]
    const day = aggregateDayUsage(events, dayKey(T(2026, 8, 21, 12)))
    expect(day['deepseek-v4-flash'].in).toBe(200)
    expect(day['deepseek-v4-flash'].out).toBe(20)
    expect(day['deepseek-v4-flash'].calls).toBe(1)
  })

  it('splits peak and off-peak volume per counter', () => {
    const events = [
      requestContext(1, T(2026, 8, 21, 8, 0), 'deepseek-v4-pro'),
      usageEvent(2, T(2026, 8, 21, 10, 0), { inputTokens: 1000, outputTokens: 100, cacheWriteTokens: 40 }),
      usageEvent(3, T(2026, 8, 21, 20, 0), { inputTokens: 3000, outputTokens: 300, cacheReadTokens: 500 }),
    ]
    const row = aggregateDayUsage(events, dayKey(T(2026, 8, 21, 12)))['deepseek-v4-pro']
    expect(row.in).toBe(4000)
    expect(row.calls).toBe(2)
    expect(row.peakIn).toBe(1000)
    expect(row.peakOut).toBe(100)
    expect(row.peakCacheW).toBe(40)
    expect(row.peakCacheIn ?? 0).toBe(0)
  })

  it('falls back to the unknown model without a request/context', () => {
    const day = aggregateDayUsage([usageEvent(1, T(2026, 8, 21, 15, 0), { inputTokens: 5 })], dayKey(T(2026, 8, 21, 15)))
    expect(day.unknown.calls).toBe(1)
    expect(day.unknown.in).toBe(5)
  })
})

describe('pruneUsage', () => {
  it('keeps the configured Beijing-day window and removes malformed/expired buckets', () => {
    const now = T(2026, 8, 24, 12)
    const dayMs = 86_400_000
    const usage = {
      [dayKey(now)]: {},
      [dayKey(now - 89 * dayMs)]: {},
      [dayKey(now - 90 * dayMs)]: {},
      malformed: {},
    }
    expect(pruneUsage(usage, now, 90)).toBe(2)
    expect(usage[dayKey(now)]).toEqual({})
    expect(usage[dayKey(now - 89 * dayMs)]).toEqual({})
    expect(usage[dayKey(now - 90 * dayMs)]).toBeUndefined()
    expect(usage.malformed).toBeUndefined()
  })
})
