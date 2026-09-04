/** Pure helpers for usage reporting, prompt templates, and portable files. */
import type { PromptItem, UsageMap } from './protocol.ts'
import { usageCostBreakdown } from './pricing.ts'

export interface UsageSummary { tokens: number; calls: number; costCny: number; exact: boolean }

export type BudgetState = 'disabled' | 'unknown' | 'ok' | 'warning' | 'over'

export function budgetState(summary: UsageSummary, budgetCny: number, warningPercent = 80): BudgetState {
  if (!Number.isFinite(budgetCny) || budgetCny <= 0) return 'disabled'
  if (!summary.exact) return 'unknown'
  const ratio = summary.costCny / budgetCny * 100
  if (ratio >= 100) return 'over'
  return ratio >= Math.max(1, Math.min(100, warningPercent)) ? 'warning' : 'ok'
}

export function summarizeUsage(usage: UsageMap, days?: ReadonlySet<string>): UsageSummary {
  const out: UsageSummary = { tokens: 0, calls: 0, costCny: 0, exact: true }
  for (const [day, models] of Object.entries(usage)) {
    if (days !== undefined && !days.has(day)) continue
    for (const [model, row] of Object.entries(models)) {
      out.tokens += row.in + row.out + row.cacheIn + row.cacheW
      out.calls += row.calls
      const cost = usageCostBreakdown(row, model)
      if (!cost.exact) out.exact = false
      else out.costCny += cost.totalCostCny
    }
  }
  return out
}

function csvCell(value: unknown): string {
  const valueText = String(value ?? '')
  return /[",\r\n]/.test(valueText) ? `"${valueText.replace(/"/g, '""')}"` : valueText
}

export function usageCsv(usage: UsageMap): string {
  const rows: string[][] = [['日期', '模型', '输入', '输出', '缓存读取', '缓存写入', '调用次数', '峰闲状态', '估算费用(CNY)']]
  for (const day of Object.keys(usage).sort()) {
    for (const model of Object.keys(usage[day]).sort()) {
      const row = usage[day][model]
      const cost = usageCostBreakdown(row, model)
      rows.push([day, model, String(row.in), String(row.out), String(row.cacheIn), String(row.cacheW), String(row.calls), cost.exact ? '精确' : '不精确', cost.exact ? cost.totalCostCny.toFixed(6) : ''])
    }
  }
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

const VARIABLE_RE = /\{\{\s*([\w\u3400-\u9fff.-]+)\s*\}\}/g

export function promptVariables(text: string): string[] {
  const names: string[] = []
  for (const match of text.matchAll(VARIABLE_RE)) if (!names.includes(match[1])) names.push(match[1])
  return names
}

export function fillPromptTemplate(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(VARIABLE_RE, (_all, name: string) => values[name] ?? '')
}

/** Normalize a prompt imported from a portable document without pulling the
 * Node-owned state module into the browser bundle. */
export function normalizePromptItem(raw: unknown): PromptItem | null {
  if (raw === null || typeof raw !== 'object') return null
  const src = raw as Record<string, unknown>
  if (typeof src.id !== 'string' || src.id.trim() === '' || typeof src.name !== 'string' || typeof src.text !== 'string') return null
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

export function promptsMarkdown(prompts: readonly PromptItem[]): string {
  return prompts.map((prompt) => `## ${prompt.name}\n${(prompt.tags ?? []).length > 0 ? `标签：${(prompt.tags ?? []).join('、')}\n` : ''}\n${prompt.text.trim()}\n`).join('\n')
}

export function parsePromptsMarkdown(text: string): PromptItem[] {
  const parts = text.replace(/\r\n/g, '\n').split(/^##\s+/m).slice(1)
  return parts.map((part, index) => {
    const lines = part.split('\n')
    const name = (lines.shift() ?? '').trim() || '未命名'
    let tags: string[] = []
    while (lines[0]?.trim() === '') lines.shift()
    if (lines[0]?.startsWith('标签：')) tags = lines.shift()!.slice(3).split(/[、,，]/).map((tag) => tag.trim()).filter(Boolean)
    while (lines[0]?.trim() === '') lines.shift()
    return { id: `p-import-${Date.now()}-${index}`, name, text: lines.join('\n').trim(), tags: [...new Set(tags)], favorite: false, useCount: 0 }
  }).filter((prompt) => prompt.text !== '')
}

export function isCommandPaletteShortcut(event: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'key'>, target: Pick<HTMLElement, 'isContentEditable' | 'tagName'> | null): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return false
  return target === null || (!target.isContentEditable && !/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

export interface ArchiveBatchResultItem {
  id: string
  ok: boolean
  error?: string
}

export async function archiveBatch(ids: readonly string[], running: ReadonlySet<string>, archive: (id: string) => Promise<void>): Promise<{ succeeded: number; failed: number; results: ArchiveBatchResultItem[] }> {
  let succeeded = 0
  let failed = 0
  const results: ArchiveBatchResultItem[] = []
  for (const id of ids) {
    if (running.has(id)) {
      failed++
      results.push({ id, ok: false, error: '运行中的会话不可归档' })
      continue
    }
    try {
      await archive(id)
      succeeded++
      results.push({ id, ok: true })
    } catch (error) {
      failed++
      results.push({ id, ok: false, error: String((error as Error)?.message ?? error) })
    }
  }
  return { succeeded, failed, results }
}
