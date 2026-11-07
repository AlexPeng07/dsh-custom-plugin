/**
 * Panel placement for the floating personalize panel.
 *
 * The panel is a non-modal popover over a live page: it must never cover the
 * bottom input dock (the composer grows with the draft and moves between the
 * hero and session layouts), must stay inside the viewport, and must keep the
 * spot the user dragged it to unless that spot breaks either rule. All of that
 * is geometry only, so it lives here as pure functions and is pinned by
 * `tests/panel-bounds.spec.ts`; the DOM measurement stays in `custom.tsx`.
 * @module @alexpeng/dsh-custom-plugin/client/panel-bounds
 */

/** Kept between the panel's bottom edge and the composer's top edge. */
export const COMPOSER_CLEARANCE = 10

export interface PanelSize {
  readonly w: number
  readonly h: number
}

/** Anything with an axis-aligned border box (a `DOMRect` satisfies this). */
export interface PanelBox {
  readonly top: number
  readonly bottom: number
  readonly width: number
  readonly height: number
}

export interface PanelFrameInput {
  readonly viewport: PanelSize
  /** Where the panel sits when it has never been dragged. */
  readonly preferred: { readonly right: number; readonly top: number }
  readonly width: number
  readonly maxHeight: number
  /** Shortest usable panel: below this the body is unreadable, so the frame
   *  moves up instead of shrinking further. */
  readonly minHeight: number
  readonly margin: number
  /** Viewport y of the protected strip (composer top minus clearance), or
   *  null when the page has no composer to avoid. */
  readonly safeBottom: number | null
  /** Resting place from a previous drag, or null for the default anchor. */
  readonly pos: { readonly x: number; readonly y: number } | null
}

export interface PanelFrame {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

/**
 * Place the panel: clamp the width into the viewport, raise the bottom limit
 * above the composer, shorten from the bottom (never from the top, which
 * carries the drag handle), and clamp a dragged position on both axes.
 */
export function panelFrame(input: PanelFrameInput): PanelFrame {
  const vw = Math.max(0, input.viewport.w)
  const vh = Math.max(0, input.viewport.h)
  const width = Math.min(input.width, Math.max(0, vw - input.margin * 2))
  const limit = input.safeBottom === null
    ? vh - input.margin
    : Math.min(input.safeBottom, vh - input.margin)
  // A dragged panel that would leave less than minHeight above the composer
  // slides up instead of overlapping it.
  const maxTop = Math.max(input.margin, limit - input.minHeight)
  const wantedTop = input.pos === null ? input.preferred.top : input.pos.y
  const top = Math.min(Math.max(wantedTop, input.margin), maxTop)
  const wantedLeft = input.pos === null ? vw - input.preferred.right - width : input.pos.x
  const left = Math.min(Math.max(wantedLeft, input.margin), Math.max(input.margin, vw - width - input.margin))
  const height = Math.max(input.minHeight, Math.min(input.maxHeight, limit - top))
  return { left, top, width, height }
}

/**
 * Pick the composer's top edge from the editable text boxes on the page: the
 * composer is the lowest editable box with usable area. Returns null when the
 * page shows none (a dialog-only screen), which leaves the panel on the
 * viewport-height fallback.
 */
export function pickComposerTop(
  boxes: readonly PanelBox[],
  viewport: PanelSize,
  minWidth = 180,
  minHeight = 16,
): number | null {
  let best: PanelBox | null = null
  for (const box of boxes) {
    if (box.width < minWidth || box.height < minHeight) continue
    if (box.top < 0 || box.bottom > viewport.h + 1) continue
    if (best === null || box.bottom > best.bottom) best = box
  }
  return best === null ? null : best.top
}
