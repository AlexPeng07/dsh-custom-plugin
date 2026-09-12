import { describe, expect, it } from 'vitest'
import { CustomPluginHost } from '../src/host-service.ts'
import { defaultState } from '../src/state.ts'

declare global {
  // Node 22 exposes Symbol.dispose; the project's ES2022 lib does not type it.
  interface SymbolConstructor {
    readonly dispose: symbol
  }
}

const SEEDED_ERROR = 'seeded session constructor seed must equal its inherited prefix'

function seededException(): Error {
  return new Error(SEEDED_ERROR)
}

function buildHost(sessionQuery: Record<string, unknown>): CustomPluginHost {
  return new CustomPluginHost({ sessionQuery: sessionQuery as never, state: defaultState(), statePath: () => 'state.json', saveNow: async () => {}, reportDiag: () => {}, diagReports: [] })
}

const forkedLog = [
  { seq: 0, time: 1, type: 'turn/start', data: { turn: 1 } },
  { seq: 1, time: 2, type: 'user/message', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] } },
  { seq: 2, time: 3, type: 'assistant/message', data: { message: { role: 'assistant', content: [{ type: 'text', text: '世界' }] } } },
]

describe('readSession fallback', () => {
  it('exports via observeSession when readSession rejects a seeded fork log', async () => {
    let disposed = false
    const host = buildHost({
      readSession: async () => { throw seededException() },
      readTitle: async () => ({ title: '标题' }),
      observeSession: async () => ({
        header: { id: 's1', createdAt: 123, cwd: '/tmp' },
        events: forkedLog,
        [Symbol.dispose]: () => { disposed = true },
      }),
    })
    const result = await host.exportRun('s1', 'markdown')
    expect(result.ok).toBe(true)
    if (result.ok !== true) return
    expect(result.fileName.endsWith('.md')).toBe(true)
    expect(result.content).toContain('你好')
    expect(result.content).toContain('世界')
    expect(disposed).toBe(true)
  })

  it('keeps JSON export metadata when reading through the fallback lease', async () => {
    const host = buildHost({
      readSession: async () => { throw seededException() },
      readTitle: async () => undefined,
      observeSession: async () => ({
        header: { id: 's1', createdAt: 123, cwd: '/tmp' },
        events: forkedLog,
      }),
    })
    const result = await host.exportRun('s1', 'json')
    expect(result.ok).toBe(true)
    if (result.ok !== true) return
    const doc = JSON.parse(result.content) as { meta: { id: string; createdAt: number; cwd: string } }
    expect(doc.meta.id).toBe('s1')
    expect(doc.meta.createdAt).toBe(123)
    expect(doc.meta.cwd).toBe('/tmp')
  })

  it('builds timeline items through the fallback lease', async () => {
    const host = buildHost({
      readSession: async () => { throw seededException() },
      observeSession: async () => ({
        header: { id: 's1', createdAt: 123 },
        events: forkedLog,
      }),
    })
    const result = await host.timelineGet('s1')
    expect(result.ok).toBe(true)
    if (result.ok !== true) return
    expect(result.items.length).toBe(1)
    expect(result.items[0].text).toBe('你好')
  })

  it('surfaces the original readSession error when observeSession is unavailable', async () => {
    const host = buildHost({
      readSession: async () => { throw seededException() },
    })
    await expect(host.exportRun('s1', 'markdown')).resolves.toEqual({ ok: false, error: `读取会话失败: ${SEEDED_ERROR}` })
  })

  it('surfaces the observeSession failure when the fallback also fails', async () => {
    const host = buildHost({
      readSession: async () => { throw seededException() },
      observeSession: async () => { throw new Error('stored session "s1" is corrupt') },
    })
    await expect(host.exportRun('s1', 'markdown')).resolves.toEqual({ ok: false, error: '读取会话失败: stored session "s1" is corrupt' })
  })
})
