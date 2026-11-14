/**
 * `ocean` 2.0: a living water surface instead of two fixed sine swells.
 *
 * Three layers make the scene:
 *   1. a divergence-free current (the curl of a drifting stream function) that
 *      moves the whole surface without piling water into one corner;
 *   2. a {@link BgWakeField} wave tank. Pointer drags, clicks and fish wakes
 *      inject height impulses that propagate, interfere and fade — the water
 *      remembers what touched it;
 *   3. eighteen small fish plus two large koi. Steering is boids-lite
 *      (alignment / cohesion / separation / mill); the pointer pushes them
 *      away and a click startles the school, which then regroups.
 *
 * The piece writes only ramp levels plus two optional per-cell buffers:
 * `emphasis` marks interaction cells so the renderer may keep them visible at
 * a reduced strength inside the calm zone, and `overlay` carries the fish
 * glyphs (direction marks for the small fish, body/edge/head/tail cells for
 * the koi). The renderer draws those with `fillText` after the atlas blit, so
 * no second atlas is needed.
 *
 * The flow-field constants are re-derived for grid cells; the stream-function
 * form follows `stackedlol/ascii-sharks` (MIT, see NOTICE). No code from the
 * `dsh-ascii-ocean` plugin is copied — its LICENSE file has no licence text.
 * @module @alexpeng/dsh-custom-plugin/client/bg-ocean
 */

import { hash2, shade, valueNoise, type AsciiInput, type AsciiPiece } from './bg-field.ts'
import {
  createWakeField,
  injectWakeRing,
  injectWakeTrail,
  stepWake,
  type BgWakeField,
} from './bg-wake.ts'

/** Current wavenumbers and speed, in grid cells. Slow enough to read as a
 * current rather than as a moving wallpaper. */
const K1 = 1 / 30
const K2 = 1 / 36
const K3 = 1 / 24
const CURRENT_SCALE = 12

/** How much of the wake tank reaches the visible water. */
const WAKE_SCALE = 0.55

/** Positive wake height that counts as an interaction crest. Troughs never
 * add ink (they clear dots instead), and the base water carries no wake at
 * all, so only something the hand just did may ask the calm zone for the
 * emphasis floor. Lowered 0.15 → 0.09 on 2026-11-11 so a drag ring's crests
 * are marked and read as bright dots inside the reading column. */
const EMPHASIS_WAKE = 0.09

/** Eighteen schooling fish plus two koi: enough for a school silhouette, small
 * enough that the O(n²) steering pass is noise (324 pairs at most). The koi
 * are deliberately large multi-cell silhouettes — a one-cell fish disappears
 * at 12 px, which is what made the first pass read as a dot field. */
const SMALL_FISH = 18
const KOI_FISH = 2
const FISH_TOTAL = SMALL_FISH + KOI_FISH

/** Small-fish speed band, cells/s. */
const SMALL_MIN = 1.2
const SMALL_MAX = 4.2
/** Koi speed band, cells/s. */
const KOI_MIN = 0.5
const KOI_MAX = 2.2
/** A click is felt inside this radius (cells). */
const STARTLE_RADIUS = 9
/** The pointer pushes fish away inside this radius (cells). */
const CROWD_RADIUS = 6

/** A drag drops one small dipole ring per this much time and travel, so the
 * crests stay separate instead of summing into a bright patch. */
const DRAG_RING_TIME = 0.16
const DRAG_RING_DISTANCE = 4

/** Direction glyph slots in `OVERLAY_GLYPHS` (bg-field). */
const DIR_GLYPHS = [1, 2, 3, 4, 5, 2, 6, 4]

interface Fish {
  kind: 0 | 1
  x: number
  y: number
  vx: number
  vy: number
  phase: number
  fear: number
}

interface Current {
  x: number
  y: number
}

const current: Current = { x: 0, y: 0 }

/** Divergence-free current: u = ∂ψ/∂y, v = −∂ψ/∂x. */
function sampleCurrent(x: number, y: number, t: number): Current {
  const a = x * K1 + t * 0.07
  const b = y * K2 - t * 0.05
  const c = (x + y) * K3 + t * 0.11
  current.x = (-K2 * Math.sin(a) * Math.sin(b) + 0.5 * K3 * Math.cos(c)) * CURRENT_SCALE
  current.y = (-K1 * Math.cos(a) * Math.cos(b) - 0.5 * K3 * Math.cos(c)) * CURRENT_SCALE
  return current
}

/** Overlay slots for a koi: body, edge, head, tail. */
const KOI_BODY = 9
const KOI_EDGE = 10
const KOI_HEAD = 11
const KOI_TAIL = 8

/** Horizontal koi silhouette: a 10×3 body with a forked tail, relative to the
 * centre. The glyph slot is what the renderer draws; the level is a faint dot
 * left behind it so the fish never vanishes if a glyph is missing. */
const KOI_H: ReadonlyArray<readonly [number, number, number, number]> = [
  [-6, 0, 2, KOI_TAIL], [-5, -1, 2, KOI_TAIL], [-5, 1, 2, KOI_TAIL],
  [-4, 0, 2, KOI_EDGE], [-4, 1, 2, KOI_EDGE],
  [-3, 0, 3, KOI_EDGE], [-3, 1, 3, KOI_EDGE],
  [-2, -1, 3, KOI_EDGE], [-2, 0, 4, KOI_BODY], [-2, 1, 4, KOI_BODY], [-2, 2, 2, KOI_EDGE],
  [-1, -1, 3, KOI_EDGE], [-1, 0, 4, KOI_BODY], [-1, 1, 4, KOI_BODY], [-1, 2, 2, KOI_EDGE],
  [0, -1, 3, KOI_EDGE], [0, 0, 4, KOI_BODY], [0, 1, 4, KOI_BODY], [0, 2, 2, KOI_EDGE],
  [1, -1, 3, KOI_EDGE], [1, 0, 4, KOI_BODY], [1, 1, 4, KOI_BODY],
  [2, 0, 4, KOI_BODY], [2, 1, 4, KOI_BODY],
  [3, 0, 4, KOI_BODY], [3, 1, 4, KOI_BODY],
  [4, 0, 3, KOI_HEAD], [4, 1, 3, KOI_HEAD],
]

/** Vertical koi silhouette: the same body transposed around the centre. */
const KOI_V: ReadonlyArray<readonly [number, number, number, number]> = KOI_H.map(
  ([dx, dy, level, glyph]) => [dy, -dx, level, glyph] as const,
)

function glyphFor(vx: number, vy: number): number {
  const sector = Math.round(Math.atan2(vy, vx) / (Math.PI / 4)) & 7
  return DIR_GLYPHS[sector]
}

/**
 * Create the ocean piece. The returned function owns its wake tank and fish
 * arrays; they are rebuilt only when the grid changes, never per frame.
 */
export function createOceanPiece(levels: number, dither: boolean): AsciiPiece {
  const targetLevels = levels
  let wake: BgWakeField | null = null
  let cols = 0
  let rows = 0
  let fish: Fish[] = []
  let lastT = 0
  let pulseSeen = 0
  let lastPointerX = Number.NaN
  let lastPointerY = Number.NaN
  let pointerSeen = false
  // Drag rings: the position/time of the last dropped ring, so a drag leaves
  // separate expanding rings instead of a lifted patch.
  let ringX = Number.NaN
  let ringY = Number.NaN
  let ringT = -Number.MAX_VALUE

  function resetGrid(nextCols: number, nextRows: number): void {
    cols = nextCols
    rows = nextRows
    wake = createWakeField(cols, rows)
    fish = []
    for (let i = 0; i < FISH_TOTAL; i++) {
      const kind: 0 | 1 = i < SMALL_FISH ? 0 : 1
      const hx = hash2(i * 3 + 1, 17)
      const hy = hash2(i * 3 + 2, 29)
      const angle = hash2(i * 3 + 3, 41) * Math.PI * 2
      fish.push({
        kind,
        x: 2 + hx * Math.max(1, cols - 4),
        y: 2 + hy * Math.max(1, rows - 4),
        vx: Math.cos(angle),
        vy: Math.sin(angle) * 0.4,
        phase: hx * Math.PI * 2,
        fear: 0,
      })
    }
    lastT = 0
    pulseSeen = 0
    lastPointerX = Number.NaN
    lastPointerY = Number.NaN
    pointerSeen = false
    ringX = Number.NaN
    ringY = Number.NaN
    ringT = -Number.MAX_VALUE
  }

  function ensureGrid(nextCols: number, nextRows: number): void {
    if (wake === null || nextCols !== cols || nextRows !== rows) {
      resetGrid(nextCols, nextRows)
      return
    }
    // A new renderer instance can hand us the same grid after a preset switch;
    // the wake tank is reset there by construction, so nothing to do here.
  }

  function clamp(value: number, lo: number, hi: number): number {
    return value < lo ? lo : value > hi ? hi : value
  }

  /** Keep the school inside the field: wrap horizontally, bounce vertically. */
  function wrap(f: Fish): void {
    if (f.x < -1) f.x = cols + 1
    else if (f.x > cols + 1) f.x = -1
    if (f.y < 1) {
      f.y = 1
      if (f.vy < 0) f.vy = -f.vy * 0.6
    } else if (f.y > rows - 2) {
      f.y = rows - 2
      if (f.vy > 0) f.vy = -f.vy * 0.6
    }
  }

  function injectPointer(t: number, input: AsciiInput): void {
    if (wake === null) return
    if (!input.active) {
      pointerSeen = false
      lastPointerX = Number.NaN
      lastPointerY = Number.NaN
      ringX = Number.NaN
      ringT = -Number.MAX_VALUE
      return
    }
    const x = input.x
    const y = input.y
    if (!pointerSeen || !Number.isFinite(lastPointerX)) {
      pointerSeen = true
      lastPointerX = x
      lastPointerY = y
      return
    }
    const dx = x - lastPointerX
    const dy = y - lastPointerY
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist < 0.35) return
    const speed = Math.sqrt(input.vx * input.vx + input.vy * input.vy)
    // One small dipole ring per gesture step (time *and* distance gated), so
    // the crests stay separate: a drag reads as a row of expanding rings
    // rather than a bright patch painted along the cursor. A faint trail keeps
    // the path continuous between them.
    const travelled = Number.isFinite(ringX) ? Math.sqrt((x - ringX) ** 2 + (y - ringY) ** 2) : Number.POSITIVE_INFINITY
    if (t - ringT >= DRAG_RING_TIME && travelled >= DRAG_RING_DISTANCE) {
      const amp = 0.11 + Math.min(0.06, speed * 0.0018)
      injectWakeRing(wake, x, y, 1.5, 1.2, amp)
      injectWakeRing(wake, x, y, 0.9, 1.0, -amp * 0.6)
      ringX = x
      ringY = y
      ringT = t
    }
    injectWakeTrail(wake, x, y, 0.006)
    lastPointerX = x
    lastPointerY = y
  }

  function startle(input: AsciiInput): void {
    if (wake === null || input.pulseId === pulseSeen) return
    pulseSeen = input.pulseId
    // A dipole, not a disk: the outer crest and the inner trough cancel the
    // net volume, so a click draws a ring instead of saturating every cell in
    // a 12-cell radius to the top of the ramp.
    injectWakeRing(wake, input.pulseX, input.pulseY, 4.5, 1.8, 0.4)
    injectWakeRing(wake, input.pulseX, input.pulseY, 3.1, 1.8, -0.34)
    injectWakeRing(wake, input.pulseX, input.pulseY, 9.5, 2.4, 0.19)
    injectWakeRing(wake, input.pulseX, input.pulseY, 8, 2.6, -0.14)
    for (const f of fish) {
      const dx = f.x - input.pulseX
      const dy = f.y - input.pulseY
      const d = Math.sqrt(dx * dx + dy * dy)
      if (d >= STARTLE_RADIUS || d < 0.001) continue
      const push = (1 - d / STARTLE_RADIUS) * (f.kind === 0 ? 17 : 9)
      f.vx += (dx / d) * push
      f.vy += (dy / d) * push
      f.fear = 1
    }
  }

  function steer(dt: number, t: number, input: AsciiInput): void {
    if (dt <= 0) return
    const schoolCount = SMALL_FISH
    let cx = 0
    let cy = 0
    let avx = 0
    let avy = 0
    for (let i = 0; i < schoolCount; i++) {
      const f = fish[i]
      cx += f.x
      cy += f.y
      avx += f.vx
      avy += f.vy
    }
    cx /= schoolCount
    cy /= schoolCount
    avx /= schoolCount
    avy /= schoolCount
    const decay = Math.exp(-dt / 2.2)
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i]
      const school = f.kind === 0
      const flow = sampleCurrent(f.x, f.y, t)
      let ax = flow.x * (school ? 0.9 : 0.7)
      let ay = flow.y * (school ? 0.9 : 0.7)
      if (school) {
        ax += (cx - f.x) * 0.32
        ay += (cy - f.y) * 0.32
        ax += (avx - f.vx) * 0.55
        ay += (avy - f.vy) * 0.55
        // Separation from the rest of the school.
        for (let j = 0; j < schoolCount; j++) {
          if (j === i) continue
          const other = fish[j]
          const dx = f.x - other.x
          const dy = f.y - other.y
          const d2 = dx * dx + dy * dy
          if (d2 < 5.8 && d2 > 0.0001) {
            const inv = 2.6 / d2
            ax += dx * inv
            ay += dy * inv
          }
        }
        // A slow mill keeps the school from collapsing into a dot.
        ax += -Math.sin(t * 0.6 + f.phase) * 0.28
        ay += Math.cos(t * 0.47 + f.phase * 1.7) * 0.34
      } else {
        ax += Math.sin(t * 0.31 + f.phase) * 0.4
        ay += Math.cos(t * 0.23 + f.phase * 1.3) * 0.22
      }
      if (input.active) {
        const dx = f.x - input.x
        const dy = f.y - input.y
        const d = Math.sqrt(dx * dx + dy * dy)
        const radius = school ? CROWD_RADIUS : CROWD_RADIUS + 2
        if (d < radius && d > 0.001) {
          const push = (1 - d / radius) * (school ? 11 : 5)
          ax += (dx / d) * push
          ay += (dy / d) * push
          f.fear = Math.max(f.fear, school ? 0.55 : 0.3)
        }
      }
      f.vx += ax * dt
      f.vy += ay * dt
      // Fish mostly cruise level; the koi is heavier and banks less.
      f.vy *= Math.exp(-dt * (school ? 0.8 : 1.2))
      const max = (school ? SMALL_MAX : KOI_MAX) * (1 + f.fear * 0.8)
      const min = school ? SMALL_MIN : KOI_MIN
      const speed = Math.sqrt(f.vx * f.vx + f.vy * f.vy)
      if (speed > max) {
        f.vx = (f.vx / speed) * max
        f.vy = (f.vy / speed) * max
      } else if (speed < min && speed > 0.0001) {
        f.vx = (f.vx / speed) * min
        f.vy = (f.vy / speed) * min
      }
      f.x += f.vx * dt
      f.y += f.vy * dt
      f.fear *= decay
      wrap(f)
      if (wake !== null) {
        // The tail is behind the heading; the wake follows it.
        injectWakeTrail(wake, f.x - f.vx * 0.12, f.y - f.vy * 0.12, (school ? 0.012 : 0.03) * Math.min(2, speed))
      }
    }
  }

  function drawFish(out: Uint8Array, emphasis: Uint8Array | undefined, overlay: Uint8Array | undefined): void {
    for (const f of fish) {
      const col = Math.round(f.x)
      const row = Math.round(f.y)
      if (col < 0 || col >= cols || row < 0 || row >= rows) continue
      const i = row * cols + col
      if (f.kind === 0) {
        if (targetLevels > 1) out[i] = Math.max(out[i], targetLevels - 1)
        if (emphasis !== undefined) emphasis[i] = 1
        if (overlay !== undefined) overlay[i] = glyphFor(f.vx, f.vy)
        // A second cell behind the head turns a one-cell dash into a readable
        // little fish: `>#` / `#>`. It costs one overlay cell per fish.
        const speed = Math.sqrt(f.vx * f.vx + f.vy * f.vy)
        if (speed > 0.001) {
          const bx = col - Math.round(f.vx / speed)
          const by = row - Math.round(f.vy / speed)
          if (bx >= 0 && bx < cols && by >= 0 && by < rows) {
            const j = by * cols + bx
            if (targetLevels > 2) out[j] = Math.max(out[j], targetLevels - 2)
            if (emphasis !== undefined) emphasis[j] = 1
            if (overlay !== undefined) overlay[j] = KOI_EDGE
          }
        }
        continue
      }
      const horizontal = Math.abs(f.vx) >= Math.abs(f.vy)
      const mirror = horizontal && f.vx < 0 ? -1 : 1
      const mask = horizontal ? KOI_H : KOI_V
      for (const [dx, dy, level, glyph] of mask) {
        const c = horizontal ? col + dx * mirror : col + dx
        const r = row + dy
        if (c < 0 || c >= cols || r < 0 || r >= rows) continue
        const j = r * cols + c
        if (targetLevels > level) out[j] = Math.max(out[j], level)
        if (emphasis !== undefined) emphasis[j] = 1
        if (overlay !== undefined) overlay[j] = glyph
      }
    }
  }

  function frame(t: number, out: Uint8Array, nextCols: number, nextRows: number, input?: AsciiInput, emphasis?: Uint8Array, overlay?: Uint8Array): void {
    ensureGrid(nextCols, nextRows)
    if (wake === null) return
    const active = input !== undefined
    const dt = lastT === 0 ? 0 : Math.min(0.12, Math.max(0, t - lastT))
    lastT = t
    if (active) {
      injectPointer(t, input)
      startle(input)
    } else {
      pointerSeen = false
      lastPointerX = Number.NaN
      lastPointerY = Number.NaN
    }
    // Advance the water first so the fish and the render see the same surface.
    if (dt > 0) {
      stepWake(wake)
      steer(dt, t, active ? input : NO_INPUT)
    }
    let i = 0
    for (let row = 0; row < nextRows; row++) {
      for (let col = 0; col < nextCols; col++, i++) {
        // A contour field rather than a height map: two drifting noise fields
        // are folded through a sine, which wraps the swell into curved lines
        // instead of the horizontal dot bands a single sine train produces.
        // The line is the crest; everything below it stays blank.
        const n1 = valueNoise(col * 0.045 + t * 0.08, row * 0.065 + t * 0.05)
        const n2 = valueNoise(col * 0.11 - t * 0.06, row * 0.14 - t * 0.09)
        const contour = Math.sin(n1 * 9 + n2 * 3 + (col * 0.02 + row * 0.03) + t * 0.35)
        // A sparse one-step speckle, but tied to the crest instead of sprinkled
        // over every cell: a dot on the wave reads as spray, while the old
        // 20%-everywhere field read as dust over the whole page — and that dust
        // was exactly the part that mixed with the copy. Troughs stay empty.
        const crest = contour > 0 ? contour * contour : 0
        const base = crest > 0.4 && hash2(col, row) > 0.7 ? 1 / targetLevels : 0
        // The ambient swell deliberately sits in the lower half of the ramp
        // (peak 0.45): the top levels are reserved for the pointer's wake, so a
        // ripple reads against the water instead of merging with a saturated
        // field. It also keeps the sea from competing with the copy.
        let level = Math.max(base, crest * 0.45)
        const h = wake.height[i]
        // Crests add dots, troughs *clear* them: a displaced surface reads as a
        // bright ring plus a small hole, and a hole is far more legible in a dot
        // field than a few extra dots on an already dotted cell. Only strong
        // troughs (the click's inner ring) are allowed to erase the water.
        if (h >= 0) level = Math.min(1, level + h * 1.5)
        else if (h < -0.06) level = Math.max(0, level + h * 0.8)
        // Foam belongs on crests, not sprinkled at random over the whole field.
        if (level > 0.35 && hash2(col, row) > 0.68) level += 0.1
        shade(out, i, level, targetLevels, dither, row, col)
        // Only positive crests add ink to the visible water, so only they may
        // ask the calm zone for the emphasis floor; a negative trough spreading
        // under the column is invisible and must stay masked.
        if (emphasis !== undefined && h > EMPHASIS_WAKE) emphasis[i] = 1
      }
    }
    drawFish(out, emphasis, overlay)
  }

  return frame
}

/** A shared inert input for the frames where the renderer passes nothing. */
const NO_INPUT: AsciiInput = {
  x: 0,
  y: 0,
  active: false,
  down: false,
  vx: 0,
  vy: 0,
  pulseId: 0,
  pulseX: 0,
  pulseY: 0,
}


