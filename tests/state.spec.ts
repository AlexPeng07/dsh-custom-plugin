/**
 * Unit tests for the state document: default shape, config normalization
 * (retired keys dropped), and merge semantics.
 * @module @alexpeng/dsh-custom-plugin/tests/state
 */

import { describe, expect, it } from 'vitest'
import { mkdir, readdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultState, loadStateFile, mergeState, normalizeCfg, saveStateFile, STATE_FILE, tempPathFor } from '../src/state.ts'
import { DEFAULT_CONFIG } from '../src/protocol.ts'

describe('defaultState', () => {
  it('starts with the default config and empty collections', () => {
    const state = defaultState()
    expect(state.cfg).toEqual(DEFAULT_CONFIG)
    expect(state.folders).toEqual([])
    expect(state.prompts).toEqual([])
    expect(state.stars).toEqual({})
    expect(state.apiKey).toBe('')
    expect(state.usage).toEqual({})
  })
})

describe('normalizeCfg', () => {
  it('drops retired keys and keeps typed defaults', () => {
    const cfg = normalizeCfg({ bg: '雾蓝', weather: 'snow', clouds: true, wind: 3, glass: 'yes' })
    expect(cfg.bg).toBe('雾蓝')
    expect(cfg.weather).toBe('snow')
    expect((cfg as Record<string, unknown>).clouds).toBeUndefined()
    expect((cfg as Record<string, unknown>).wind).toBeUndefined()
    // Non-boolean value for a boolean key falls back to the default.
    expect(cfg.glass).toBe(DEFAULT_CONFIG.glass)
  })

  it('accepts only known keys', () => {
    const cfg = normalizeCfg({ timelineLeft: true, bogus: 'x' })
    expect(cfg.timelineLeft).toBe(true)
    expect((cfg as Record<string, unknown>).bogus).toBeUndefined()
  })

  it('normalizes numeric budget fields', () => {
    expect(normalizeCfg({ monthlyBudgetCny: 120, budgetWarningPercent: 75 })).toMatchObject({ monthlyBudgetCny: 120, budgetWarningPercent: 75 })
    expect(normalizeCfg({ monthlyBudgetCny: '120' }).monthlyBudgetCny).toBe(0)
    expect(normalizeCfg({ monthlyBudgetCny: -1, budgetWarningPercent: 0 }).budgetWarningPercent).toBe(1)
    expect(normalizeCfg({ monthlyBudgetCny: -1, budgetWarningPercent: 101 })).toMatchObject({ monthlyBudgetCny: 0, budgetWarningPercent: 100 })
  })
})

describe('mergeState', () => {
  it('merges persisted documents into the default state', () => {
    const state = defaultState()
    mergeState(state, {
      cfg: { bg: '石板蓝' },
      folders: [{ id: 'f1', name: '工作', children: [], sessionIds: [], workspaceIds: [], prompts: [] }],
      prompts: [{ id: 'p1', name: '周报', text: '写周报' }],
      stars: { s1: { 12: true } },
      apiKey: 'sk-test',
      usage: { '2026-08-22': { 'deepseek-v4-flash': { in: 1, out: 2, cacheIn: 0, cacheW: 0, reason: 0, calls: 1 } } },
    })
    expect(state.cfg.bg).toBe('石板蓝')
    expect(state.folders).toHaveLength(1)
    expect(state.prompts[0].name).toBe('周报')
    expect(state.prompts[0]).toMatchObject({ tags: [], favorite: false, useCount: 0 })
    expect(state.stars.s1[12]).toBe(true)
    expect(state.apiKey).toBe('sk-test')
    expect(state.usage['2026-08-22']['deepseek-v4-flash'].in).toBe(1)
  })

  it('ignores malformed input without throwing', () => {
    const state = defaultState()
    mergeState(state, null)
    mergeState(state, 'garbage')
    mergeState(state, { cfg: 42, folders: 'nope' })
    expect(state.cfg).toEqual(DEFAULT_CONFIG)
    expect(state.folders).toEqual([])
  })

  it('rejects wrong collection shapes and non-string keys without touching defaults', () => {
    const state = defaultState()
    mergeState(state, {
      stars: ['not', 'a', 'map'],
      usage: ['not', 'a', 'map'],
      apiKey: 12345,
      prompts: 'nope',
      unknownTopLevel: { kept: false },
    })
    expect(state.stars).toEqual({})
    expect(state.usage).toEqual({})
    expect(state.apiKey).toBe('')
    expect(state.prompts).toEqual([])
    expect((state as unknown as Record<string, unknown>).unknownTopLevel).toBeUndefined()
  })
})

describe('loadStateFile', () => {
  it('loads and merges the persisted document', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'custom-plugin-state-'))
    try {
      const home = join(dir, 'home')
      await mkdir(home, { recursive: true })
      await writeFile(join(home, 'custom-plugin-state.json'), JSON.stringify({
        cfg: { bg: '雾蓝' },
        usage: { '2026-08-20': { 'deepseek-chat': { in: 9, out: 9, cacheIn: 0, cacheW: 0, reason: 0, calls: 1 } } },
      }))
      const state = defaultState()
      const path = await loadStateFile(state, home)
      expect(path).toBe(join(home, 'custom-plugin-state.json'))
      expect(state.cfg.bg).toBe('雾蓝')
      expect(state.usage['2026-08-20']['deepseek-chat'].in).toBe(9)
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  })

  it('keeps defaults when no persisted document exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'custom-plugin-state-'))
    try {
      const state = defaultState()
      const path = await loadStateFile(state, join(dir, 'home'))
      expect(path).toBe(join(dir, 'home', 'custom-plugin-state.json'))
      expect(state.cfg).toEqual(DEFAULT_CONFIG)
      expect(state.folders).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  })
})

describe('saveStateFile', () => {
  it('serializes concurrent saves: all settle, the document stays valid, no tmp residue', async () => {
    const home = await mkdtemp(join(tmpdir(), 'custom-plugin-save-'))
    try {
      const state = defaultState()
      await Promise.all(Array.from({ length: 12 }, (_, index) => {
        state.cfg.bg = `色-${index}`
        return saveStateFile(state, home)
      }))
      const text = await readFile(join(home, STATE_FILE), 'utf8')
      expect(() => JSON.parse(text)).not.toThrow()
      // Any leftover counts, not just the pre-Desktop fixed name.
      expect((await readdir(home)).filter(name => name !== STATE_FILE)).toEqual([])
    } finally {
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  })

  it('drops its own temp when the write fails', async () => {
    const home = await mkdtemp(join(tmpdir(), 'custom-plugin-save-fail-'))
    try {
      const statePath = join(home, STATE_FILE)
      // A non-empty directory in the rename target's place makes the rename fail.
      await mkdir(join(statePath, 'blocked'), { recursive: true })
      // Pin the rejection to the rename itself: a throw from the cleanup path
      // would satisfy a bare rejects.toThrow() and hide a leaked temp file.
      const failure = await saveStateFile(defaultState(), home).then(() => undefined, (error: unknown) => error as NodeJS.ErrnoException)
      expect(failure?.syscall).toBe('rename')
      expect((await readdir(home)).filter(name => name !== STATE_FILE)).toEqual([])
    } finally {
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  })
  it('leaves another host in-flight temp file alone instead of writing through it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'custom-plugin-tmpname-'))
    try {
      const statePath = join(home, STATE_FILE)
      const legacy = `${statePath}.tmp`
      // The name every dsh host used before the process qualifier. A second
      // host's unfinished write would land in our document through it.
      await writeFile(legacy, 'sentinel-from-another-host', 'utf8')
      await saveStateFile(defaultState(), home)
      expect(await readFile(legacy, 'utf8')).toBe('sentinel-from-another-host')
      const saved = JSON.parse(await readFile(statePath, 'utf8')) as { cfg?: unknown }
      expect(saved.cfg).toBeDefined()
    } finally {
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  })
})

describe('tempPathFor', () => {
  it('separates temp names per pid so two hosts sharing one $DSH_HOME cannot rename each other\'s partial write', () => {
    const target = '/home/.dsh/custom-plugin-state.json'
    expect(tempPathFor(target, 1111)).not.toBe(tempPathFor(target, 2222))
    // The fixed name is the collision this exists to avoid.
    expect(tempPathFor(target, 1111)).not.toBe(`${target}.tmp`)
    expect(tempPathFor(target, process.pid)).toBe(`${target}.${process.pid}.tmp`)
  })
})
