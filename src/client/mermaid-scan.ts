/**
 * In-place Mermaid rendering over the GUI's code-block DOM, extracted from the
 * React component so it can be benchmarked and tested without mounting the
 * whole shell.
 *
 * Behaviour is deliberately unchanged: the GUI-owned `<pre>` node is never
 * moved, the plugin-owned wrapper is inserted before the block and toggles the
 * block's `display`, a failed render keeps the raw fence plus a retry marker,
 * and a theme flip invalidates the rendered-SVG memo.
 * @module @alexpeng/dsh-custom-plugin/client/mermaid-scan
 */

import { isGenericInfostring, isMermaidCode, normalizeMermaidText } from './mermaid-code.ts'
import { removeLegacyMermaidErrors } from './mermaid-render.ts'
import type { MermaidRenderResult } from './mermaid-render.ts'
import { mermaidCodeKey } from './timeline-diff.ts'
import { mermaidLiveUrl } from './mermaid-url.ts'

export interface MermaidScanDeps {
  ensureMermaid(): Promise<boolean>
  renderMermaid(code: string, dark: boolean): Promise<MermaidRenderResult>
}

export interface MermaidScanner {
  scan(dark: boolean): Promise<void>
  restore(): void
}

export function createMermaidScanner(deps: MermaidScanDeps): MermaidScanner {
  /** Blocks with a render already in flight (WeakSet: dead blocks drop out). */
  const inflight = new WeakSet<HTMLElement>()
  /** Previous scan theme; a flip invalidates rendered-SVG memoization. */
  let lastDark: boolean | null = null

  /** The banner's language label: `.md-code-block > bannerWrap > banner >
   * infostring` is the GUI CodeBlock's stable shape (its CSS classes are
   * hashed, the structure is not). */
  function blockInfostring(block: HTMLElement): string | null {
    const info = block.querySelector(':scope > div:first-child > div:first-child > div:first-child')
    return info !== null ? info.textContent ?? '' : null
  }

  /** Raw fence text: the GUI keeps unknown languages (mermaid among them) on
   * the plain `<pre><code>` path, so `pre` always carries the source. */
  function blockCodeText(block: HTMLElement): string | null {
    const pre = block.querySelector('pre')
    return pre !== null ? pre.textContent ?? '' : null
  }

  /** Insert/refresh the diagram wrapper before one code block. Never moves
   * GUI-owned nodes — React keeps reconciling its tree; the block is only
   * visually swapped with the diagram stage via display. */
  async function renderInPlace(block: HTMLElement, code: string, dark: boolean): Promise<void> {
    const key = mermaidCodeKey(code)
    const existingWrap = block.previousElementSibling
    if (block.dataset.vxMmd === key && existingWrap !== null && existingWrap.classList.contains('vx-mmd-wrap')) return
    const ready = await deps.ensureMermaid()
    if (!ready) {
      // Engine unreachable: keep the code visible; a later scan retries once
      // the engine becomes ready (ensureMermaid clears the fail marker then).
      block.dataset.vxMmdFail = key
      return
    }
    const r = await deps.renderMermaid(code, dark)
    if (!r.ok) { block.dataset.vxMmdFail = key; return }
    delete block.dataset.vxMmdFail
    const d = typeof document !== 'undefined' ? document : null
    if (d === null) return
    // Re-read the sibling after the awaits: React may have re-rendered the
    // conversation and detached the wrapper observed before ensureMermaid.
    let wrap = block.previousElementSibling as HTMLElement | null
    if (wrap === null || !wrap.classList.contains('vx-mmd-wrap')) {
      wrap = d.createElement('div')
      wrap.className = 'vx-mmd-wrap'
      block.parentElement?.insertBefore(wrap, block)
      const bar = d.createElement('div')
      bar.className = 'vx-mmd-bar'
      const diagramBtn = d.createElement('button')
      diagramBtn.type = 'button'
      diagramBtn.className = 'vx-mmd-btn active'
      diagramBtn.textContent = '图表'
      const codeBtn = d.createElement('button')
      codeBtn.type = 'button'
      codeBtn.className = 'vx-mmd-btn'
      codeBtn.textContent = '代码'
      const live = d.createElement('a')
      live.className = 'vx-mmd-live'
      live.target = '_blank'
      live.rel = 'noopener noreferrer'
      live.textContent = 'mermaid.live'
      void mermaidLiveUrl(code).then((url) => { live.href = url }).catch(() => {})
      bar.append(diagramBtn, codeBtn, live)
      const stage = d.createElement('div')
      stage.className = 'vx-mmd-stage'
      wrap.append(bar, stage)
      const showDiagram = (): void => {
        stage.style.display = ''
        block.style.display = 'none'
        diagramBtn.classList.add('active')
        codeBtn.classList.remove('active')
      }
      const showCode = (): void => {
        stage.style.display = 'none'
        block.style.display = ''
        diagramBtn.classList.remove('active')
        codeBtn.classList.add('active')
      }
      diagramBtn.addEventListener('click', showDiagram)
      codeBtn.addEventListener('click', showCode)
      showDiagram()
    }
    const stage = wrap.querySelector('.vx-mmd-stage')
    if (stage === null) return
    stage.innerHTML = r.svg
    block.dataset.vxMmd = key
  }

  /** Scan every chat code block and render the mermaid ones in place. */
  async function scan(dark: boolean): Promise<void> {
    const d = typeof document !== 'undefined' ? document : null
    if (d === null) return
    if (lastDark !== null && lastDark !== dark) {
      // Theme flipped: drop the memo so existing diagrams re-render.
      for (const block of Array.from(d.querySelectorAll<HTMLElement>('.md-code-block'))) delete block.dataset.vxMmd
    }
    lastDark = dark
    removeLegacyMermaidErrors(d)
    // Drop wrappers whose code block left the DOM (history switch / unmount).
    for (const wrap of Array.from(d.querySelectorAll<HTMLElement>('.vx-mmd-wrap'))) {
      const next = wrap.nextElementSibling
      if (next === null || !next.classList.contains('md-code-block')) wrap.remove()
    }
    for (const block of Array.from(d.querySelectorAll<HTMLElement>('.md-code-block'))) {
      if (inflight.has(block)) continue
      const codeRaw = blockCodeText(block)
      if (codeRaw === null) continue
      const code = normalizeMermaidText(codeRaw).trim()
      if (code === '') continue
      const key = mermaidCodeKey(code)
      const info = blockInfostring(block)
      const definite = info !== null && info.trim().toLowerCase() === 'mermaid'
      if (definite) {
        // Settled ```mermaid fence: only guard against a lone keyword line.
        if (code.split('\n').filter((l) => l.trim() !== '').length < 2) continue
      } else {
        // Blank (streaming) or generic banner: content heuristics decide, so a
        // streaming mindmap previews as soon as it is complete enough and a
        // named foreign language (python etc.) is never touched.
        if (!isGenericInfostring(info)) continue
        if (!isMermaidCode(codeRaw)) continue
      }
      if (block.dataset.vxMmd === key || block.dataset.vxMmdFail === key) continue
      inflight.add(block)
      try {
        await renderInPlace(block, code, dark)
      } finally {
        inflight.delete(block)
      }
    }
  }

  /** Undo in-place rendering (feature toggled off): remove wrappers, unhide
   * code blocks. Diagram DOM is plugin-owned, so removal is safe. */
  function restore(): void {
    const d = typeof document !== 'undefined' ? document : null
    if (d === null) return
    for (const wrap of Array.from(d.querySelectorAll<HTMLElement>('.vx-mmd-wrap'))) {
      const next = wrap.nextElementSibling as HTMLElement | null
      if (next !== null && next.classList.contains('md-code-block')) next.style.display = ''
      wrap.remove()
    }
    for (const block of Array.from(d.querySelectorAll<HTMLElement>('.md-code-block'))) {
      delete block.dataset.vxMmd
      delete block.dataset.vxMmdFail
    }
  }

  return { scan, restore }
}
