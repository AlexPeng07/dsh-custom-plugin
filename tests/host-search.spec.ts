import { describe, expect, it } from 'vitest'
import { CustomPluginHost } from '../src/host-service.ts'
import { defaultState } from '../src/state.ts'

function makeHost(sessionQuery: unknown): CustomPluginHost {
  return new CustomPluginHost({ sessionQuery: sessionQuery as never, state: defaultState(), statePath: () => 'state.json', saveNow: async () => {}, reportDiag: () => {}, diagReports: [] })
}

describe('conversationSearch', () => {
  it('filters roles and anchors assistant/tool hits to the owning user turn', async () => {
    const events = [
      { seq: 1, time: 1, type: 'turn/start', data: { turn: 1 } },
      { seq: 2, time: 2, type: 'user/message', data: {} },
      { seq: 3, time: 3, type: 'assistant/message', data: {} },
      { seq: 4, time: 4, type: 'tool/result', data: {} },
    ]
    const sessionQuery = {
      readSession: async () => ({ events }),
      searchEvents: async () => ({ items: [
        { seq: 3, time: 3, type: 'assistant/message', snippet: 'assistant hit' },
        { seq: 4, time: 4, type: 'tool/result', snippet: 'tool hit' },
      ] }),
    }
    const result = await makeHost(sessionQuery).conversationSearch('s1', 'hit', ['assistant'])
    expect(result).toEqual({ ok: true, items: [{ sessionId: 's1', seq: 3, anchorSeq: 2, kind: 'assistant', time: 3, snippet: 'assistant hit' }], hasMore: false, source: 'index' })
  })

  it('keeps sequence zero as a valid first-turn anchor', async () => {
    const events = [
      { seq: 0, time: 1, type: 'user/message', data: {} },
      { seq: 1, time: 2, type: 'assistant/message', data: {} },
    ]
    const sessionQuery = {
      readSession: async () => ({ events }),
      searchEvents: async () => ({ items: [{ seq: 1, time: 2, type: 'assistant/message', snippet: 'first hit' }] }),
    }
    await expect(makeHost(sessionQuery).conversationSearch('s1', 'hit', ['assistant'])).resolves.toEqual({
      ok: true,
      items: [{ sessionId: 's1', seq: 1, anchorSeq: 0, kind: 'assistant', time: 2, snippet: 'first hit' }],
      hasMore: false,
      source: 'index',
    })
  })

  it('scans the session log when the deployment has no event index', async () => {
    // dsh's shipped web profile composes session-query with `openAt: never`, so
    // searchEvents() rejects and the feature must still answer from the log.
    const events = [
      { seq: 1, time: 1, type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'hello 世界' }], source: { kind: 'user' } } },
      // The assistant row carries the needle on purpose: the requested kinds
      // exclude it, so this is what makes the role filter load-bearing — a scan
      // that ignored `wanted` would report three hits here instead of two.
      { seq: 2, time: 2, type: 'assistant/message', data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'hello from the assistant' }] } } },
      { seq: 3, time: 3, type: 'tool/call', data: { turn: 1, step: 1, callId: 'c3', name: 'read', arguments: '{"path":"hello.txt"}' } },
    ]
    const sessionQuery = {
      readSession: async () => ({ events }),
      searchEvents: async () => { throw new Error('session search is disabled: openAt "never"') },
    }
    const result = await makeHost(sessionQuery).conversationSearch('s1', 'HELLO', ['user', 'tool'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source).toBe('scan')
    expect(result.items.map((item) => [item.seq, item.kind])).toEqual([[1, 'user'], [3, 'tool']])
    expect(result.items[0].snippet).toContain('hello')
  })

  it('claims there are more results only when a hit actually follows the cap', async () => {
    const build = (n: number) => Array.from({ length: n }, (_, i) => ({
      seq: i + 1,
      time: i + 1,
      type: 'user/message',
      data: { role: 'user', content: [{ type: 'text', text: `hello ${i}` }], source: { kind: 'user' } },
    }))
    const host = (n: number) => makeHost({
      readSession: async () => ({ events: build(n) }),
      searchEvents: async () => { throw new Error('session search is disabled: openAt "never"') },
    })
    const exact = await host(100).conversationSearch('s1', 'hello', ['user'])
    expect(exact.ok).toBe(true)
    if (!exact.ok) return
    expect(exact.items.length).toBe(100)
    expect(exact.hasMore).toBe(false)
    const over = await host(101).conversationSearch('s1', 'hello', ['user'])
    expect(over.ok).toBe(true)
    if (!over.ok) return
    expect(over.items.length).toBe(100)
    expect(over.hasMore).toBe(true)
  })

  it('reports the log read failure instead of silently returning no hits', async () => {
    const sessionQuery = {
      readSession: async () => { throw new Error('persistence unavailable') },
      searchEvents: async () => ({ items: [] }),
    }
    await expect(makeHost(sessionQuery).conversationSearch('s1', 'x', [])).resolves.toEqual({ ok: false, error: 'persistence unavailable' })
  })
})
