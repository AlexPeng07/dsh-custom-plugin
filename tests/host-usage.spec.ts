/** Tests for bounded and de-duplicated usage-log scans. */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { CustomPluginHost } from '../src/host-service.ts'
import { defaultState } from '../src/state.ts'
import { dayKey } from '../src/usage.ts'

function usageEvent(time: number, seq: number): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      turn: 1,
      step: 1,
      message: { id: `a${seq}`, role: 'assistant', content: [], source: { kind: 'model' } },
      usage: { inputTokens: 10, outputTokens: 5 },
    },
  } as never
}

function requestContext(time: number): SessionEvent {
  return { type: 'request/context', seq: 1, time, data: { model: 'deepseek-v4-flash' } } as never
}

describe('CustomPluginHost.usageScan', () => {
  it('limits concurrent reads and shares one in-flight scan', async () => {
    const state = defaultState()
    const records = Array.from({ length: 9 }, (_, index) => ({ header: { id: `session-${index}` } }))
    let active = 0
    let maxActive = 0
    let reads = 0
    const time = Date.now()
    const sessionQuery = {
      listSessions: async () => records,
      readSession: async () => {
        reads++
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise<void>((resolve) => setTimeout(resolve, 4))
        active--
        return { events: [requestContext(time), usageEvent(time, reads)] }
      },
    }
    const host = new CustomPluginHost({
      sessionQuery: sessionQuery as never,
      state,
      statePath: () => 'custom-plugin-state.json',
      saveNow: async () => {},
      reportDiag: () => {},
      diagReports: [],
      credentialStore: { available: false, get: async () => '', set: async () => false, clear: async () => false },
    })

    const first = host.usageScan()
    const second = host.usageScan()
    const [left, right] = await Promise.all([first, second])

    expect(reads).toBe(records.length)
    expect(maxActive).toBeLessThanOrEqual(4)
    expect(left).toEqual(right)
    expect(left).toMatchObject({ ok: true, scannedSessions: records.length })
    expect(state.usage[dayKey(time)]['deepseek-v4-flash'].calls).toBe(records.length)
  })
})
