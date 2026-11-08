/**
 * Page-background layer skeleton: one decorative element below the content
 * surfaces, plus the gates that decide whether it may exist at all.
 *
 * Layer facts measured on dsh 0.2.1-rc.5 (2026-11-06, 1440x900): `<html>` is
 * transparent and `body` carries the opaque canvas fill, so a
 * `position:fixed; z-index:-1` child of `body` paints above that background
 * and below every content surface. The surfaces are 0.5–0.62 alpha only while
 * glass is on: with `glass:false` the layer is fully covered, which the
 * renderer step must treat as "invisible by design", not as a bug. The layer
 * must never live in `.vx-root` — that container sits inside the shell's
 * `.pI_x6G_overlayLayer` (`z-index:20`), so its 2147483000 only orders plugin
 * surfaces locally and native dialogs at z1000 paint above it.
 *
 * Phase 1 owns the layer, its config path and the degradation gates; Phase 2
 * adds the ASCII canvas renderer inside this node (see `bg-ascii.ts`).
 * @module @alexpeng/dsh-custom-plugin/client/bg-layer
 */

import { DARK_CANVAS_LIGHTNESS, PALETTE, toDarkRamp } from './palette.ts'

/** DOM id of the owned background layer. */
export const BG_LAYER_ID = 'vx-bg'

/** Motion state the renderer step will honour. */
export type BgLayerMotion = 'animated' | 'static' | 'paused'

/** Environment facts the gates read; injected so tests need no DOM. */
export interface BgLayerCaps {
  readonly canvas2d: boolean
  readonly reducedMotion: boolean
  readonly hidden: boolean
}

/** Whether the layer may mount, and if so the motion state to record. */
export type BgLayerVerdict =
  | { readonly mount: false; readonly reason: 'disabled' | 'no-canvas' }
  | { readonly mount: true; readonly motion: BgLayerMotion }

/** Capability facts for the two renderer tiers. `webgl` is the result of the
 * cached WebGL1 probe; `canvas2d` is required by the ASCII fallback. */
export interface BgFxCaps extends BgLayerCaps {
  readonly webgl: boolean
}

/** Verdict for the multi-tier gate: which renderer the layer will host. */
export type BgFxVerdict =
  | { readonly mount: false; readonly reason: 'disabled' | 'no-canvas' }
  | { readonly mount: true; readonly motion: BgLayerMotion; readonly tier: 'ascii' | 'shader' }

function motionOf(caps: BgLayerCaps): BgLayerMotion {
  return caps.hidden ? 'paused' : caps.reducedMotion ? 'static' : 'animated'
}

/**
 * Gate for the full `bgFx` enum. The requested shader tier needs WebGL1; when
 * the probe failed but a 2D context exists, the same layer mounts with the
 * ASCII tier so the page keeps an animated background instead of dropping to
 * the plain tint. When neither context exists there is nothing to draw, and
 * the caller leaves the body fill in place.
 */
export function decideBgFxLayer(mode: 'none' | 'ascii' | 'shader', caps: BgFxCaps): BgFxVerdict {
  if (mode === 'none') return { mount: false, reason: 'disabled' }
  if (mode === 'shader') {
    if (caps.webgl) return { mount: true, motion: motionOf(caps), tier: 'shader' }
    if (caps.canvas2d) return { mount: true, motion: motionOf(caps), tier: 'ascii' }
    return { mount: false, reason: 'no-canvas' }
  }
  if (!caps.canvas2d) return { mount: false, reason: 'no-canvas' }
  return { mount: true, motion: motionOf(caps), tier: 'ascii' }
}

/**
 * Build-before-teardown swap. The two tiers are mutually exclusive, so the
 * replacement must be constructed (and its first frame painted) before the
 * old renderer is destroyed: that order is what prevents a blank frame while
 * the opaque body fill is still transparent. A failed build leaves the current
 * renderer untouched, so the caller can fall back without losing the layer.
 */
export function swapBgRenderer<R extends { destroy(): void }>(current: R | null, build: () => R | null): R | null {
  const next = build()
  if (next === null) return current
  if (current !== null) current.destroy()
  return next
}

/**
 * Decide whether the background layer may exist. The layer is off by
 * convention: `bgFx` starts `'none'`, so an untouched install never creates a
 * DOM node. Without a 2D canvas context the ASCII renderer has nothing to
 * draw and the plain body tint is the documented fallback; mounting an empty
 * node would add surface without value.
 */
export function decideBgLayer(enabled: boolean, caps: BgLayerCaps): BgLayerVerdict {
  if (!enabled) return { mount: false, reason: 'disabled' }
  if (!caps.canvas2d) return { mount: false, reason: 'no-canvas' }
  const motion: BgLayerMotion = caps.hidden ? 'paused' : caps.reducedMotion ? 'static' : 'animated'
  return { mount: true, motion }
}

/**
 * The tint handed to the layer for the current palette and theme. Light mode
 * uses the family's pastel; dark mode derives it through `toDarkRamp` with the
 * same body-canvas lightness the appearance painter uses, so a theme flip
 * re-paints the layer through the existing `applyAppearance` effect deps.
 *
 * The neutral tint must equal the shell's own no-palette base fill, because the
 * backdrop token set paints that fill at a low alpha over this canvas: a
 * mismatched tint would shift the whole page by the difference (measured −7
 * luma on every content pixel while the tint was `#ffffff` against the shell's
 * `#f8f9fb` — a tone change, not texture). Matching the canvas keeps the
 * on/off difference purely ink.
 */
export function bgLayerTint(bg: string | undefined, dark: boolean): string {
  if (bg === undefined || bg === 'default') return dark ? '#0f1117' : '#f8f9fb'
  const base = (PALETTE.find((entry) => entry[0] === bg) ?? PALETTE[0])[1]
  return dark ? toDarkRamp(base, DARK_CANVAS_LIGHTNESS) : base
}

/** The slice of a DOM element this layer owns (kept structural for tests). */
export interface BgLayerElementLike {
  id: string
  className: string
  readonly clientWidth: number
  readonly clientHeight: number
  setAttribute(name: string, value: string): void
  getAttribute(name: string): string | null
  appendChild(node: unknown): unknown
  style: {
    setProperty(name: string, value: string): void
    getPropertyValue(name: string): string
  }
  remove(): void
}

/** The slice of `Document` this layer touches. */
export interface BgLayerDocLike {
  readonly body: { appendChild(node: BgLayerElementLike): unknown }
  createElement(tag: string): BgLayerElementLike
  getElementById(id: string): BgLayerElementLike | null
}

/** The mount-shaped half of {@link BgLayerVerdict}. */
export type BgLayerMountVerdict = Extract<BgLayerVerdict, { mount: true }>

/**
 * Create or update the layer. Idempotent: a second call re-applies the motion
 * attribute and tint on the existing node instead of appending a duplicate,
 * which is what the appearance painter needs on every theme/config repaint.
 */
export function mountBgLayer(doc: BgLayerDocLike, verdict: BgLayerMountVerdict, tint: string): BgLayerElementLike {
  let el = doc.getElementById(BG_LAYER_ID)
  if (el === null) {
    el = doc.createElement('div')
    el.id = BG_LAYER_ID
    el.className = 'vx-bg'
    // Decorative: it must never enter the accessibility tree or a screenshot
    // reader as content.
    el.setAttribute('aria-hidden', 'true')
    doc.body.appendChild(el)
  }
  el.setAttribute('data-vx-bg-motion', verdict.motion)
  el.style.setProperty('--vx-bg-tint', tint)
  return el
}

/** Remove the layer; a missing node is a no-op (fresh install / already off). */
export function unmountBgLayer(doc: BgLayerDocLike): void {
  doc.getElementById(BG_LAYER_ID)?.remove()
}
