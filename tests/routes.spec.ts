import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { CustomPluginHost } from '../src/host-service.ts'
import { makeCustomPluginRoutes } from '../src/routes.ts'
import { CUSTOM_PLUGIN_API_PREFIX } from '../src/protocol.ts'
import { BACKUP_BODY_LIMIT } from '../src/backup.ts'

/** The web shape: a same-origin page fetch. */
const WEB_HEADERS: Record<string, string | undefined> = { host: '127.0.0.1:3000', 'sec-fetch-site': 'same-origin' }

function request(body: unknown, method = 'POST', path = '/search', headers: Record<string, string | undefined> = WEB_HEADERS): IncomingMessage {
  // undefined values delete the header — that is how a test builds the dsh
  // Desktop forward shape (no origin, no sec-fetch-site at all).
  const clean: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') clean[key] = value
  }
  return Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]), {
    method,
    url: `${CUSTOM_PLUGIN_API_PREFIX}${path}`,
    headers: clean,
    socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as IncomingMessage
}

function response(): { res: ServerResponse; status: number; body: unknown } {
  const result = { status: 0, body: undefined as unknown }
  const res = {
    writeHead(status: number) { result.status = status },
    end(value?: unknown) { result.body = value === undefined ? undefined : JSON.parse(String(value)) },
  }
  return {
    res: res as unknown as ServerResponse,
    get status() { return result.status },
    get body() { return result.body },
  }
}

describe('custom plugin routes', () => {
  it('rejects a non-array role filter instead of treating it as all roles', async () => {
    let called = false
    const host = { conversationSearch: async () => { called = true; return { ok: true, items: [], hasMore: false } } } as unknown as CustomPluginHost
    const route = makeCustomPluginRoutes(host).find((item) => item.path === `${CUSTOM_PLUGIN_API_PREFIX}/search`)!
    const out = response()
    await route.handler(request({ sessionId: 's1', query: 'x', kinds: 'user' }), out.res)
    expect(out.status).toBe(400)
    expect(called).toBe(false)
  })

  it('waits for state readiness before serving the state view', async () => {
    let release!: () => void
    const ready = new Promise<void>((resolve) => { release = resolve })
    let called = false
    const host = { stateView: async () => { called = true; return {} } } as unknown as CustomPluginHost
    const route = makeCustomPluginRoutes(host, ready).find((item) => item.path === `${CUSTOM_PLUGIN_API_PREFIX}/state`)!
    const out = response()
    const pending = route.handler(request({}, 'GET'), out.res)
    await Promise.resolve()
    expect(called).toBe(false)
    release()
    await pending
    expect(called).toBe(true)
    expect(out.status).toBe(200)
  })

  it('applies the 5 MiB limit to the document, not the JSON envelope', async () => {
    let called = 0
    const host = { backupImport: async () => { called++; return { ok: true, preview: { folders: 0, prompts: 0, starredSessions: 0, usageDays: 0, conflicts: { folders: 0, prompts: 0, usageDays: 0 } } } } } as unknown as CustomPluginHost
    const route = makeCustomPluginRoutes(host).find((item) => item.path === `${CUSTOM_PLUGIN_API_PREFIX}/backup`)!
    const documentValue: { padding: string } = { padding: '' }
    const base = Buffer.byteLength(JSON.stringify(documentValue), 'utf8')
    documentValue.padding = 'x'.repeat(BACKUP_BODY_LIMIT - base)
    const accepted = response()
    await route.handler(request({ document: documentValue, mode: 'merge', dryRun: true }, 'POST', '/backup'), accepted.res)
    expect(accepted.status).toBe(200)
    expect(called).toBe(1)
    documentValue.padding += 'x'
    const rejected = response()
    await route.handler(request({ document: documentValue, mode: 'merge', dryRun: true }, 'POST', '/backup'), rejected.res)
    expect(rejected.status).toBe(413)
    expect(called).toBe(1)
  })

  it('rejects missing documents and malformed dryRun flags before import', async () => {
    let called = 0
    const host = { backupImport: async () => { called++; return { ok: true, preview: {} } } } as unknown as CustomPluginHost
    const route = makeCustomPluginRoutes(host).find((item) => item.path === `${CUSTOM_PLUGIN_API_PREFIX}/backup`)!
    const missing = response()
    await route.handler(request({ mode: 'merge' }, 'POST', '/backup'), missing.res)
    expect(missing.status).toBe(400)
    expect((missing.body as { error: string }).error).toContain('缺失')
    const malformed = response()
    await route.handler(request({ mode: 'merge', document: {}, dryRun: 'yes' }, 'POST', '/backup'), malformed.res)
    expect(malformed.status).toBe(400)
    expect((malformed.body as { error: string }).error).toContain('dryRun')
    expect(called).toBe(0)
  })
})

describe('custom plugin route trust fence (guard)', () => {
  // The guard answers before any handler logic runs, so the host stub only
  // needs the state view for the accepted cases.
  const host = { stateView: async () => ({}) } as unknown as CustomPluginHost
  const stateRoute = makeCustomPluginRoutes(host).find((item) => item.path === `${CUSTOM_PLUGIN_API_PREFIX}/state`)!

  async function status(headers: Record<string, string | undefined>, method = 'GET'): Promise<number> {
    const out = response()
    await stateRoute.handler(request({}, method, '/state', headers), out.res)
    return out.status
  }

  it('accepts the dsh Desktop HTTP forward shape: loopback Host, no origin, no sec-fetch-site', async () => {
    // The desktop shell deletes host/origin/sec-fetch-site/cookie before
    // re-issuing the request against its Host; a fence that required an
    // affirmative browser marker 403'd every route inside Desktop.
    expect(await status({ host: '127.0.0.1:19387' })).toBe(200)
  })

  it('accepts the dsh Desktop WS-upgrade shape (origin rewritten to the Host authority)', async () => {
    expect(await status({ host: '127.0.0.1:19387', origin: 'http://127.0.0.1:19387', 'sec-fetch-site': 'same-origin' })).toBe(200)
  })

  it('accepts the web shape (same-origin marker)', async () => {
    expect(await status(WEB_HEADERS)).toBe(200)
  })

  it('rejects a foreign Origin', async () => {
    expect(await status({ ...WEB_HEADERS, origin: 'http://evil.example' })).toBe(403)
  })

  it('rejects sec-fetch-site: cross-site', async () => {
    expect(await status({ ...WEB_HEADERS, 'sec-fetch-site': 'cross-site' })).toBe(403)
  })

  it('rejects an unparseable Origin', async () => {
    expect(await status({ ...WEB_HEADERS, origin: 'not-a-url' })).toBe(403)
  })

  it('rejects a non-loopback Host header', async () => {
    expect(await status({ host: 'example.com:3000', 'sec-fetch-site': 'same-origin' })).toBe(403)
  })
})
