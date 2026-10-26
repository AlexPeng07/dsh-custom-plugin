/**
 * Mermaid render + scratch-node cleanup, kept out of the React component so the
 * failure path can be exercised in a real browser.
 *
 * Mermaid appends its error diagram to <body> before `render()` rejects; a
 * caller that only catches the exception leaves `div#d<id>` (and sometimes the
 * SVG) behind. Everything below exists to make that impossible: suppress the
 * error UI, remove all three possible scratch nodes in a `finally`, and expose
 * a sweep for diagrams left by older builds.
 *
 * This module must stay dependency-free: `scripts/smoke.mjs` transpiles it on
 * its own and loads it as an ES module in the headless browser.
 * @module @alexpeng/dsh-custom-plugin/client/mermaid-render
 */

/** The slice of window.mermaid this module uses. */
export interface MermaidLike {
  initialize(options: Record<string, unknown>): void
  render(id: string, code: string): Promise<string | { svg: string }>
}

export type MermaidRenderResult = { ok: true; svg: string } | { ok: false; error: string }

/** A fresh id per render; Mermaid appends `d` + id / `i` + id scratch nodes. */
function mermaidScratchId(): string {
  return 'vx-mmd-' + Date.now() + Math.floor(Math.random() * 9999)
}

/** Remove the three nodes Mermaid may leave for one render id. */
export function removeMermaidScratch(doc: Document | null, id: string): void {
  if (doc === null) return
  for (const scratch of [id, 'd' + id, 'i' + id]) doc.getElementById(scratch)?.remove()
}

/** Remove error diagrams left in <body> by builds without error suppression. */
export function removeLegacyMermaidErrors(doc: Document | null): void {
  if (doc === null) return
  for (const leftover of Array.from(doc.querySelectorAll<HTMLElement>('body > div[id^="dvx-mmd-"]'))) leftover.remove()
}

export async function renderMermaid(
  code: string,
  dark = false,
  options: { win?: Window | null; doc?: Document | null } = {},
): Promise<MermaidRenderResult> {
  const doc = options.doc !== undefined ? options.doc : (typeof document !== 'undefined' ? document : null)
  const win = options.win !== undefined ? options.win : (typeof window !== 'undefined' ? window : null)
  const mermaid = (win as unknown as { mermaid?: MermaidLike } | null)?.mermaid
  if (mermaid === undefined) return { ok: false, error: '引擎未就绪' }
  const id = mermaidScratchId()
  try {
    mermaid.initialize({
      startOnLoad: false,
      theme: dark ? 'dark' : 'default',
      securityLevel: 'strict',
      // Without this Mermaid renders a full-width bomb diagram into <body>
      // before it throws; removeMermaidScratch alone cannot undo the paint.
      suppressErrorRendering: true,
    })
    const out = await mermaid.render(id, code)
    const svg = typeof out === 'string' ? out : (out?.svg ?? '')
    if (svg === '') return { ok: false, error: '引擎未返回 SVG' }
    return { ok: true, svg }
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error) }
  } finally {
    removeMermaidScratch(doc, id)
  }
}
