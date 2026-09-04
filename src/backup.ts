/** Validation and merge rules for versioned, secret-free local backups. */
import { rename, writeFile } from 'node:fs/promises'
import { DEFAULT_CONFIG, type BackupImportMode, type BackupImportPreview, type CustomPluginBackupV1, type CustomPluginConfig, type CustomPluginState, type FolderNode, type PromptItem, type StarsMap, type UsageMap, type UsageRow } from './protocol.ts'
import { normalizeCfg, normalizePrompt } from './state.ts'
import { pruneUsage } from './usage.ts'

export const BACKUP_FORMAT = 'dsh-custom-plugin-backup' as const
export const BACKUP_VERSION = 1 as const
export const BACKUP_BODY_LIMIT = 5 * 1024 * 1024

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function counter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function validDayKey(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function strictCfg(raw: unknown): CustomPluginConfig {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('配置数据无效')
  const src = raw as Record<string, unknown>
  for (const key of Object.keys(DEFAULT_CONFIG) as Array<keyof CustomPluginConfig>) {
    const value = src[key]
    if (value === undefined) continue
    const expected = DEFAULT_CONFIG[key]
    if (typeof value !== typeof expected) throw new Error('配置数据无效')
    if (typeof expected === 'number') {
      const numericValue = value as number
      if (!Number.isFinite(numericValue) || (key === 'monthlyBudgetCny' && numericValue < 0) || (key === 'budgetWarningPercent' && (numericValue < 1 || numericValue > 100))) throw new Error('配置数据无效')
    }
  }
  return normalizeCfg(raw)
}

function safeKey(value: string): boolean {
  return value !== '__proto__' && value !== 'constructor' && value !== 'prototype'
}

function folder(raw: unknown, seen: Set<string>): FolderNode | null {
  if (raw === null || typeof raw !== 'object') return null
  const src = raw as Record<string, unknown>
  if (typeof src.id !== 'string' || src.id === '' || seen.has(src.id) || typeof src.name !== 'string') return null
  seen.add(src.id)
  if (!Array.isArray(src.children) || !Array.isArray(src.sessionIds) || !Array.isArray(src.workspaceIds) || !Array.isArray(src.prompts)) return null
  const children = src.children.map((item) => folder(item, seen))
  if (children.some((item) => item === null)) return null
  const strings = (value: unknown[]): string[] | null => value.every((item) => typeof item === 'string') ? [...new Set(value as string[])] : null
  const sessionIds = strings(src.sessionIds)
  const workspaceIds = strings(src.workspaceIds)
  const prompts = strings(src.prompts)
  if (sessionIds === null || workspaceIds === null || prompts === null) return null
  return { id: src.id, name: src.name, children: children as FolderNode[], sessionIds, workspaceIds, prompts }
}

function usageRow(raw: unknown): UsageRow | null {
  if (raw === null || typeof raw !== 'object') return null
  const src = raw as Record<string, unknown>
  for (const key of ['in', 'out', 'cacheIn', 'cacheW', 'reason', 'calls']) if (!counter(src[key])) return null
  const row: UsageRow = { in: src.in as number, out: src.out as number, cacheIn: src.cacheIn as number, cacheW: src.cacheW as number, reason: src.reason as number, calls: src.calls as number }
  let providedPeakCounters = 0
  for (const key of ['peakIn', 'peakCacheIn', 'peakCacheW', 'peakOut'] as const) {
    if (src[key] !== undefined) {
      if (!counter(src[key])) return null
      providedPeakCounters++
    }
    if (typeof src[key] === 'number') row[key] = src[key]
  }
  if (providedPeakCounters !== 0 && providedPeakCounters !== 4) return null
  if (src.peakSplitKnown !== undefined && typeof src.peakSplitKnown !== 'boolean') return null
  const hasPeakCounters = providedPeakCounters === 4
  if (src.peakSplitKnown === true && !hasPeakCounters) return null
  if (hasPeakCounters && (row.peakIn! > row.in || row.peakCacheIn! > row.cacheIn || row.peakCacheW! > row.cacheW || row.peakOut! > row.out)) return null
  row.peakSplitKnown = src.peakSplitKnown === false ? false : hasPeakCounters
  return row
}

export function createBackup(state: CustomPluginState): CustomPluginBackupV1 {
  const seen = new Set<string>()
  const folders = (Array.isArray(state.folders) ? state.folders : []).map((item) => folder(item, seen)).filter((item): item is FolderNode => item !== null)
  const prompts = (Array.isArray(state.prompts) ? state.prompts : []).map(normalizePrompt).filter((item): item is PromptItem => item !== null)
  const stars: StarsMap = {}
  if (state.stars !== null && typeof state.stars === 'object') {
    for (const [sessionId, entries] of Object.entries(state.stars)) {
      if (!safeKey(sessionId) || entries === null || typeof entries !== 'object' || Array.isArray(entries)) continue
      const clean: Record<string, boolean> = {}
      for (const [seq, value] of Object.entries(entries)) if (value === true && /^\d+$/.test(seq)) clean[seq] = true
      if (Object.keys(clean).length > 0) stars[sessionId] = clean
    }
  }
  const usage: UsageMap = {}
  if (state.usage !== null && typeof state.usage === 'object') {
    for (const [day, models] of Object.entries(state.usage)) {
      if (!validDayKey(day) || models === null || typeof models !== 'object' || Array.isArray(models)) continue
      const clean: Record<string, UsageRow> = {}
      for (const [model, rawRow] of Object.entries(models)) {
        if (!safeKey(model)) continue
        const row = usageRow(rawRow)
        if (model !== '' && row !== null) clean[model] = row
      }
      if (Object.keys(clean).length > 0) usage[day] = clean
    }
  }
  return clone({ format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data: { cfg: normalizeCfg(state.cfg), folders, prompts, stars, usage } })
}

export function parseBackup(raw: unknown): CustomPluginBackupV1 {
  if (raw === null || typeof raw !== 'object') throw new Error('备份文件不是 JSON 对象')
  const src = raw as Record<string, unknown>
  if (src.format !== BACKUP_FORMAT || src.version !== BACKUP_VERSION) throw new Error('不支持的备份格式或版本')
  if (typeof src.exportedAt !== 'string' || Number.isNaN(Date.parse(src.exportedAt))) throw new Error('备份时间无效')
  if (src.data === null || typeof src.data !== 'object') throw new Error('备份数据缺失')
  const data = src.data as Record<string, unknown>
  if (data.cfg === null || typeof data.cfg !== 'object' || Array.isArray(data.cfg) || !Array.isArray(data.folders) || !Array.isArray(data.prompts) || data.stars === null || typeof data.stars !== 'object' || Array.isArray(data.stars) || data.usage === null || typeof data.usage !== 'object' || Array.isArray(data.usage)) throw new Error('备份数据结构无效')
  const seen = new Set<string>()
  const folders = data.folders.map((item) => folder(item, seen))
  if (folders.some((item) => item === null)) throw new Error('文件夹数据无效')
  const prompts = data.prompts.map(normalizePrompt)
  if (prompts.some((item) => item === null)) throw new Error('提示词数据无效')
  const stars: StarsMap = {}
  for (const [sessionId, entries] of Object.entries(data.stars as Record<string, unknown>)) {
    if (!safeKey(sessionId)) throw new Error('星标数据无效')
    if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) throw new Error('星标数据无效')
    stars[sessionId] = {}
    for (const [seq, value] of Object.entries(entries as Record<string, unknown>)) {
      if (value !== true || !/^\d+$/.test(seq)) throw new Error('星标数据无效')
      stars[sessionId][seq] = true
    }
  }
  const usage: UsageMap = {}
  for (const [day, models] of Object.entries(data.usage as Record<string, unknown>)) {
    if (!validDayKey(day) || models === null || typeof models !== 'object' || Array.isArray(models)) throw new Error('用量数据无效')
    usage[day] = {}
    for (const [model, rawRow] of Object.entries(models as Record<string, unknown>)) {
      if (!safeKey(model)) throw new Error('用量数据无效')
      const row = usageRow(rawRow)
      if (model === '' || row === null) throw new Error('用量数据无效')
      usage[day][model] = row
    }
  }
  pruneUsage(usage)
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: src.exportedAt, data: { cfg: strictCfg(data.cfg), folders: folders as FolderNode[], prompts: prompts as PromptItem[], stars, usage } }
}

function folderIds(nodes: readonly FolderNode[], out = new Set<string>()): Set<string> {
  for (const node of nodes) { out.add(node.id); folderIds(node.children, out) }
  return out
}

export function backupPreview(current: CustomPluginState, backup: CustomPluginBackupV1): BackupImportPreview {
  const currentFolders = folderIds(current.folders)
  const incomingFolders = folderIds(backup.data.folders)
  const currentPrompts = new Set(current.prompts.map((item) => item.id))
  return {
    folders: incomingFolders.size,
    prompts: backup.data.prompts.length,
    starredSessions: Object.keys(backup.data.stars).length,
    usageDays: Object.keys(backup.data.usage).length,
    conflicts: {
      folders: [...incomingFolders].filter((id) => currentFolders.has(id)).length,
      prompts: backup.data.prompts.filter((item) => currentPrompts.has(item.id)).length,
      usageDays: Object.keys(backup.data.usage).filter((day) => current.usage[day] !== undefined).length,
    },
  }
}

function mergeById<T extends { id: string }>(current: readonly T[], incoming: readonly T[]): T[] {
  const replacements = new Map(incoming.map((item) => [item.id, clone(item)]))
  const out = current.map((item) => replacements.get(item.id) ?? item)
  for (const item of incoming) if (!current.some((old) => old.id === item.id)) out.push(clone(item))
  return out
}

/** Merge a folder tree by stable node id. Imported parents and sibling order
 * win for nodes present in the document; current nodes absent from it remain
 * in their existing order. This also moves a duplicate node when its parent
 * changed in the imported tree, instead of leaving a stale root copy behind. */
function mergeFolders(current: readonly FolderNode[], incoming: readonly FolderNode[]): FolderNode[] {
  const incomingIds = folderIds(incoming)
  const index = new Map<string, FolderNode>()
  const indexTree = (nodes: readonly FolderNode[]): void => {
    for (const node of nodes) { index.set(node.id, node); indexTree(node.children) }
  }
  indexTree(current)

  const retain = (node: FolderNode): FolderNode | null => {
    if (incomingIds.has(node.id)) return null
    const children = node.children.map(retain).filter((item): item is FolderNode => item !== null)
    return { id: node.id, name: node.name, children, sessionIds: clone(node.sessionIds), workspaceIds: clone(node.workspaceIds), prompts: clone(node.prompts) }
  }

  const imported = (source: FolderNode): FolderNode => {
    const currentNode = index.get(source.id)
    // Unrelated current children stay before the imported sequence; all
    // imported siblings then follow the exact order from the backup.
    const children = (currentNode?.children ?? []).map(retain).filter((item): item is FolderNode => item !== null)
      .concat(source.children.map(imported))
    return { id: source.id, name: source.name, children, sessionIds: clone(source.sessionIds), workspaceIds: clone(source.workspaceIds), prompts: clone(source.prompts) }
  }

  // The imported tree owns the ordering of imported roots. Current roots that
  // are absent from the document are appended in their existing order.
  const out = incoming.map(imported)
  for (const node of current) if (!incomingIds.has(node.id)) {
    const kept = retain(node)
    if (kept !== null) out.push(kept)
  }
  return out
}

export function importedState(current: CustomPluginState, backup: CustomPluginBackupV1, mode: BackupImportMode): CustomPluginState {
  const data = backup.data
  if (mode === 'replace') return { cfg: clone(data.cfg), folders: clone(data.folders), prompts: clone(data.prompts), stars: clone(data.stars), usage: clone(data.usage), apiKey: current.apiKey }
  const stars = clone(current.stars)
  for (const [sessionId, values] of Object.entries(data.stars)) stars[sessionId] = { ...(stars[sessionId] ?? {}), ...clone(values) }
  const usage = clone(current.usage)
  for (const [day, models] of Object.entries(data.usage)) usage[day] = { ...(usage[day] ?? {}), ...clone(models) }
  pruneUsage(usage)
  return { cfg: normalizeCfg({ ...current.cfg, ...clone(data.cfg) }), folders: mergeFolders(current.folders, data.folders), prompts: mergeById(current.prompts, data.prompts), stars, usage, apiKey: current.apiKey }
}

export async function writeRecoveryBackup(path: string, state: CustomPluginState): Promise<string> {
  const target = path + '.backup.json'
  const temporary = target + '.tmp'
  await writeFile(temporary, JSON.stringify(createBackup(state), null, 2), 'utf8')
  await rename(temporary, target)
  return target
}
