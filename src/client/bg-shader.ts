/**
 * WebGL1 backdrop: one full-screen triangle, one fragment shader, no library.
 *
 * This is the shader tier of `div#vx-bg`. It shares the layer, the motion
 * attribute (`data-vx-bg-motion`), the tint (`--vx-bg-tint`), the visibility
 * rules and the one-way degradation ladder with the ASCII renderer, but it is
 * exclusive with it: the two never coexist, and leaving this tier calls
 * `WEBGL_lose_context` so the page never accumulates contexts.
 *
 * The uniform contract is fixed (time, resolution, dpr, surface, ink, speed,
 * density, intensity, seed). Surface and ink are the same values the ASCII
 * tier uses, so both tiers read correctly on light/dark themes and every
 * palette; the ink keeps `inkFor`'s fixed lightness delta and nothing neon or
 * highly saturated enters the shader.
 *
 * Styles are self-declared static or animated. A style that does not depend on
 * `u_time` draws one frame and never schedules rAF; the caller never has to
 * sniff pixels to discover that (readPixels would force a sync far more
 * expensive than the frame it saves).
 * @module @alexpeng/dsh-custom-plugin/client/bg-shader
 */

import { DEGRADE_MAX, DPR_CAP, createLadder, isDarkSurface, observeFrame, type LadderState } from './bg-ascii.ts'
import { FOCUS_FEATHER_PX, FOCUS_FLOOR, normalizeFocusRect, type BgFocusRect } from './bg-focus.ts'
import { hexToRgb, inkFor, inkScaleFor } from './palette.ts'

/** Every shader style id. */
export type ShaderStyle = 'liquid' | 'grain'

/** Inclusive numeric bounds for the future settings panel. */
export interface ShaderRange {
  readonly min: number
  readonly max: number
}

/** Writable bounds per style; defaults sit inside these. */
export interface ShaderStyleRanges {
  readonly speed: ShaderRange
  readonly density: ShaderRange
  readonly intensity: ShaderRange
  readonly seed: ShaderRange
  readonly fps: ShaderRange
}

/** Tunables of one style. `animated: false` means "draw one frame, never
 * schedule rAF" — a physical property of the shader, not a runtime guess. */
export interface ShaderStyleSpec {
  readonly speed: number
  readonly density: number
  readonly intensity: number
  readonly seed: number
  readonly fps: number
  readonly animated: boolean
  /** Per-style multiplier on the theme's base ΔL (see `inkFor`). The user's
   * soft/standard/strong strength choice multiplies this again. */
  readonly inkScale: number
  readonly ranges: ShaderStyleRanges
}

/**
 * Two deliberately different pieces rather than one field with knobs:
 * `liquid` is a low-frequency domain-warped ink cloud that drifts; `grain` is
 * a fine, static film grain with a soft edge falloff. Both derive their ink
 * from the surface brightness, so they work on light, dark and every palette.
 */
export const SHADER_STYLES: Record<ShaderStyle, ShaderStyleSpec> = {
  liquid: {
    // 0.70 of the ink at the cloud peaks. The ink delta comes from `inkFor`
    // (0.7 light / 0.15 dark, one per-theme calibration). Round 1 re-tune
    // 2026-11-08 after the user rejected the 1%-Michelson ruler as "根本看不
    // 出来": the smoothstep window below now starts at 0.22, so the *typical*
    // pixel (field ≈ 0.4) lands near 0.35 amount instead of 0.09 — the cloud
    // covers area rather than owning a few bright cores — and the peak
    // intensity moved 0.56 → 0.70 with the panel range widened to 1.0.
    speed: 1, density: 1.1, intensity: 0.7, seed: 7.3, fps: 24, animated: true, inkScale: 1,
    ranges: {
      speed: { min: 0.2, max: 1.2 },
      density: { min: 0.8, max: 1.6 },
      intensity: { min: 0.2, max: 1 },
      seed: { min: 0, max: 9999 },
      fps: { min: 15, max: 30 },
    },
  },
  grain: {
    // Static by design: this is the style that exercises the zero-rAF path.
    // It also gives reduced-motion users a texture that never moves. The
    // fine speck is the main signal, so its ceiling sits higher than liquid's
    // while the mean stays low (most cells are near the surface colour).
    // Deliberately left at 0.60/ink 1.0 after the 2026-11-08 review: it already
    // measures the highest mean ink mass of any piece (0.55% light / 1.34%
    // dark, i.e. 2.4× the light figure on a dark surface — exactly the target
    // ratio), so boosting it would push the dark theme into the distracting
    // band; its shallow 1.64% peak is a property of a fine static speck.
    speed: 0, density: 1.2, intensity: 0.6, seed: 41.7, fps: 30, animated: false, inkScale: 1,
    ranges: {
      speed: { min: 0, max: 0 },
      density: { min: 0.75, max: 1.75 },
      intensity: { min: 0.2, max: 0.8 },
      seed: { min: 0, max: 9999 },
      fps: { min: 10, max: 30 },
    },
  },
}

/** Resolve a stored preset id to a shader style. An ASCII id or any unknown
 * string is a stale cross-tier combination and falls back to the default. */
export function resolveShaderStyle(preset: string | undefined): ShaderStyle {
  if (preset !== undefined && Object.prototype.hasOwnProperty.call(SHADER_STYLES, preset)) {
    return preset as ShaderStyle
  }
  return 'liquid'
}

/** Panel overrides for one shader style. Values are clamped into the style's
 * own `ranges` before they reach a uniform; `strength` is the user's
 * soft/standard/strong multiplier on the ink step (clamped to the ink band). */
export type ShaderParams = Partial<Record<'speed' | 'density' | 'intensity' | 'fps' | 'strength', number>>

/** Clamp one override into a style range; `undefined`/non-finite means "use
 * the style default". */
function clampOverride(value: number | undefined, range: ShaderRange, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return value < range.min ? range.min : value > range.max ? range.max : value
}

/**
 * Resolve overrides against one style. Missing keys fall back to the style
 * default, so a style switch never inherits a value it cannot honour. Returns
 * the base spec object itself when nothing is overridden.
 */
export function resolveShaderSpec(style: ShaderStyle, params: ShaderParams): ShaderStyleSpec {
  const base = SHADER_STYLES[style]
  const speed = clampOverride(params.speed, base.ranges.speed, base.speed)
  const density = clampOverride(params.density, base.ranges.density, base.density)
  const intensity = clampOverride(params.intensity, base.ranges.intensity, base.intensity)
  const fps = clampOverride(params.fps, base.ranges.fps, base.fps)
  const inkScale = inkScaleFor(base.inkScale * inkScaleFor(params.strength))
  if (speed === base.speed && density === base.density && intensity === base.intensity && fps === base.fps && inkScale === base.inkScale) {
    return base
  }
  return { ...base, speed, density, intensity, fps, inkScale }
}

/** Hard bounds the uniform contract promises, independent of a style. */
export const SHADER_UNIFORM_RANGES = {
  speed: { min: 0, max: 2 },
  density: { min: 0.5, max: 2 },
  intensity: { min: 0, max: 1 },
  seed: { min: 0, max: 9999 },
} as const

/** Vertex shader for the single full-screen triangle (GLSL ES 1.00). */
export const SHADER_VERTEX_SOURCE = `attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`

// Desktop GPUs all expose highp in the fragment stage; the fallback keeps
// old mobile-class hardware compiling instead of dropping the whole tier, at
// the cost of grain precision (the low-frequency field stays usable).
const SHADER_PRELUDE = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float u_time;
uniform vec2  u_resolution;
uniform float u_dpr;
uniform vec3  u_surface;
uniform vec3  u_ink;
uniform float u_speed;
uniform float u_density;
uniform float u_intensity;
uniform float u_seed;
uniform vec4  u_focus;
uniform float u_focusFeather;
uniform float u_focusFloor;
varying vec2 v_uv;

// Reading-column focus: full ink outside the column, u_focusFloor inside it,
// with a smoothstep feather on every side. The rect arrives in CSS px from the
// top-left origin, so the flip has to happen here (v_uv.y runs bottom-up).
// A zero-width rect (u_focus.z <= 0) means "no zone" and leaves the frame
// untouched.
float focusWeight() {
  if (u_focus.z <= 0.0) return 1.0;
  vec2 px = vec2(v_uv.x, 1.0 - v_uv.y) * u_resolution;
  vec2 right = u_focus.xy + u_focus.zw;
  float dx = px.x < u_focus.x ? u_focus.x - px.x : (px.x > right.x ? px.x - right.x : 0.0);
  float dy = px.y < u_focus.y ? u_focus.y - px.y : (px.y > right.y ? px.y - right.y : 0.0);
  float d = length(vec2(dx, dy));
  float t = clamp(d / max(u_focusFeather, 1.0), 0.0, 1.0);
  return u_focusFloor + (1.0 - u_focusFloor) * (t * t * (3.0 - 2.0 * t));
}

// The public seed range is 0..9999; fold it into 0..1 so every hash input
// stays in a range both highp and mediump can resolve.
float seed01;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`

/**
 * Fragment shaders, one per style. Both end in `mix(u_surface, u_ink, …)` with
 * alpha 1: the layer is the opaque page background while it is mounted, which
 * is the same contract the ASCII canvas honours with its surface fill.
 */
export const SHADER_FRAGMENT_SOURCE: Record<ShaderStyle, string> = {
  liquid: `${SHADER_PRELUDE}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.55;
  for (int i = 0; i < 3; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + 11.7;
    a *= 0.5;
  }
  return v;
}

void main() {
  seed01 = fract(u_seed * 0.0137);
  float aspect = u_resolution.x / max(u_resolution.y, 1.0);
  vec2 q = (v_uv - 0.5) * vec2(aspect, 1.0);
  float t = u_time * u_speed;
  float scale = 2.4 * u_density;
  vec2 warp = vec2(
    vnoise(q * scale + vec2(t * 0.11, seed01 * 3.7)),
    vnoise(q * scale + vec2(5.2 - t * 0.09, seed01 * 2.1 + 3.1))
  );
  float f = fbm(q * (scale * 1.44) + warp * 1.2 + vec2(t * 0.05, -t * 0.035));
  f = smoothstep(0.22, 0.72, f);
  // A very low-frequency vertical breath keeps the cloud alive without
  // pushing the field into a fast, high-contrast band.
  f *= 0.82 + 0.18 * sin(q.y * 2.4 + t * 0.22 + seed01 * 6.0);
  float amount = clamp(f * u_intensity, 0.0, 1.0) * focusWeight();
  gl_FragColor = vec4(mix(u_surface, u_ink, amount), 1.0);
}`,
  grain: `${SHADER_PRELUDE}
void main() {
  seed01 = fract(u_seed * 0.0137);
  // CSS-pixel space: the cell size is a visual unit, so DPR must not change
  // the grain size on screen. u_dpr only feeds the sub-pixel phase.
  vec2 px = v_uv * u_resolution;
  float cell = max(1.0, (3.2 + 0.1 * u_dpr) / max(u_density, 0.001));
  vec2 grid = floor(px / cell);
  float fine = hash21(grid * 0.061 + vec2(seed01 * 31.0, seed01 * 17.0));
  float cloud = vnoise(px / max(u_resolution.y, 1.0) * 2.1 + seed01 * 5.0);
  // The calm centre is now the shared reading-column mask (focusWeight), so
  // the old hand-tuned radial term is gone: two overlapping fades on the same
  // axis would have made the column's edge read twice as wide as it is.
  float amount = (fine * 0.78 + cloud * 0.22) * u_intensity * focusWeight();
  gl_FragColor = vec4(mix(u_surface, u_ink, clamp(amount, 0.0, 1.0)), 1.0);
}`,
}

/** Numeric values handed to the GPU for one draw. Plain data so the uniform
 * mapping is unit-testable without a GL context. */
export interface ShaderUniformValues {
  time: number
  width: number
  height: number
  dpr: number
  surface: [number, number, number]
  ink: [number, number, number]
  speed: number
  density: number
  intensity: number
  seed: number
  /** `[x, y, w, h]` in CSS px; `w <= 0` disables the mask. */
  focus: [number, number, number, number]
  focusFeather: number
  focusFloor: number
}

/** Inputs for {@link shaderUniforms}; `dark` is derived from the surface. */
export interface ShaderUniformInput {
  time: number
  width: number
  height: number
  dpr: number
  spec: ShaderStyleSpec
  surface: string
  /** Multiplier applied by the degradation ladder (L2). */
  densityScale?: number
  /** Reading-column calm zone from the appearance painter. */
  focus?: BgFocusRect | null
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return value < min ? min : value > max ? max : value
}

function rgb01(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex)
  return [r / 255, g / 255, b / 255]
}

/** `[0, 0, 0, 0]` means "no calm zone": the shader skips the fade entirely. */
function focusRectUniform(rect: BgFocusRect | null | undefined): [number, number, number, number] {
  const clean = normalizeFocusRect(rect)
  return clean === null ? [0, 0, 0, 0] : [clean.x, clean.y, clean.w, clean.h]
}

/**
 * Map runtime state onto the uniform contract. Visibility time is clamped at
 * zero; resolution is CSS pixels (never backing pixels); dpr honours the same
 * 2× cap as the ASCII tier; density and the other knobs stay inside the
 * documented ranges even if a future panel or a hand-edited state file writes
 * something else. The ink is `inkFor(surface, dark)` so both tiers use exactly
 * the same lightness delta.
 */
export function shaderUniforms(input: ShaderUniformInput): ShaderUniformValues {
  const dpr = clamp(input.dpr, 1, DPR_CAP, 1)
  const densityScale = finite(input.densityScale ?? 1, 1)
  const density = clamp(input.spec.density * densityScale, SHADER_UNIFORM_RANGES.density.min, SHADER_UNIFORM_RANGES.density.max, input.spec.density)
  const surfaceHex = input.surface
  return {
    time: Math.max(0, finite(input.time, 0)),
    width: Math.max(1, finite(input.width, 1)),
    height: Math.max(1, finite(input.height, 1)),
    dpr,
    surface: rgb01(surfaceHex),
    ink: rgb01(inkFor(surfaceHex, isDarkSurface(surfaceHex), input.spec.inkScale)),
    speed: clamp(input.spec.speed, SHADER_UNIFORM_RANGES.speed.min, SHADER_UNIFORM_RANGES.speed.max, 0),
    density,
    intensity: clamp(input.spec.intensity, SHADER_UNIFORM_RANGES.intensity.min, SHADER_UNIFORM_RANGES.intensity.max, 0),
    seed: clamp(input.spec.seed, SHADER_UNIFORM_RANGES.seed.min, SHADER_UNIFORM_RANGES.seed.max, 0),
    focus: focusRectUniform(input.focus),
    focusFeather: FOCUS_FEATHER_PX,
    focusFloor: FOCUS_FLOOR,
  }
}

/** The GL call surface this renderer uses (kept structural for tests). */
export interface ShaderGL {
  readonly VERTEX_SHADER: number
  readonly FRAGMENT_SHADER: number
  readonly COMPILE_STATUS: number
  readonly LINK_STATUS: number
  readonly ARRAY_BUFFER: number
  readonly STATIC_DRAW: number
  readonly FLOAT: number
  readonly TRIANGLES: number
  readonly COLOR_BUFFER_BIT: number
  createShader(type: number): object | null
  shaderSource(shader: object, source: string): void
  compileShader(shader: object): void
  getShaderParameter(shader: object, pname: number): boolean
  getShaderInfoLog(shader: object): string | null
  deleteShader(shader: object): void
  createProgram(): object | null
  attachShader(program: object, shader: object): void
  linkProgram(program: object): void
  getProgramParameter(program: object, pname: number): boolean
  getProgramInfoLog(program: object): string | null
  deleteProgram(program: object): void
  useProgram(program: object | null): void
  createBuffer(): object | null
  bindBuffer(target: number, buffer: object | null): void
  bufferData(target: number, data: Float32Array, usage: number): void
  deleteBuffer(buffer: object): void
  getAttribLocation(program: object, name: string): number
  enableVertexAttribArray(index: number): void
  vertexAttribPointer(index: number, size: number, type: number, normalized: boolean, stride: number, offset: number): void
  getUniformLocation(program: object, name: string): object | null
  uniform1f(location: object | null, value: number): void
  uniform2f(location: object | null, x: number, y: number): void
  uniform3f(location: object | null, x: number, y: number, z: number): void
  uniform4f(location: object | null, x: number, y: number, z: number, w: number): void
  viewport(x: number, y: number, width: number, height: number): void
  drawArrays(mode: number, first: number, count: number): void
  clearColor(r: number, g: number, b: number, a: number): void
  clear(mask: number): void
  getExtension(name: string): unknown
  getParameter(pname: number): unknown
}

/** WebGL context attributes the spec fixes. */
export interface ShaderContextAttributes {
  readonly alpha: boolean
  readonly antialias: boolean
  readonly depth: boolean
  readonly stencil: boolean
  readonly powerPreference: 'low-power'
}

/** The canvas surface this renderer owns. */
export interface ShaderCanvasLike {
  width: number
  height: number
  className: string
  style: { width: string; height: string }
  getContext(contextId: 'webgl', attributes?: ShaderContextAttributes): ShaderGL | null
  addEventListener(type: 'webglcontextlost', listener: (event: ShaderContextLostEvent) => void): void
  removeEventListener(type: 'webglcontextlost', listener: (event: ShaderContextLostEvent) => void): void
  remove(): void
}

/** The only context-loss field this renderer reads. */
export interface ShaderContextLostEvent {
  preventDefault(): void
}

/** The host element (`div#vx-bg`) as this renderer sees it. */
export interface ShaderHostLike {
  readonly clientWidth: number
  readonly clientHeight: number
  getAttribute(name: string): string | null
  appendChild(node: ShaderCanvasLike): unknown
  style: { getPropertyValue(name: string): string }
}

/** The slice of `Document` this renderer touches. */
export interface ShaderDocLike {
  createElement(tag: string): ShaderCanvasLike
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
  readonly hidden: boolean
}

/** The slice of `MediaQueryList` this renderer touches. */
export interface ShaderMediaQueryLike {
  readonly matches: boolean
  addEventListener(type: 'change', listener: () => void): void
  removeEventListener(type: 'change', listener: () => void): void
}

/** The slice of `ResizeObserver` this renderer touches. */
export interface ShaderResizeObserverLike {
  observe(target: unknown): void
  disconnect(): void
}

/** The slice of `Window` this renderer touches. */
export interface ShaderWinLike {
  readonly devicePixelRatio: number
  readonly innerWidth?: number
  readonly innerHeight?: number
  requestAnimationFrame(callback: (now: number) => void): number
  cancelAnimationFrame(handle: number): void
  matchMedia(query: string): ShaderMediaQueryLike
  ResizeObserver?: new (callback: () => void) => ShaderResizeObserverLike
}

/** Observable renderer state; the live probe and tests read this. */
export interface ShaderBackdropStats {
  level: number
  width: number
  height: number
  frames: number
  alive: boolean
  contextLost: boolean
  style: ShaderStyle
  /** Actual back-end string from `WEBGL_debug_renderer_info`, when exposed. */
  renderer: string | null
}

/** Options accepted by {@link createShaderBackdrop}. */
export interface ShaderBackdropOptions {
  doc: ShaderDocLike
  win: ShaderWinLike
  host: ShaderHostLike
  style?: ShaderStyle
  /** Panel overrides for the boot style; clamps to its `ranges`. */
  params?: ShaderParams
  /** Called once when the GPU drops this context. The caller falls back to
   * ASCII; this renderer never tries to recover on its own. */
  onFallback?: (reason: 'context-lost') => void
}

/** Handle owned by the appearance painter. */
export interface ShaderBackdrop {
  sync(): void
  /** Rebuild the program for another style. False means compile failed and
   * the previous style is still live, so the caller can fall back. */
  setStyle(style: ShaderStyle): boolean
  /** Replace the panel overrides for the current style. Values are clamped
   * into that style's `ranges`; a style switch keeps the overrides and
   * re-clamps them. Repaints immediately so a dragging slider is visible. */
  setParams(params: ShaderParams): void
  /** Move the calm zone (the reading column); `null` disables the mask. */
  setFocus(rect: BgFocusRect | null): void
  destroy(): void
  readonly stats: ShaderBackdropStats
}

interface UniformLocations {
  time: object | null
  resolution: object | null
  dpr: object | null
  surface: object | null
  ink: object | null
  speed: object | null
  density: object | null
  intensity: object | null
  seed: object | null
  focus: object | null
  focusFeather: object | null
  focusFloor: object | null
}

interface BuiltProgram {
  program: object
  uniforms: UniformLocations
  /** `a_pos` location; -1 when the driver optimized it away (never on a
   * program that actually consumes the attribute). */
  attrib: number
}

const FALLBACK_SURFACE = '#e9ebee'

function readTint(value: string): string {
  const trimmed = value.trim()
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed : FALLBACK_SURFACE
}

const CONTEXT_ATTRIBUTES: ShaderContextAttributes = {
  alpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  powerPreference: 'low-power',
}

const TRIANGLE = new Float32Array([-1, -1, 3, -1, -1, 3])

function compileShader(gl: ShaderGL, type: number, source: string): object | null {
  const shader = gl.createShader(type)
  if (shader === null) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function buildProgram(gl: ShaderGL, style: ShaderStyle): BuiltProgram | null {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, SHADER_VERTEX_SOURCE)
  if (vertex === null) return null
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, SHADER_FRAGMENT_SOURCE[style])
  if (fragment === null) {
    gl.deleteShader(vertex)
    return null
  }
  const program = gl.createProgram()
  if (program === null) {
    gl.deleteShader(vertex)
    gl.deleteShader(fragment)
    return null
  }
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }
  return {
    program,
    attrib: gl.getAttribLocation(program, 'a_pos'),
    uniforms: {
      time: gl.getUniformLocation(program, 'u_time'),
      resolution: gl.getUniformLocation(program, 'u_resolution'),
      dpr: gl.getUniformLocation(program, 'u_dpr'),
      surface: gl.getUniformLocation(program, 'u_surface'),
      ink: gl.getUniformLocation(program, 'u_ink'),
      speed: gl.getUniformLocation(program, 'u_speed'),
      density: gl.getUniformLocation(program, 'u_density'),
      intensity: gl.getUniformLocation(program, 'u_intensity'),
      seed: gl.getUniformLocation(program, 'u_seed'),
      focus: gl.getUniformLocation(program, 'u_focus'),
      focusFeather: gl.getUniformLocation(program, 'u_focusFeather'),
      focusFloor: gl.getUniformLocation(program, 'u_focusFloor'),
    },
  }
}

/**
 * Create the shader backdrop and attach its canvas. Returns null when WebGL1
 * is unavailable or the program does not compile; in that case the canvas is
 * removed and no context is left alive, and the caller falls back to ASCII and
 * tells the user.
 */
export function createShaderBackdrop(options: ShaderBackdropOptions): ShaderBackdrop | null {
  const { doc, win, host } = options
  const canvas = doc.createElement('canvas')
  canvas.className = 'vx-bg-canvas vx-bg-shader'
  const gl = canvas.getContext('webgl', CONTEXT_ATTRIBUTES)
  if (gl === null) {
    canvas.remove()
    return null
  }
  let style = resolveShaderStyle(options.style)
  let params: ShaderParams = normalizeParams(options.params)
  let current: ShaderStyleSpec = resolveShaderSpec(style, params)
  // Non-null alias: TypeScript cannot keep the outer narrowing inside the
  // function declarations that close over it.
  const gpu: ShaderGL = gl
  let built = buildProgram(gpu, style)
  if (built === null) {
    loseContext(gpu)
    canvas.remove()
    return null
  }
  host.appendChild(canvas)

  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, TRIANGLE, gl.STATIC_DRAW)

  const rendererInfo = describeRenderer(gl)
  const stats: ShaderBackdropStats = {
    level: 0, width: 0, height: 0, frames: 0, alive: true, contextLost: false, style, renderer: rendererInfo,
  }
  const ladder: LadderState = createLadder()
  let destroyed = false
  let lost = false
  let running = false
  let level = 0
  let raf = 0
  let lastTick = 0
  let lastDraw = 0
  let acc = 0
  let frames = 0
  let dpr = 1
  let cssW = 0
  let cssH = 0
  let layoutDone = false
  let surface = FALLBACK_SURFACE
  let densityScale = 1
  let targetFps = current.fps
  let resizeTimer: ReturnType<typeof setTimeout> | null = null
  let resizeObserver: ShaderResizeObserverLike | null = null
  let dprMql: ShaderMediaQueryLike | null = null
  let focusRect: BgFocusRect | null = null

  function spec(): ShaderStyleSpec {
    return current
  }

  function normalizeParams(next: ShaderParams | undefined): ShaderParams {
    const out: ShaderParams = {}
    if (next === undefined) return out
    for (const key of ['speed', 'density', 'intensity', 'fps', 'strength'] as const) {
      const value = next[key]
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
    }
    return out
  }

  function paramsEqual(a: ShaderParams, b: ShaderParams): boolean {
    return a.speed === b.speed && a.density === b.density && a.intensity === b.intensity
      && a.fps === b.fps && a.strength === b.strength
  }

  function resetLadder(): void {
    level = 0
    ladder.level = 0
    ladder.badWindows = 0
    ladder.sum = 0
    ladder.count = 0
    densityScale = 1
    targetFps = spec().fps
    acc = 0
    lastTick = 0
    lastDraw = 0
    stats.level = 0
  }

  function layout(force = false): void {
    if (destroyed) return
    const width = host.clientWidth || win.innerWidth || 0
    const height = host.clientHeight || win.innerHeight || 0
    if (width <= 0 || height <= 0) return
    const previousDpr = dpr
    dpr = Math.min(win.devicePixelRatio || 1, DPR_CAP)
    if (previousDpr !== dpr) watchDpr()
    const backingW = Math.round(width * dpr)
    const backingH = Math.round(height * dpr)
    if (canvas.width !== backingW || canvas.height !== backingH) {
      canvas.width = backingW
      canvas.height = backingH
    }
    cssW = width
    cssH = height
    stats.width = cssW
    stats.height = cssH
    layoutDone = true
    if (force) stats.frames = frames
  }

  function drawFrame(seconds: number): void {
    if (destroyed || lost || gl === null || built === null || !layoutDone) return
    const values = shaderUniforms({
      time: seconds,
      width: cssW,
      height: cssH,
      dpr,
      spec: spec(),
      surface,
      densityScale,
      focus: focusRect,
    })
    if (level >= DEGRADE_MAX) {
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(values.surface[0], values.surface[1], values.surface[2], 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      frames++
      stats.frames = frames
      return
    }
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.useProgram(built.program)
    if (built.attrib >= 0 && buffer !== null) {
      // One full-screen triangle: clip-space vertices, so no projection
      // uniform is needed and the attribute stays two floats.
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.enableVertexAttribArray(built.attrib)
      gl.vertexAttribPointer(built.attrib, 2, gl.FLOAT, false, 0, 0)
    }
    const u = built.uniforms
    gl.uniform1f(u.time, values.time)
    gl.uniform2f(u.resolution, values.width, values.height)
    gl.uniform1f(u.dpr, values.dpr)
    gl.uniform3f(u.surface, values.surface[0], values.surface[1], values.surface[2])
    gl.uniform3f(u.ink, values.ink[0], values.ink[1], values.ink[2])
    gl.uniform1f(u.speed, values.speed)
    gl.uniform1f(u.density, values.density)
    gl.uniform1f(u.intensity, values.intensity)
    gl.uniform1f(u.seed, values.seed)
    gl.uniform4f(u.focus, values.focus[0], values.focus[1], values.focus[2], values.focus[3])
    gl.uniform1f(u.focusFeather, values.focusFeather)
    gl.uniform1f(u.focusFloor, values.focusFloor)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    frames++
    stats.frames = frames
  }

  function drawOnce(): void {
    if (!layoutDone) layout()
    if (layoutDone) drawFrame(acc / 1000)
  }

  function schedule(): void {
    if (!running || raf !== 0 || destroyed) return
    raf = win.requestAnimationFrame(onFrame)
  }

  function stopLoop(): void {
    running = false
    if (raf !== 0) {
      win.cancelAnimationFrame(raf)
      raf = 0
    }
    lastTick = 0
    lastDraw = 0
  }

  function startLoop(): void {
    if (running || destroyed) return
    running = true
    lastTick = 0
    lastDraw = 0
    schedule()
  }

  function setLevel(next: number): void {
    const clamped = Math.max(0, Math.min(DEGRADE_MAX, next))
    if (clamped === level) return
    level = clamped
    stats.level = level
    // Same ladder as the ASCII tier: L1 fps 24→15, L2 density ×0.75, L3 mono
    // (the shader mixes one ink already), L4 dither off (no dither here, so a
    // deliberate no-op), L5 one frame and stop, L6 surface only.
    densityScale = clamped >= 2 ? 0.75 : 1
    targetFps = clamped >= 1 ? Math.min(spec().fps, 15) : spec().fps
    if (clamped === 5) {
      stopLoop()
      drawOnce()
    } else if (clamped === DEGRADE_MAX) {
      stopLoop()
      drawFrame(acc / 1000)
    }
  }

  function onFrame(now: number): void {
    raf = 0
    if (!running || destroyed) return
    if (lastTick !== 0) acc += Math.min(now - lastTick, 100)
    lastTick = now
    const budget = 1000 / Math.max(1, targetFps)
    if (now - lastDraw < budget - 2) {
      schedule()
      return
    }
    const interval = lastDraw === 0 ? budget : now - lastDraw
    lastDraw = now
    drawFrame(acc / 1000)
    if (level < 5 && observeFrame(ladder, interval, budget)) setLevel(ladder.level)
    if (level >= 5 || destroyed) {
      running = false
      return
    }
    schedule()
  }

  function computeMotion(): 'animated' | 'static' | 'paused' {
    const attr = host.getAttribute('data-vx-bg-motion')
    if (doc.hidden || attr === 'paused') return 'paused'
    if (reducedMql.matches || attr === 'static') return 'static'
    return 'animated'
  }

  function applyMotion(): void {
    if (destroyed || lost) return
    const motion = computeMotion()
    if (motion === 'paused') {
      // Freeze: stop rAF and drop the interval anchor, so hidden time is never
      // accumulated into `u_time`.
      stopLoop()
      return
    }
    if (motion === 'static' || !spec().animated || level >= 5) {
      stopLoop()
      drawOnce()
      return
    }
    if (!layoutDone) {
      sync()
      return
    }
    if (!running) {
      drawFrame(acc / 1000)
      startLoop()
    }
  }

  function sync(): void {
    if (destroyed || lost) return
    const nextSurface = readTint(host.style.getPropertyValue('--vx-bg-tint'))
    surface = nextSurface
    if (!layoutDone) layout()
    if (!layoutDone) return
    const motion = computeMotion()
    if (motion === 'paused') {
      stopLoop()
      return
    }
    if (motion === 'static' || !spec().animated || level >= 5) {
      stopLoop()
      drawOnce()
      return
    }
    // Paint immediately: while the layer is mounted `body` is transparent, so
    // an empty canvas would flash the browser's default background. A theme
    // flip has to repaint the still frame even when no rAF is running.
    drawFrame(acc / 1000)
    if (!running) startLoop()
  }

  function setStyle(next: ShaderStyle): boolean {
    if (destroyed || lost) return false
    const target = resolveShaderStyle(next)
    if (target === style) return true
    const candidate = buildProgram(gpu, target)
    if (candidate === null) return false
    if (built !== null) gpu.deleteProgram(built.program)
    built = candidate
    style = target
    stats.style = style
    // Overrides travel with the style switch and re-clamp to its own ranges.
    current = resolveShaderSpec(style, params)
    resetLadder()
    layout()
    if (!layoutDone) return true
    const motion = computeMotion()
    if (motion === 'paused') {
      stopLoop()
      return true
    }
    if (motion === 'static' || !spec().animated || level >= 5) {
      stopLoop()
      drawOnce()
      return true
    }
    drawFrame(acc / 1000)
    if (!running) startLoop()
    return true
  }

  function setParams(next: ShaderParams): void {
    if (destroyed || lost) return
    const normalized = normalizeParams(next)
    if (paramsEqual(normalized, params)) return
    params = normalized
    current = resolveShaderSpec(style, params)
    resetLadder()
    if (!layoutDone) layout()
    if (!layoutDone) return
    const motion = computeMotion()
    if (motion === 'paused') {
      stopLoop()
      return
    }
    // speed/intensity/density are uniforms, so one immediate draw shows the
    // new value; a static style and the reduced-motion path paint one frame.
    if (motion === 'static' || !spec().animated || level >= 5) {
      stopLoop()
      drawOnce()
      return
    }
    drawFrame(acc / 1000)
    if (!running) startLoop()
  }

  function setFocus(next: BgFocusRect | null): void {
    if (destroyed || lost) return
    const rect = normalizeFocusRect(next)
    if (rect === null && focusRect === null) return
    if (rect !== null && focusRect !== null && rect.x === focusRect.x && rect.y === focusRect.y && rect.w === focusRect.w && rect.h === focusRect.h) return
    focusRect = rect
    // The zone is just two extra uniforms: a running loop picks it up next
    // frame, a stopped one paints once so the layout change is not stale.
    if (computeMotion() === 'paused' || !layoutDone) return
    if (!running) drawOnce()
  }

  function onVisibility(): void {
    applyMotion()
  }

  const reducedMql = win.matchMedia('(prefers-reduced-motion: reduce)')
  const onReduced = (): void => {
    applyMotion()
  }

  function onDpr(): void {
    if (destroyed) return
    layout(true)
    sync()
  }

  function watchDpr(): void {
    if (dprMql !== null) {
      dprMql.removeEventListener('change', onDpr)
      dprMql = null
    }
    try {
      const next = win.matchMedia(`(resolution: ${dpr}dppx)`)
      next.addEventListener('change', onDpr)
      dprMql = next
    } catch {
      // Engines without resolution queries simply keep the boot dpr.
    }
  }

  function onContextLost(event: ShaderContextLostEvent): void {
    event.preventDefault()
    if (destroyed || lost) return
    lost = true
    stats.contextLost = true
    stopLoop()
    options.onFallback?.('context-lost')
  }

  doc.addEventListener('visibilitychange', onVisibility)
  reducedMql.addEventListener('change', onReduced)
  watchDpr()
  const Observer = win.ResizeObserver
  if (typeof Observer === 'function') {
    resizeObserver = new Observer(() => {
      if (resizeTimer !== null) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        resizeTimer = null
        if (destroyed) return
        layout(true)
        sync()
      }, 150)
    })
    resizeObserver.observe(host)
  }
  canvas.addEventListener('webglcontextlost', onContextLost)

  function destroy(): void {
    if (destroyed) return
    destroyed = true
    stopLoop()
    if (resizeTimer !== null) {
      clearTimeout(resizeTimer)
      resizeTimer = null
    }
    if (resizeObserver !== null) {
      resizeObserver.disconnect()
      resizeObserver = null
    }
    doc.removeEventListener('visibilitychange', onVisibility)
    reducedMql.removeEventListener('change', onReduced)
    if (dprMql !== null) {
      dprMql.removeEventListener('change', onDpr)
      dprMql = null
    }
    canvas.removeEventListener('webglcontextlost', onContextLost)
    if (built !== null) {
      gpu.deleteProgram(built.program)
      built = null
    }
    if (buffer !== null) gpu.deleteBuffer(buffer)
    if (!lost) loseContext(gpu)
    canvas.width = 0
    canvas.height = 0
    canvas.remove()
    stats.alive = false
  }

  return { sync, setStyle, setParams, setFocus, destroy, stats }
}

/** Read the actual back-end string when the browser exposes it. Never used to
 * infer utilization; it only names the backend in diagnostics. */
function describeRenderer(gl: ShaderGL): string | null {
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL?: number } | null
    if (info === null || info.UNMASKED_RENDERER_WEBGL === undefined) return null
    const value = gl.getParameter(info.UNMASKED_RENDERER_WEBGL)
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

function loseContext(gl: ShaderGL): void {
  try {
    const ext = gl.getExtension('WEBGL_lose_context') as { loseContext?: () => void } | null
    ext?.loseContext?.()
  } catch {
    // Already lost or the extension is unavailable; nothing to free.
  }
}
