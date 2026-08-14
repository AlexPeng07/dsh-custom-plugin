/**
 * Host service for dsh-custom-plugin: owns the state document and every
 * browser-facing capability (timeline, export, balance, usage scan, Mermaid).
 * The routes in `routes.ts` are a thin HTTP fence over this class.
 * @module @alexpeng/dsh-custom-plugin/host-service
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import { buildExportRows, buildMarkdown, buildPdfHtml, extractTurns } from './extract.ts'
import { readDeepSeekCredential } from './credentials.ts'
import type { BalanceInfo, CustomPluginState, TimelineItem } from './protocol.ts'
import { dayKey } from './usage.ts'

export type { BalanceInfo, TimelineItem }

/** Options the loader entry supplies to the host service. */
export interface CustomPluginHostOptions {
  sessionQuery: SessionQueryEngine
  /** Persisted state document (mutated in place; the loader owns saving). */
  state: CustomPluginState
  /** Resolve the absolute state file path for diagnostics. */
  statePath: () => string
  /** Persist the state document now. */
  saveNow: () => Promise<void>
  /** Record a bounded client diagnostic line. */
  reportDiag: (message: string) => void
  /** Bounded diagnostic ring for the status tool. */
  diagReports: string[]
  /** Optional attachment store used to embed images into PDF exports. */
  attachments?: AttachmentStore | undefined
}

/** Host capabilities behind the routes and the agent tool. */
export class CustomPluginHost {
  private readonly sessionQuery: SessionQueryEngine
  private readonly state: CustomPluginState
  private readonly statePath: () => string
  private readonly persistNow: () => Promise<void>
  private readonly diagReports: string[]
  private readonly attachments: AttachmentStore | undefined
  private readonly sessionModel = new Map<string, string | null>()
  private readonly timelineCache = new Map<string, { at: number; lastSeq: number; items: TimelineItem[] }>()
  private mermaidBytesValue = 0
  private mermaidJs = ''

  constructor(_ctx: Context, options: CustomPluginHostOptions) {
    this.sessionQuery = options.sessionQuery
    this.state = options.state
    this.statePath = options.statePath
    this.persistNow = options.saveNow
    this.diagReports = options.diagReports
    this.attachments = options.attachments
  }

  /** Persist the state document (debounced by the loader entry). */
  async persist(): Promise<void> {
    await this.persistNow()
  }

  /** Record a bounded client diagnostic line. */
  pushDiag(message: string): void {
    this.diagReports.push(String(message ?? '').slice(0, 400))
    if (this.diagReports.length > 20) this.diagReports.splice(0, this.diagReports.length - 20)
  }

  /** Track the model of each session's latest request. */
  rememberModel(sessionId: string, model: string | null): void {
    this.sessionModel.set(sessionId, model)
  }

  forgetSession(sessionId: string): void {
    this.sessionModel.delete(sessionId)
  }

  /** Fold one assistant/message usage record into today's ledger. */
  foldUsage(sessionId: string, usage: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number }): void {
    const today = dayKey()
    const day = this.state.usage[today] ?? (this.state.usage[today] = {})
    const model = this.sessionModel.get(sessionId) ?? 'unknown'
    const row = day[model] ?? (day[model] = { in: 0, out: 0, cacheIn: 0, cacheW: 0, reason: 0, calls: 0 })
    row.in += usage.inputTokens ?? 0
    row.out += usage.outputTokens ?? 0
    row.cacheIn += usage.cacheReadTokens ?? 0
    row.cacheW += usage.cacheWriteTokens ?? 0
    row.reason += usage.reasoningTokens ?? 0
    row.calls += 1
  }

  /** Snapshot of the whole state document for the browser. */
  stateView(): Pick<CustomPluginState, 'cfg' | 'folders' | 'prompts' | 'stars' | 'apiKey' | 'usage'> {
    return {
      cfg: this.state.cfg,
      folders: this.state.folders,
      prompts: this.state.prompts,
      stars: this.state.stars,
      apiKey: this.state.apiKey,
      usage: this.state.usage,
    }
  }

  /** Apply a browser-side state edit (config, folders, prompts, stars, api key). */
  applyEdit(edit: { cfg?: Partial<CustomPluginState['cfg']>; folders?: CustomPluginState['folders']; prompts?: CustomPluginState['prompts']; stars?: CustomPluginState['stars']; apiKey?: string }): void {
    if (edit.cfg !== undefined && edit.cfg !== null && typeof edit.cfg === 'object') this.state.cfg = { ...this.state.cfg, ...edit.cfg }
    if (Array.isArray(edit.folders)) this.state.folders = edit.folders
    if (Array.isArray(edit.prompts)) this.state.prompts = edit.prompts
    if (edit.stars !== undefined && edit.stars !== null && typeof edit.stars === 'object') this.state.stars = edit.stars
    if (typeof edit.apiKey === 'string') this.state.apiKey = edit.apiKey
  }

  /** Timeline nodes for one session, with a 10-second cache. */
  async timelineGet(sessionId: string, afterSeq: number): Promise<{ ok: true; sessionId: string; items: TimelineItem[] } | { ok: false; error: string }> {
    const cached = this.timelineCache.get(sessionId)
    const fresh = cached !== undefined && Date.now() - cached.at < 10000
    let items: TimelineItem[] | null = null
    if (fresh && cached.lastSeq > 0 && afterSeq > 0 && afterSeq < cached.lastSeq) {
      items = cached.items.filter((item) => item.seq > afterSeq)
    } else {
      try {
        const snapshot = await this.sessionQuery.readSession(sessionId as never)
        const all = extractTurns(snapshot.events)
        if (this.timelineCache.size > 6) {
          const firstKey = this.timelineCache.keys().next().value
          if (firstKey !== undefined) this.timelineCache.delete(firstKey)
        }
        this.timelineCache.set(sessionId, {
          at: Date.now(),
          lastSeq: all.length > 0 ? all[all.length - 1].seq : 0,
          items: all,
        })
        items = afterSeq > 0 ? all.filter((item) => item.seq > afterSeq) : all.slice(-160)
      } catch (error) {
        return { ok: false, error: String((error as Error)?.message ?? error) }
      }
    }
    return { ok: true, sessionId, items: (items ?? []).slice(-160) }
  }

  /** Export one session as JSON / Markdown / print-ready HTML. */
  async exportRun(sessionId: string, format: string): Promise<{ ok: true; content: string; fileName: string; mime: string } | { ok: false; error: string }> {
    let snapshot
    try {
      snapshot = await this.sessionQuery.readSession(sessionId as never)
    } catch (error) {
      return { ok: false, error: `读取会话失败: ${String((error as Error)?.message ?? error)}` }
    }
    let title = ''
    try {
      const titleSnapshot = await this.sessionQuery.readTitle(sessionId as never)
      if (titleSnapshot !== undefined) title = String((titleSnapshot as { title?: unknown }).title ?? '')
    } catch {
      title = ''
    }
    const readImage = this.attachments !== undefined
      ? (ref: Parameters<AttachmentStore['readImage']>[0]) => this.attachments!.readImage(ref)
      : undefined
    try {
      const rows = await buildExportRows(snapshot, format === 'pdf' ? 'pdf' : format === 'json' ? 'json' : 'markdown', readImage)
      const stamp = `${dayKey()}-${String(Date.now() % 86400000)}`
      if (format === 'json') {
        const messages = rows.map((row) => {
          if (row.kind === 'user') {
            return { role: 'user', content: row.text, images: (row.images ?? []).map((image) => ({ name: image.name, mediaType: image.mediaType, width: image.width, height: image.height, bytes: image.bytes })) }
          }
          if (row.kind === 'assistant') return { role: 'assistant', content: row.text }
          if (row.kind === 'tool-call') return { role: 'tool', name: row.toolName, arguments: row.toolArgs, content: '' }
          if (row.kind === 'tool-result') return { role: 'tool', name: row.toolName ?? '', content: row.text }
          return { role: 'system', content: row.text }
        })
        const doc = {
          meta: {
            exporter: 'dsh-custom-plugin',
            version: 1,
            id: sessionId,
            title,
            createdAt: snapshot.session.createdAt ?? null,
            cwd: snapshot.session.cwd ?? null,
            exportedAt: new Date().toISOString(),
            count: messages.length,
          },
          messages,
        }
        return { ok: true, content: JSON.stringify(doc, null, 2), fileName: `custom-conversation-${stamp}.json`, mime: 'application/json' }
      }
      if (format === 'markdown') {
        return { ok: true, content: buildMarkdown(rows, sessionId), fileName: `custom-conversation-${stamp}.md`, mime: 'text/markdown' }
      }
      if (format === 'pdf') {
        return { ok: true, content: buildPdfHtml(rows, sessionId), fileName: `custom-conversation-${stamp}.html`, mime: 'text/html' }
      }
      return { ok: false, error: 'unknown format' }
    } catch (error) {
      return { ok: false, error: `构建导出失败: ${String((error as Error)?.message ?? error)}` }
    }
  }

  /** Resolve the DeepSeek balance API key: state value first, then environment, then DSH credential refs. */
  private async resolveApiKey(): Promise<string> {
    const key = (this.state.apiKey ?? '').trim()
    if (key !== '') return key
    try {
      const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
      const candidate = env?.DEEPSEEK_API_KEY ?? env?.DEEPSEEK_KEY ?? env?.DEEPSEEK_TOKEN
      if (typeof candidate === 'string' && /^sk-/.test(candidate)) return candidate
    } catch {
      // environment unavailable
    }
    try {
      // DSH keeps model keys in $DSH_HOME/.credentials.yaml and never exports
      // them to the process environment; reuse the same file so a key
      // configured once in DSH is picked up automatically here.
      const candidate = await readDeepSeekCredential()
      if (/^sk-/.test(candidate)) return candidate
    } catch {
      // credential refs unavailable
    }
    return ''
  }

  /** Query the DeepSeek balance endpoint (15s timeout). */
  async balanceGet(): Promise<{ ok: boolean; keyConfigured: boolean; balance?: BalanceInfo | null; error?: string | null; usageToday?: unknown; available?: boolean }> {
    const usageToday = this.state.usage[dayKey()] ?? {}
    const key = await this.resolveApiKey()
    if (key === '') return { ok: false, keyConfigured: false, error: '未配置 DeepSeek API Key（请在额度面板粘贴 sk- 开头的密钥）', usageToday }
    let response
    try {
      response = await this.httpJson('https://api.deepseek.com/user/balance', { Authorization: `Bearer ${key}`, Accept: 'application/json' })
    } catch (error) {
      return { ok: false, keyConfigured: true, error: String((error as Error)?.message ?? error), usageToday }
    }
    if (!response.ok) return { ok: false, keyConfigured: true, error: response.error ?? '请求失败', usageToday }
    const json = (response.json ?? {}) as { is_available?: boolean; balance_infos?: Array<{ currency?: string; total_balance?: string; granted_balance?: string; topped_up_balance?: string }> }
    const infos = json.balance_infos ?? []
    const info = infos.find((item) => item.currency === 'CNY') ?? infos[0]
    return {
      ok: true,
      keyConfigured: true,
      available: json.is_available !== false,
      balance: info !== undefined ? { currency: info.currency ?? '', total: info.total_balance ?? '0', granted: info.granted_balance ?? '0', toppedUp: info.topped_up_balance ?? '0' } : null,
      error: infos.length > 0 ? null : '响应中无余额信息',
      usageToday,
    }
  }

  /** Re-scan today's session logs and rebuild today's usage ledger. */
  async usageScan(): Promise<{ ok: true; usageToday: unknown; scannedSessions: number } | { ok: false; error: string }> {
    let records
    try {
      records = await this.sessionQuery.listSessions()
    } catch {
      return { ok: false, error: '列会话失败' }
    }
    const today = dayKey()
    const agg: Record<string, { in: number; out: number; cacheIn: number; cacheW: number; reason: number; calls: number }> = {}
    let scanned = 0
    for (const record of records) {
      try {
        const createdAt = (record.header as { createdAt?: unknown }).createdAt
        if (typeof createdAt !== 'number' || dayKey(createdAt) !== today) continue
        scanned++
        const snapshot = await this.sessionQuery.readSession(record.header.id as never)
        let model: string | null = null
        for (const event of snapshot.events) {
          if (event.type === 'request/context') model = event.data.model
          else if (event.type === 'assistant/message' && event.data.usage !== undefined) {
            const usage = event.data.usage
            const key = model ?? 'unknown'
            const row = agg[key] ?? (agg[key] = { in: 0, out: 0, cacheIn: 0, cacheW: 0, reason: 0, calls: 0 })
            row.in += usage.inputTokens ?? 0
            row.out += usage.outputTokens ?? 0
            row.cacheIn += usage.cacheReadTokens ?? 0
            row.cacheW += usage.cacheWriteTokens ?? 0
            row.reason += usage.reasoningTokens ?? 0
            row.calls += 1
          }
        }
      } catch {
        // skip unreadable session
      }
    }
    if (scanned > 0) this.state.usage[today] = agg
    void this.persist()
    return { ok: true, usageToday: this.state.usage[today] ?? {}, scannedSessions: scanned }
  }

  /** Fetch the Mermaid engine from CDN mirrors (cached for the host lifetime). */
  async mermaidFetch(): Promise<{ ok: true; bytes: number } | { ok: false; error: string }> {
    if (this.mermaidBytesValue > 0) return { ok: true, bytes: this.mermaidBytesValue }
    const urls = [
      'https://cdn.jsdelivr.net/npm/mermaid@11.6.0/dist/mermaid.min.js',
      'https://fastly.jsdelivr.net/npm/mermaid@11.6.0/dist/mermaid.min.js',
      'https://unpkg.com/mermaid@11.6.0/dist/mermaid.min.js',
    ]
    let text = ''
    let lastError = ''
    for (const url of urls) {
      try {
        const result = await this.httpText(url)
        if (result.ok) { text = result.text; break }
        lastError = result.error ?? ''
      } catch (error) {
        lastError = String((error as Error)?.message ?? error)
      }
    }
    if (text === '') return { ok: false, error: `无法获取 Mermaid 引擎: ${lastError}` }
    this.mermaidJs = text
    this.mermaidBytesValue = text.length
    return { ok: true, bytes: text.length }
  }

  /** The cached Mermaid engine script (served at the script path). */
  mermaidScript(): string {
    return this.mermaidJs
  }

  /** Mermaid engine byte count for diagnostics. */
  mermaidBytes(): number {
    return this.mermaidBytesValue
  }

  /** Diagnostics snapshot for the status tool and the About tab. */
  debugInfo(): { statePath: string; today: string; usageToday: unknown; mermaidBytes: number; apiKeySet: boolean; diagReports: string[] } {
    return {
      statePath: this.statePath(),
      today: dayKey(),
      usageToday: this.state.usage[dayKey()] ?? {},
      mermaidBytes: this.mermaidBytesValue,
      apiKeySet: this.state.apiKey.trim() !== '',
      diagReports: [...this.diagReports],
    }
  }

  private async httpText(url: string): Promise<{ ok: true; text: string } | { ok: false; error?: string }> {
    try {
      const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15000) })
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) return { ok: false, error: `认证失败 (HTTP ${response.status})` }
        return { ok: false, error: `HTTP ${response.status}` }
      }
      return { ok: true, text: await response.text() }
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message ?? error) }
    }
  }

  private async httpJson(url: string, headers: Record<string, string>): Promise<{ ok: true; json: unknown } | { ok: false; error?: string }> {
    try {
      const response = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(15000) })
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) return { ok: false, error: '认证失败 (HTTP ' + response.status + ')，请检查 API Key 是否正确' }
        return { ok: false, error: `HTTP ${response.status}` }
      }
      try {
        return { ok: true, json: await response.json() }
      } catch {
        return { ok: false, error: '非 JSON 响应' }
      }
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message ?? error) }
    }
  }
}
