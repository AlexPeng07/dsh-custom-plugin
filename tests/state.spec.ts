/**
 * Unit tests for the state document: default shape, config normalization
 * (retired keys dropped), and merge semantics.
 * @module @alexpeng/dsh-custom-plugin/tests/state
 */

import { describe, expect, it } from 'vitest'
import { mkdir, readdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultState, loadStateFile, mergeState, normalizeCfg, normalizeFolders, normalizeStars, saveStateFile, STATE_FILE, tempPathFor } from '../src/state.ts'
import { DEFAULT_CONFIG, type UsageRow } from '../src/protocol.ts'

/** A full ledger row; the sync arithmetic touches every counter. */
function fullRow(over: Partial<UsageRow>): UsageRow {
  return { in: 0, out: 0, cacheIn: 0, cacheW: 0, reason: 0, calls: 0, peakIn: 0, peakCacheIn: 0, peakCacheW: 0, peakOut: 0, peakSplitKnown: true, ...over }
}

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
    const cfg = normalizeCfg({ quote: true, bogus: 'x' })
    expect(cfg.quote).toBe(true)
    expect((cfg as Record<string, unknown>).bogus).toBeUndefined()
  })

  it('drops keys retired with the timeline rail instead of persisting them', () => {
    const cfg = normalizeCfg({ timeline: false, timelineLeft: true, starsOnly: true })
    expect((cfg as Record<string, unknown>).timeline).toBeUndefined()
    expect((cfg as Record<string, unknown>).timelineLeft).toBeUndefined()
    expect((cfg as Record<string, unknown>).starsOnly).toBeUndefined()
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

describe('loadStateFile failure handling', () => {
  it('quarantines a corrupt document aside instead of silently adopting defaults over it', async () => {
    const home = await mkdtemp(join(tmpdir(), 'custom-plugin-corrupt-'))
    try {
      const statePath = join(home, STATE_FILE)
      const garbage = '{ "cfg": '
      await writeFile(statePath, garbage, 'utf8')
      const state = defaultState()
      expect(await loadStateFile(state, home, [])).toBe(statePath)
      // Defaults were adopted, but the original bytes survive aside,
      // pid-qualified so two hosts sharing one home cannot fight over the
      // recovery name — the caller may then save without destroying them.
      expect(state.cfg).toEqual(DEFAULT_CONFIG)
      expect(await readFile(`${statePath}.corrupt-${process.pid}`, 'utf8')).toBe(garbage)
      expect(await readdir(home)).toEqual([`${STATE_FILE}.corrupt-${process.pid}`])
    } finally {
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  })

  it('quarantines an unreadable document after the retry ladder exhausts', async () => {
    const home = await mkdtemp(join(tmpdir(), 'custom-plugin-unreadable-'))
    try {
      // A directory at the state path fails readFile without ENOENT on every
      // platform (EISDIR on POSIX, EPERM on Windows) — the stand-in for an
      // AV-held or sync-client-locked file that never unlocks.
      const statePath = join(home, STATE_FILE)
      await mkdir(statePath)
      const state = defaultState()
      expect(await loadStateFile(state, home, [])).toBe(statePath)
      expect(state.cfg).toEqual(DEFAULT_CONFIG)
      expect(await readdir(home)).toEqual([`${STATE_FILE}.corrupt-${process.pid}`])
    } finally {
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  })

  it('retries a transient read failure and merges once the file recovers', async () => {
    const home = await mkdtemp(join(tmpdir(), 'custom-plugin-transient-'))
    try {
      const statePath = join(home, STATE_FILE)
      await mkdir(statePath)
      // Heal the path (blocking directory -> valid document) well before the
      // one retry fires, so the ladder's second read finds real content.
      setTimeout(() => {
        void rm(statePath, { recursive: true, force: true })
          .then(() => writeFile(statePath, JSON.stringify({ cfg: { bg: '雾蓝' } }), 'utf8'))
          .catch(() => { /* a failed heal fails the merge assertion below */ })
      }, 10)
      const state = defaultState()
      await loadStateFile(state, home, [250])
      expect(state.cfg.bg).toBe('雾蓝')
      expect((await readdir(home)).filter((name) => name !== STATE_FILE)).toEqual([])
    } finally {
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  })

  it('rejects and leaves the document untouched when quarantine itself fails', async () => {
    const home = await mkdtemp(join(tmpdir(), 'custom-plugin-quarantine-fail-'))
    try {
      const statePath = join(home, STATE_FILE)
      const garbage = '{ broken'
      await writeFile(statePath, garbage, 'utf8')
      // A non-empty directory squatting on the recovery name makes the
      // quarantine rename fail on every platform; the loader must then
      // reject so its caller keeps the host read-only instead of saving
      // defaults over the file it could not read.
      await mkdir(join(`${statePath}.corrupt-${process.pid}`, 'blocked'), { recursive: true })
      const state = defaultState()
      await expect(loadStateFile(state, home, [])).rejects.toThrow()
      expect(await readFile(statePath, 'utf8')).toBe(garbage)
    } finally {
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  })
})

describe('saveStateFile cross-host sync', () => {
  it('merges another host\'s writes back in instead of overwriting them', async () => {
    const home = await mkdtemp(join(tmpdir(), 'custom-plugin-sync-'))
    try {
      const statePath = join(home, STATE_FILE)
      const f1 = { id: 'f1', name: '工作', children: [], sessionIds: [], workspaceIds: [], prompts: [] }
      const f2 = { id: 'f2', name: '桌面', children: [], sessionIds: [], workspaceIds: [], prompts: [] }
      // What this host booted from.
      await writeFile(statePath, JSON.stringify({ folders: [f1] }), 'utf8')
      const state = defaultState()
      await loadStateFile(state, home, [])
      // The other host saves while this one is running: its own usage day and
      // a folder created in its GUI.
      await writeFile(statePath, JSON.stringify({
        folders: [f1, f2],
        usage: { '2026-09-20': { 'deepseek-chat': fullRow({ in: 10, calls: 1 }) } },
      }), 'utf8')
      // Local progress: a config edit (dirty section) and a usage day of our own.
      state.cfg.bg = '石板蓝'
      state.usage['2026-09-21'] = { 'deepseek-chat': fullRow({ in: 7, calls: 1 }) }
      await saveStateFile(state, home)
      const saved = JSON.parse(await readFile(statePath, 'utf8')) as { cfg?: { bg?: string }; folders?: unknown[]; usage?: Record<string, Record<string, UsageRow>> }
      // The untouched folders section adopts the external version instead of
      // reverting it; the locally-dirty config keeps the local edit.
      expect(saved.folders).toHaveLength(2)
      expect(saved.cfg?.bg).toBe('石板蓝')
      // Both hosts' usage days survive the save.
      expect(saved.usage?.['2026-09-20']?.['deepseek-chat']?.in).toBe(10)
      expect(saved.usage?.['2026-09-21']?.['deepseek-chat']?.in).toBe(7)
    } finally {
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  })

  it('unions two hosts\' concurrent additions to the same usage row exactly', async () => {
    const home = await mkdtemp(join(tmpdir(), 'custom-plugin-sync-row-'))
    try {
      const statePath = join(home, STATE_FILE)
      // The shared base both hosts last saved.
      await writeFile(statePath, JSON.stringify({ usage: { '2026-09-20': { 'deepseek-chat': fullRow({ in: 10, calls: 2 }) } } }), 'utf8')
      const state = defaultState()
      await loadStateFile(state, home, [])
      // The other host folded +5 in / +1 call since the base.
      await writeFile(statePath, JSON.stringify({ usage: { '2026-09-20': { 'deepseek-chat': fullRow({ in: 15, calls: 3 }) } } }), 'utf8')
      // This host folded +3 in / +1 call since the base.
      const row = state.usage['2026-09-20']['deepseek-chat']
      row.in = 13
      row.calls = 3
      await saveStateFile(state, home)
      const saved = JSON.parse(await readFile(statePath, 'utf8')) as { usage?: Record<string, Record<string, UsageRow>> }
      // theirs + ours − base per counter: (15+13−10) in, (3+3−2) calls.
      expect(saved.usage?.['2026-09-20']?.['deepseek-chat']?.in).toBe(18)
      expect(saved.usage?.['2026-09-20']?.['deepseek-chat']?.calls).toBe(4)
    } finally {
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  })

  it('saves over a fresh install without a merge attempt', async () => {
    const home = await mkdtemp(join(tmpdir(), 'custom-plugin-sync-fresh-'))
    try {
      const state = defaultState()
      await loadStateFile(state, home, [])
      state.cfg.bg = '雾蓝'
      await saveStateFile(state, home)
      const saved = JSON.parse(await readFile(join(home, STATE_FILE), 'utf8')) as { cfg?: { bg?: string } }
      expect(saved.cfg?.bg).toBe('雾蓝')
      expect((await readdir(home)).filter((name) => name !== STATE_FILE)).toEqual([])
    } finally {
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  })
})

describe('normalizeFolders / normalizeStars (browser edit gate)', () => {
  const leaf = { id: 'f1', name: '工作', children: [], sessionIds: ['s1', 's1'], workspaceIds: [], prompts: [] }

  it('accepts a valid tree and dedupes string id lists', () => {
    const folders = normalizeFolders([leaf, { ...leaf, id: 'f2', name: '生活', children: [{ ...leaf, id: 'f3' }] }])
    expect(folders).toHaveLength(2)
    expect(folders![0].sessionIds).toEqual(['s1'])
    expect(folders![1].children[0].id).toBe('f3')
  })

  it('rejects duplicate ids, missing arrays, and non-string members', () => {
    expect(normalizeFolders([leaf, { ...leaf, id: 'f1' }])).toBeNull()
    expect(normalizeFolders([{ ...leaf, sessionIds: 'nope' }])).toBeNull()
    expect(normalizeFolders([{ ...leaf, sessionIds: [1] }])).toBeNull()
    expect(normalizeFolders([{ ...leaf, name: 42 }])).toBeNull()
    expect(normalizeFolders('nope')).toBeNull()
  })

  it('rejects a tree deeper than the cap instead of letting stringify blow up later', () => {
    const deep = (depth: number): unknown => {
      let node: unknown = { id: `leaf-${depth}`, name: 'x', children: [], sessionIds: [], workspaceIds: [], prompts: [] }
      for (let i = 0; i < depth; i++) node = { id: `n-${i}`, name: 'x', children: [node], sessionIds: [], workspaceIds: [], prompts: [] }
      return node
    }
    expect(normalizeFolders([deep(30)])).not.toBeNull()
    expect(normalizeFolders([deep(200)])).toBeNull()
  })

  it('accepts a well-formed star map and rejects unsafe keys and bad entries', () => {
    expect(normalizeStars({ s1: { 12: true }, s2: {} })).toEqual({ s1: { 12: true }, s2: {} })
    // JSON — the actual wire shape — makes __proto__ an own property; an
    // object literal would have set the prototype instead.
    expect(normalizeStars(JSON.parse('{"__proto__": {"1": true}}'))).toBeNull()
    expect(normalizeStars({ constructor: { 1: true } })).toBeNull()
    expect(normalizeStars({ prototype: { 1: true } })).toBeNull()
    expect(normalizeStars({ s1: { x: true } })).toBeNull()
    expect(normalizeStars({ s1: { 12: false } })).toBeNull()
    expect(normalizeStars({ s1: [true] })).toBeNull()
    expect(normalizeStars([])).toBeNull()
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
