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
      await rm(dir, { force: true, recursive: true })
    }
  })

  it('falls back to the CDN mirrors when no local dependency resolves', async () => {
    const fetchSpy = vi.fn(async () => new Response('// mermaid stub', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const host = makeHost(() => null)
      const result = await host.mermaidFetch()
      expect(result).toEqual({ ok: true, bytes: 15 })
      expect(host.mermaidLoadedSource()).toBe('cdn')
      expect(fetchSpy).toHaveBeenCalledTimes(1)
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
