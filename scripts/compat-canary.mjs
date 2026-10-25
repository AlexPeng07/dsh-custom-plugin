#!/usr/bin/env node
/**
 * Compatibility canary: install the published plugin into a scratch profile of
 * the newest dsh release, boot that host for real, and run the live probes.
 *
 * The support line is an open lower bound (`engines.dsh: >=0.1.7-rc.2`), so the
 * host no longer tells users that an untested dsh release is unsupported. This
 * canary is what notices when such a release actually breaks an API the bundle
 * still calls; it runs on a schedule in CI and opens an issue on failure.
 *
 *   node scripts/compat-canary.mjs                    # newest of npm latest/next
 *   node scripts/compat-canary.mjs 0.2.1-rc.3         # one exact version
 *   node scripts/compat-canary.mjs --plugin ./x.tgz   # test a local build
 *   node scripts/compat-canary.mjs --keep             # keep the scratch profile
 *
 * Read-only with respect to the developer's harness: every dsh command gets a
 * temporary DSH_HOME. Requires Node 22+, npm, bash and curl.
 * @module dsh-custom-plugin/scripts/compat-canary
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const publishedSpec = '@alexpeng/dsh-custom-plugin@latest'

const args = process.argv.slice(2)
const keep = args.includes('--keep')
let pluginSpec = publishedSpec
let explicitVersion = ''
let explicitPort = 0
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--plugin') pluginSpec = args[++i] ?? ''
  else if (arg === '--port') explicitPort = Number(args[++i])
  else if (arg === '--keep') continue
  else if (!arg.startsWith('--')) explicitVersion = arg
  else {
    console.error(`unknown option: ${arg}`)
    process.exit(2)
  }
}

let workspace = ''
let dshVersion = explicitVersion || 'unknown'
let verdict = 'FAIL'
let server = undefined

const run = (command, commandArgs, options = {}) =>
  execFileSync(command, commandArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    // npm is a .cmd shim on Windows; node itself must never go through a shell,
    // or `C:\Program Files\nodejs\node.exe` is split at the space.
    shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
    ...options,
  })

function newestTaggedVersion() {
  const out = run(npm, ['view', '@deepseek-ai/dsh', 'dist-tags', '--json', '--prefer-online'])
  const tags = JSON.parse(out)
  const candidates = [tags.latest, tags.next].filter((version) => typeof version === 'string' && semver.valid(version))
  if (candidates.length === 0) throw new Error(`npm dist-tags carry no usable dsh version: ${out.trim()}`)
  return candidates.sort(semver.rcompare)[0]
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port
      probe.close(() => resolvePort(port))
    })
  })
}

function packPlugin() {
  if (pluginSpec.endsWith('.tgz')) {
    const file = resolve(pluginSpec)
    if (!existsSync(file)) throw new Error(`plugin tarball not found: ${file}`)
    return file
  }
  run(npm, ['pack', pluginSpec, '--pack-destination', workspace, '--prefer-online'], { cwd: root })
  const tarball = readdirSync(workspace).find((name) => name.endsWith('.tgz'))
  if (tarball === undefined) throw new Error(`npm pack produced no tarball for ${pluginSpec}`)
  return join(workspace, tarball)
}

async function waitForBootUrl(child, timeoutMs) {
  let output = ''
  return new Promise((resolveUrl, reject) => {
    let timer = undefined
    const settle = (fn, value) => {
      clearTimeout(timer)
      child.stdout?.off('data', onData)
      child.stderr?.off('data', onData)
      fn(value)
    }
    const onData = (chunk) => {
      output += chunk.toString()
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\/\?token=[A-Za-z0-9_-]+/)
      if (match !== null) settle(resolveUrl, match[0])
    }
    timer = setTimeout(
      () => settle(reject, new Error(`dsh printed no boot URL within ${timeoutMs} ms\n${output}`)),
      timeoutMs,
    )
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.once('exit', (code) => settle(reject, new Error(`dsh exited before printing a boot URL (code ${code})\n${output}`)))
  })
}

async function stopServer() {
  if (server === undefined || server.exitCode !== null) return
  const exited = new Promise((resolveExit) => server.once('exit', resolveExit))
  server.kill('SIGTERM')
  await Promise.race([exited, new Promise((resolveWait) => setTimeout(resolveWait, 5000))])
  if (server.exitCode === null) server.kill('SIGKILL')
}

function fail(message) {
  console.error(`\nCANARY dsh=${dshVersion} plugin=${pluginSpec} verdict=FAIL\n${message}`)
  verdict = 'FAIL'
}

try {
  if (explicitVersion === '') dshVersion = newestTaggedVersion()
  workspace = mkdtempSync(join(tmpdir(), 'dsh-compat-canary-'))
  console.log(`CANARY dsh=${dshVersion} plugin=${pluginSpec} workspace=${workspace}`)

  const tarball = packPlugin()
  const dshDir = join(workspace, 'dshnext')
  mkdirSync(dshDir)
  writeFileSync(join(dshDir, 'package.json'), JSON.stringify({ name: 'dsh-compat-canary', private: true }))
  run(npm, ['install', '--no-audit', '--no-fund', `@deepseek-ai/dsh@${dshVersion}`], { cwd: dshDir })
  const dshBin = join(dshDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  if (!existsSync(dshBin)) throw new Error(`dsh ${dshVersion} installed without lib/bin.js`)

  const home = join(workspace, 'home')
  run(process.execPath, [dshBin, 'plugin', '--profile', 'web', 'add', tarball], {
    cwd: dshDir,
    env: { ...process.env, DSH_HOME: home },
  })

  const port = explicitPort > 0 ? explicitPort : await freePort()
  server = spawn(process.execPath, [dshBin, '--profile', 'web', '--no-open', '--port', String(port)], {
    cwd: dshDir,
    env: { ...process.env, DSH_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const bootUrl = await waitForBootUrl(server, 90_000)
  const jar = join(workspace, 'jar.txt')
  const cookie = spawnSync('curl', ['-s', '-c', jar, '-o', process.platform === 'win32' ? 'NUL' : '/dev/null', bootUrl], {
    encoding: 'utf8',
  })
  if (cookie.status !== 0) throw new Error(`curl could not seed the boot cookie: ${cookie.stderr}`)

  const live = spawnSync('bash', [join(root, 'scripts', 'live-dsh-check.sh')], {
    env: { ...process.env, DSH_HOME: home, DSH_PORT: String(port), COOKIE_JAR: jar },
    stdio: 'inherit',
  })
  if (live.status !== 0) throw new Error(`live-dsh-check.sh exited ${live.status} on dsh ${dshVersion}`)
  verdict = 'PASS'
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  await stopServer()
  if (workspace !== '' && !keep) {
    try {
      rmSync(workspace, { recursive: true, force: true })
    } catch (error) {
      console.error(`warning: could not remove ${workspace}: ${error.message}`)
    }
  } else if (workspace !== '') {
    console.log(`kept workspace: ${workspace}`)
  }
  console.log(`\nCANARY dsh=${dshVersion} plugin=${pluginSpec} verdict=${verdict}`)
}
