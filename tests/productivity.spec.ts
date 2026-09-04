import { describe, expect, it, vi } from 'vitest'
import { archiveBatch, budgetState, fillPromptTemplate, isCommandPaletteShortcut, parsePromptsMarkdown, promptVariables, promptsMarkdown, summarizeUsage, usageCsv } from '../src/productivity.ts'

describe('usage reporting', () => {
  const exact = { in: 100, out: 20, cacheIn: 5, cacheW: 0, reason: 0, calls: 2, peakIn: 100, peakOut: 20, peakCacheIn: 5, peakCacheW: 0, peakSplitKnown: true }
  it('summarizes selected days and preserves exactness', () => {
    const result = summarizeUsage({ '2026-09-01': { 'deepseek-v4-flash': exact }, '2026-09-02': { legacy: { in: 1, out: 1, cacheIn: 0, cacheW: 0, reason: 0, calls: 1 } } }, new Set(['2026-09-01']))
    expect(result.tokens).toBe(125)
    expect(result.calls).toBe(2)
    expect(result.exact).toBe(true)
  })
  it('does not emit a misleading CSV cost for inexact rows and escapes model names', () => {
    const csv = usageCsv({ '2026-09-01': { 'model,"x"': { in: 1, out: 1, cacheIn: 0, cacheW: 0, reason: 0, calls: 1 } } })
    expect(csv).toContain('"model,""x"""')
    expect(csv).toContain('不精确,')
  })
  it('classifies budget boundaries', () => {
    expect(budgetState({ tokens: 0, calls: 0, costCny: 80, exact: true }, 100, 80)).toBe('warning')
    expect(budgetState({ tokens: 0, calls: 0, costCny: 100, exact: true }, 100, 80)).toBe('over')
    expect(budgetState({ tokens: 0, calls: 0, costCny: 1, exact: false }, 100, 80)).toBe('unknown')
  })
})

describe('prompt portability and templates', () => {
  it('extracts unique variables and fills every occurrence', () => {
    expect(promptVariables('{{主题}} / {{ name }} / {{主题}}')).toEqual(['主题', 'name'])
    expect(fillPromptTemplate('{{主题}} {{主题}}', { 主题: '测试' })).toBe('测试 测试')
  })
  it('round-trips Markdown names, tags, and bodies', () => {
    const markdown = promptsMarkdown([{ id: 'p1', name: '周报', text: '生成周报', tags: ['工作'] }])
    expect(parsePromptsMarkdown(markdown)[0]).toMatchObject({ name: '周报', text: '生成周报', tags: ['工作'] })
  })
})

describe('command and archive helpers', () => {
  it('protects editable targets from Ctrl/Cmd+K', () => {
    const event = { ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, key: 'k' }
    expect(isCommandPaletteShortcut(event, { isContentEditable: false, tagName: 'DIV' })).toBe(true)
    expect(isCommandPaletteShortcut(event, { isContentEditable: false, tagName: 'INPUT' })).toBe(false)
  })
  it('reports partial archive failures and skips running sessions', async () => {
    const archive = vi.fn(async (id: string) => { if (id === 'bad') throw new Error('failed') })
    await expect(archiveBatch(['ok', 'bad', 'running'], new Set(['running']), archive)).resolves.toEqual({
      succeeded: 1,
      failed: 2,
      results: [
        { id: 'ok', ok: true },
        { id: 'bad', ok: false, error: 'failed' },
        { id: 'running', ok: false, error: '运行中的会话不可归档' },
      ],
    })
    expect(archive).toHaveBeenCalledTimes(2)
  })
})
