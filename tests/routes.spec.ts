import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { CustomPluginHost } from '../src/host-service.ts'
import { defaultState } from '../src/state.ts'
import { makeCustomPluginRoutes } from '../src/routes.ts'
import { CUSTOM_PLUGIN_API_PREFIX, MERMAID_SCRIPT_PATH } from '../src/protocol.ts'
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

/** A request whose body is a raw string, for malformed-JSON and oversized
 * payloads the JSON helper above cannot express. */
function rawRequest(text: string, method = 'POST', path = '/state'): IncomingMessage {
  return Object.assign(Readable.from([Buffer.from(text)]), {
    method,
    url: `${CUSTOM_PLUGIN_API_PREFIX}${path}`,
    headers: WEB_HEADERS,
    socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as IncomingMessage
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

  it('fences the mermaid script path like the API routes', async () => {
    const host = { mermaidScript: () => '/* engine */' } as unknown as CustomPluginHost
    const route = makeCustomPluginRoutes(host).find((item) => item.path === MERMAID_SCRIPT_PATH)!
    const out = response()
    await route.handler(request({}, 'GET', '/x', { ...WEB_HEADERS, origin: 'http://evil.example' }), out.res)
    expect(out.status).toBe(403)
  })
})

describe('custom plugin routes error surface', () => {
  // None of these reach the host, so an empty stub is enough.
  const host = {} as unknown as CustomPluginHost

  function route(path: string) {
    const found = makeCustomPluginRoutes(host).find((item) => item.path === (path === MERMAID_SCRIPT_PATH ? path : `${CUSTOM_PLUGIN_API_PREFIX}${path}`))
    if (found === undefined) throw new Error(`route not found: ${path}`)
    return found
  }

  it('answers 405 for every wrong method', async () => {
    const cases: Array<[method: string, path: string]> = [
      ['PUT', '/state'],
      ['POST', '/timeline'],
      ['GET', '/search'],
      ['GET', '/export'],
      ['POST', '/balance'],
      ['GET', '/usage-scan'],
      ['GET', '/mermaid'],
      ['GET', '/diag'],
      ['POST', '/debug'],
    ]
    for (const [method, path] of cases) {
      const out = response()
      await route(path).handler(request({}, method, path), out.res)
      expect(out.status, `${method} ${path}`).toBe(405)
      expect((out.body as { error: string }).error).toBe('method-not-allowed')
    }
  })

  it('maps a malformed JSON body to 400 without reaching the host', async () => {
    let called = 0
    const stateHost = { applyEdit: async () => { called++ } } as unknown as CustomPluginHost
    const stateRoute = makeCustomPluginRoutes(stateHost).find((item) => item.path === `${CUSTOM_PLUGIN_API_PREFIX}/state`)!
    const out = response()
    await stateRoute.handler(rawRequest('not json'), out.res)
    expect(out.status).toBe(400)
    expect(called).toBe(0)
  })

  it('maps a stream-level oversized body to 413 before parsing it', async () => {
    let called = 0
    const stateHost = { applyEdit: async () => { called++ } } as unknown as CustomPluginHost
    const stateRoute = makeCustomPluginRoutes(stateHost).find((item) => item.path === `${CUSTOM_PLUGIN_API_PREFIX}/state`)!
    // One chunk already past the 256 KiB state limit: the rejection must come
    // from the stream check, not the JSON envelope.
    const out = response()
    await stateRoute.handler(rawRequest('x'.repeat(300 * 1024)), out.res)
    expect(out.status).toBe(413)
    expect(called).toBe(0)
  })

  it('rejects timeline and export without a sessionId', async () => {
    const timeline = response()
    await route('/timeline').handler(request({}, 'GET', '/timeline'), timeline.res)
    expect(timeline.status).toBe(400)
    const exportOut = response()
    await route('/export').handler(request({}, 'POST', '/export'), exportOut.res)
    expect(exportOut.status).toBe(400)
  })

  it('rejects an invalid role inside an otherwise valid kinds array', async () => {
    let called = false
    const searchHost = { conversationSearch: async () => { called = true; return { ok: true, items: [], hasMore: false } } } as unknown as CustomPluginHost
    const searchRoute = makeCustomPluginRoutes(searchHost).find((item) => item.path === `${CUSTOM_PLUGIN_API_PREFIX}/search`)!
    const out = response()
    await searchRoute.handler(request({ sessionId: 's1', query: 'x', kinds: ['user', 'bogus'] }, 'POST', '/search'), out.res)
    expect(out.status).toBe(400)
    expect((out.body as { error: string }).error).toContain('角色筛选')
    expect(called).toBe(false)
  })

  it('serves the state save happy path and maps an applyEdit failure to 400', async () => {
    let edit: unknown = null
    let persisted = 0
    const okHost = {
      applyEdit: async (value: unknown) => { edit = value },
      persistWhenIdle: async () => { persisted++ },
      credentialStatus: async () => ({ apiKeyConfigured: true, credentialStorage: 'system' }),
    } as unknown as CustomPluginHost
    const okRoute = makeCustomPluginRoutes(okHost).find((item) => item.path === `${CUSTOM_PLUGIN_API_PREFIX}/state`)!
    const ok = response()
    await okRoute.handler(request({ cfg: { quote: true }, folders: [] }, 'POST', '/state'), ok.res)
    expect(ok.status).toBe(200)
    expect((ok.body as { ok: boolean }).ok).toBe(true)
    expect((ok.body as { apiKeyConfigured: boolean }).apiKeyConfigured).toBe(true)
    expect(persisted).toBe(1)
    expect((edit as { cfg: unknown }).cfg).toEqual({ quote: true })

    const failHost = {
      applyEdit: async () => { throw new Error('系统凭据清除失败') },
      persistWhenIdle: async () => { persisted++ },
    } as unknown as CustomPluginHost
    const failRoute = makeCustomPluginRoutes(failHost).find((item) => item.path === `${CUSTOM_PLUGIN_API_PREFIX}/state`)!
    const fail = response()
    const before = persisted
    await failRoute.handler(request({ cfg: {} }, 'POST', '/state'), fail.res)
    expect(fail.status).toBe(400)
    expect((fail.body as { error: string }).error).toBe('系统凭据清除失败')
    expect(persisted).toBe(before)
  })

  it('serves 503 with a plain body when the mermaid engine is not loaded', async () => {
    const mermaidHost = { mermaidScript: () => '' } as unknown as CustomPluginHost
    const scriptRoute = makeCustomPluginRoutes(mermaidHost).find((item) => item.path === MERMAID_SCRIPT_PATH)!
    // The script path answers plain text and assigns `statusCode` directly
    // (no writeHead), so capture both through a property setter.
    const out = { status: 0, text: '' }
    const res = {
      set statusCode(status: number) { out.status = status },
      setHeader() { /* ignored */ },
      end(value?: unknown) { out.text = String(value ?? '') },
    } as unknown as ServerResponse
    await scriptRoute.handler(request({}, 'GET', '/x'), res)
    expect(out.status).toBe(503)
    expect(out.text).toBe('mermaid bundle not ready')
  })

  it('rejects malformed folder and star shapes with 400 before persisting', async () => {
    // A real host, so the assertion covers the actual chain: route →
    // applyEdit → the normalizeFolders/normalizeStars gate (not a mock's
    // re-implementation of it).
    const realHost = new CustomPluginHost({
      sessionQuery: {} as never,
      state: defaultState(),
      statePath: () => 'state.json',
      saveNow: async () => {},
      reportDiag: () => {},
      diagReports: [],
      credentialStore: { available: false, get: async () => '', set: async () => false, clear: async () => false },
    })
    const route = makeCustomPluginRoutes(realHost).find((item) => item.path === `${CUSTOM_PLUGIN_API_PREFIX}/state`)!
    const badFolders = response()
    await route.handler(request({ folders: [{ id: 'f1', name: 42 }] }, 'POST', '/state'), badFolders.res)
    expect(badFolders.status).toBe(400)
    expect((badFolders.body as { error: string }).error).toBe('文件夹数据无效')
    const badStars = response()
    await route.handler(request({ stars: { s1: { bad: true } } }, 'POST', '/state'), badStars.res)
    expect(badStars.status).toBe(400)
    expect((badStars.body as { error: string }).error).toBe('星标数据无效')
    const good = response()
    await route.handler(request({ folders: [{ id: 'f1', name: '工作', children: [], sessionIds: [], workspaceIds: [], prompts: [] }] }, 'POST', '/state'), good.res)
    expect(good.status).toBe(200)
    expect((await realHost.stateView()).folders).toHaveLength(1)
  })
})
