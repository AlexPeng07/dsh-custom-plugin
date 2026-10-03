/**
 * Invariant tests over the generated static CSS. The stylesheet is a plain
 * string, so these are string assertions — but each one encodes a shipped
 * regression: the 0.7.0 liquid scope bug (`.vx-liquid` selectors that could
 * never match because the class lives on <html>, an ANCESTOR of .vx-root),
 * the dark-GUI-on-light-OS frost mismatch, and retired class names.
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
    // Braces inside comments are prose, not structure — count on stripped CSS.
    const stripped = STATIC_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(stripped.split('{').length).toBe(stripped.split('}').length)
  })

  it('never places .vx-liquid after .vx-root in a selector (the 0.7.0 dead-rule bug)', () => {
    // vx-liquid lives on <html>; a selector ordering it under .vx-root can
    // never match and silently downgraded the panel to frost.
    for (const rule of all) {
      const liquidAt = rule.selector.indexOf('.vx-liquid')
      const rootAt = rule.selector.indexOf('.vx-root')
      if (liquidAt >= 0 && rootAt >= 0) expect(liquidAt, rule.selector).toBeLessThan(rootAt)
    }
  })

  it('scopes the theme-dependent glass fills on the mirrored root classes', () => {
    // The GUI theme can disagree with the OS scheme, so frost fills must key
    // on :root.vx-dark / :root.vx-light, not only prefers-color-scheme.
    expect(all.some((r) => r.selector === ':root.vx-dark .vx-glass')).toBe(true)
    expect(all.some((r) => r.selector === ':root.vx-light .vx-glass')).toBe(true)
    // Liquid fills likewise carry both theme scopes (plus the .vx-root
    // descendant variant for surfaces inside the app root).
    expect(all.some((r) => r.selector === ':root.vx-liquid.vx-dark .vx-glass')).toBe(true)
    expect(all.some((r) => r.selector === ':root.vx-liquid.vx-light .vx-glass')).toBe(true)
  })

  it('themes the balance hover card through the root classes', () => {
    expect(all.some((r) => r.selector === ':root.vx-dark .vx-balance-hover')).toBe(true)
    expect(all.some((r) => r.selector === ':root.vx-light .vx-balance-hover')).toBe(true)
  })

  it('carries no retired class names', () => {
    expect(STATIC_CSS).not.toContain('vx-dots')
    expect(STATIC_CSS).not.toContain('vx-timeline')
  })
})
