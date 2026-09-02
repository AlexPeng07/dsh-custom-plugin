/** Regression tests for ordered browser state saves. */

import { describe, expect, it, vi } from 'vitest'
import { apiStateSave } from '../src/client/api.ts'

describe('apiStateSave', () => {
  it('sends complete state snapshots in invocation order', async () => {
    let release!: () => void
    const firstStarted = new Promise<void>((resolve) => { release = resolve })
    const bodies: Array<Record<string, unknown>> = []
    const fetchSpy = vi.fn(async (_input: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>)
      if (bodies.length === 1) await firstStarted
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const first = apiStateSave({ cfg: { bg: '第一版' } })
      await Promise.resolve()
      const second = apiStateSave({ cfg: { bg: '第二版' } })
      await Promise.resolve()
      expect(bodies).toHaveLength(1)
      release()
      await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }])
      expect(bodies.map((body) => (body.cfg as Record<string, unknown>).bg)).toEqual(['第一版', '第二版'])
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
