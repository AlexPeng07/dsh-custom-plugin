/**
 * Browser transport for dsh-custom-plugin: plain same-origin fetch against
 * the host routes. Every call returns the `{ ok }` envelope the host writes;
 * failures surface as `{ ok: false, error }` instead of throwing.
 * @module @alexpeng/dsh-custom-plugin/client/api
 */

import { CUSTOM_PLUGIN_API_PREFIX, type BackupImportMode, type BackupImportPreview, type ConversationSearchKind, type ConversationSearchResult, type CredentialStorage, type CustomPluginBackupV1, type CustomPluginConfig, type CustomPluginPublicState, type CustomPluginState, type TimelineItem } from '../protocol.ts'

const REQUEST_TIMEOUT_MS = 20_000

/** State edit the browser sends to the host. */
export interface StateEdit {
  cfg?: Partial<CustomPluginConfig>
  folders?: CustomPluginState['folders']
  prompts?: CustomPluginState['prompts']
  stars?: CustomPluginState['stars']
  apiKey?: string
}

/** Balance payload as the host reports it. */
export interface BalancePayload {
  ok: boolean
  keyConfigured: boolean
  balance?: { currency: string; total: string; granted: string; toppedUp: string } | null
  error?: string | null
  usageToday?: Record<string, unknown>
}

type StateSaveResult = { ok: true; apiKeyConfigured?: boolean; credentialStorage?: CredentialStorage } | { ok: false; error?: string }

async function request<T>(path: string, init?: RequestInit, externalSignal?: AbortSignal): Promise<T> {
  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => { controller.abort() }, REQUEST_TIMEOUT_MS)
  const abort = (): void => controller.abort()
  externalSignal?.addEventListener('abort', abort, { once: true })
  if (externalSignal?.aborted === true) controller.abort()
  try {
    const response = await fetch(`${CUSTOM_PLUGIN_API_PREFIX}${path}`, { ...init, signal: controller.signal })
    try {
      return await response.json() as T & { error?: string }
    } catch {
      // Non-JSON body (e.g. a size-limit rejection): keep the documented
      // contract of an { ok: false } envelope instead of a bare SyntaxError.
      return { ok: false, error: `HTTP ${String(response.status)} 非 JSON 响应` } as unknown as T
    }
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error) } as unknown as T
  } finally {
    globalThis.clearTimeout(timer)
    externalSignal?.removeEventListener('abort', abort)
  }
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * State POSTs carry a complete snapshot rather than an operation log. Keep
 * them on one client-side queue so a quick sequence of toggles cannot be
 * applied out of order when the network completes requests differently.
 */
let stateSaveQueue: Promise<void> = Promise.resolve()

/** Read the whole state document. */
export async function apiStateGet(): Promise<{ ok: true; data: CustomPluginPublicState } | { ok: false; error?: string }> {
  return await request('/state', { cache: 'no-store' })
}

/** Persist a state edit. */
export async function apiStateSave(edit: StateEdit): Promise<StateSaveResult> {
  const run: Promise<StateSaveResult> = stateSaveQueue.catch(() => {}).then(() => postJson<StateSaveResult>('/state', edit))
  stateSaveQueue = run.then(() => {}, () => {})
  return await run
}

/** Timeline nodes for one session (tail-capped by the host). */
export async function apiTimelineGet(sessionId: string): Promise<{ ok: true; sessionId: string; items: TimelineItem[] } | { ok: false; error?: string }> {
  return await request(`/timeline?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
}

export async function apiBackupExport(): Promise<{ ok: true; data: CustomPluginBackupV1 } | { ok: false; error?: string }> {
  return await request('/backup', { cache: 'no-store' })
}

export async function apiBackupImport(document: unknown, mode: BackupImportMode, dryRun: boolean): Promise<{ ok: true; preview: BackupImportPreview; recoveryPath?: string } | { ok: false; error?: string }> {
  return await postJson('/backup', { document, mode, dryRun })
}

export async function apiConversationSearch(sessionId: string, query: string, kinds: ConversationSearchKind[], signal?: AbortSignal): Promise<{ ok: true; } & ConversationSearchResult | { ok: false; error?: string }> {
  return await request('/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, query, kinds }) }, signal)
}

/** Export one session in the given format. */
export async function apiExportRun(sessionId: string, format: string): Promise<{ ok: true; content: string; fileName: string; mime: string } | { ok: false; error?: string }> {
  return await postJson('/export', { sessionId, format })
}

/** DeepSeek balance. */
export async function apiBalanceGet(): Promise<BalancePayload> {
  return await request('/balance', { cache: 'no-store' })
}

/** Re-scan today's session logs for usage. */
export async function apiUsageScan(): Promise<{ ok: true; day: string; usageToday: Record<string, unknown>; scannedSessions: number } | { ok: false; error?: string }> {
  return await postJson('/usage-scan', {})
}

/** Fetch the Mermaid engine into the host cache. */
export async function apiMermaidFetch(): Promise<{ ok: true; bytes: number } | { ok: false; error?: string }> {
  return await postJson('/mermaid', {})
}

/** Best-effort diagnostics report. */
export function apiDiagReport(message: string): void {
  void postJson('/diag', { msg: String(message).slice(0, 400) }).catch(() => {})
}

/** Host diagnostics for the About tab. */
export async function apiDebugInfo(): Promise<Record<string, unknown>> {
  try {
    const result = await request<{ ok: true } & Record<string, unknown>>('/debug', { cache: 'no-store' })
    return result
  } catch {
    return { ok: false }
  }
}
