/**
 * Invariant tests over the generated static CSS. The stylesheet is a plain
 * string, so these are string assertions — each one encodes a shipped
 * regression: the 0.7.0 liquid scope bug (`.vx-liquid` selectors that could
 * never match because the class lives on <html>, an ANCESTOR of .vx-root),
 * the pre-overhaul self-drawn palette, and the missing open/close motion.
 * @module @alexpeng/dsh-custom-plugin/tests/styles
 */

import { describe, expect, it } from 'vitest'
import { STATIC_CSS } from '../src/client/styles.ts'

/** Split the stylesheet into `selector { body }` pairs (comments stripped). */
function rules(css: string): Array<{ selector: string; body: string }> {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: Array<{ selector: string; body: string }> = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped)) !== null) out.push({ selector: m[1].trim(), body: m[2] })
  return out
}

describe('STATIC_CSS invariants', () => {
  const all = rules(STATIC_CSS)

  it('is non-empty and structurally balanced', () => {
    expect(STATIC_CSS.length).toBeGreaterThan(1000)
    const stripped = STATIC_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(stripped.split('{').length).toBe(stripped.split('}').length)
  })

  it('never places .vx-liquid after .vx-root in a selector (the 0.7.0 dead-rule bug)', () => {
    for (const rule of all) {
      const liquidAt = rule.selector.indexOf('.vx-liquid')
      const rootAt = rule.selector.indexOf('.vx-root')
      if (liquidAt >= 0 && rootAt >= 0) expect(liquidAt, rule.selector).toBeLessThan(rootAt)
    }
  })

  it('builds floating surfaces from one neutral material palette', () => {
    const surface = all.find((r) => r.selector === '.vx-glass,\n.vx-popover' || r.selector === '.vx-glass, .vx-popover')
    expect(surface).toBeDefined()
    expect(surface?.body).toContain('rgba(250, 251, 253, .9)')
    expect(surface?.body).toContain('blur(30px)')
    expect(STATIC_CSS).not.toContain('#7fa4e0')
  })

  it('gives dialogs the same material as the floating surfaces', () => {
    const dialog = all.find((r) => r.selector === '.vx-dialog')
    expect(dialog).toBeDefined()
    expect(dialog?.body).toContain('var(--dsw-alias-bg-layer-3')
    const glassDialog = all.find((r) => r.selector === ':root:not(.vx-glass-off) .vx-dialog')
    expect(glassDialog?.body).toContain('backdrop-filter')
    const mask = all.find((r) => r.selector === '.vx-dialog-mask')
    expect(mask?.body).toContain('var(--dsw-alias-bg-mask-1')
    expect(mask?.body).not.toContain('backdrop-filter')
  })

  it('ships entrance/exit motion for every floating surface', () => {
    expect(STATIC_CSS).toContain('@keyframes vx-pop-in')
    expect(STATIC_CSS).toContain('@keyframes vx-pop-out')
    expect(STATIC_CSS).toContain('@keyframes vx-dialog-in')
    expect(STATIC_CSS).toContain('@keyframes vx-toast-in')
    expect(all.some((r) => r.selector === ".vx-popover[data-state='open']")).toBe(true)
    expect(all.some((r) => r.selector === ".vx-popover[data-state='closed']")).toBe(true)
    expect(all.some((r) => r.selector === ".vx-dialog[data-state='closed']")).toBe(true)
    expect(all.some((r) => r.selector === ".vx-dialog-mask[data-state='closed']")).toBe(true)
  })

  it('honours prefers-reduced-motion', () => {
    expect(STATIC_CSS).toContain('@media (prefers-reduced-motion: reduce)')
    expect(STATIC_CSS).toContain('animation: none !important')
    expect(STATIC_CSS).toContain('transition: none !important')
  })

  it('shares one head/body/foot shell across every anchored card', () => {
    const popover = all.find((r) => r.selector === '.vx-popover')
    expect(popover?.body).toContain('display: flex')
    expect(popover?.body).toContain('overflow: hidden')
    expect(all.find((r) => r.selector === '.vx-pop-head')?.body).toContain('padding: 12px 14px 6px')
    expect(all.find((r) => r.selector === '.vx-pop-body')?.body).toContain('overflow: auto')
    expect(all.find((r) => r.selector === '.vx-pop-body')?.body).toContain('padding: 4px 14px 10px')
    expect(all.find((r) => r.selector === '.vx-pop-foot')?.body).toContain('border-top')
    // Cards that still carry their own shell drift away from the shared one.
    expect(STATIC_CSS).not.toContain('vx-balance-body')
    expect(STATIC_CSS).not.toContain('vx-folders-body')
    expect(STATIC_CSS).not.toContain('vx-quick-panel')
    expect(STATIC_CSS).not.toContain('vx-panel-head')
  })

  it('keeps plugin header buttons on the native chip inset so the row gaps match', () => {
    // The session header actions row is one 10px-gap flex row and the native
    // agent-preset chip right-insets its label by 2px. The shared button rule's
    // 10px side padding made the gap between our two buttons 9px wider than
    // the gap before the first; the override must keep matching the chip.
    const button = all.find((r) => r.selector === '.vx-header-btn')
    expect(button?.body).toContain('padding: 3px 2px')
  })

  it('keeps liquid clear and colourless while frost stays milky', () => {
    // Desktop hosts plugin popovers in a separate floating document, where
    // backdrop-filter cannot sample the page behind it. Liquid therefore reads
    // through its body (86% -> 78%) plus edge optics — a 1px specular rim with a
    // faint dispersion fringe, a top bevel and a darker bottom inner shade — not
    // through a tinted or milky fill. Frost is the opaque 90% -> 84% milk pane.
    const liquid = all.find((r) => r.selector === '.vx-liquid .vx-glass,\n.vx-liquid .vx-popover')
    expect(liquid?.body).toContain('rgba(249, 251, 254, .86)')
    expect(liquid?.body).toContain('rgba(242, 246, 250, .78)')
    expect(liquid?.body).toContain('blur(2px)')
    expect(liquid?.body).toContain('inset 0 -10px 18px -14px')
    expect(STATIC_CSS).toContain('.vx-liquid .vx-popover::after')
    // The settings page is the same sheet: liquid is the clear pane with the
    // specular rim; frost is the milky sheet with no rim.
    const sheet = all.find((r) => r.selector === '.vx-settings-page.vx-glass-on')
    expect(sheet?.body).toContain('rgba(250, 251, 253, .94)')
    const liquidSheet = all.find((r) => r.selector === '.vx-settings-page.vx-glass-on.vx-liquid')
    expect(liquidSheet?.body).toContain('rgba(249, 251, 254, .9)')
    expect(liquidSheet?.body).toContain('rgba(242, 246, 250, .82)')
    expect(STATIC_CSS).toContain('.vx-settings-page.vx-glass-on.vx-liquid::after')
    // A live background may only nudge transmission; the optics never move.
    const liveLiquid = all.find((r) => r.selector === ':root.vx-bg-live.vx-liquid:not(.vx-glass-off) .vx-glass,\n:root.vx-bg-live.vx-liquid:not(.vx-glass-off) .vx-popover')
    expect(liveLiquid?.body).toContain('rgba(249, 251, 254, .84)')
    expect(liveLiquid?.body).toContain('rgba(242, 246, 250, .76)')
    const liveSheet = all.find((r) => r.selector === '.vx-settings-page.vx-glass-on.vx-liquid.vx-bg-live')
    expect(liveSheet?.body).toContain('rgba(249, 251, 254, .88)')
    expect(liveSheet?.body).toContain('rgba(242, 246, 250, .8)')
  })

  it('does not re-implement the light/dark palettes with media queries', () => {
    expect(STATIC_CSS).not.toContain('@media (prefers-color-scheme: dark)')
  })

  it('carries no retired class names', () => {
    expect(STATIC_CSS).not.toContain('vx-dots')
    expect(STATIC_CSS).not.toContain('vx-timeline')
    expect(STATIC_CSS).not.toContain('vx-modal')
    expect(STATIC_CSS).not.toContain('vx-toasts')
  })
})
