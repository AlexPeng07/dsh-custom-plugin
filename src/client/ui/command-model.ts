/**
 * Pure command-palette model: filtering, grouping and the recent-command list.
 * @module @alexpeng/dsh-custom-plugin/client/ui/command-model
 */

export interface PaletteCommand {
  key: string
  label: string
  detail: string
  group: string
  disabled?: boolean
  run: () => void
}

export interface CommandGroup {
  group: string
  items: PaletteCommand[]
}

/** Case-insensitive filter over label and detail, capped for long lists. */
export function filterCommands(items: readonly PaletteCommand[], query: string, limit = 50): PaletteCommand[] {
  const q = query.trim().toLowerCase()
  const matched = q === ''
    ? items.slice()
    : items.filter((item) => item.label.toLowerCase().includes(q) || item.detail.toLowerCase().includes(q))
  return matched.slice(0, Math.max(0, limit))
}

/** Group commands in first-seen order so the rendered sections stay stable. */
export function groupCommands(items: readonly PaletteCommand[]): CommandGroup[] {
  const order: string[] = []
  const map = new Map<string, PaletteCommand[]>()
  for (const item of items) {
    if (!map.has(item.group)) { map.set(item.group, []); order.push(item.group) }
    map.get(item.group)?.push(item)
  }
  return order.map((group) => ({ group, items: map.get(group) ?? [] }))
}

/** Move a command key to the front of the recent list, de-duplicated. */
export function recordRecent(list: readonly string[], key: string, max = 5): string[] {
  const next = [key, ...list.filter((item) => item !== key)]
  return next.slice(0, Math.max(0, max))
}

/** Commands whose keys appear in the recent list, in recent order. */
export function recentCommands(items: readonly PaletteCommand[], recent: readonly string[]): PaletteCommand[] {
  const byKey = new Map(items.map((item) => [item.key, item]))
  return recent.map((key) => byKey.get(key)).filter((item): item is PaletteCommand => item !== undefined)
}

const RECENT_KEY = 'vx-command-recent'

/** Read the recent list from storage; storage failures degrade to empty. */
export function loadRecent(storage: Storage | null): string[] {
  if (storage === null) return []
  try {
    const raw = storage.getItem(RECENT_KEY)
    if (raw === null) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string').slice(0, 5) : []
  } catch {
    return []
  }
}

/** Persist the recent list; storage failures are ignored. */
export function saveRecent(storage: Storage | null, list: readonly string[]): void {
  if (storage === null) return
  try { storage.setItem(RECENT_KEY, JSON.stringify(list)) } catch { /* private mode */ }
}
