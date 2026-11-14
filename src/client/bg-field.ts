/**
 * Shared field primitives for the ASCII backdrop pieces.
 *
 * A piece writes one ramp level per cell into a caller-owned `Uint8Array` and
 * never allocates in its hot loop. Interaction is injected through
 * {@link AsciiInput}; pieces that draw something other than water (fish
 * glyphs) write a slot into the optional `overlay` buffer, and pieces whose
 * cells must stay readable inside the calm zone mark them in `emphasis`.
 *
 * Keeping these types here (rather than in `bg-ascii.ts`) lets `bg-ocean.ts`
 * depend on the contract without importing the renderer, so there is no
 * module cycle between the piece and the canvas that hosts it.
 * @module @alexpeng/dsh-custom-plugin/client/bg-field
 */

/** One frame is one ramp-level index per cell. The extra arguments are
 * optional so the four older pieces and their tests keep compiling. */
export type AsciiPiece = (
  t: number,
  out: Uint8Array,
  cols: number,
  rows: number,
  input?: AsciiInput,
  emphasis?: Uint8Array,
  overlay?: Uint8Array,
) => void

/** Pointer state in grid coordinates. The renderer maps CSS pixels onto cells
 * once per frame, so a piece never touches the DOM or the event object. */
export interface AsciiInput {
  /** Pointer position in cells. */
  x: number
  y: number
  /** The pointer has been seen and has not left the window. */
  active: boolean
  /** Primary button held down. */
  down: boolean
  /** Smoothed velocity in cells per second. */
  vx: number
  vy: number
  /** Increments once per press; a piece reacts to a change. */
  pulseId: number
  pulseX: number
  pulseY: number
}

/** Glyphs a piece may place through the overlay buffer. Index 0 is "none";
 * 1–8 are single-cell direction marks for the small fish, 9–13 are the body,
 * edge, head and tail cells of a koi. */
export const OVERLAY_GLYPHS: readonly string[] = ['', '>', '\\', 'v', '/', '<', '^', '|', '~', '#', '%', '@', '*', 'o']

/** Lowest field value the `flow` / `static` piece may emit, as a fraction of
 * the ramp. 0.45 keeps the darkest cell around the middle of the ramp instead
 * of the blank space glyph: the ink *area* per cell, not the ink darkness, is
 * what the eye reads through the 0.5-alpha content surface. */
export const FLOW_LEVEL_FLOOR = 0.45

/** Contrast and gamma stay internal: exposed knobs made every preset look
 * worse. Values are deliberate no-ops until a preset needs them. */
export const CONTRAST = 1
export const GAMMA = 1

/** Bayer 4×4 ordered dither matrix (row-major). */
export const BAYER4 = new Uint8Array([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5])

/** Quantize a 0..1 field value to a ramp index. Clamping lives here so a
 * piece can never write outside the atlas. */
export function quantizeLevel(value: number, levels: number): number {
  if (levels <= 1) return 0
  if (!Number.isFinite(value) || value <= 0) return 0
  const idx = Math.floor(value * levels)
  return idx >= levels ? levels - 1 : idx
}

/** 32-bit integer hash → 0..1. `Math.imul` keeps the multiplications honest;
 * plain `*` would lose the low bits once the product passes 2^53. */
export function hash2(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Smooth value noise; one octave is enough for a decorative drift field. */
export function valueNoise(x: number, y: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const ux = fx * fx * (3 - 2 * fx)
  const uy = fy * fy * (3 - 2 * fy)
  const a = hash2(x0, y0)
  const b = hash2(x0 + 1, y0)
  const c = hash2(x0, y0 + 1)
  const d = hash2(x0 + 1, y0 + 1)
  const ab = a + (b - a) * ux
  const cd = c + (d - c) * ux
  return ab + (cd - ab) * uy
}

/** Shared tail of every piece: clamp, optional Bayer dither, quantize. */
export function shade(out: Uint8Array, i: number, v: number, levels: number, dither: boolean, row: number, col: number): void {
  if (v < 0) v = 0
  else if (v > 1) v = 1
  if (dither) {
    v += (BAYER4[(row & 3) * 4 + (col & 3)] / 16 - 0.5) * (1 / levels)
    if (v < 0) v = 0
    else if (v > 1) v = 1
  }
  out[i] = quantizeLevel(v, levels)
}
