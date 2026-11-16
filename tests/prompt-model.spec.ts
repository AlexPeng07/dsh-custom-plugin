/**
 * Unit tests for the prompt-library model.
 * @module @alexpeng/dsh-custom-plugin/tests/prompt-model
 */

import { describe, expect, it } from 'vitest'
import type { PromptItem } from '../src/protocol.ts'
import {
  allTags,
  filterPrompts,
  mergePromptImport,
  normalizeTags,
  sortPrompts,
  validatePromptDraft,
} from '../src/client/ui/prompt-model.ts'

function prompt(id: string, name: string, text: string, extra: Partial<PromptItem> = {}): PromptItem {
  return { id, name, text, tags: [], favorite: false, useCount: 0, ...extra }
}

describe('normalizeTags', () => {
  it('trims, splits on both comma forms and de-duplicates case-insensitively', () => {
    expect(normalizeTags(' 写作, 翻译，WRITING, writing ')).toEqual(['写作', '翻译', 'WRITING'])
  })
  it('drops empty entries', () => {
    expect(normalizeTags(',, a , ,')).toEqual(['a'])
  })
})

describe('validatePromptDraft', () => {
  it('requires a name and content', () => {
    expect(validatePromptDraft({ name: '', text: '  ', tags: [] })).toEqual(['名称不能为空', '内容不能为空'])
    expect(validatePromptDraft({ name: 'a', text: 'b', tags: [] })).toEqual([])
  })
})

describe('filterPrompts', () => {
  const items = [
    prompt('1', '周报', '总结本周工作', { tags: ['写作'] }),
    prompt('2', '翻译', 'translate text', { tags: ['英文'], favorite: true }),
  ]
  it('matches name, text and tags', () => {
    expect(filterPrompts(items, { query: '周报' }).map((item) => item.id)).toEqual(['1'])
    expect(filterPrompts(items, { query: 'translate' }).map((item) => item.id)).toEqual(['2'])
    expect(filterPrompts(items, { query: '英文' }).map((item) => item.id)).toEqual(['2'])
  })
  it('filters by tag and favourites', () => {
    expect(filterPrompts(items, { tag: '写作' }).map((item) => item.id)).toEqual(['1'])
    expect(filterPrompts(items, { favoritesOnly: true }).map((item) => item.id)).toEqual(['2'])
  })
})

describe('sortPrompts', () => {
  const items = [
    prompt('1', 'b', '', { useCount: 1, lastUsedAt: 5 }),
    prompt('2', 'a', '', { useCount: 9, lastUsedAt: 1 }),
  ]
  it('keeps manual order', () => {
    expect(sortPrompts(items, 'manual').map((item) => item.id)).toEqual(['1', '2'])
  })
  it('sorts by recent, use count and name', () => {
    expect(sortPrompts(items, 'recent').map((item) => item.id)).toEqual(['1', '2'])
    expect(sortPrompts(items, 'used').map((item) => item.id)).toEqual(['2', '1'])
    expect(sortPrompts(items, 'name').map((item) => item.id)).toEqual(['2', '1'])
  })
})

describe('mergePromptImport', () => {
  const current = [prompt('1', 'old', 'old'), prompt('2', 'keep', 'keep')]
  const incoming = [prompt('1', 'new', 'new'), prompt('3', 'added', 'added')]
  it('updates by id and appends new items in merge mode', () => {
    const result = mergePromptImport(current, incoming, 'merge')
    expect(result.updated).toBe(1)
    expect(result.added).toBe(1)
    expect(result.next.map((item) => item.name)).toEqual(['new', 'keep', 'added'])
  })
  it('replaces the library in replace mode', () => {
    const result = mergePromptImport(current, incoming, 'replace')
    expect(result.removed).toBe(2)
    expect(result.next).toEqual(incoming)
  })
})

describe('allTags', () => {
  it('collects distinct tags sorted for the filter menu', () => {
    expect(allTags([prompt('1', 'a', '', { tags: ['b', 'a'] }), prompt('2', 'b', '', { tags: ['A', 'c'] })])).toEqual(['a', 'b', 'c'])
  })
})
