#!/usr/bin/env node
/**
 * Post-change smoke test: verifies the built artifacts against the contracts
 * the harness actually depends on. CI runs the static half with
 * `--static-only`; the headless-browser handshake below stays a local step.
 *
 *  1. lib/client.js — loaded in headless Edge against a stubbed
 *     window.__ModuleLoader__, asserting the registration handshake: the
 *     bundle must REGISTER its factory ({id, factory}) at script execution
 *     without materializing (the lazy CJS model), with id == package name.
 *  2. lib/index.js — imports cleanly as ESM and exposes inject/apply.
 *  3. cordis.patch.yml — carries the expected insert row.
 *  4. package.json — the fields dsh reads before activating the bundle:
 *     dsh.client platform/exports, dsh.bundle.patch, the icon file, the
 *     locale display metadata, and peer ranges that agree with the dsh release
 *     this bundle was type-checked against.
 *  5. the local mermaid engine dependency resolves from the built tree.
 *
 * Run after `pnpm build` when touching the client bundle, the loader entry,
 * or the packaging config: `pnpm smoke`. Requires msedge.exe (Windows) or a
 * Chromium-family browser via SMOKE_BROWSER.
 * @module dsh-custom-plugin/scripts/smoke
 */

import { createServer } from 'node:http'
import { existsSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, delimiter } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
// The same library dsh's own peer gate uses, so this gate cannot disagree with
// the runtime about what a range admits (prerelease semantics included).
import semver from 'semver'

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

// ── manifest contract: fields dsh reads before it ever activates the plugin ──
// A wrong value here skips or hides the whole bundle with no runtime error, so
// these are checked from the files rather than trusted.

const manifestText = await readFile(join(root, 'package.json'), 'utf8')
const manifest = JSON.parse(manifestText)
// A duplicated key is valid-ish JSON that JSON.parse resolves by keeping the
// last value, so the manifest can silently carry a stale field. Count the
// top-level entries in the text and compare with what survived parsing.
{
  // Derive the indentation instead of hardcoding two spaces: a reindented
  // manifest would otherwise read as "0 keys in the text" and stay red for the
  // wrong reason.
  const firstKeyLine = (manifestText.split(/\r?\n/).find((l) => /^\s*"[^"]+"\s*:/.test(l)) ?? '')
  const indent = firstKeyLine.slice(0, firstKeyLine.length - firstKeyLine.trimStart().length)
  const parsedKeys = Object.keys(manifest).length
  if (!/^ +$/.test(indent)) {
    // "Cannot tell" is not a pass: say so instead of comparing nothing to itself.
    bad(`package.json: cannot tell which keys are top-level (first key line is indented ${JSON.stringify(indent)}) — the duplicate-key check is blind here`)
  } else {
    const rawKeys = (manifestText.match(new RegExp(`^${indent}"[^"]+"\\s*:`, 'gm')) ?? []).length
    if (rawKeys !== parsedKeys) {
      bad(`package.json: ${rawKeys} top-level keys in the text but ${parsedKeys} after parsing — a duplicated key is being silently overwritten`)
    } else if (rawKeys === 0) {
      bad('package.json: the duplicate-key check found no top-level keys at all — it is not looking at anything')
    } else {
      ok(`package.json: ${parsedKeys} top-level keys, no duplicates`)
    }
  }
}
const clientDecl = manifest.dsh?.client
if (clientDecl?.platform !== 'web') {
  bad(`package.json: dsh.client.platform must be "web" (got ${JSON.stringify(clientDecl?.platform)}) — the web shell skips rows for any other platform`)
} else {
  ok(`package.json: dsh.client declares platform web with ${clientDecl.inject?.length ?? 0} inject row(s)`)
}
const clientExport = manifest.exports?.['./client']?.default ?? manifest.exports?.['./client']
if (typeof clientExport !== 'string' || !existsSync(join(root, clientExport))) {
  bad('package.json: dsh.client is declared but exports["./client"] is missing or unbuildable — client-modules throws on this row')
} else {
  ok(`package.json: exports["./client"] resolves (${clientExport})`)
}
const patchDecl = manifest.dsh?.bundle?.patch
if (typeof patchDecl !== 'string' || !existsSync(join(root, patchDecl))) {
  bad(`package.json: dsh.bundle.patch points at a missing file (${JSON.stringify(patchDecl)})`)
} else {
  ok(`package.json: dsh.bundle.patch resolves (${patchDecl})`)
}
if (typeof manifest.icon === 'string') {
  const iconPath = join(root, manifest.icon)
  const iconBytes = existsSync(iconPath) ? (await readFile(iconPath)).byteLength : -1
  if (iconBytes < 0 || manifest.icon.startsWith('/') || /^[a-z]+:/.test(manifest.icon)) {
    bad(`package.json: icon must be a readable path inside the package (got ${JSON.stringify(manifest.icon)})`)
  } else if (iconBytes > 256 * 1024) {
    bad(`package.json: icon is ${iconBytes} bytes — dsh accepts at most 256 KiB`)
  } else {
    ok(`package.json: icon present (${manifest.icon}, ${iconBytes} bytes)`)
  }
} else {
  bad('package.json: no icon field — the plugin card shows the panel default artwork')
}
for (const localeFile of ['locale/en.json', 'locale/zh.json']) {
  let meta
  try {
    meta = JSON.parse(await readFile(join(root, localeFile), 'utf8')).meta
  } catch {
    bad(`package.json: ${localeFile} is missing or unparsable — plugin display text falls back to the package name`)
    continue
  }
  if (typeof meta?.title !== 'string' || typeof meta?.description !== 'string') {
    bad(`package.json: ${localeFile} needs meta.title and meta.description`)
  } else {
    ok(`package.json: ${localeFile} carries meta.title (${meta.title})`)
  }
}

// The runtime peer gate reads only `@deepseek-ai/dsh` / `@deepseek-ai/dsh-*`
// peers and tests them with semver.satisfies(runtime, range, { includePrerelease:
// true }). What this gate has to catch is a manifest claiming something other
// than the release the bundle was type-checked against, so the check is
// satisfaction — not the spelling of the range.
const gateOpts = { includePrerelease: true }
const dshPeers = Object.entries(manifest.peerDependencies ?? {}).filter(([name]) => name.startsWith('@deepseek-ai/dsh'))
if (dshPeers.length === 0) {
  bad('peerDependencies: no @deepseek-ai/dsh* peer is declared, so no dsh release would be gated')
}
for (const [name, range] of dshPeers) {
  let installed
  try {
    installed = JSON.parse(await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8')).version
  } catch {
    bad(`peerDependencies: ${name} is declared but not installed, so its range cannot be checked`)
    continue
  }
  if (!semver.validRange(String(range), gateOpts)) {
    bad(`peerDependencies: ${name} range ${JSON.stringify(range)} is not a valid semver range — dsh reads that as incompatible and skips the bundle`)
  } else if (!semver.satisfies(installed, String(range), gateOpts)) {
    bad(`peerDependencies: the ${installed} build target this bundle was type-checked against does not satisfy the declared range ${JSON.stringify(range)} — dsh would refuse the very release this was built for`)
  } else if (semver.satisfies('99.0.0', String(range), gateOpts)) {
    bad(`peerDependencies: ${name} range ${JSON.stringify(range)} admits every version, so it states no supported release at all`)
  } else {
    ok(`peerDependencies: the installed ${installed} build target satisfies ${range}`)
  }
}

// `engines.dsh` is not what the runtime gate reads — that only looks at the
// @deepseek-ai/dsh-* peers — but it is what npm and the plugin manager show the
// user, so the two must admit the same versions or the docs promise what the
// gate does not enforce.
{
  const declared = String(manifest.engines?.dsh ?? '')
  const peer = String(manifest.peerDependencies?.['@deepseek-ai/dsh-tools'] ?? '')
  if (declared === '') {
    bad('engines.dsh: absent, so users are shown no supported dsh range')
  } else if (peer === '') {
    bad('engines.dsh: cannot be cross-checked — no @deepseek-ai/dsh-tools peer is declared')
  } else {
    // Compare verdicts across the release history, not just at the floor: an
    // `||` clause can drift in either direction while the floor still looks right.
    const probe = ['0.1.6', '0.1.7-rc.1', '0.1.7-rc.2', '0.1.8', '0.1.9', '0.2.0-rc.1', '0.2.0-rc.2', '0.2.0-rc.3', '0.2.0', '0.3.0']
    const diverging = probe.filter(v => semver.satisfies(v, declared, gateOpts) !== semver.satisfies(v, peer, gateOpts))
    if (diverging.length > 0) {
      bad(`engines.dsh ${JSON.stringify(declared)} and the dsh-tools peer ${JSON.stringify(peer)} disagree on ${diverging.join(', ')}`)
    } else {
      ok(`engines.dsh agrees with the dsh-tools peer range across ${probe.length} probed versions`)
    }
  }
}

// What npm actually ships is decided by `files`; a pattern matching nothing
// publishes a bundle missing that piece (the class of breakage that shows up
// only on someone else's machine).
for (const entry of manifest.files ?? []) {
  const resolved = entry.includes('*')
    ? (() => {
        const [dir, suffix] = entry.includes('/') ? [entry.slice(0, entry.lastIndexOf('/')), entry.slice(entry.lastIndexOf('/') + 1)] : ['', entry]
        const base = join(root, dir)
        const re = new RegExp('^' + suffix.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$')
        try { return readdirSync(base).filter((item) => re.test(item)).length } catch { return -1 }
      })()
    : existsSync(join(root, entry)) ? 1 : 0
  if (resolved <= 0) bad(`package.json files: "${entry}" matches nothing in the working tree`)
  else ok(`package.json files: "${entry}" resolves (${resolved})`)
}

const require = createRequire(join(root, 'lib/index.js'))
try {
  const engine = require.resolve('mermaid/dist/mermaid.min.js')
  ok(`mermaid engine resolves locally: ${engine}`)
} catch {
  bad('mermaid/dist/mermaid.min.js does not resolve — run pnpm install')
}

// ── headless browser: the registration handshake ────────────────────────────

// `--static-only` stops after the artifact and manifest contract checks, so CI
// can run the checks that need no browser (a missing Chrome on a runner must not
// read as a packaging failure, and the handshake still runs via `pnpm smoke`).
const staticOnly = process.argv.includes('--static-only')

function findBrowser() {
  const configured = [
    process.env.SMOKE_BROWSER,
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Microsoft/Edge/Application/msedge.exe'),
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter((item) => typeof item === 'string' && item !== '')
  const byPath = configured.find((item) => existsSync(item))
  if (byPath !== undefined) return byPath
  // Bare executable names only resolve through PATH.
  const dirs = (process.env.PATH ?? '').split(delimiter).filter((dir) => dir !== '')
  for (const name of ['google-chrome', 'chromium', 'chromium-browser', 'msedge']) {
    for (const dir of dirs) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

const browserPath = staticOnly ? null : findBrowser()
if (staticOnly) {
  ok('headless browser handshake skipped (--static-only)')
} else if (browserPath === null) {
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
