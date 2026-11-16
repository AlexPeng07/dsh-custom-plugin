/**
 * Pure prompt-library operations: tag normalization, validation, filtering,
 * sorting and import merging. Kept DOM-free so the panel stays presentational
 * and these rules can be unit tested.
 * @module @alexpeng/dsh-custom-plugin/client/ui/prompt-model
 */

import type { PromptItem } from '../../protocol.ts'

export type PromptSort = 'manual' | 'recent' | 'used' | 'name'
export type PromptImportMode = 'merge' | 'replace'

export interface PromptDraft {
  name: string
  text: string
  tags: string[]
}

/** Split, trim and de-duplicate tags (case-insensitive) while keeping order. */
export function normalizeTags(input: string | readonly string[]): string[] {
  const parts = typeof input === 'string' ? input.split(/[,，]/) : input
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    const tag = String(part).trim()
    if (tag === '') continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

/** Validation errors for the editor; an empty array means the draft is valid. */
export function validatePromptDraft(draft: PromptDraft): string[] {
  const errors: string[] = []
  if (draft.name.trim() === '') errors.push('名称不能为空')
  if (draft.text.trim() === '') errors.push('内容不能为空')
  return errors
}

/** Every distinct tag across the library, sorted for the filter menu. */
export function allTags(items: readonly PromptItem[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    for (const tag of normalizeTags(item.tags ?? [])) {
      const key = tag.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(tag)
    }
  }
  return out.sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

export interface PromptFilter {
  query?: string
  tag?: string | null
  favoritesOnly?: boolean
}

/** Filter by free text, one tag and the favourites switch. */
export function filterPrompts(items: readonly PromptItem[], filter: PromptFilter): PromptItem[] {
  const query = (filter.query ?? '').trim().toLowerCase()
  const tag = filter.tag?.toLowerCase() ?? null
  return items.filter((item) => {
    if (filter.favoritesOnly === true && item.favorite !== true) return false
    if (tag !== null) {
      const tags = normalizeTags(item.tags ?? []).map((value) => value.toLowerCase())
      if (!tags.includes(tag)) return false
    }
    if (query === '') return true
    return String(item.name ?? '').toLowerCase().includes(query)
      || String(item.text ?? '').toLowerCase().includes(query)
      || normalizeTags(item.tags ?? []).some((value) => value.toLowerCase().includes(query))
  })
}

/** Stable sort for the four supported orders. */
export function sortPrompts(items: readonly PromptItem[], sort: PromptSort): PromptItem[] {
  const list = items.slice()
  if (sort === 'manual') return list
  if (sort === 'name') return list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'))
  if (sort === 'recent') return list.sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
  return list.sort((a, b) => (b.useCount ?? 0) - (a.useCount ?? 0))
}

export interface ImportResult {
  next: PromptItem[]
  added: number
  updated: number
  removed: number
}

/** Merge an imported set by id, or replace the whole library. */
export function mergePromptImport(
  current: readonly PromptItem[],
  incoming: readonly PromptItem[],
  mode: PromptImportMode,
): ImportResult {
  if (mode === 'replace') {
    return { next: incoming.slice(), added: incoming.length, updated: 0, removed: current.length }
  }
  const byId = new Map(incoming.map((item) => [item.id, item]))
  let updated = 0
  const next = current.map((item) => {
    const replacement = byId.get(item.id)
    if (replacement === undefined) return item
    updated++
    byId.delete(item.id)
    return replacement
  })
  const addedItems = [...byId.values()]
  return { next: next.concat(addedItems), added: addedItems.length, updated, removed: 0 }
}
