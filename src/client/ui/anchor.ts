/**
 * Anchored-popover geometry.
 *
 * Floating surfaces in this plugin are anchored to the control that opened
 * them, never dragged. This module owns the pure placement math so the
 * flip/clamp behaviour can be pinned by unit tests; the DOM measurement in
 * `overlays.tsx` only feeds rectangles in and applies the returned frame.
 * @module @alexpeng/dsh-custom-plugin/client/ui/anchor
 */

/** Axis-aligned box of the trigger (a `DOMRect` satisfies this). */
export interface AnchorRect {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
  readonly width: number
  readonly height: number
}

/** Desired size of the floating surface. */
export interface AnchorSize {
  readonly width: number
  readonly height: number
}

/** Visible viewport size. */
export interface AnchorViewport {
  readonly width: number
  readonly height: number
}

export interface AnchorOptions {
  /** Space between the trigger and the surface. Defaults to 8px. */
  readonly gap?: number
  /** Minimum distance kept from every viewport edge. Defaults to 8px. */
  readonly margin?: number
  /** Which trigger edge the surface aligns to. Defaults to `start`. */
  readonly align?: 'start' | 'end' | 'center'
  /** Side tried first. Defaults to `bottom`. */
  readonly preferred?: 'top' | 'bottom'
}

export interface AnchorFrame {
  readonly left: number
  readonly top: number
  readonly maxHeight: number
  readonly placement: 'top' | 'bottom'
  /** CSS transform origin matching the chosen side. */
  readonly origin: string
}

/**
 * Place a floating surface next to its trigger.
 *
 * The surface opens on `preferred` when that side has room for the requested
 * height, flips to the other side when it does not, and otherwise stays on the
 * roomier side with `maxHeight` capped to the available space. Horizontally it
 * aligns to the requested trigger edge and is clamped into the viewport.
 */
export function anchorFrame(
  trigger: AnchorRect,
  size: AnchorSize,
  viewport: AnchorViewport,
  options: AnchorOptions = {},
): AnchorFrame {
  const gap = Math.max(0, options.gap ?? 8)
  const margin = Math.max(0, options.margin ?? 8)
  const align = options.align ?? 'start'
  const vw = Math.max(0, viewport.width)
  const vh = Math.max(0, viewport.height)
  const below = vh - trigger.bottom - gap - margin
  const above = trigger.top - gap - margin
  const wantedHeight = Math.max(0, size.height)
  const preferred = options.preferred ?? 'bottom'
  const fitsBelow = below >= wantedHeight
  const fitsAbove = above >= wantedHeight
  let placement: 'top' | 'bottom'
  if (preferred === 'bottom') placement = fitsBelow || !fitsAbove ? 'bottom' : 'top'
  else placement = fitsAbove || !fitsBelow ? 'top' : 'bottom'
  // When neither side fits, keep the side with more room instead of a fixed
  // preference: a very short window should still show as much as possible.
  if (!fitsBelow && !fitsAbove) placement = below >= above ? 'bottom' : 'top'
  const space = placement === 'bottom' ? below : above
  const width = Math.min(Math.max(0, size.width), Math.max(0, vw - margin * 2))
  let left: number
  if (align === 'end') left = trigger.right - width
  else if (align === 'center') left = trigger.left + trigger.width / 2 - width / 2
  else left = trigger.left
  left = Math.min(Math.max(left, margin), Math.max(margin, vw - width - margin))
  const top = placement === 'bottom' ? trigger.bottom + gap : Math.max(margin, trigger.top - gap - Math.min(wantedHeight, space))
  const originY = placement === 'bottom' ? 'top' : 'bottom'
  const origin = `${align === 'end' ? 'right' : align === 'center' ? 'center' : 'left'} ${originY}`
  return {
    left: Math.round(left),
    top: Math.round(top),
    maxHeight: Math.max(0, Math.round(space)),
    placement,
    origin,
  }
}
