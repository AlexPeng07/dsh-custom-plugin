/**
 * A small height-field wave tank shared by interactive pieces.
 *
 * Diffusion alone only blurs an impulse; it never makes a ripple travel. This
 * is a two-buffer wave equation instead: height `h` and vertical velocity `v`
 * are advanced with a five-point Laplacian, damped, then swapped. A ring
 * injection therefore expands, interferes with the next ring and dies out on
 * its own — the property that makes dragging a finger on the water read as
 * water rather than as a moving spotlight.
 *
 * Both passes are O(cols × rows), allocation-free, and the field is rebuilt
 * only when the grid actually changes.
 * @module @alexpeng/dsh-custom-plugin/client/bg-wake
 */

/** Wave coupling. Above ~0.5 the explicit scheme is unstable in 2D. */
export const WAKE_C2 = 0.28

/** Per-step velocity damping (energy loss). */
export const WAKE_DAMPING = 0.975

/** Per-step height decay (slow return to flat water). */
export const WAKE_DECAY = 0.993

/** Clamp so a burst of injections can never make the surface explode. */
export const WAKE_MAX = 1.4

/** Two height buffers and two velocity buffers, all `cols × rows`. */
export interface BgWakeField {
  cols: number
  rows: number
  height: Float32Array
  nextHeight: Float32Array
  velocity: Float32Array
  nextVelocity: Float32Array
}

/** Allocate a flat field. */
export function createWakeField(cols: number, rows: number): BgWakeField {
  const size = Math.max(0, cols * rows)
  return {
    cols,
    rows,
    height: new Float32Array(size),
    nextHeight: new Float32Array(size),
    velocity: new Float32Array(size),
    nextVelocity: new Float32Array(size),
  }
}

/** Resize in place. Returns true when the grid changed and the caller must
 * treat the surface as freshly flat. */
export function resizeWakeField(field: BgWakeField, cols: number, rows: number): boolean {
  if (field.cols === cols && field.rows === rows) return false
  field.cols = cols
  field.rows = rows
  const size = Math.max(0, cols * rows)
  field.height = new Float32Array(size)
  field.nextHeight = new Float32Array(size)
  field.velocity = new Float32Array(size)
  field.nextVelocity = new Float32Array(size)
  return true
}

/** Drop every wave but keep the buffers. */
export function clearWake(field: BgWakeField): void {
  field.height.fill(0)
  field.nextHeight.fill(0)
  field.velocity.fill(0)
  field.nextVelocity.fill(0)
}

function clampWake(value: number): number {
  return value < -WAKE_MAX ? -WAKE_MAX : value > WAKE_MAX ? WAKE_MAX : value
}

/**
 * Advance one step. The outer one-cell border is absorbing (zeroed) so the
 * viewport edge does not act like a bathtub wall and bounce rings back.
 */
export function stepWake(field: BgWakeField): void {
  const { cols, rows, height, nextHeight, velocity, nextVelocity } = field
  if (cols < 3 || rows < 3) {
    clearWake(field)
    return
  }
  nextHeight.fill(0)
  nextVelocity.fill(0)
  for (let row = 1; row < rows - 1; row++) {
    const base = row * cols
    for (let col = 1; col < cols - 1; col++) {
      const i = base + col
      const lap = height[i - 1] + height[i + 1] + height[i - cols] + height[i + cols] - 4 * height[i]
      const v = clampWake((velocity[i] + WAKE_C2 * lap) * WAKE_DAMPING)
      const h = clampWake((height[i] + v) * WAKE_DECAY)
      nextVelocity[i] = v
      nextHeight[i] = h
    }
  }
  field.height = nextHeight
  field.nextHeight = height
  field.velocity = nextVelocity
  field.nextVelocity = velocity
}

/**
 * A soft circular depression (pointer drag). `radius` and `x/y` are in cells.
 * The write is clamped to the field and never allocates.
 */
export function injectWake(field: BgWakeField, x: number, y: number, radius: number, strength: number): void {
  const { cols, rows, height, velocity } = field
  if (cols === 0 || rows === 0 || strength === 0) return
  const r = Math.max(0.6, radius)
  const minX = Math.max(1, Math.floor(x - r))
  const maxX = Math.min(cols - 2, Math.ceil(x + r))
  const minY = Math.max(1, Math.floor(y - r))
  const maxY = Math.min(rows - 2, Math.ceil(y + r))
  if (minX > maxX || minY > maxY) return
  const inv = 1 / (r * r)
  for (let row = minY; row <= maxY; row++) {
    const dy = row - y
    for (let col = minX; col <= maxX; col++) {
      const dx = col - x
      const falloff = 1 - (dx * dx + dy * dy) * inv
      if (falloff <= 0) continue
      const i = row * cols + col
      // Positive: a finger press raises the surface, and the renderer paints
      // only positive height, so the splash is visible on the very next frame.
      height[i] = clampWake(height[i] + strength * falloff)
      velocity[i] = clampWake(velocity[i] + strength * falloff * 1.6)
    }
  }
}

/**
 * A ring impulse (a click). The profile is a Gaussian band around `radius`;
 * `strength` may be negative for the rebound half of a splash.
 */
export function injectWakeRing(
  field: BgWakeField,
  x: number,
  y: number,
  radius: number,
  width: number,
  strength: number,
): void {
  const { cols, rows, height, velocity } = field
  if (cols === 0 || rows === 0 || strength === 0) return
  const r = Math.max(0.5, radius)
  const w = Math.max(0.5, width)
  const reach = r + w * 2
  const minX = Math.max(1, Math.floor(x - reach))
  const maxX = Math.min(cols - 2, Math.ceil(x + reach))
  const minY = Math.max(1, Math.floor(y - reach))
  const maxY = Math.min(rows - 2, Math.ceil(y + reach))
  if (minX > maxX || minY > maxY) return
  const inv = 1 / (w * w)
  for (let row = minY; row <= maxY; row++) {
    const dy = row - y
    for (let col = minX; col <= maxX; col++) {
      const dx = col - x
      const d = Math.sqrt(dx * dx + dy * dy)
      const band = d - r
      const profile = Math.exp(-(band * band) * inv)
      if (profile < 0.01) continue
      const i = row * cols + col
      height[i] = clampWake(height[i] + strength * profile)
      velocity[i] = clampWake(velocity[i] + strength * profile * 2.2)
    }
  }
}

/** A small wake behind a swimming fish. */
export function injectWakeTrail(field: BgWakeField, x: number, y: number, strength: number): void {
  injectWake(field, x, y, 1.1, strength)
}

/** Nearest-cell height sample (used by fish steering and tests). */
export function sampleWake(field: BgWakeField, x: number, y: number): number {
  const col = Math.max(0, Math.min(field.cols - 1, Math.round(x)))
  const row = Math.max(0, Math.min(field.rows - 1, Math.round(y)))
  return field.height[row * field.cols + col]
}
