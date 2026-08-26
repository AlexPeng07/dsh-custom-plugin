/**
 * Host service for dsh-custom-plugin: owns the state document and every
 * browser-facing capability (timeline, export, balance, usage scan, Mermaid).
 * The routes in `routes.ts` are a thin HTTP fence over this class.
 * @module @alexpeng/dsh-custom-plugin/host-service
 */

import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { buildExportRows, buildMarkdown, buildPdfHtml, extractTurns } from './extract.ts'
import { readDeepSeekCredential } from './credentials.ts'
import { SystemCredentialStore, type CredentialStore } from './system-credentials.ts'
import type { BalanceInfo, CredentialStorage, CustomPluginPublicState, CustomPluginState, TimelineItem, UsageRow } from './protocol.ts'
import { aggregateDayUsage, createUsageRow, dayKey, foldUsageRecord, isPeakHour, mergeUsageRow, pruneUsage, type UsageRecord } from './usage.ts'

const USAGE_SCAN_CONCURRENCY = 4

type UsageScanResult = { ok: true; day: string; usageToday: unknown; scannedSessions: number } | { ok: false; error: string }

interface ScanEntry {
  readable: boolean
  usage: Record<string, UsageRow>
}

async function mapConcurrent<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const run = async (): Promise<void> => {
    while (true) {
      const index = next++
      if (index >= items.length) return
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()))
  return results
}

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
  /** Test seam: return the local mermaid engine file path (or null). */
  localMermaidPath?: () => string | null
  /** Test seam: read the DeepSeek credential from DSH's credentials file. */
  readCredential?: () => Promise<string>
  /** Test seam and optional platform adapter for OS credential storage. */
  credentialStore?: CredentialStore
}

/** Host capabilities behind the routes and the agent tool. */
export class CustomPluginHost {
  private readonly sessionQuery: SessionQueryEngine
  private readonly state: CustomPluginState
  private readonly statePath: () => string
  private readonly persistNow: () => Promise<void>
  private readonly diagReports: string[]
  private readonly attachments: AttachmentStore | undefined
  private readonly credentialStore: CredentialStore
  private readonly sessionModel = new Map<string, string | null>()
  private usageScanPromise: Promise<UsageScanResult> | null = null
  private usageRevision = 0
  private lastUsagePruneDay = ''
  private mermaidBytesValue = 0
  private mermaidJs = ''
  private mermaidSource = ''
  private localMermaidPath: () => string | null
  private readCredential: () => Promise<string>

  constructor(options: CustomPluginHostOptions) {
    this.sessionQuery = options.sessionQuery
    this.state = options.state
    this.statePath = options.statePath
    this.persistNow = options.saveNow
    this.diagReports = options.diagReports
    this.attachments = options.attachments
    this.credentialStore = options.credentialStore ?? new SystemCredentialStore()
    this.localMermaidPath = options.localMermaidPath ?? defaultLocalMermaidPath
    this.readCredential = options.readCredential ?? readDeepSeekCredential
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

  /** Fold one assistant/message usage record into the ledger. The event time
   * decides both the day bucket and the peak/off-peak portion. */
  foldUsage(sessionId: string, usage: UsageRecord, time?: number): void {
    const at = time ?? Date.now()
    const dayName = dayKey(at)
    const day = this.state.usage[dayName] ?? (this.state.usage[dayName] = {})
    if (this.lastUsagePruneDay !== dayName) {
      pruneUsage(this.state.usage, at)
      this.lastUsagePruneDay = dayName
    }
    const model = this.sessionModel.get(sessionId) ?? 'unknown'
    const row = day[model] ?? (day[model] = createUsageRow())
    foldUsageRecord(row, usage, isPeakHour(at))
    this.usageRevision++
  }

  /** Snapshot of browser-safe state; the API key value never crosses this boundary. */
  async stateView(): Promise<CustomPluginPublicState> {
    const credential = await this.credentialStatus()
    return {
      cfg: this.state.cfg,
      folders: this.state.folders,
      prompts: this.state.prompts,
      stars: this.state.stars,
      usage: this.state.usage,
      ...credential,
    }
  }

  /** Apply a browser-side state edit (config, folders, prompts, stars, api key). */
  async applyEdit(edit: { cfg?: Partial<CustomPluginState['cfg']>; folders?: CustomPluginState['folders']; prompts?: CustomPluginState['prompts']; stars?: CustomPluginState['stars']; apiKey?: string }): Promise<void> {
    if (edit.cfg !== undefined && edit.cfg !== null && typeof edit.cfg === 'object') this.state.cfg = { ...this.state.cfg, ...edit.cfg }
    if (Array.isArray(edit.folders)) this.state.folders = edit.folders
    if (Array.isArray(edit.prompts)) this.state.prompts = edit.prompts
    if (edit.stars !== undefined && edit.stars !== null && typeof edit.stars === 'object') this.state.stars = edit.stars
    if (typeof edit.apiKey === 'string') {
      const key = edit.apiKey.trim()
      if (key === '') {
        const cleared = await this.credentialStore.clear()
        if (this.credentialStore.available && !cleared) throw new Error('系统凭据清除失败，请重试')
        this.state.apiKey = ''
      } else {
        if (!/^sk-/.test(key)) throw new Error('DeepSeek API Key 必须以 sk- 开头')
        this.state.apiKey = await this.credentialStore.set(key) ? '' : key
      }
    }
  }

  /** Move a legacy plaintext state key into the OS store when available. */
  async migrateLegacyApiKey(): Promise<boolean> {
    const key = (this.state.apiKey ?? '').trim()
    if (!/^sk-/.test(key) || !this.credentialStore.available) return false
    let existing = ''
    try {
      existing = (await this.credentialStore.get()).trim()
    } catch {
      // Do not overwrite a credential that could not be read safely.
      return false
    }
    if (existing !== '') {
      if (/^sk-/.test(existing)) {
        this.state.apiKey = ''
        return true
      }
      // Keep the legacy value as a compatibility fallback rather than
      // overwriting an unexpected non-empty OS-store entry.
      return false
    }
    if (!await this.credentialStore.set(key)) return false
    this.state.apiKey = ''
    return true
  }

  /** Timeline nodes for one session, capped to the 400-node tail. The tail cap
   * bounds the payload (each item carries up to 4k of preview text); 400 keeps
   * dots available when the GUI deep-loads history. */
  async timelineGet(sessionId: string): Promise<{ ok: true; sessionId: string; items: TimelineItem[] } | { ok: false; error: string }> {
    try {
      const snapshot = await this.sessionQuery.readSession(sessionId as never)
      return { ok: true, sessionId, items: extractTurns(snapshot.events).slice(-400) }
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message ?? error) }
    }
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

  /** Resolve the key and its source without returning either value to the browser. */
  private async resolveApiKeyWithSource(): Promise<{ key: string; source: CredentialStorage }> {
    try {
      const system = (await this.credentialStore.get()).trim()
      if (/^sk-/.test(system)) return { key: system, source: 'system' }
    } catch {
      // OS credential store unavailable — continue through compatibility tiers.
    }
    const key = (this.state.apiKey ?? '').trim()
    if (/^sk-/.test(key)) return { key, source: 'legacy-state' }
    try {
      const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
      // First valid candidate wins: an unset, empty, or non-sk value for one
      // name must not shadow the next name (mirrors the credential-file tier,
      // where each ref is checked individually).
      for (const name of ['DEEPSEEK_API_KEY', 'DEEPSEEK_KEY', 'DEEPSEEK_TOKEN']) {
        const value = env?.[name]
        if (typeof value === 'string' && /^sk-/.test(value.trim())) return { key: value.trim(), source: 'environment' }
      }
    } catch {
      // environment unavailable
    }
    try {
      // DSH keeps model keys in $DSH_HOME/.credentials.yaml and never exports
      // them to the process environment; reuse the same file so a key
      // configured once in DSH is picked up automatically here.
      const candidate = await this.readCredential()
      if (/^sk-/.test(candidate)) return { key: candidate.trim(), source: 'dsh' }
    } catch {
      // credential refs unavailable
    }
    return { key: '', source: 'none' }
  }

  private async resolveApiKey(): Promise<string> {
    return (await this.resolveApiKeyWithSource()).key
  }

  /** Browser-safe credential status used by state and save responses. */
  async credentialStatus(): Promise<Pick<CustomPluginPublicState, 'apiKeyConfigured' | 'credentialStorage'>> {
    const resolved = await this.resolveApiKeyWithSource()
    return { apiKeyConfigured: resolved.key !== '', credentialStorage: resolved.source }
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

  /** Re-scan the session logs and rebuild today's usage ledger. Every session
   * is replayed but only usage events whose own timestamp falls on today are
   * folded, so sessions created before midnight keep contributing the usage
   * they produced today. */
  async usageScan(): Promise<UsageScanResult> {
    if (this.usageScanPromise !== null) return await this.usageScanPromise
    const run = this.usageScanImpl()
    this.usageScanPromise = run
    try {
      return await run
    } finally {
      if (this.usageScanPromise === run) this.usageScanPromise = null
    }
  }

  private async usageScanImpl(): Promise<UsageScanResult> {
    const revisionAtStart = this.usageRevision
    let records
    try {
      records = await this.sessionQuery.listSessions()
    } catch {
      return { ok: false, error: '列会话失败' }
    }
    const today = dayKey()
    const agg: Record<string, UsageRow> = {}
    let scanned = 0
    const entries = await mapConcurrent(records, USAGE_SCAN_CONCURRENCY, async (record): Promise<ScanEntry> => {
      try {
        const snapshot = await this.sessionQuery.readSession(record.header.id as never)
        const dayUsage = aggregateDayUsage(snapshot.events, today)
        return { readable: true, usage: dayUsage }
      } catch {
        // skip unreadable session
        return { readable: false, usage: {} }
      }
    })
    let failedSessions = 0
    for (const entry of entries) {
      if (!entry.readable) {
        failedSessions++
        continue
      }
      const models = Object.keys(entry.usage)
      if (models.length === 0) continue
      scanned++
      for (const model of models) {
        const row = agg[model] ?? (agg[model] = createUsageRow())
        mergeUsageRow(row, entry.usage[model])
      }
    }
    // Never replace a complete live ledger with a partial replay. The caller
    // can retry after the unreadable sessions recover.
    if (failedSessions > 0) return { ok: false, error: '部分会话读取失败，未覆盖现有用量，请稍后重试' }
    // Live session events may arrive while the asynchronous replay is in
    // flight. Keep them rather than replacing them with an older snapshot.
    if (this.usageRevision !== revisionAtStart) return { ok: false, error: '扫描期间产生了新用量，未覆盖现有用量，请稍后重试' }
    pruneUsage(this.state.usage)
    this.state.usage[today] = agg
    void this.persist().catch((error) => this.pushDiag(`usage scan save failed: ${String((error as Error)?.message ?? error)}`))
    return { ok: true, day: today, usageToday: this.state.usage[today] ?? {}, scannedSessions: scanned }
  }

  /** Resolve the Mermaid engine: the bundled `mermaid` dependency on disk
   * first (no runtime network), CDN mirrors only as a fallback (cached for
   * the host lifetime). */
  async mermaidFetch(): Promise<{ ok: true; bytes: number } | { ok: false; error: string }> {
    if (this.mermaidBytesValue > 0) return { ok: true, bytes: this.mermaidBytesValue }
    const localPath = this.localMermaidPath()
    if (localPath !== null && localPath !== '') {
      try {
        const text = readFileSync(localPath, 'utf8')
        if (text.length > 0) {
          this.mermaidJs = text
          this.mermaidBytesValue = text.length
          this.mermaidSource = 'local'
          return { ok: true, bytes: text.length }
        }
      } catch {
        // unreadable local bundle: fall through to the CDN mirrors
      }
    }
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
    this.mermaidSource = 'cdn'
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

  /** Where the engine came from: 'local', 'cdn', or '' while unloaded. */
  mermaidLoadedSource(): string {
    return this.mermaidSource
  }

  /** Whether any DeepSeek key source resolves (state, environment, credential
   * file) — the honest answer behind the panel's "key configured" badge. */
  async hasApiKey(): Promise<boolean> {
    return await this.resolveApiKey() !== ''
  }

  /** Diagnostics snapshot for the status tool and the About tab. */
  async debugInfo(): Promise<{ statePath: string; today: string; usageToday: unknown; mermaidBytes: number; mermaidSource: string; apiKeySet: boolean; diagReports: string[] }> {
    return {
      statePath: this.statePath(),
      today: dayKey(),
      usageToday: this.state.usage[dayKey()] ?? {},
      mermaidBytes: this.mermaidBytesValue,
      mermaidSource: this.mermaidSource,
      apiKeySet: await this.hasApiKey(),
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

/** Resolve `mermaid/dist/mermaid.min.js` from the package's own dependency
 * tree (works for `link:` checkouts and registry installs alike); null when
 * the dependency is absent, which falls mermaidFetch back to the CDN. */
export function defaultLocalMermaidPath(): string | null {
  try {
    const require = createRequire(import.meta.url)
    return require.resolve('mermaid/dist/mermaid.min.js')
  } catch {
    return null
  }
}
