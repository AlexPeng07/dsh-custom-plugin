import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backupPreview, createBackup, importedState, parseBackup } from '../src/backup.ts'
import { CustomPluginHost } from '../src/host-service.ts'
import { defaultState } from '../src/state.ts'

describe('portable backup', () => {
  it('excludes the API key and validates the version', () => {
    const state = defaultState(); state.apiKey = 'sk-secret'
    const backup = createBackup(state)
    expect(JSON.stringify(backup)).not.toContain('sk-secret')
    expect(() => parseBackup({ ...backup, version: 2 })).toThrow(/版本/)
    expect(() => parseBackup({ ...backup, data: { ...backup.data, usage: { '2026-09-01': { model: { in: 1, out: 1, cacheIn: 0, cacheW: 0, reason: 0, calls: 1, peakSplitKnown: true } } } } })).toThrow(/用量/)
  })
  it('recognizes a complete legacy split even when the marker is omitted', () => {
    const backup = createBackup(defaultState())
    backup.data.usage = { '2026-09-01': { model: { in: 1, out: 1, cacheIn: 0, cacheW: 0, reason: 0, calls: 1, peakIn: 1, peakCacheIn: 0, peakCacheW: 0, peakOut: 1 } } }
    expect(parseBackup(backup).data.usage['2026-09-01'].model.peakSplitKnown).toBe(true)
  })
  it('rejects malformed numeric config and impossible peak counters', () => {
    const backup = createBackup(defaultState())
    expect(() => parseBackup({ ...backup, data: { ...backup.data, cfg: { ...backup.data.cfg, monthlyBudgetCny: 'oops' } } })).toThrow(/配置/)
    expect(() => parseBackup({ ...backup, data: { ...backup.data, usage: { '2026-09-01': { model: { in: 1, out: 0, cacheIn: 0, cacheW: 0, reason: 0, calls: 1, peakIn: 2, peakCacheIn: 0, peakCacheW: 0, peakOut: 0, peakSplitKnown: true } } } } })).toThrow(/用量/)
  })
  it('merges by stable id and preserves the current key', () => {
    const current = defaultState(); current.apiKey = 'sk-current'; current.prompts = [{ id: 'p1', name: '旧', text: '旧' }]
    const incoming = createBackup(defaultState()); incoming.data.prompts = [{ id: 'p1', name: '新', text: '新' }, { id: 'p2', name: '二', text: '二' }]
    const parsed = parseBackup(incoming)
    expect(backupPreview(current, parsed).conflicts.prompts).toBe(1)
    const merged = importedState(current, parsed, 'merge')
    expect(merged.prompts.map((item) => item.name)).toEqual(['新', '二'])
    expect(merged.apiKey).toBe('sk-current')
  })
  it('merges nested folder ids without dropping unrelated current children', () => {
    const current = defaultState()
    current.folders = [{ id: 'root', name: '旧根', children: [{ id: 'keep', name: '保留', children: [], sessionIds: [], workspaceIds: [], prompts: [] }], sessionIds: [], workspaceIds: [], prompts: [] }]
    const incoming = createBackup(defaultState())
    incoming.data.folders = [{ id: 'root', name: '新根', children: [{ id: 'child', name: '新子', children: [], sessionIds: [], workspaceIds: [], prompts: [] }], sessionIds: [], workspaceIds: [], prompts: [] }]
    const merged = importedState(current, parseBackup(incoming), 'merge')
    expect(merged.folders[0].name).toBe('新根')
    expect(merged.folders[0].children.map((item) => item.id)).toEqual(['keep', 'child'])
  })
  it('moves a folder when the imported parent changed without leaving a duplicate root', () => {
    const current = defaultState()
    current.folders = [{ id: 'a', name: 'A', children: [], sessionIds: [], workspaceIds: [], prompts: [] }]
    const incoming = createBackup(defaultState())
    incoming.data.folders = [{ id: 'b', name: 'B', children: [{ id: 'a', name: 'A2', children: [], sessionIds: [], workspaceIds: [], prompts: [] }], sessionIds: [], workspaceIds: [], prompts: [] }]
    const merged = importedState(current, parseBackup(incoming), 'merge')
    expect(merged.folders.map((item) => item.id)).toEqual(['b'])
    expect(merged.folders[0].children.map((item) => item.id)).toEqual(['a'])
    expect(merged.folders[0].children[0].name).toBe('A2')
  })
  it('honors imported sibling order for existing folder ids', () => {
    const current = defaultState()
    current.folders = [{ id: 'root', name: '根', children: [
      { id: 'a', name: 'A', children: [], sessionIds: [], workspaceIds: [], prompts: [] },
      { id: 'b', name: 'B', children: [], sessionIds: [], workspaceIds: [], prompts: [] },
    ], sessionIds: [], workspaceIds: [], prompts: [] }]
    const incoming = createBackup(defaultState())
    incoming.data.folders = [{ id: 'root', name: '根2', children: [
      { id: 'b', name: 'B2', children: [], sessionIds: [], workspaceIds: [], prompts: [] },
      { id: 'a', name: 'A2', children: [], sessionIds: [], workspaceIds: [], prompts: [] },
    ], sessionIds: [], workspaceIds: [], prompts: [] }]
    const merged = importedState(current, parseBackup(incoming), 'merge')
    expect(merged.folders[0].children.map((item) => item.id)).toEqual(['b', 'a'])
  })
  it('restores memory state when persistence fails and leaves a secret-free recovery file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'custom-backup-'))
    try {
      const state = defaultState(); state.apiKey = 'sk-secret'; state.cfg.bg = '雾蓝'
      const incomingState = defaultState(); incomingState.cfg.bg = '极光'
      const host = new CustomPluginHost({ sessionQuery: {} as never, state, statePath: () => join(dir, 'state.json'), saveNow: async () => { throw new Error('disk full') }, reportDiag: () => {}, diagReports: [] })
      const result = await host.backupImport(createBackup(incomingState), 'replace', false)
      expect(result.ok).toBe(false)
      expect(state.cfg.bg).toBe('雾蓝')
      expect(await readFile(join(dir, 'state.json.backup.json'), 'utf8')).not.toContain('sk-secret')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('serializes an import with a live usage event instead of losing the event', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'custom-backup-race-'))
    try {
      const state = defaultState()
      let started!: () => void
      const saveStarted = new Promise<void>((resolve) => { started = resolve })
      let release!: () => void
      const saveRelease = new Promise<void>((resolve) => { release = resolve })
      const host = new CustomPluginHost({ sessionQuery: {} as never, state, statePath: () => join(dir, 'state.json'), saveNow: async () => { started(); await saveRelease }, reportDiag: () => {}, diagReports: [] })
      host.rememberModel('live', 'deepseek-v4-flash')
      const importPromise = host.backupImport(createBackup(defaultState()), 'replace', false)
      // The event is deliberately delivered in the same turn as the import
      // call, before its promise continuation starts.
      host.foldUsage('live', { inputTokens: 3 }, Date.now())
      await saveStarted
      release()
      const result = await importPromise
      expect(result.ok).toBe(true)
      expect(state.usage).not.toEqual({})
      expect(Object.values(state.usage)[0]['deepseek-v4-flash'].in).toBe(3)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('serializes concurrent imports and chains recovery snapshots', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'custom-backup-concurrent-'))
    try {
      const state = defaultState()
      const firstState = defaultState(); firstState.cfg.bg = '雾蓝'
      const secondState = defaultState(); secondState.cfg.bg = '极光'
      let firstSaveStarted!: () => void
      const saveStarted = new Promise<void>((resolve) => { firstSaveStarted = resolve })
      let releaseFirst!: () => void
      const release = new Promise<void>((resolve) => { releaseFirst = resolve })
      let saveCount = 0
      const host = new CustomPluginHost({
        sessionQuery: {} as never,
        state,
        statePath: () => join(dir, 'state.json'),
        saveNow: async () => {
          saveCount++
          if (saveCount === 1) { firstSaveStarted(); await release }
        },
        reportDiag: () => {},
        diagReports: [],
      })

      const first = host.backupImport(createBackup(firstState), 'replace', false)
      await saveStarted
      const second = host.backupImport(createBackup(secondState), 'replace', false)
      releaseFirst()
      const results = await Promise.all([first, second])
      expect(results.every((result) => result.ok === true)).toBe(true)
      expect(saveCount).toBe(2)
      expect(state.cfg.bg).toBe('极光')
      const recovery = JSON.parse(await readFile(join(dir, 'state.json.backup.json'), 'utf8')) as { data: { cfg: { bg?: string } } }
      expect(recovery.data.cfg.bg).toBe('雾蓝')
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
