/**
 * Host-owned state store for dsh-custom-plugin.
 *
 * One JSON document at `$DSH_HOME/custom-plugin-state.json` holds the
 * appearance configuration, folder tree, prompt library, starred timeline
 * nodes, the balance API key, and the per-day token usage ledger. Writes are
 * atomic (temp file + rename) and serialized (one in-flight write per path),
 * so a crash never truncates the document and concurrent saves never race
 * on the temp file.
 * @module @alexpeng/dsh-custom-plugin/state
 */

import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { dshHome } from './dsh-home.ts'
import { DEFAULT_CONFIG, type CustomPluginConfig, type CustomPluginState, type FolderNode, type PromptItem, type StarsMap, type UsageMap, type UsageRow } from './protocol.ts'
import { createUsageRow, pruneUsage } from './usage.ts'

/** State file name of this plugin. */
export const STATE_FILE = 'custom-plugin-state.json'

/** Default state document. */
export function defaultState(): CustomPluginState {
  return {
    cfg: { ...DEFAULT_CONFIG },
    folders: [],
    prompts: [],
    stars: {},
    apiKey: '',
    usage: {},
  }
}

/** Normalize a stored configuration: strip retired keys and fill defaults. */
export function normalizeCfg(raw: unknown): CustomPluginConfig {
  const cfg: CustomPluginConfig = { ...DEFAULT_CONFIG }
  if (raw === null || typeof raw !== 'object') return cfg
  const src = raw as Record<string, unknown>
  for (const key of Object.keys(DEFAULT_CONFIG) as Array<keyof CustomPluginConfig>) {
    const value = src[key]
    if (value === undefined) continue
    const current = cfg[key]
    if (typeof current === 'boolean') {
      if (typeof value === 'boolean') (cfg as Record<string, unknown>)[key] = value
    } else if (typeof current === 'number') {
      if (typeof value === 'number' && Number.isFinite(value)) (cfg as Record<string, unknown>)[key] = value
    } else if (typeof current === 'string') {
      if (typeof value === 'string') (cfg as Record<string, unknown>)[key] = value
    }
  }
  // Budget values are user-facing numeric settings. Keep malformed or stale
  // values inside the documented range even when they came from an older
  // state file or an external backup.
  cfg.monthlyBudgetCny = Math.max(0, cfg.monthlyBudgetCny ?? 0)
  cfg.budgetWarningPercent = Math.max(1, Math.min(100, cfg.budgetWarningPercent ?? 80))
  // The aurora preset was removed; migrate a stored value to "no color".
  if (cfg.bg === 'aurora') cfg.bg = 'default'
  // Retired keys (clouds / wind, and the timeline trio removed with the rail)
  // are dropped by construction: only the keys listed in DEFAULT_CONFIG are
  // ever copied.
  return cfg
}

/** Normalize one prompt while retaining its stable identity and order. */
export function normalizePrompt(raw: unknown): PromptItem | null {
  if (raw === null || typeof raw !== 'object') return null
  const src = raw as Record<string, unknown>
  if (typeof src.id !== 'string' || src.id === '' || typeof src.name !== 'string' || typeof src.text !== 'string') return null
  return {
    id: src.id,
    name: src.name,
    text: src.text,
    tags: Array.isArray(src.tags) ? [...new Set(src.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean))] : [],
    favorite: src.favorite === true,
    useCount: typeof src.useCount === 'number' && Number.isFinite(src.useCount) && src.useCount >= 0 ? Math.floor(src.useCount) : 0,
    lastUsedAt: typeof src.lastUsedAt === 'number' && Number.isFinite(src.lastUsedAt) && src.lastUsedAt > 0 ? src.lastUsedAt : undefined,
  }
}

/** Merge a persisted document into the default state, ignoring unknown shapes. */
export function mergeState(target: CustomPluginState, raw: unknown): void {
  if (raw === null || typeof raw !== 'object') return
  const src = raw as Record<string, unknown>
  if (src.cfg !== undefined) target.cfg = normalizeCfg(src.cfg)
  if (Array.isArray(src.folders)) target.folders = src.folders as FolderNode[]
  if (Array.isArray(src.prompts)) target.prompts = src.prompts.map(normalizePrompt).filter((item): item is PromptItem => item !== null)
  if (src.stars !== null && typeof src.stars === 'object' && !Array.isArray(src.stars)) target.stars = src.stars as StarsMap
  if (typeof src.apiKey === 'string') target.apiKey = src.apiKey
  if (src.usage !== null && typeof src.usage === 'object' && !Array.isArray(src.usage)) target.usage = src.usage as UsageMap
}

/** Rejection caps for browser-supplied documents. A shape beyond them is
 * rejected outright — never truncated — because the client owns the whole
 * document and a partial accept would silently drop the rest. The depth cap
 * is what keeps a hostile edit from making `JSON.stringify` throw
 * `RangeError` on every later save. */
const MAX_FOLDER_DEPTH = 32
const MAX_FOLDER_NODES = 2000
const MAX_STAR_ENTRIES = 10000

function safeKeyPart(value: string): boolean {
  return value !== '__proto__' && value !== 'constructor' && value !== 'prototype'
}

/**
 * Validate a folder tree from the browser against the persisted shape:
 * unique non-empty ids, string name, and string-only id lists, bounded in
 * depth and node count. Null on any violation — the caller rejects the edit.
 */
export function normalizeFolders(raw: unknown): FolderNode[] | null {
  if (!Array.isArray(raw)) return null
  const seen = new Set<string>()
  let count = 0
  const walk = (node: unknown, depth: number): FolderNode | null => {
    if (node === null || typeof node !== 'object') return null
    const src = node as Record<string, unknown>
    if (typeof src.id !== 'string' || src.id === '' || seen.has(src.id)) return null
    if (typeof src.name !== 'string') return null
    if (!Array.isArray(src.children) || !Array.isArray(src.sessionIds) || !Array.isArray(src.workspaceIds) || !Array.isArray(src.prompts)) return null
    const strings = (value: unknown[]): string[] | null => value.every((item) => typeof item === 'string') ? [...new Set(value as string[])] : null
    const sessionIds = strings(src.sessionIds)
    const workspaceIds = strings(src.workspaceIds)
    const prompts = strings(src.prompts)
    if (sessionIds === null || workspaceIds === null || prompts === null) return null
    if (depth >= MAX_FOLDER_DEPTH) return null
    if (++count > MAX_FOLDER_NODES) return null
    seen.add(src.id)
    const children: FolderNode[] = []
    for (const child of src.children) {
      const parsed = walk(child, depth + 1)
      if (parsed === null) return null
      children.push(parsed)
    }
    return { id: src.id, name: src.name, children, sessionIds, workspaceIds, prompts }
  }
  const out: FolderNode[] = []
  for (const node of raw) {
    const parsed = walk(node, 0)
    if (parsed === null) return null
    out.push(parsed)
  }
  return out
}

/**
 * Validate a star map from the browser: session ids as safe object keys,
 * digit-string sequence keys, `true` values only, bounded total. Null on any
 * violation.
 */
export function normalizeStars(raw: unknown): StarsMap | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: StarsMap = {}
  let total = 0
  for (const [sessionId, entries] of Object.entries(raw as Record<string, unknown>)) {
    if (!safeKeyPart(sessionId)) return null
    if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) return null
    const clean: Record<string, boolean> = {}
    for (const [seq, value] of Object.entries(entries as Record<string, unknown>)) {
      if (value !== true || !/^\d+$/.test(seq)) return null
      if (++total > MAX_STAR_ENTRIES) return null
      clean[seq] = true
    }
    out[sessionId] = clean
  }
  return out
}

/** Retry ladder for a transiently unreadable state file (AV scan, sync
 * client, a sharing violation racing the Desktop host's rename). Same
 * cadence as the browser half's load retries, so a slow-locking file heals
 * inside the window the client is still retrying its first read. */
const LOAD_RETRY_DELAYS = [1500, 3000, 6000]

/**
 * Load and merge the persisted document into `state`.
 *
 * A missing file (ENOENT) is a fresh install and resolves with defaults. A
 * corrupt or permanently unreadable file is renamed aside before defaults
 * are adopted, so the caller's immediate save cannot destroy the previous
 * bytes. Only when the file is unreadable AND cannot be moved aside does
 * this reject — the caller must then suppress saves, because persisting
 * never-loaded defaults would clobber a document that may be intact.
 */
export async function loadStateFile(
  state: CustomPluginState,
  home: string = dshHome(),
  retryDelays: readonly number[] = LOAD_RETRY_DELAYS,
): Promise<string> {
  const statePath = join(home, STATE_FILE)
  let text: string
  let mtimeMs = 0
  let size = 0
  for (let attempt = 0; ; attempt++) {
    try {
      // One handle for fstat + read: the baseline identity and the merged
      // bytes then describe the same document even if another host saves
      // between the two calls.
      const handle = await open(statePath, 'r')
      try {
        const st = await handle.stat()
        text = await handle.readFile('utf8')
        mtimeMs = st.mtimeMs
        size = st.size
      } finally {
        await handle.close()
      }
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        syncBaselines.set(statePath, null)
        return statePath
      }
      if (attempt < retryDelays.length) {
        await new Promise((resolve) => { setTimeout(resolve, retryDelays[attempt]) })
        continue
      }
      await quarantineStateFile(statePath, error)
      syncBaselines.set(statePath, null)
      return statePath
    }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    // Unrecoverable in place; keep the bytes aside and start from defaults.
    await quarantineStateFile(statePath, error)
    syncBaselines.set(statePath, null)
    raw = null
  }
  if (raw !== null) {
    mergeState(state, raw)
    syncBaselines.set(statePath, { mtimeMs, size, doc: text })
  }
  // Keep the JSON document bounded even when the user has not opened the
  // usage panel for a long time. The loader saves the normalized state after
  // this function resolves.
  pruneUsage(state.usage)
  return statePath
}

/**
 * Rename an unusable state document aside, pid-qualified like the atomic
 * save temp: `$DSH_HOME` is shared by every host under it, so two hosts
 * quarantining must not fight over one recovery name. A file that vanished
 * between the failed read and this rename needs no recovery copy; any other
 * rename failure propagates so the caller knows not to save defaults over a
 * document it could neither read nor preserve.
 */
async function quarantineStateFile(statePath: string, cause: unknown): Promise<void> {
  try {
    await rename(statePath, `${statePath}.corrupt-${process.pid}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return
    throw new Error(`state file unreadable and could not be quarantined (read: ${String((cause as Error)?.message ?? cause)}; rename: ${String((error as Error)?.message ?? error)})`, { cause: error })
  }
}

/** In-flight save per state path: concurrent saves queue instead of racing on
 * the rename order. Two writers renaming one temp file is the Windows
 * EPERM/EBUSY source; queuing also coalesces naturally, because each turn
 * serializes the live document when it runs, not when it was requested. */
const saveQueues = new Map<string, Promise<void>>()

/**
 * Temp name for an atomic replace, qualified by the writing process.
 *
 * The queue above is per-process, but `$DSH_HOME` is not: dsh Web and dsh
 * Desktop both run hosts against one home (separate profiles, one `$DSH_HOME`),
 * so a fixed temp name would let the two hosts write and rename the same file
 * and hand each other a partially written document.
 */
export function tempPathFor(target: string, pid: number = process.pid): string {
  return `${target}.${pid}.tmp`
}

/** Atomically persist the state document. Saves to the same path are
 * serialized: a caller awaits its own turn's completion, a failed turn never
 * poisons the queue behind it. Before writing, another host's changes since
 * this process last loaded or saved the file are merged back in (see
 * `mergeExternalChanges`). */
export function saveStateFile(state: CustomPluginState, home: string = dshHome()): Promise<void> {
  const statePath = join(home, STATE_FILE)
  const turn = (saveQueues.get(statePath) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      await mergeExternalChanges(state, statePath)
      await mkdir(dirname(statePath), { recursive: true })
      const doc = JSON.stringify(state)
      const tmpPath = tempPathFor(statePath)
      try {
        await writeFile(tmpPath, doc, 'utf8')
        await rename(tmpPath, statePath)
      } catch (error) {
        // A pid-qualified temp would otherwise survive a failed turn and accumulate.
        await rm(tmpPath, { force: true }).catch(() => { /* the rename may have landed; nothing left to clean */ })
        throw error
      }
      // Record what this process just made the file look like, so the next
      // turn can tell its own writes from another host's.
      const st = await stat(statePath).catch(() => null)
      syncBaselines.set(statePath, st !== null ? { mtimeMs: st.mtimeMs, size: st.size, doc } : null)
    })
  saveQueues.set(statePath, turn)
  return turn.finally(() => {
    if (saveQueues.get(statePath) === turn) saveQueues.delete(statePath)
  })
}

/** Per-path view of the on-disk document this process last saw: its stat
 * identity and its serialized bytes. `$DSH_HOME` is shared by every dsh host
 * under it (Web + Desktop), so a save must first notice whether another host
 * wrote the file since. `null` marks "believed absent"; no entry at all marks
 * "never loaded through this module", where a direct save keeps the plain
 * last-writer-wins behavior. */
const syncBaselines = new Map<string, { mtimeMs: number; size: number; doc: string } | null>()

/**
 * Fold another host's writes back in before this process saves over them.
 *
 * Each host holds the whole document in memory, so an unchecked save is
 * last-writer-wins and silently discards the other host's usage folds and
 * config edits. When the file's stat identity no longer matches what this
 * process last wrote or loaded, the current bytes are re-read and three-way
 * merged against the last-saved snapshot: sections this process has not
 * touched adopt the external version, the usage ledger unions arithmetically
 * (`theirs + ours − base` per counter — exact for two hosts that both
 * started from `base`), and locally-dirty sections keep the local version.
 *
 * The stat fast path misses only a same-instant, same-length rewrite by
 * another host. An unreadable or undecodable external document falls back to
 * the plain overwrite — the boot-time quarantine remains the backstop for
 * the destructive case.
 */
async function mergeExternalChanges(state: CustomPluginState, statePath: string): Promise<void> {
  const baseline = syncBaselines.get(statePath)
  if (baseline === undefined) return
  const st = await stat(statePath).catch(() => null)
  if (st === null) return // absent (or vanishing mid-check): nothing to merge
  if (baseline !== null && st.mtimeMs === baseline.mtimeMs && st.size === baseline.size) return
  const text = await readFile(statePath, 'utf8').catch(() => null)
  if (text === null) return
  let theirs: unknown
  try {
    theirs = JSON.parse(text)
  } catch {
    return // an undecodable external document has nothing mergeable
  }
  if (theirs === null || typeof theirs !== 'object') return
  mergeThreeWay(state, baseline !== null ? safeParse(baseline.doc) : null, theirs as Record<string, unknown>)
}

function safeParse(text: string): CustomPluginState | null {
  try {
    return JSON.parse(text) as CustomPluginState
  } catch {
    return null
  }
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function mergeThreeWay(state: CustomPluginState, base: CustomPluginState | null, theirs: Record<string, unknown>): void {
  const t = theirs as Partial<CustomPluginState>
  const b = (base ?? {}) as Partial<CustomPluginState>
  if (sameJson(state.cfg, b.cfg)) state.cfg = normalizeCfg(t.cfg)
  if (sameJson(state.folders, b.folders) && Array.isArray(t.folders)) state.folders = t.folders as FolderNode[]
  if (sameJson(state.prompts, b.prompts) && Array.isArray(t.prompts)) state.prompts = t.prompts.map(normalizePrompt).filter((item): item is PromptItem => item !== null)
  if (sameJson(state.stars, b.stars) && t.stars !== null && typeof t.stars === 'object' && !Array.isArray(t.stars)) state.stars = t.stars as StarsMap
  if (sameJson(state.apiKey, b.apiKey) && typeof t.apiKey === 'string') state.apiKey = t.apiKey
  state.usage = mergeUsageThreeWay(state.usage, base?.usage ?? {}, t.usage)
}

const USAGE_COUNTER_KEYS = ['in', 'out', 'cacheIn', 'cacheW', 'reason', 'calls', 'peakIn', 'peakCacheIn', 'peakCacheW', 'peakOut'] as const

function counterOf(row: UsageRow | undefined, key: (typeof USAGE_COUNTER_KEYS)[number]): number {
  const value = row?.[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

/** Union two hosts' ledgers given the snapshot both last saved. For every
 * counter `theirs + ours − base` is exactly the combined progress when both
 * hosts started from `base` (their session streams are disjoint: separate
 * dsh profiles under one `$DSH_HOME`); clamped at zero so a tampered base
 * cannot drive a row negative. */
function mergeUsageThreeWay(ours: UsageMap, base: UsageMap, theirsRaw: unknown): UsageMap {
  const theirs = theirsRaw !== null && typeof theirsRaw === 'object' && !Array.isArray(theirsRaw) ? theirsRaw as UsageMap : {}
  const merged: UsageMap = {}
  for (const day of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
    const mergedDay: Record<string, UsageRow> = {}
    for (const model of new Set([...Object.keys(ours[day] ?? {}), ...Object.keys(theirs[day] ?? {})])) {
      const om = ours[day]?.[model]
      const tm = theirs[day]?.[model]
      if (om === undefined && tm === undefined) continue
      const row = createUsageRow()
      for (const key of USAGE_COUNTER_KEYS) {
        ;(row as unknown as Record<string, number>)[key] = Math.max(0, counterOf(tm, key) + counterOf(om, key) - counterOf(base[day]?.[model], key))
      }
      row.peakSplitKnown = !(om?.peakSplitKnown === false || tm?.peakSplitKnown === false)
      mergedDay[model] = row
    }
    if (Object.keys(mergedDay).length > 0) merged[day] = mergedDay
  }
  pruneUsage(merged)
  return merged
}
