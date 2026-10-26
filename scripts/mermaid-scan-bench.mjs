#!/usr/bin/env node
/**
 * Mermaid scan/render benchmark for a long chat turn.
 *
 * dsh virtualizes messages, but a single huge turn mounts all of its code
 * blocks. This tool builds that worst case synthetically in headless Edge:
 * N blocks (every Nth is a Mermaid fence), measures the extracted scanner's
 * cold and warm passes, then measures real Mermaid rendering for K diagrams.
 * It is a measurement tool, not a gate; run it before changing scan frequency
 * or adding viewport-based rendering.
 *
 *   node scripts/mermaid-scan-bench.mjs
 *
 * Requires the same Chromium-family browser as `pnpm smoke`.
 * @module dsh-custom-plugin/scripts/mermaid-scan-bench
 */

import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'lib/index.js'))

function findBrowser() {
  const candidates = [
    process.env.SMOKE_BROWSER,
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Microsoft/Edge/Application/msedge.exe'),
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Microsoft/Edge/Application/msedge.exe'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter((item) => typeof item === 'string' && item !== '')
  const byPath = candidates.find((item) => existsSync(item))
  if (byPath !== undefined) return byPath
  for (const name of process.platform === 'win32' ? ['msedge.exe', 'chrome.exe'] : ['google-chrome', 'chromium']) {
    for (const dir of (process.env.PATH ?? '').split(delimiter)) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

const browserPath = findBrowser()
if (browserPath === null) {
  console.error('No Chromium-family browser found; set SMOKE_BROWSER.')
  process.exit(2)
}

const transpile = async (name) => ts.transpileModule(
  await readFile(join(root, 'src/client', `${name}.ts`), 'utf8'),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
).outputText.replace(/from ['"](\.\/[a-z0-9-]+)\.ts['"]/g, "from '$1.js'")

const modules = {
  '/mermaid-render.js': await transpile('mermaid-render'),
  '/mermaid-scan.js': await transpile('mermaid-scan'),
  '/mermaid-code.js': await transpile('mermaid-code'),
  '/timeline-diff.js': await transpile('timeline-diff'),
  '/mermaid-url.js': await transpile('mermaid-url'),
}
const mermaidEngine = readFileSync(require.resolve('mermaid/dist/mermaid.min.js'))

const server = createServer((request, response) => {
  if (request.url === '/mermaid.js') {
    response.writeHead(200, { 'content-type': 'application/javascript' })
    response.end(mermaidEngine)
  } else if (request.url !== undefined && Object.hasOwn(modules, request.url)) {
    response.writeHead(200, { 'content-type': 'application/javascript' })
    response.end(modules[request.url])
  } else if (request.url === '/bench.html') {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><html><body><div id="chat"></div><script src="/mermaid.js"></script></body></html>')
  } else {
    response.writeHead(404)
    response.end('not found')
  }
})
server.listen(0, '127.0.0.1')
await new Promise((resolve) => server.once('listening', resolve))
const port = server.address().port

const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ['--no-first-run', '--disable-gpu'] })
const page = await browser.newPage()
await page.goto(`http://127.0.0.1:${port}/bench.html`, { waitUntil: 'networkidle0' })

const result = await page.evaluate(async () => {
  const { createMermaidScanner } = await import('/mermaid-scan.js')
  const { renderMermaid } = await import('/mermaid-render.js')
  const chat = document.getElementById('chat')
  const pythonSource = Array.from({ length: 24 }, (_, i) => `def step_${i}(value):  # tool output line ${i}\n    return value + ${i}`).join('\n')

  const makeBlock = (lang, code) => {
    const block = document.createElement('div')
    block.className = 'md-code-block'
    const banner = document.createElement('div')
    const row = document.createElement('div')
    const info = document.createElement('div')
    info.textContent = lang
    row.append(info)
    banner.append(row)
    block.append(banner)
    const pre = document.createElement('pre')
    const codeEl = document.createElement('code')
    codeEl.textContent = code
    pre.append(codeEl)
    block.append(pre)
    return block
  }

  const reset = (count, mermaidEvery, mermaidCode) => {
    chat.replaceChildren()
    const fragment = document.createDocumentFragment()
    let mermaid = 0
    for (let i = 0; i < count; i++) {
      const isMermaid = i % mermaidEvery === 0
      if (isMermaid) mermaid++
      fragment.append(makeBlock(isMermaid ? 'mermaid' : 'python', isMermaid ? mermaidCode : pythonSource))
    }
    chat.append(fragment)
    return mermaid
  }

  const stats = (values) => {
    const sorted = [...values].sort((a, b) => a - b)
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
    return { median: +at(0.5).toFixed(2), p95: +at(0.95).toFixed(2) }
  }

  const measureScan = async (count, mermaidEvery) => {
    const mermaid = reset(count, mermaidEvery, 'flowchart LR\n  A-->B')
    let renders = 0
    const scanner = createMermaidScanner({
      ensureMermaid: async () => true,
      renderMermaid: async () => { renders++; return { ok: true, svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>' } },
    })
    const coldStart = performance.now()
    await scanner.scan(false)
    const cold = +(performance.now() - coldStart).toFixed(2)
    const warm = []
    for (let i = 0; i < 20; i++) {
      const start = performance.now()
      await scanner.scan(false)
      warm.push(performance.now() - start)
    }
    const nonMermaidCode = chat.querySelectorAll('.md-code-block')[1].querySelector('code')
    nonMermaidCode.textContent += '\n# streamed update'
    const mutateStart = performance.now()
    await scanner.scan(false)
    const mutate = +(performance.now() - mutateStart).toFixed(2)
    scanner.restore()
    return { count, mermaid, cold, ...stats(warm), mutate, renders }
  }

  const scanRows = []
  for (const count of [50, 200, 500, 1000]) scanRows.push(await measureScan(count, 10))

  const renderRows = []
  for (const count of [1, 5, 10, 20]) {
    const mermaid = reset(count, 1, 'flowchart LR\n  A-->B')
    let renderedBytes = 0
    const scanner = createMermaidScanner({
      ensureMermaid: async () => true,
      renderMermaid: async (code, dark) => {
        const out = await renderMermaid(code, dark)
        if (out.ok) renderedBytes += out.svg.length
        return out
      },
    })
    const start = performance.now()
    await scanner.scan(false)
    const cold = +(performance.now() - start).toFixed(2)
    scanner.restore()
    renderRows.push({ count: mermaid, cold, perDiagram: +(cold / count).toFixed(2), svgBytes: renderedBytes })
  }

  return { scanRows, renderRows }
})

await browser.close()
server.close()
server.closeAllConnections?.()

console.log('Synthetic turn scan (every 10th block is Mermaid, others ~1.5 KB python-like)')
console.log('blocks  mermaid  cold ms  warm median  warm p95  mutate ms  cold renders')
for (const row of result.scanRows) {
  console.log(`${String(row.count).padEnd(7)} ${String(row.mermaid).padEnd(8)} ${String(row.cold).padEnd(8)} ${String(row.median).padEnd(12)} ${String(row.p95).padEnd(9)} ${String(row.mutate).padEnd(10)} ${row.renders}`)
}
console.log('\nReal Mermaid render (simple flowchart, local 11.17.2 engine)')
console.log('diagrams  cold ms  per-diagram ms  svg bytes')
for (const row of result.renderRows) {
  console.log(`${String(row.count).padEnd(9)} ${String(row.cold).padEnd(8)} ${String(row.perDiagram).padEnd(15)} ${row.svgBytes}`)
}
console.log('\nInterpretation: compare warm p95 with the 400 ms observer debounce; compare per-diagram × diagrams in one turn with the eager (current) scan.')
