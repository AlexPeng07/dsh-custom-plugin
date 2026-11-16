/**
 * Unit tests for the command-palette model.
 * @module @alexpeng/dsh-custom-plugin/tests/command-model
 */

import { describe, expect, it } from 'vitest'
import {
  filterCommands,
  groupCommands,
  recentCommands,
  recordRecent,
  type PaletteCommand,
} from '../src/client/ui/command-model.ts'

function command(key: string, label: string, group: string, detail = ''): PaletteCommand {
  return { key, label, group, detail, run: () => {} }
}

describe('filterCommands', () => {
  const items = [command('a', '导出会话', '功能', 'Markdown'), command('b', '打开设置', '功能', '设置')]
  it('matches label and detail case-insensitively', () => {
    expect(filterCommands(items, '导出').map((item) => item.key)).toEqual(['a'])
    expect(filterCommands(items, 'markdown').map((item) => item.key)).toEqual(['a'])
  })
  it('returns everything for an empty query and respects the limit', () => {
    expect(filterCommands(items, '')).toHaveLength(2)
    expect(filterCommands(items, '', 1)).toHaveLength(1)
  })
})

describe('groupCommands', () => {
  it('keeps first-seen group order', () => {
    const groups = groupCommands([command('a', 'A', '功能'), command('b', 'B', '会话'), command('c', 'C', '功能')])
    expect(groups.map((item) => item.group)).toEqual(['功能', '会话'])
    expect(groups[0].items.map((item) => item.key)).toEqual(['a', 'c'])
  })
})

describe('recordRecent / recentCommands', () => {
  it('moves a key to the front and de-duplicates', () => {
    expect(recordRecent(['a', 'b'], 'b')).toEqual(['b', 'a'])
    expect(recordRecent(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b'])
  })
  it('resolves recent keys to commands in recent order', () => {
    const items = [command('a', 'A', '功能'), command('b', 'B', '会话')]
    expect(recentCommands(items, ['b', 'missing', 'a']).map((item) => item.key)).toEqual(['b', 'a'])
  })
})
