/**
 * HTTP routes for dsh-custom-plugin.
 *
 * Every route sits behind the loopback + same-origin fence (shared
 * `loopback.ts`); the browser talks to these handlers with plain fetch. The
 * mermaid engine script is served at its own non-API path because the browser
 * loads it as a `<script src>`.
 * @module @alexpeng/dsh-custom-plugin/routes
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { CustomPluginHost } from './host-service.ts'
import { isLoopbackRequest } from './loopback.ts'
import { CUSTOM_PLUGIN_API_PREFIX, MERMAID_SCRIPT_PATH } from './protocol.ts'

const BODY_LIMIT = 256 * 1024
const TIMELINE_LIMIT = 64 * 1024

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function browserSameOriginMarker(req: IncomingMessage): boolean {
  const site = req.headers['sec-fetch-site']
  return site === 'same-origin' || typeof req.headers.origin === 'string'
}

function guard(req: IncomingMessage, res: ServerResponse): boolean {
  if (browserSameOriginMarker(req) && isLoopbackRequest(req)) return true
  json(res, 403, { ok: false, error: 'forbidden' })
  return false
}

async function readBody(req: IncomingMessage, limit: number): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > limit) throw new Error('body-too-large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function isMethod(req: IncomingMessage, method: string, res: ServerResponse): boolean {
  if (req.method === method) return true
  json(res, 405, { ok: false, error: 'method-not-allowed' })
  return false
}

/** Build the plugin's route set. */
export function makeCustomPluginRoutes(host: CustomPluginHost): WebRoute[] {
  const stateRoute: WebRoute = {
    kind: 'exact',
    path: `${CUSTOM_PLUGIN_API_PREFIX}/state`,
    handler: async (req, res): Promise<void> => {
      if (!guard(req, res)) return
      if (req.method === 'GET') {
        json(res, 200, { ok: true, data: host.stateView() })
        return
      }
      if (req.method !== 'POST') {
        json(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      try {
        const body = (await readBody(req, BODY_LIMIT)) as Record<string, unknown>
        host.applyEdit({
          cfg: body.cfg as never,
          folders: Array.isArray(body.folders) ? (body.folders as never) : undefined,
          prompts: Array.isArray(body.prompts) ? (body.prompts as never) : undefined,
          stars: body.stars as never,
          apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
        })
        await host.persist()
        json(res, 200, { ok: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        json(res, message === 'body-too-large' ? 413 : 400, { ok: false, error: message })
      }
    },
  }

  const timelineRoute: WebRoute = {
    kind: 'exact',
    path: `${CUSTOM_PLUGIN_API_PREFIX}/timeline`,
    handler: async (req, res): Promise<void> => {
      if (!guard(req, res)) return
      if (!isMethod(req, 'GET', res)) return
      const url = new URL(req.url ?? '/', 'http://localhost')
      const sessionId = url.searchParams.get('sessionId') ?? ''
      const afterSeq = Number(url.searchParams.get('afterSeq') ?? '0')
      if (sessionId === '') {
        json(res, 400, { ok: false, error: 'no sessionId' })
        return
      }
      const result = await host.timelineGet(sessionId, Number.isFinite(afterSeq) ? afterSeq : 0)
      json(res, result.ok ? 200 : 500, result)
    },
  }

  const exportRoute: WebRoute = {
    kind: 'exact',
    path: `${CUSTOM_PLUGIN_API_PREFIX}/export`,
    handler: async (req, res): Promise<void> => {
      if (!guard(req, res)) return
      if (!isMethod(req, 'POST', res)) return
      try {
        const body = (await readBody(req, TIMELINE_LIMIT)) as { sessionId?: string; format?: string }
        if (typeof body.sessionId !== 'string' || body.sessionId === '') {
          json(res, 400, { ok: false, error: 'no sessionId' })
          return
        }
        const result = await host.exportRun(body.sessionId, body.format ?? 'json')
        json(res, result.ok ? 200 : 500, result)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        json(res, message === 'body-too-large' ? 413 : 400, { ok: false, error: message })
      }
    },
  }

  const balanceRoute: WebRoute = {
    kind: 'exact',
    path: `${CUSTOM_PLUGIN_API_PREFIX}/balance`,
    handler: async (req, res): Promise<void> => {
      if (!guard(req, res)) return
      if (!isMethod(req, 'GET', res)) return
      const result = await host.balanceGet()
      json(res, result.ok ? 200 : 200, result)
    },
  }

  const usageScanRoute: WebRoute = {
    kind: 'exact',
    path: `${CUSTOM_PLUGIN_API_PREFIX}/usage-scan`,
    handler: async (req, res): Promise<void> => {
      if (!guard(req, res)) return
      if (!isMethod(req, 'POST', res)) return
      const result = await host.usageScan()
      json(res, result.ok ? 200 : 500, result)
    },
  }

  const mermaidFetchRoute: WebRoute = {
    kind: 'exact',
    path: `${CUSTOM_PLUGIN_API_PREFIX}/mermaid`,
    handler: async (req, res): Promise<void> => {
      if (!guard(req, res)) return
      if (!isMethod(req, 'POST', res)) return
      const result = await host.mermaidFetch()
      json(res, result.ok ? 200 : 502, result)
    },
  }

  const mermaidScriptRoute: WebRoute = {
    kind: 'exact',
    path: MERMAID_SCRIPT_PATH,
    handler: (req, res): void => {
      const script = host.mermaidScript()
      if (script === '') {
        res.statusCode = 503
        res.end('mermaid bundle not ready')
        return
      }
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8')
      res.setHeader('Cache-Control', 'no-store')
      res.end(script)
    },
  }

  const diagRoute: WebRoute = {
    kind: 'exact',
    path: `${CUSTOM_PLUGIN_API_PREFIX}/diag`,
    handler: async (req, res): Promise<void> => {
      if (!guard(req, res)) return
      if (!isMethod(req, 'POST', res)) return
      try {
        const body = (await readBody(req, 4 * 1024)) as { msg?: string }
        if (typeof body.msg === 'string') host.pushDiag(body.msg)
      } catch {
        // diagnostics are best-effort
      }
      json(res, 200, { ok: true })
    },
  }

  const debugRoute: WebRoute = {
    kind: 'exact',
    path: `${CUSTOM_PLUGIN_API_PREFIX}/debug`,
    handler: (req, res): void => {
      if (!guard(req, res)) return
      if (!isMethod(req, 'GET', res)) return
      void host.debugInfo().then((info) => { json(res, 200, { ok: true, ...info }) }).catch(() => { json(res, 200, { ok: false, error: '调试信息不可用' }) })
    },
  }

  return [stateRoute, timelineRoute, exportRoute, balanceRoute, usageScanRoute, mermaidFetchRoute, mermaidScriptRoute, diagRoute, debugRoute]
}
