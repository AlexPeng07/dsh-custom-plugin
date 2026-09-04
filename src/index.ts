/**
 * Host loader entry for dsh-custom-plugin.
 *
 * The Host owns the state document, the daily token-usage ledger (folded
 * from `session/event`), the `/api/custom-plugin` routes (state, timeline,
 * export, backup, search, balance, usage scan, Mermaid fetch, diagnostics), and the
 * `custom_plugin_status` agent tool. The browser is a same-origin view over
 * those routes; this half has no UI of its own.
 * @module @alexpeng/dsh-custom-plugin
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { join } from 'node:path'
import { dshHome } from './dsh-home.ts'
import { mountOnce } from './mount-once.ts'
import { defaultState, loadStateFile, saveStateFile, STATE_FILE } from './state.ts'
import { CustomPluginHost } from './host-service.ts'
import { makeCustomPluginRoutes } from './routes.ts'
import { dayKey } from './usage.ts'

export const inject = ['webServer', 'tools', 'sessionQuery']

export const apply = mountOnce('@alexpeng/dsh-custom-plugin', applyImpl)

function applyImpl(ctx: Context): void {
  const state = defaultState()
  // Keep diagnostics truthful even before the asynchronous load resolves.
  // `dshHome()` is a directory; the state path is its sibling file.
  let statePath = join(dshHome(), STATE_FILE)
  let stateLoaded = false
  const sessionModels = new Map<string, string | null>()
  const pendingUsage: Array<{ sessionId: string; usage: NonNullable<Extract<SessionEvent, { type: 'assistant/message' }>['data']['usage']>; time: number; model: string | null }> = []

  const diagReports: string[] = []
  const reportDiag = (message: string): void => {
    diagReports.push(String(message ?? '').slice(0, 400))
    if (diagReports.length > 20) diagReports.splice(0, diagReports.length - 20)
  }

  const saveSoon = (() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    return (): void => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        void host.persistWhenIdle().catch((error) => {
          reportDiag(`state save failed: ${String((error as Error)?.message ?? error)}`)
        })
      }, 500)
    }
  })()

  const host = new CustomPluginHost({
    sessionQuery: ctx.sessionQuery,
    state,
    statePath: () => statePath,
    saveNow: () => saveStateFile(state),
    reportDiag,
    diagReports,
    attachments: ctx.get('attachments'),
  })

  const stateReady = loadStateFile(state).then(async (path) => {
    statePath = path
    if (await host.migrateLegacyApiKey()) reportDiag('legacy API key migrated to system credentials')
    stateLoaded = true
    for (const item of pendingUsage.splice(0)) host.foldUsage(item.sessionId, item.usage, item.time, item.model)
    return saveStateFile(state)
  }).catch((error) => {
    // Keep the default state usable when the file is unreadable. Events are
    // still folded after the failed load so they are not silently discarded.
    reportDiag(`state load failed: ${String((error as Error)?.message ?? error)}`)
    stateLoaded = true
    for (const item of pendingUsage.splice(0)) host.foldUsage(item.sessionId, item.usage, item.time, item.model)
  })

  // Daily token usage: fold request/context (model) + assistant/message (usage).
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    try {
      if (event === undefined || event === null) return
      const sessionId = String(session.id)
      if (event.type === 'request/context') {
        const model = event.data.model ?? null
        sessionModels.set(sessionId, model)
        host.rememberModel(sessionId, model)
      } else if (event.type === 'assistant/message' && event.data.usage !== undefined) {
        if (!stateLoaded) pendingUsage.push({ sessionId, usage: event.data.usage, time: event.time, model: sessionModels.get(sessionId) ?? null })
        else {
          host.foldUsage(sessionId, event.data.usage, event.time)
          saveSoon()
        }
      }
    } catch (error) {
      reportDiag(`usage fold failed: ${String((error as Error)?.message ?? error)}`)
    }
  })
  ctx.on('session/disposed', (session: Session) => {
    const sessionId = String(session.id)
    sessionModels.delete(sessionId)
    host.forgetSession(sessionId)
  })

  // Routes: state document, timeline, export, backup, search, balance, usage scan, Mermaid.
  const routeDisposers: Array<() => void> = []
  for (const route of makeCustomPluginRoutes(host, stateReady)) {
    routeDisposers.push(ctx.webServer.register(route))
  }

  // Preheat the Mermaid engine (local dependency first, CDN fallback) so the
  // first diagram render in the browser does not pay the load latency.
  void host.mermaidFetch().then((result) => {
    reportDiag(result.ok ? `mermaid engine ready (${result.bytes} bytes, ${host.mermaidLoadedSource()})` : `mermaid engine failed: ${result.error}`)
  })

  // The status tool: appearance config, today's usage, balance, timeline sample.
  const disposeTool = ctx.tools.register(defineTool({
    name: 'custom_plugin_status',
    description: '查看 Custom 便利套件（dsh-custom-plugin）运行状态：外观配置、今日 token 用量（按模型）、DeepSeek 余额（如已配置 API Key）、当前会话时间线样本、Mermaid 引擎加载情况、客户端注入诊断。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const v = (value ?? {}) as Record<string, unknown>
        const lines: string[] = []
        lines.push(`Custom 便利套件状态 (今日 ${String(v.today ?? '?')})`)
        lines.push(`外观配置: ${JSON.stringify(v.cfg ?? {})}`)
        lines.push(`今日用量: ${JSON.stringify(v.usageToday ?? {})}`)
        if (v.balance !== undefined && v.balance !== null) {
          const balance = v.balance as { currency?: string; total?: string }
          lines.push(`余额: ${String(balance.currency ?? '')} ${String(balance.total ?? '')}`)
        }
        if (typeof v.balanceError === 'string' && v.balanceError !== '') lines.push(`余额错误: ${v.balanceError}`)
        if (Array.isArray(v.timelineSample)) lines.push(`时间线样本: ${JSON.stringify(v.timelineSample)}`)
        lines.push(`Mermaid 引擎: ${String(v.mermaidBytes ?? 0)} bytes; 状态文件: ${String(v.statePath ?? '')}`)
        if (Array.isArray(v.diagReports) && v.diagReports.length > 0) lines.push(`客户端诊断: ${v.diagReports.join(' | ')}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async execute(): Promise<Record<string, any>> {
      await stateReady
      const out: Record<string, unknown> = {
        today: dayKey(),
        cfg: state.cfg,
        usageToday: state.usage[dayKey()] ?? {},
        mermaidBytes: host.mermaidBytes(),
        statePath,
        apiKeyConfigured: await host.hasApiKey(),
        diagReports: [...diagReports],
      }
      const agents = ctx.get('agents') as { currentInitiator?(): { id: unknown } } | undefined
      const agent = agents !== undefined && typeof agents.currentInitiator === 'function' ? agents.currentInitiator() : null
      const sessionId = agent !== null && agent !== undefined ? String(agent.id) : null
      if (sessionId !== null) {
        const timeline = await host.timelineGet(sessionId)
        out.timelineSample = timeline.ok
          ? (timeline.items ?? []).slice(0, 2).map((item) => ({ seq: item.seq, time: item.time, text: item.text.slice(0, 120) }))
          : timeline.error
      }
      const balance = await host.balanceGet()
      out.balance = balance.ok ? balance.balance : null
      out.balanceError = balance.ok ? null : balance.error
      return out
    },
  }))

  ctx.effect(() => {
    const dispose = routeDisposers.splice(0)
    return () => { for (const item of dispose) item() }
  }, 'custom-plugin: host routes')

  ctx.effect(() => () => { disposeTool() }, 'custom-plugin: status tool')
}
