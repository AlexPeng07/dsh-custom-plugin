/**
 * Integration tests for the host loader entry (`src/index.ts`): state-load
 * fallbacks (quarantine, read-only gate), pendingUsage buffering, the save
 * debounce, route/tool registration and disposal, and the status-tool
 * envelope — the boot paths no other spec reaches.
 * @module @alexpeng/dsh-custom-plugin/tests/loader-entry
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.ts'
import { STATE_FILE } from '../src/state.ts'
import { dayKey } from '../src/usage.ts'
import { CUSTOM_PLUGIN_API_PREFIX, MERMAID_SCRIPT_PATH } from '../src/protocol.ts'

type Ctx = Parameters<typeof apply>[0]

const ENV_KEYS = ['DSH_HOME', 'DEEPSEEK_API_KEY', 'DEEPSEEK_KEY', 'DEEPSEEK_TOKEN'] as const
const MOUNT_KEY = Symbol.for('dsh-custom-plugin.mounted-plugins')

interface FakeCtx {
  ctx: Ctx
  fire(event: string, ...args: unknown[]): void
  routePaths: string[]
  routesDisposed: number
  tool: { execute(args: unknown, exec: unknown): Promise<Record<string, unknown>> } | null
  toolDisposed: boolean
  runEffects(): void
}

function makeFakeCtx(): FakeCtx {
  const handlers = new Map<string, Array<(a: unknown, b: unknown) => void>>()
  const effects: Array<() => void> = []
  const routePaths: string[] = []
  const state = { routesDisposed: 0, tool: null as FakeCtx['tool'], toolDisposed: false }
  const ctx = {
    sessionQuery: {},
    on(event: string, handler: (a: unknown, b: unknown) => void): void {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
    },
    effect(effect: () => unknown): void {
      const dispose = effect()
      // typeof narrows unknown to Function; the cast carries the contract.
      if (typeof dispose === 'function') effects.push(dispose as () => void)
    },
    get(): undefined {
      return undefined
    },
    webServer: {
      register(route: { path: string }): () => void {
        routePaths.push(route.path)
        return () => { state.routesDisposed++ }
      },
    },
    tools: {
      register(tool: unknown): () => void {
        state.tool = tool as FakeCtx['tool']
        return () => { state.toolDisposed = true }
      },
    },
  } as unknown as Ctx
  return {
    ctx,
    fire(event: string, ...args: unknown[]): void {
      for (const handler of handlers.get(event) ?? []) handler(args[0], args[1])
    },
    get routePaths() { return routePaths },
    get routesDisposed() { return state.routesDisposed },
    get tool() { return state.tool },
    get toolDisposed() { return state.toolDisposed },
    runEffects(): void {
      for (const dispose of effects.splice(0)) dispose()
    },
  }
}

/** Real event-loop turns for fs IO to land while only setTimeout is faked.
 * The boot chain is ~10 sequential fs operations (open/stat/read/close, then
 * mkdir/write/rename/stat), so the budget must cover them all. */
async function ioTick(rounds = 50): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((resolve) => { setImmediate(resolve) })
}

/** The real setTimeout, captured at module load: the poll below must slice
 * the real event loop even while a test has replaced the global timer
 * functions — and a pure setImmediate loop starves fs completions on
 * Windows, so ticks alone are not an option in either mode. */
const setTimeoutNative: typeof setTimeout = setTimeout

/** Poll until the persisted document satisfies `probe` — Windows AV scans
 * can hold a fresh tmp file far longer than any fixed tick budget, so boot
 * writes are awaited by observation, not by turn count. */
async function waitForState(home: string, probe: (doc: Record<string, unknown>) => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms
  for (;;) {
    try {
      const text = await readFile(join(home, STATE_FILE), 'utf8')
      if (probe(JSON.parse(text) as Record<string, unknown>)) return
    } catch { /* not written (or mid-write) yet */ }
    if (Date.now() > deadline) throw new Error('state document never reached the expected shape')
    await new Promise<void>((resolve) => { setTimeoutNative(resolve, 15) })
  }
}

function resetMount(): void {
  const mounted = (globalThis as unknown as { [key: symbol]: Set<string> | undefined })[MOUNT_KEY]
  mounted?.delete('@alexpeng/dsh-custom-plugin')
}

const EXPECTED_ROUTE_PATHS = new Set([
  `${CUSTOM_PLUGIN_API_PREFIX}/state`,
  `${CUSTOM_PLUGIN_API_PREFIX}/timeline`,
  `${CUSTOM_PLUGIN_API_PREFIX}/backup`,
  `${CUSTOM_PLUGIN_API_PREFIX}/search`,
  `${CUSTOM_PLUGIN_API_PREFIX}/export`,
  `${CUSTOM_PLUGIN_API_PREFIX}/balance`,
  `${CUSTOM_PLUGIN_API_PREFIX}/usage-scan`,
  `${CUSTOM_PLUGIN_API_PREFIX}/mermaid`,
  MERMAID_SCRIPT_PATH,
  `${CUSTOM_PLUGIN_API_PREFIX}/diag`,
  `${CUSTOM_PLUGIN_API_PREFIX}/debug`,
])

const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  resetMount()
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  vi.useRealTimers()
  resetMount()
})

afterAll(() => {
  vi.useRealTimers()
})

async function tempHome(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  process.env.DSH_HOME = dir
  return dir
}

async function rmHome(home: string): Promise<void> {
  delete process.env.DSH_HOME
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
}

describe('loader entry', () => {
  it('registers every route and the status tool, then persists the normalized document', async () => {
    const home = await tempHome('custom-plugin-loader-')
    try {
      await writeFile(join(home, STATE_FILE), JSON.stringify({ cfg: { bg: '雾蓝' } }), 'utf8')
      const fake = makeFakeCtx()
      apply(fake.ctx)
      await waitForState(home, (doc) => Array.isArray(doc.folders) && (doc.folders as unknown[]).length === 0)
      expect(new Set(fake.routePaths)).toEqual(EXPECTED_ROUTE_PATHS)
      expect(fake.tool).not.toBeNull()
      const saved = JSON.parse(await readFile(join(home, STATE_FILE), 'utf8')) as { cfg?: { bg?: string } }
      expect(saved.cfg?.bg).toBe('雾蓝')
      // No temp/quarantine residue from an uneventful boot.
      expect((await readdir(home)).filter((name) => name !== STATE_FILE)).toEqual([])
    } finally {
      await rmHome(home)
    }
  })

  it('buffers usage events that arrive before the state load resolves', async () => {
    const home = await tempHome('custom-plugin-buffer-')
    try {
      await writeFile(join(home, STATE_FILE), JSON.stringify({ cfg: {} }), 'utf8')
      const fake = makeFakeCtx()
      apply(fake.ctx)
      // Same synchronous block: the load promise is still in flight, so both
      // events must take the pendingUsage path and survive to the first save.
      fake.fire('session/event', { id: 's1' }, { type: 'request/context', data: { model: 'deepseek-v4-flash' } })
      fake.fire('session/event', { id: 's1' }, { type: 'assistant/message', data: { usage: { inputTokens: 10, outputTokens: 2 } }, time: Date.now() })
      await waitForState(home, (doc) => {
        const usage = doc.usage as Record<string, Record<string, { in?: number }>> | undefined
        return usage?.[dayKey()]?.['deepseek-v4-flash']?.in === 10
      })
    } finally {
      await rmHome(home)
    }
  })

  it('debounces live usage saves and folds both events into one document', async () => {
    const home = await tempHome('custom-plugin-debounce-')
    try {
      await writeFile(join(home, STATE_FILE), JSON.stringify({ cfg: {} }), 'utf8')
      const fake = makeFakeCtx()
      apply(fake.ctx)
      // The boot save must have landed before freezing timers, so the
      // "before" read below observes the debounce, not the boot itself.
      await waitForState(home, (doc) => doc.usage !== undefined)
      // Fake only setTimeout: the debounce is timer-driven, while fs IO keeps
      // using the real event loop.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const fireUsage = (tokens: number): void => {
        fake.fire('session/event', { id: 's1' }, { type: 'assistant/message', data: { usage: { inputTokens: tokens } }, time: Date.now() })
      }
      fireUsage(10)
      fireUsage(20)
      // Before the 500 ms window closes nothing is written…
      const before = JSON.parse(await readFile(join(home, STATE_FILE), 'utf8')) as { usage?: Record<string, unknown> }
      expect(before.usage?.[dayKey()]).toBeUndefined()
      // …then one debounce turn persists the folded total.
      await vi.advanceTimersByTimeAsync(600)
      await waitForState(home, (doc) => {
        const usage = doc.usage as Record<string, Record<string, { in?: number }>> | undefined
        return usage?.[dayKey()]?.['unknown']?.in === 30
      })
    } finally {
      vi.useRealTimers()
      await rmHome(home)
    }
  })

  it('quarantines a corrupt document, adopts defaults, and keeps writing', async () => {
    const home = await tempHome('custom-plugin-corrupt-')
    try {
      const garbage = '{ "cfg": '
      await writeFile(join(home, STATE_FILE), garbage, 'utf8')
      const fake = makeFakeCtx()
      apply(fake.ctx)
      // Quarantine + boot save: the on-disk document becomes valid again and
      // the original bytes survive aside under the pid-qualified name.
      await waitForState(home, (doc) => Array.isArray(doc.folders))
      expect(await readFile(`${join(home, STATE_FILE)}.corrupt-${process.pid}`, 'utf8')).toBe(garbage)
      const status = await fake.tool!.execute({}, undefined)
      expect(status.statePath).toBe(join(home, STATE_FILE))
      expect(status.today).toBe(dayKey())
      expect(status.apiKeyConfigured).toBe(false)
    } finally {
      await rmHome(home)
    }
  })

  it('runs read-only when the document is unreadable and cannot be quarantined', async () => {
    const home = await tempHome('custom-plugin-readonly-')
    try {
      const statePath = join(home, STATE_FILE)
      // A directory at the state path fails readFile without ENOENT on every
      // platform, and a non-empty directory squatting on the recovery name
      // makes the quarantine rename fail — the loader must reject and the
      // host must then suppress every save instead of clobbering.
      await mkdir(statePath)
      await mkdir(join(`${statePath}.corrupt-${process.pid}`, 'blocked'), { recursive: true })
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const fake = makeFakeCtx()
      apply(fake.ctx)
      // Walk the 1.5s/3s/6s retry ladder to exhaustion; each step needs one
      // real IO round for the failed open to land.
      for (let i = 0; i < 40; i++) {
        await vi.advanceTimersByTimeAsync(12_000)
        await ioTick(8)
      }
      // Live usage after the failed load: folded in memory, never written.
      fake.fire('session/event', { id: 's1' }, { type: 'assistant/message', data: { usage: { inputTokens: 5 } }, time: Date.now() })
      await vi.advanceTimersByTimeAsync(5_000)
      await ioTick()
      expect((await readdir(home)).sort()).toEqual([`${STATE_FILE}.corrupt-${process.pid}`, STATE_FILE].sort())
      const status = await fake.tool!.execute({}, undefined)
      expect(String((status.diagReports as string[]).find((line) => line.includes('read-only')))).toContain('state file unreadable')
      expect(status.usageToday).toMatchObject({ unknown: { in: 5 } })
    } finally {
      vi.useRealTimers()
      await rmHome(home)
    }
  })

  it('disposes routes and the tool with its fiber effects and re-arms the mount', async () => {
    const home = await tempHome('custom-plugin-dispose-')
    try {
      await writeFile(join(home, STATE_FILE), JSON.stringify({ cfg: {} }), 'utf8')
      const first = makeFakeCtx()
      apply(first.ctx)
      await ioTick()
      first.runEffects()
      expect(first.routesDisposed).toBe(EXPECTED_ROUTE_PATHS.size)
      expect(first.toolDisposed).toBe(true)
      // The unmarker ran with the fiber effects, so a re-apply mounts again.
      const second = makeFakeCtx()
      apply(second.ctx)
      expect(second.routePaths).toHaveLength(EXPECTED_ROUTE_PATHS.size)
      // session/disposed must not throw on the cleanup path.
      second.fire('session/disposed', { id: 's1' }, undefined)
    } finally {
      await rmHome(home)
    }
  })
})
