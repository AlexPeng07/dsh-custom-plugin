/**
 * Spatial focus mask for the backdrop: the ink keeps full strength around the
 * shell's edges and fades toward the reading column, so the texture never sits
 * directly behind body copy. Geometry only — the DOM measurement lives in
 * `custom.tsx`, so both renderer tiers and the unit tests share one rule.
 *
 * The mask is deliberately *not* a radial vignette: the fade follows the real
 * content rectangle (feathered on every side), so a sidebar collapse or a
 * window resize moves the calm zone with the text instead of leaving a
 * mismatched circle on screen.
 */

/** Rectangle in CSS pixels, top-left origin, viewport coordinates. */
export interface BgFocusRect {
  x: number
  y: number
  w: number
  h: number
}

/** Feather width of the fade, CSS px. 150 is kept from rounds 2–3, but for a
 * different reason now: with the composer-span rect the visible gutter is only
 * ~141 px wide (x 280..421 at 1280), so the ramp has to finish *inside* it — at
 * 150 the weight reaches 0.97 at the gutter's outer edge and 1.0 a few px
 * further out, which is the strongest "edge strong → body faint" the layout
 * allows. Round 4 A/B'd 220 and rejected it: a band wider than the gutter
 * dilutes the one region the user can actually see (canvas gutter mean 0.0141
 * vs sidebar 0.0744, i.e. the gutter sat at 19% of full strength while the
 * paragraph area was already down at 0.0060 — ratio 2.37×). */
export const FOCUS_FEATHER_PX = 150

/** Ink retained at the middle of the reading column, as a fraction of full
 * strength. Round 4 lowered this from 0.45 to 0.15: the canvas already showed
 * a 3.96× mean ratio at 0.45 (column 0.0151 vs gutter 0.0599), yet the
 * page-scale A/B read as one flat wash — a uniform 45% inside a zone that
 * covers almost the whole content area has nothing to be compared against.
 * 0.15 leaves a barely-there texture behind the copy while the gutter keeps
 * full strength, and the text contrast measured 14.32:1 at 0.45, so it can
 * only improve here. */
export const FOCUS_FLOOR = 0.15

/** Reject geometry that cannot describe a real column. */
export function normalizeFocusRect(rect: BgFocusRect | null | undefined): BgFocusRect | null {
  if (rect === null || rect === undefined) return null
  const { x, y, w, h } = rect
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return null
  if (w <= 0 || h <= 0) return null
  return { x, y, w, h }
}

/**
 * The "避让正文" gate: the rect the renderers get. `false` means the mask does
 * not participate at all — `null` reaches `setFocus`, so the ASCII tier never
 * allocates caps and the shader never uploads `u_focus`. This is deliberately
 * not "weight every cell by 1": that would keep the whole pipeline running
 * for a page the user asked to be uniform.
 */
export function focusRectFor(bgFocus: boolean | undefined, rect: BgFocusRect | null): BgFocusRect | null {
  return bgFocus === false ? null : normalizeFocusRect(rect)
}

/** True when two rects describe the same zone; used to skip mask rebuilds. */
export function sameFocusRect(a: BgFocusRect | null, b: BgFocusRect | null): boolean {
  if (a === null || b === null) return a === b
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}

/**
 * Ink weight (0..1) at a CSS point: `floor` inside the rect, rising to 1 at
 * `feather` px outside it with a smoothstep ramp (C1-continuous, so the fade
 * has no visible band at either end).
 */
export function focusWeight(px: number, py: number, rect: BgFocusRect, feather: number, floor: number): number {
  const right = rect.x + rect.w
  const bottom = rect.y + rect.h
  const dx = px < rect.x ? rect.x - px : px > right ? px - right : 0
  const dy = py < rect.y ? rect.y - py : py > bottom ? py - bottom : 0
  const distance = dx === 0 && dy === 0 ? 0 : Math.sqrt(dx * dx + dy * dy)
  if (feather <= 0) return distance > 0 ? 1 : floor
  const t = distance >= feather ? 1 : distance / feather
  const eased = t * t * (3 - 2 * t)
  return floor + (1 - floor) * eased
}

/**
 * Per-cell level caps for the ASCII tier. A cell may not exceed its cap, which
 * thins the glyph ramp toward the column centre; the ramp order is preserved
 * so the piece keeps its own look. The cap is quantised anyway (a ramp has
 * 9–15 steps), so a per-cell dither breaks the level boundaries into a soft
 * grain instead of concentric rims.
 */
export function buildFocusCaps(
  cols: number,
  rows: number,
  cellW: number,
  cellH: number,
  rect: BgFocusRect,
  feather: number,
  floor: number,
  lastLevel: number,
  out?: Uint8Array,
): Uint8Array {
  const caps = out !== undefined && out.length === cols * rows ? out : new Uint8Array(cols * rows)
  let i = 0
  for (let row = 0; row < rows; row++) {
    const y = (row + 0.5) * cellH
    for (let col = 0; col < cols; col++, i++) {
      const weight = focusWeight((col + 0.5) * cellW, y, rect, feather, floor)
      // 2×2 ordered dither in the -0.375..0.375 band: enough to hide the step
      // edges, far too small to change the intended weight.
      const dither = (((col & 1) << 1) | (row & 1)) / 4 - 0.375
      const raw = Math.round(lastLevel * weight + dither)
      caps[i] = raw <= 0 ? 0 : raw >= lastLevel ? lastLevel : raw
    }
  }
  return caps
}
