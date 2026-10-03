/**
 * Unit tests for the host Mermaid engine loader: the bundled local
 * dependency wins, the CDN mirrors are only a fallback.
 * @module @alexpeng/dsh-custom-plugin/tests/host-mermaid
 */

import { afterAll, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CustomPluginHost, defaultLocalMermaidPath } from '../src/host-service.ts'
import { defaultState } from '../src/state.ts'

function makeHost(localMermaidPath?: () => string | null): CustomPluginHost {
  return new CustomPluginHost({
    sessionQuery: {} as never,
    state: defaultState(),
    statePath: () => 'state.json',
    saveNow: async () => {},
    reportDiag: () => {},
    diagReports: [],
    localMermaidPath,
  })
}

/** A CDN body that passes the payload sanity check (script-shaped, past the
 * size floor) without being the real 3.5 MB bundle. */
const STUB = '// mermaid stub\n' + 'x'.repeat(2000)

describe('mermaidFetch local-first', () => {
  it('loads the bundled engine from disk without touching the network', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const host = makeHost(() => defaultLocalMermaidPath())
      const result = await host.mermaidFetch()
      expect(result.ok).toBe(true)
      if (result.ok === true) expect(result.bytes).toBeGreaterThan(1_000_000)
      expect(host.mermaidLoadedSource()).toBe('local')
      expect(host.mermaidScript()).toContain('mermaid')
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reads a custom local path and reports its byte count', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vx-mmd-'))
    try {
      const file = join(dir, 'mermaid.min.js')
      await writeFile(file, 'x'.repeat(2048), 'utf8')
      const host = makeHost(() => file)
      const result = await host.mermaidFetch()
      expect(result).toEqual({ ok: true, bytes: 2048 })
      expect(host.mermaidLoadedSource()).toBe('local')
    } finally {
      await rm(dir, { force: true, recursive: true, maxRetries: 10, retryDelay: 50 })
    }
  })

  it('falls back to the CDN mirrors when no local dependency resolves', async () => {
    const fetchSpy = vi.fn(async () => new Response(STUB, { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const host = makeHost(() => null)
      const result = await host.mermaidFetch()
      expect(result).toEqual({ ok: true, bytes: STUB.length })
      expect(host.mermaidLoadedSource()).toBe('cdn')
      expect(fetchSpy).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('shares one in-flight CDN load between concurrent callers', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const fetchSpy = vi.fn(async () => {
      await gate
      return new Response(STUB, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const host = makeHost(() => null)
      const first = host.mermaidFetch()
      const second = host.mermaidFetch()
      await Promise.resolve()
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      release()
      await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true, bytes: STUB.length }, { ok: true, bytes: STUB.length }])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('refuses to cache an HTML interstitial and falls through to the next mirror', async () => {
    // A captive portal answers 200 with a login page; the payload check must
    // reject it instead of poisoning the host-lifetime engine cache.
    const responses = ['<!doctype html><html><body>sign in</body></html>' + 'x'.repeat(2000), STUB]
    let call = 0
    const fetchSpy = vi.fn(async () => new Response(responses[Math.min(call++, responses.length - 1)], { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const host = makeHost(() => null)
      const result = await host.mermaidFetch()
      expect(result).toEqual({ ok: true, bytes: STUB.length })
      expect(host.mermaidLoadedSource()).toBe('cdn')
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('fails without caching when every mirror serves an HTML page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>blocked</html>' + 'x'.repeat(2000), { status: 200 })))
    try {
      const host = makeHost(() => null)
      const result = await host.mermaidFetch()
      expect(result.ok).toBe(false)
      if (result.ok === false) expect(result.error).toContain('无法获取 Mermaid 引擎')
      expect(host.mermaidScript()).toBe('')
      expect(host.mermaidBytes()).toBe(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('rejects a too-small 200 body instead of caching it as the engine', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('// tiny', { status: 200 })))
    try {
      const host = makeHost(() => null)
      const result = await host.mermaidFetch()
      expect(result.ok).toBe(false)
      expect(host.mermaidScript()).toBe('')
      expect(host.mermaidBytes()).toBe(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports a failure envelope when local is absent and every mirror fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })))
    try {
      const host = makeHost(() => null)
      const result = await host.mermaidFetch()
      expect(result.ok).toBe(false)
      if (result.ok === false) expect(result.error).toContain('无法获取 Mermaid 引擎')
      expect(host.mermaidScript()).toBe('')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

afterAll(() => {
  vi.unstubAllGlobals()
})
