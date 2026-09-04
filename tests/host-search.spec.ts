import { describe, expect, it } from 'vitest'
import { CustomPluginHost } from '../src/host-service.ts'
import { defaultState } from '../src/state.ts'

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
    const host = new CustomPluginHost({ sessionQuery: sessionQuery as never, state: defaultState(), statePath: () => 'state.json', saveNow: async () => {}, reportDiag: () => {}, diagReports: [] })
    const result = await host.conversationSearch('s1', 'hit', ['assistant'])
    expect(result).toEqual({ ok: true, items: [{ sessionId: 's1', seq: 3, anchorSeq: 2, kind: 'assistant', time: 3, snippet: 'assistant hit' }], hasMore: false })
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
    const host = new CustomPluginHost({ sessionQuery: sessionQuery as never, state: defaultState(), statePath: () => 'state.json', saveNow: async () => {}, reportDiag: () => {}, diagReports: [] })
    await expect(host.conversationSearch('s1', 'hit', ['assistant'])).resolves.toEqual({ ok: true, items: [{ sessionId: 's1', seq: 1, anchorSeq: 0, kind: 'assistant', time: 2, snippet: 'first hit' }], hasMore: false })
  })
})
