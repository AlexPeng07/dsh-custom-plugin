#!/usr/bin/env node
/**
 * Post-change smoke test (local self-check, not part of CI): verifies the
 * built artifacts against the contracts the harness actually depends on.
 *
 *  1. lib/client.js — loaded in headless Edge against a stubbed
 *     window.__ModuleLoader__, asserting the registration handshake: the
 *     bundle must REGISTER its factory ({id, factory}) at script execution
 *     without materializing (the lazy CJS model), with id == package name.
 *  2. lib/index.js — imports cleanly as ESM and exposes inject/apply.
 *  3. cordis.patch.yml — carries the expected insert row.
 *  4. the local mermaid engine dependency resolves from the built tree.
 *
 * Run after `pnpm build` when touching the client bundle, the loader entry,
 * or the packaging config: `pnpm smoke`. Requires msedge.exe (Windows) or a
 * Chromium-family browser via SMOKE_BROWSER.
 * @module dsh-custom-plugin/scripts/smoke
 */

import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ID = '@alexpeng/dsh-custom-plugin'
const failures = []
const ok = (message) => { console.log(`✓ ${message}`) }
const bad = (message) => { failures.push(message); console.error(`✗ ${message}`) }

// ── static contract checks on the built artifacts ────────────────────────────

const clientJs = await readFile(join(root, 'lib/client.js'), 'utf8')
// Strip the trailing sourcemap comment before the footer check.
const clientBody = clientJs.replace(/\n*(?:\/\/[#@]\s*sourceMappingURL=[^\n]*)?\s*$/, '')
if (clientJs.startsWith('window.__ModuleLoader__.load(') && clientJs.includes(`id: ${JSON.stringify(ID)}`)) {
  ok('lib/client.js: loader banner present, id == package name')
} else {
  bad('lib/client.js: loader banner or registration id missing/wrong')
}
// Rolldown re-indents the footer into multiple lines; match both shapes.
if (/return\s+module\.exports;\s*\}\s*\}\s*\)\s*;\s*$/.test(clientBody)) {
  ok('lib/client.js: CJS factory footer present')
} else {
  bad('lib/client.js: factory footer missing — bundle is not a loader closure')
}

const nodeHalf = await import(pathToFileURL(join(root, 'lib/index.js')).href)
if (Array.isArray(nodeHalf.inject) && typeof nodeHalf.apply === 'function') {
  ok(`lib/index.js: ESM import clean, exports inject/apply (${nodeHalf.inject.join(', ')})`)
} else {
  bad('lib/index.js: import succeeded but inject/apply are missing')
}

const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
if (/- id:\s*custom-plugin\b/.test(patch) && patch.includes(`name: '${ID}'`)) {
  ok('cordis.patch.yml: insert row references the package name')
} else {
  bad('cordis.patch.yml: insert row missing or not referencing the package name')
}

const require = createRequire(join(root, 'lib/index.js'))
try {
  const engine = require.resolve('mermaid/dist/mermaid.min.js')
  ok(`mermaid engine resolves locally: ${engine}`)
} catch {
  bad('mermaid/dist/mermaid.min.js does not resolve — run pnpm install')
}

// ── headless browser: the registration handshake ────────────────────────────

function findBrowser() {
  const candidates = [
    process.env.SMOKE_BROWSER,
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Microsoft/Edge/Application/msedge.exe'),
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  ].filter((item) => typeof item === 'string' && item !== '')
  return candidates.find((item) => existsSync(item)) ?? null
}

const browserPath = findBrowser()
if (browserPath === null) {
  bad('no msedge.exe/chrome.exe found — set SMOKE_BROWSER to a Chromium-family executable')
} else {
  const { default: puppeteer } = await import('puppeteer-core')
  const server = createServer(async (request, response) => {
    if (request.url === '/client.js') {
      response.writeHead(200, { 'content-type': 'application/javascript' })
      response.end(clientJs)
    } else {
      response.writeHead(404)
      response.end('not found')
    }
  })
  server.listen(0, '127.0.0.1')
  await new Promise((resolveListen) => server.once('listening', resolveListen))
  const port = server.address().port
  let browser
  try {
    browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ['--no-first-run', '--disable-gpu'] })
    const page = await browser.newPage()
    const pageErrors = []
    page.on('pageerror', (error) => { pageErrors.push(String(error)) })
    await page.setContent(`<!doctype html><html><body><script>
window.__ModuleLoader__ = {
  mode: 'queue', pendingQueue: [], registrations: [],
  load(registration) { this.registrations.push(registration); window.__registered = registration },
  create() { throw new Error('smoke never materializes') },
};
</script><script src="http://127.0.0.1:${port}/client.js"></script></body></html>`, { waitUntil: 'networkidle0' })
    // Functions do not survive CDP serialization — assert types in the page.
    const registration = await page.evaluate(() => {
      const reg = window.__registered
      if (reg === undefined || reg === null) return null
      return { id: reg.id, factoryType: typeof reg.factory }
    })
    if (registration !== null && registration.id === ID && registration.factoryType === 'function') {
      ok(`${browserPath.includes('msedge') ? 'headless Edge' : 'headless browser'}: bundle registered (id + factory), no materialization`)
    } else {
      bad(`registration handshake failed: ${JSON.stringify(registration)}`)
    }
    if (pageErrors.length === 0) {
      ok('no page errors during bundle script execution')
    } else {
      bad(`page errors: ${pageErrors.join(' | ').slice(0, 300)}`)
    }
  } catch (error) {
    bad(`headless browser stage failed: ${String(error instanceof Error ? error.message : error)}`)
  } finally {
    if (browser !== undefined) await browser.close().catch(() => {})
    server.close()
    server.closeAllConnections?.()
  }
}

if (failures.length > 0) {
  console.error(`\nsmoke: ${failures.length} failure(s)`)
  process.exit(1)
}
console.log('\nsmoke: all checks passed')
