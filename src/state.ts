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

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { dshHome } from './dsh-home.ts'
import { DEFAULT_CONFIG, type CustomPluginConfig, type CustomPluginState, type FolderNode, type PromptItem, type StarsMap, type UsageMap } from './protocol.ts'
import { pruneUsage } from './usage.ts'

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
    } else if (typeof current === 'string') {
      if (typeof value === 'string') (cfg as Record<string, unknown>)[key] = value
    }
  }
  // Retired keys (clouds / wind) are dropped by construction: only the keys
  // listed in DEFAULT_CONFIG are ever copied.
  return cfg
}

/** Merge a persisted document into the default state, ignoring unknown shapes. */
export function mergeState(target: CustomPluginState, raw: unknown): void {
  if (raw === null || typeof raw !== 'object') return
  const src = raw as Record<string, unknown>
  if (src.cfg !== undefined) target.cfg = normalizeCfg(src.cfg)
  if (Array.isArray(src.folders)) target.folders = src.folders as FolderNode[]
  if (Array.isArray(src.prompts)) target.prompts = src.prompts as PromptItem[]
  if (src.stars !== null && typeof src.stars === 'object' && !Array.isArray(src.stars)) target.stars = src.stars as StarsMap
  if (typeof src.apiKey === 'string') target.apiKey = src.apiKey
  if (src.usage !== null && typeof src.usage === 'object' && !Array.isArray(src.usage)) target.usage = src.usage as UsageMap
}

/** Load and merge the persisted document into `state`. */
export async function loadStateFile(
  state: CustomPluginState,
  home: string = dshHome(),
): Promise<string> {
  const statePath = join(home, STATE_FILE)
  let raw: unknown = null
  try {
    const text = await readFile(statePath, 'utf8')
    raw = JSON.parse(text)
  } catch {
    raw = null
  }
  if (raw !== null) mergeState(state, raw)
  // Keep the JSON document bounded even when the user has not opened the
  // usage panel for a long time. The loader saves the normalized state after
  // this function resolves.
  pruneUsage(state.usage)
  return statePath
}

/** In-flight save per state path: concurrent saves queue instead of racing
 * on the shared .tmp file. Two writers renaming one temp file is the Windows
 * EPERM/EBUSY source; queuing also coalesces naturally, because each turn
 * serializes the live document when it runs, not when it was requested. */
const saveQueues = new Map<string, Promise<void>>()

/** Atomically persist the state document. Saves to the same path are
 * serialized: a caller awaits its own turn's completion, a failed turn never
 * poisons the queue behind it. */
export function saveStateFile(state: CustomPluginState, home: string = dshHome()): Promise<void> {
  const statePath = join(home, STATE_FILE)
  const turn = (saveQueues.get(statePath) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      await mkdir(dirname(statePath), { recursive: true })
      const tmpPath = statePath + '.tmp'
      await writeFile(tmpPath, JSON.stringify(state), 'utf8')
      await rename(tmpPath, statePath)
    })
  saveQueues.set(statePath, turn)
  return turn.finally(() => {
    if (saveQueues.get(statePath) === turn) saveQueues.delete(statePath)
  })
}
