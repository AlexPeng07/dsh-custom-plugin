#!/usr/bin/env node
/**
 * Desktop-port probe: hit the dsh Desktop Host (127.0.0.1:19387) with the
 * exact header shape the Electron shell produces when forwarding renderer
 * requests — loopback Host, no `origin`, no `sec-fetch-site` — and assert the
 * plugin routes answer. Read-only against the real home: no /state writes.
 * Negative probes (foreign Origin / cross-site) must still be 403.
 * @module dsh-custom-plugin/scripts/desktop-shape-probe
 */
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const PORT = process.env.DSH_PORT ?? '19387'
const BASE = `http://127.0.0.1:${PORT}`

let pass = 0
let fail = 0
const ok = (name, extra = '') => { console.log(`  PASS  ${name}${extra ? ' — ' + extra : ''}`); pass++ }
const bad = (name, extra = '') => { console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); fail++ }

/** Desktop forward shape: the shell deletes origin/sec-fetch-site/host/cookie. */
const DESKTOP_HEADERS = { Host: `127.0.0.1:${PORT}` }

async function request(path, { method = 'GET', headers = {}, body } = {}) {
  const merged = { ...DESKTOP_HEADERS, ...headers }
  const res = await fetch(BASE + path, {
    method,
    headers: body === undefined ? merged : { ...merged, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  return { status: res.status, text: await res.text() }
}

async function probe(name, path, { method = 'GET', headers = {}, expect, body } = {}) {
  try {
    const { status, text } = await request(path, { method, headers, body })
    const good = status === expect
    const detail = `${status}${text.length > 0 ? ' ' + text.slice(0, 120).replace(/\s+/g, ' ') : ''}`
    if (good) ok(name, detail)
    else bad(name, `expected ${expect}, got ${detail}`)
    return { status, text }
  } catch (error) {
    bad(name, String(error?.message ?? error))
    return { status: 0, text: '' }
  }
}

const json = (t) => { try { return JSON.parse(t) } catch { return null } }

// Host reachable?
const ping = await probe('host reachable (/api/custom-plugin/state)', '/api/custom-plugin/state', { expect: 200 })
if (ping.status !== 200) {
  console.log(`\nHost on ${BASE} not answering — is dsh Desktop running?`)
  process.exit(1)
}
const state = json(ping.text)
if (state?.ok === true) ok('state envelope ok:true')
else bad('state envelope', ping.text.slice(0, 120))

await probe('debug route (desktop shape)', '/api/custom-plugin/debug', { expect: 200 })
  .then((r) => {
    const info = json(r.text)
    const bytes = info?.mermaidBytes ?? 0
    if (bytes > 100_000) ok(`mermaid engine loaded (${bytes} bytes, source ${info?.mermaidSource ?? '?'})`)
    else bad('mermaid engine', r.text.slice(0, 120))
  })

await probe('backup export (desktop shape)', '/api/custom-plugin/backup', { expect: 200 })

// Session-dependent routes: discover candidate session ids from the home.
// Sessions live two levels deep (sessions/<workspace>/session-<uuid>); the
// running host may index only a subset (its own workspaces), so every
// candidate is tried and the first one the host recognizes proves the chain.
// If the GUI has no session yet, send one message there and re-run.
const candidates = []
try {
  const root = join(homedir(), '.dsh', 'sessions')
  for (const level1 of readdirSync(root, { withFileTypes: true })) {
    if (!level1.isDirectory()) continue
    for (const level2 of readdirSync(join(root, level1.name), { withFileTypes: true })) {
      if (level2.isDirectory() && level2.name.startsWith('session-')) {
        candidates.push(level2.name.slice('session-'.length))
      }
    }
  }
} catch { /* sessions dir unreadable */ }

let sessionId = ''
for (const candidate of candidates) {
  try {
    const attempt = await request(`/api/custom-plugin/timeline?sessionId=${candidate}`)
    if (attempt.status === 200 && json(attempt.text)?.ok === true) {
      sessionId = candidate
      break
    }
  } catch { /* next candidate */ }
}

if (sessionId === '') {
  console.log('  SKIP  export/search chains (no host-registered session yet — send one message in the GUI and re-run)')
} else {
  const timeline = await probe(`timeline reads ${sessionId.slice(0, 24)}`, `/api/custom-plugin/timeline?sessionId=${sessionId}`, { expect: 200 })
  const items = json(timeline.text)?.items ?? []
  if (items.length > 0) ok(`timeline returned ${items.length} nodes`)
  else bad('timeline returned no nodes', timeline.text.slice(0, 120))

  for (const fmt of ['json', 'markdown', 'pdf']) {
    await probe(`export ${fmt} (desktop shape)`, '/api/custom-plugin/export', { method: 'POST', expect: 200, body: { sessionId, format: fmt } })
  }

  const words = String(items[items.length - 1]?.text ?? '').split(/[^A-Za-z0-9]+/).filter((w) => w.length >= 3)
  const probeWord = words.sort((a, b) => b.length - a.length)[0]
  if (probeWord !== undefined) {
    await probe(`search '${probeWord}' (desktop shape)`, '/api/custom-plugin/search', { method: 'POST', expect: 200, body: { sessionId, query: probeWord } })
  } else {
    console.log('  SKIP  search (no ASCII word in newest user message)')
  }
}

await probe('usage scan (desktop shape)', '/api/custom-plugin/usage-scan', { method: 'POST', expect: 200, body: {} })
await probe('mermaid preload (desktop shape)', '/api/custom-plugin/mermaid', { method: 'POST', expect: 200, body: {} })
await probe('mermaid engine script (desktop shape)', '/custom-plugin/mermaid.js', { expect: 200 })

// Negative fence probes: these must stay rejected.
await probe('foreign Origin rejected', '/api/custom-plugin/state', { headers: { Origin: 'http://fence-probe.invalid' }, expect: 403 })
await probe('cross-site marker rejected', '/api/custom-plugin/state', { headers: { Origin: BASE, 'Sec-Fetch-Site': 'cross-site' }, expect: 403 })
await probe('foreign Origin rejected (mermaid script)', '/custom-plugin/mermaid.js', { headers: { Origin: 'http://fence-probe.invalid' }, expect: 403 })

console.log(`\n== desktop-shape probes: ${pass} pass / ${fail} fail`)
process.exit(fail > 0 ? 1 : 0)
