/**
 * Unit tests for the WebGL1 backdrop tier. The GL surface is faked
 * structurally (vitest runs without a GPU): the fake records draw/uniform
 * calls, context release and listener bookkeeping, which is exactly what the
 * lifecycle contracts are about. Uniform mapping is tested as plain data via
 * `shaderUniforms`, so its numeric ranges do not depend on a fake GL either.
 * @module @alexpeng/dsh-custom-plugin/tests/bg-shader
 */

import { describe, expect, it } from 'vitest'
import { BG_FX_SHADER_STYLES } from '../src/protocol.ts'
import {
  SHADER_FRAGMENT_SOURCE,
  SHADER_STYLES,
  SHADER_UNIFORM_RANGES,
  SHADER_PULSE_LIFE,
  createShaderBackdrop,
  resolveShaderStyle,
  shaderUniforms,
  type ShaderCanvasLike,
  type ShaderContextAttributes,
  type ShaderContextLostEvent,
  type ShaderDocLike,
  type ShaderGL,
  type ShaderHostLike,
  type ShaderMediaQueryLike,
  type ShaderStyle,
  type ShaderWinLike,
} from '../src/client/bg-shader.ts'
import type { BgPointerEventLike } from '../src/client/bg-pointer.ts'

type Listener = (event: ShaderContextLostEvent) => void

interface RecordedUniform {
  readonly name: string
  readonly args: readonly number[]
}

interface FakeGL extends ShaderGL {
  readonly uniformCalls: RecordedUniform[]
  drawCount: number
  loseCount: number
  deleteProgramCount: number
  deleteBufferCount: number
  failCompile: boolean
  attachments: ShaderContextAttributes | undefined
}

function fakeGL(): FakeGL {
  let nextShader = 0
  const gl: FakeGL = {
    VERTEX_SHADER: 1,
    FRAGMENT_SHADER: 2,
    COMPILE_STATUS: 3,
    LINK_STATUS: 4,
    ARRAY_BUFFER: 5,
    STATIC_DRAW: 6,
    FLOAT: 7,
    TRIANGLES: 8,
    COLOR_BUFFER_BIT: 9,
    uniformCalls: [],
    drawCount: 0,
    loseCount: 0,
    deleteProgramCount: 0,
    deleteBufferCount: 0,
    failCompile: false,
    attachments: undefined,
    createShader() { return { id: ++nextShader } },
    shaderSource() {},
    compileShader() {},
    getShaderParameter() { return !gl.failCompile },
    getShaderInfoLog() { return gl.failCompile ? 'compile failed' : null },
    deleteShader() {},
    createProgram() { return { program: true } },
    attachShader() {},
    linkProgram() {},
    getProgramParameter() { return true },
    getProgramInfoLog() { return null },
    deleteProgram() { gl.deleteProgramCount++ },
    useProgram() {},
    createBuffer() { return { buffer: true } },
    bindBuffer() {},
    bufferData() {},
    deleteBuffer() { gl.deleteBufferCount++ },
    getAttribLocation() { return 0 },
    enableVertexAttribArray() {},
    vertexAttribPointer() {},
    getUniformLocation(_program, name) { return { name } },
    uniform1f(location, value) { if (location !== null) gl.uniformCalls.push({ name: (location as { name: string }).name, args: [value] }) },
    uniform2f(location, x, y) { if (location !== null) gl.uniformCalls.push({ name: (location as { name: string }).name, args: [x, y] }) },
    uniform3f(location, x, y, z) { if (location !== null) gl.uniformCalls.push({ name: (location as { name: string }).name, args: [x, y, z] }) },
    uniform4f(location, x, y, z, w) { if (location !== null) gl.uniformCalls.push({ name: (location as { name: string }).name, args: [x, y, z, w] }) },
    viewport() {},
    drawArrays() { gl.drawCount++ },
    clearColor() {},
    clear() {},
    getExtension(name) {
      if (name === 'WEBGL_lose_context') return { loseContext() { gl.loseCount++ } }
      if (name === 'WEBGL_debug_renderer_info') return { UNMASKED_RENDERER_WEBGL: 0x9246 }
      return null
    },
    getParameter() { return 'FakeGPU (ANGLE)' },
  }
  return gl
}

interface FakeCanvas extends ShaderCanvasLike {
  readonly listeners: Set<Listener>
  removed: boolean
  attrs: ShaderContextAttributes | undefined
}

function fakeCanvas(gl: ShaderGL | null): FakeCanvas {
  const listeners = new Set<Listener>()
  const canvas: FakeCanvas = {
    width: 0,
    height: 0,
    className: '',
    style: { width: '', height: '' },
    listeners,
    removed: false,
    attrs: undefined,
    getContext(_id, attributes) {
      canvas.attrs = attributes
      return gl
    },
    addEventListener(_type, listener) { listeners.add(listener) },
    removeEventListener(_type, listener) { listeners.delete(listener) },
    remove() { canvas.removed = true },
  }
  return canvas
}

interface FakeDoc extends ShaderDocLike {
  readonly canvases: FakeCanvas[]
  hidden: boolean
  readonly visibility: Set<() => void>
}

function fakeDoc(gl: ShaderGL | null): FakeDoc {
  const canvases: FakeCanvas[] = []
  const visibility = new Set<() => void>()
  const doc: FakeDoc = {
    hidden: false,
    canvases,
    visibility,
    createElement() { const canvas = fakeCanvas(gl); canvases.push(canvas); return canvas },
    addEventListener(_type, listener) { visibility.add(listener) },
    removeEventListener(_type, listener) { visibility.delete(listener) },
  }
  return doc
}

interface FakeHost extends ShaderHostLike {
  readonly attrs: Map<string, string>
  readonly props: Map<string, string>
  readonly children: FakeCanvas[]
}

function fakeHost(): FakeHost {
  const attrs = new Map<string, string>([['data-vx-bg-motion', 'animated']])
  const props = new Map<string, string>([['--vx-bg-tint', '#e9ebee']])
  const children: FakeCanvas[] = []
  return {
    clientWidth: 1440,
    clientHeight: 900,
    attrs,
    props,
    children,
    getAttribute(name) { return attrs.get(name) ?? null },
    appendChild(node) { children.push(node as FakeCanvas); return node },
    style: { getPropertyValue(name) { return props.get(name) ?? '' } },
  }
}

interface FakeWin extends ShaderWinLike {
  raf: number
  readonly callbacks: Map<number, (now: number) => void>
  readonly cancelled: Set<number>
  readonly pointerListeners: Map<string, Array<(event: BgPointerEventLike) => void>>
  reducedMotion: boolean
  flush(now: number): void
  emit(type: string, event: BgPointerEventLike): void
}

function fakeWin(dpr = 1): FakeWin {
  let nextId = 0
  const callbacks = new Map<number, (now: number) => void>()
  const cancelled = new Set<number>()
  const pointerListeners = new Map<string, Array<(event: BgPointerEventLike) => void>>()
  const win: FakeWin = {
    devicePixelRatio: dpr,
    innerWidth: 1440,
    innerHeight: 900,
    raf: 0,
    callbacks,
    cancelled,
    pointerListeners,
    reducedMotion: false,
    requestAnimationFrame(callback) { const id = ++nextId; callbacks.set(id, callback); return id },
    cancelAnimationFrame(id) { cancelled.add(id); callbacks.delete(id) },
    addEventListener(type, listener) {
      const list = pointerListeners.get(type) ?? []
      list.push(listener)
      pointerListeners.set(type, list)
    },
    removeEventListener(type, listener) {
      const list = pointerListeners.get(type) ?? []
      pointerListeners.set(type, list.filter((entry) => entry !== listener))
    },
    matchMedia(query) {
      const listeners = new Set<() => void>()
      const mql: ShaderMediaQueryLike = {
        matches: query.includes('prefers-reduced-motion') ? win.reducedMotion : false,
        addEventListener(_type, listener) { listeners.add(listener) },
        removeEventListener(_type, listener) { listeners.delete(listener) },
      }
      return mql
    },
    flush(now) {
      for (const [id, callback] of [...callbacks]) {
        callbacks.delete(id)
        callback(now)
      }
    },
    emit(type, event) {
      for (const listener of [...(pointerListeners.get(type) ?? [])]) listener(event)
    },
  }
  return win
}

interface Harness {
  doc: FakeDoc
  win: FakeWin
  host: FakeHost
  gl: FakeGL
  canvas: FakeCanvas
  backdrop: ReturnType<typeof createShaderBackdrop>
}

function harness(options: { style?: ShaderStyle; dpr?: number; noGl?: boolean } = {}): Harness {
  const gl = fakeGL()
  const doc = fakeDoc(options.noGl === true ? null : gl)
  const win = fakeWin(options.dpr ?? 1)
  const host = fakeHost()
  const backdrop = createShaderBackdrop({ doc, win, host, style: options.style ?? 'liquid' })
  expect(backdrop).not.toBeNull()
  ;(backdrop as NonNullable<typeof backdrop>).sync()
  const canvas = doc.canvases[0]
  expect(canvas).toBeDefined()
  return { doc, win, host, gl, canvas, backdrop }
}

function lastUniform(gl: FakeGL, name: string): readonly number[] | undefined {
  for (let i = gl.uniformCalls.length - 1; i >= 0; i--) {
    if (gl.uniformCalls[i].name === name) return gl.uniformCalls[i].args
  }
  return undefined
}

describe('shader style table', () => {
  it('exposes exactly the ids the shared protocol knows', () => {
    expect(Object.keys(SHADER_STYLES).sort()).toEqual([...BG_FX_SHADER_STYLES].sort())
  })

  it('keeps every default inside its declared writable range', () => {
    for (const spec of Object.values(SHADER_STYLES)) {
      expect(spec.speed).toBeGreaterThanOrEqual(spec.ranges.speed.min)
      expect(spec.speed).toBeLessThanOrEqual(spec.ranges.speed.max)
      expect(spec.density).toBeGreaterThanOrEqual(spec.ranges.density.min)
      expect(spec.density).toBeLessThanOrEqual(spec.ranges.density.max)
      expect(spec.intensity).toBeGreaterThanOrEqual(spec.ranges.intensity.min)
      expect(spec.intensity).toBeLessThanOrEqual(spec.ranges.intensity.max)
      expect(spec.seed).toBeGreaterThanOrEqual(spec.ranges.seed.min)
      expect(spec.seed).toBeLessThanOrEqual(spec.ranges.seed.max)
      expect(spec.fps).toBeGreaterThanOrEqual(spec.ranges.fps.min)
      expect(spec.fps).toBeLessThanOrEqual(spec.ranges.fps.max)
      // Both styles share `inkFor`, whose delta is calibrated per theme; the
      // per-style scale only compensates ink coverage, so it stays near 1.
      expect(spec.inkScale).toBeGreaterThanOrEqual(0.8)
      expect(spec.inkScale).toBeLessThanOrEqual(1.6)
    }
  })

  it('resolves unknown and cross-tier ids to the default instead of throwing', () => {
    expect(resolveShaderStyle('liquid')).toBe('liquid')
    expect(resolveShaderStyle('grain')).toBe('grain')
    expect(resolveShaderStyle('flow')).toBe('liquid')
    expect(resolveShaderStyle('clouds')).toBe('liquid')
    expect(resolveShaderStyle(undefined)).toBe('liquid')
    expect(resolveShaderStyle('__proto__')).toBe('liquid')
  })

  it('declares grain static and liquid animated', () => {
    expect(SHADER_STYLES.grain.animated).toBe(false)
    expect(SHADER_STYLES.liquid.animated).toBe(true)
  })
})

describe('shaderUniforms', () => {
  const base = {
    time: 12.5, width: 1440, height: 900, dpr: 1, spec: SHADER_STYLES.liquid, surface: '#e9ebee',
  }

  it('passes time and CSS-pixel resolution through unchanged', () => {
    const values = shaderUniforms(base)
    expect(values.time).toBe(12.5)
    expect(values.width).toBe(1440)
    expect(values.height).toBe(900)
  })

  it('clamps time, resolution and dpr into the documented ranges', () => {
    const values = shaderUniforms({ ...base, time: -8, width: 0, height: Number.NaN, dpr: 4 })
    expect(values.time).toBe(0)
    expect(values.width).toBe(1)
    expect(values.height).toBe(1)
    expect(values.dpr).toBe(2)
    expect(shaderUniforms({ ...base, time: Number.NaN }).time).toBe(0)
  })

  it('keeps surface and ink as unit RGB and gives the ink a non-zero delta', () => {
    const values = shaderUniforms(base)
    for (const channel of [...values.surface, ...values.ink]) {
      expect(channel).toBeGreaterThanOrEqual(0)
      expect(channel).toBeLessThanOrEqual(1)
    }
    expect(values.ink).not.toEqual(values.surface)
  })

  it('scales the ink step with the piece ink scale, staying inside RGB', () => {
    const luma = ([r, g, b]: readonly number[]): number => 0.2126 * r + 0.7152 * g + 0.0722 * b
    const surfaceLuma = luma(shaderUniforms(base).surface)
    const normal = surfaceLuma - luma(shaderUniforms(base).ink)
    const stronger = surfaceLuma - luma(shaderUniforms({
      ...base,
      spec: { ...SHADER_STYLES.liquid, inkScale: 2 },
    }).ink)
    expect(normal).toBeGreaterThan(0)
    expect(stronger).toBeGreaterThan(normal)
    for (const channel of shaderUniforms({ ...base, spec: { ...SHADER_STYLES.liquid, inkScale: 2 } }).ink) {
      expect(channel).toBeGreaterThanOrEqual(0)
      expect(channel).toBeLessThanOrEqual(1)
    }
  })

  it('clamps speed, density and intensity at the uniform contract edges', () => {
    const clamped = shaderUniforms({
      ...base,
      spec: { ...SHADER_STYLES.liquid, speed: 9, density: 9, intensity: -2 },
    })
    expect(clamped.speed).toBe(SHADER_UNIFORM_RANGES.speed.max)
    expect(clamped.density).toBe(SHADER_UNIFORM_RANGES.density.max)
    expect(clamped.intensity).toBe(SHADER_UNIFORM_RANGES.intensity.min)
    const scaled = shaderUniforms({ ...base, spec: SHADER_STYLES.liquid, densityScale: 0.75 })
    expect(scaled.density).toBeCloseTo(SHADER_STYLES.liquid.density * 0.75, 5)
  })

  it('carries the calm zone as a vec4 and disables it for unusable rects', () => {
    // No zone: the shader's `u_focus.z <= 0` branch leaves the frame alone.
    expect(shaderUniforms(base).focus).toEqual([0, 0, 0, 0])
    expect(shaderUniforms({ ...base, focus: { x: 420.5, y: 116, w: 708, h: 578 } }).focus)
      .toEqual([420.5, 116, 708, 578])
    expect(shaderUniforms({ ...base, focus: { x: 0, y: 0, w: 0, h: 100 } }).focus).toEqual([0, 0, 0, 0])
    // The feather and the floor are shared constants, not per-style knobs.
    expect(shaderUniforms(base).focusFeather).toBeGreaterThan(0)
    expect(shaderUniforms(base).focusFloor).toBeGreaterThan(0)
    expect(shaderUniforms(base).focusFloor).toBeLessThan(1)
  })

  it('disables the pointer eddy when there is no live sample', () => {
    expect(shaderUniforms(base).pointer).toEqual([0, 0, 0, 0])
    expect(shaderUniforms({ ...base, pointer: { x: 10, y: 20, active: false, speed: 0.4 } }).pointer)
      .toEqual([0, 0, 0, 0])
  })

  it('clamps the live pointer into the viewport and its speed into 0..1', () => {
    expect(shaderUniforms({ ...base, pointer: { x: 700, y: 400, active: true, speed: 0.25 } }).pointer)
      .toEqual([700, 400, 1, 0.25])
    expect(shaderUniforms({ ...base, pointer: { x: -50, y: 2000, active: true, speed: 4 } }).pointer)
      .toEqual([0, 900, 1, 1])
    expect(shaderUniforms({ ...base, pointer: { x: Number.NaN, y: 300, active: true, speed: Number.NaN } }).pointer)
      .toEqual([0, 300, 1, 0])
  })

  it('expires a press ring after its documented life', () => {
    expect(shaderUniforms(base).pulse).toEqual([0, 0, 0, 0])
    expect(shaderUniforms({ ...base, pulse: { x: 700, y: 400, age: 0.4 } }).pulse)
      .toEqual([700, 400, 0.4, 1])
    expect(shaderUniforms({ ...base, pulse: { x: 700, y: 400, age: SHADER_PULSE_LIFE } }).pulse)
      .toEqual([0, 0, 0, 0])
    expect(shaderUniforms({ ...base, pulse: { x: 5000, y: 400, age: -2 } }).pulse)
      .toEqual([1440, 400, 0, 1])
  })

  it('only the animated liquid shader reads the pointer uniforms', () => {
    expect(SHADER_FRAGMENT_SOURCE.liquid).toContain('u_pointer')
    expect(SHADER_FRAGMENT_SOURCE.liquid).toContain('u_pulse')
    // Grain is declared static and never schedules a frame; reacting to the
    // pointer there would contradict that declaration.
    expect(SHADER_FRAGMENT_SOURCE.grain).not.toContain('u_pointer')
    expect(SHADER_FRAGMENT_SOURCE.grain).not.toContain('u_pulse')
  })
})

describe('createShaderBackdrop: capability gates', () => {
  it('falls back to the caller when WebGL1 is unavailable and leaves no node behind', () => {
    const gl = fakeGL()
    const doc = fakeDoc(null)
    const win = fakeWin()
    const host = fakeHost()
    expect(createShaderBackdrop({ doc, win, host, style: 'liquid' })).toBeNull()
    expect(doc.canvases).toHaveLength(1)
    expect(doc.canvases[0].removed).toBe(true)
    expect(host.children).toHaveLength(0)
  })

  it('releases the context and the canvas when the program cannot compile', () => {
    const gl = fakeGL()
    gl.failCompile = true
    const doc = fakeDoc(gl)
    const win = fakeWin()
    const host = fakeHost()
    expect(createShaderBackdrop({ doc, win, host, style: 'liquid' })).toBeNull()
    expect(gl.loseCount).toBe(1)
    expect(doc.canvases[0].removed).toBe(true)
    expect(host.children).toHaveLength(0)
  })

  it('requests the documented context attributes', () => {
    const { canvas } = harness()
    expect(canvas.attrs).toMatchObject({ alpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' })
  })
})

describe('createShaderBackdrop: layout and uniforms', () => {
  it('sizes the backing store by dpr but uniforms the CSS resolution', () => {
    const { canvas, gl } = harness({ dpr: 2 })
    expect(canvas.width).toBe(2880)
    expect(canvas.height).toBe(1800)
    expect(lastUniform(gl, 'u_resolution')).toEqual([1440, 900])
    expect(lastUniform(gl, 'u_dpr')).toEqual([2])
  })

  it('paints the first frame during sync and hands back the real GPU backend name', () => {
    const { gl, backdrop } = harness()
    expect(gl.drawCount).toBe(1)
    expect(backdrop?.stats.renderer).toBe('FakeGPU (ANGLE)')
    expect(lastUniform(gl, 'u_time')).toEqual([0])
    expect(lastUniform(gl, 'u_surface')?.every((value) => value >= 0 && value <= 1)).toBe(true)
    expect(lastUniform(gl, 'u_ink')?.every((value) => value >= 0 && value <= 1)).toBe(true)
  })

  it('uploads an idle pointer and no ring by default', () => {
    const { gl } = harness()
    expect(lastUniform(gl, 'u_pointer')).toEqual([0, 0, 0, 0])
    expect(lastUniform(gl, 'u_pulse')).toEqual([0, 0, 0, 0])
  })

  it('turns a pointer move into an eddy and a press into an expanding ring', () => {
    const { win, gl } = harness()
    win.emit('pointermove', { clientX: 700, clientY: 400, pointerType: 'mouse' })
    win.flush(1000)
    win.flush(1060)
    // `[x, y, active, speed]`; the first sample carries no velocity yet.
    expect(lastUniform(gl, 'u_pointer')).toEqual([700, 400, 1, 0])
    win.emit('pointerdown', { clientX: 640, clientY: 360, pointerType: 'mouse', button: 0 })
    win.flush(1120)
    expect(lastUniform(gl, 'u_pulse')).toEqual([640, 360, 0, 1])
    win.flush(1300)
    const aged = lastUniform(gl, 'u_pulse')
    expect(aged?.[0]).toBe(640)
    expect(aged?.[1]).toBe(360)
    // `[x, y, age, active]`: age grows on the shader's own clock.
    expect(aged?.[2]).toBeGreaterThan(0)
    expect(aged?.[3]).toBe(1)
  })

  it('does not attach pointer listeners when the window cannot carry them', () => {
    const gl = fakeGL()
    const doc = fakeDoc(gl)
    const host = fakeHost()
    // A bare window (no addEventListener) still boots the tier; the eddy is
    // simply inert instead of the renderer throwing during creation.
    const bare = {
      devicePixelRatio: 1,
      requestAnimationFrame() { return 1 },
      cancelAnimationFrame() {},
      matchMedia() {
        return { matches: false, addEventListener() {}, removeEventListener() {} }
      },
    }
    const backdrop = createShaderBackdrop({ doc, win: bare, host, style: 'liquid' })
    expect(backdrop).not.toBeNull()
    backdrop?.sync()
    expect(lastUniform(gl, 'u_pointer')).toEqual([0, 0, 0, 0])
  })
})

describe('createShaderBackdrop: motion lifecycle', () => {
  it('animates liquid, accumulating visible time only', () => {
    const { win, gl } = harness()
    win.flush(1000)
    win.flush(1042)
    expect(lastUniform(gl, 'u_time')).toEqual([0.042])
  })

  it('draws one frame and never schedules rAF for the static grain style', () => {
    const { win, gl } = harness({ style: 'grain' })
    expect(gl.drawCount).toBe(1)
    expect(win.callbacks.size).toBe(0)
    win.flush(5000)
    expect(gl.drawCount).toBe(1)
    expect(win.callbacks.size).toBe(0)
  })

  it('uploads a new calm zone and repaints a stopped frame exactly once', () => {
    const { gl, backdrop } = harness({ style: 'grain' })
    expect(gl.drawCount).toBe(1)
    expect(lastUniform(gl, 'u_focus')).toEqual([0, 0, 0, 0])
    backdrop?.setFocus({ x: 420, y: 116, w: 708, h: 578 })
    expect(lastUniform(gl, 'u_focus')).toEqual([420, 116, 708, 578])
    expect(gl.drawCount).toBe(2)
    // The same zone again must not repaint: the poll runs every 350 ms.
    backdrop?.setFocus({ x: 420, y: 116, w: 708, h: 578 })
    expect(gl.drawCount).toBe(2)
    backdrop?.setFocus(null)
    expect(lastUniform(gl, 'u_focus')).toEqual([0, 0, 0, 0])
    expect(gl.drawCount).toBe(3)
  })

  it('draws one frame and no rAF under prefers-reduced-motion', () => {
    const gl = fakeGL()
    const doc = fakeDoc(gl)
    const win = fakeWin()
    win.reducedMotion = true
    const host = fakeHost()
    const backdrop = createShaderBackdrop({ doc, win, host, style: 'liquid' })
    expect(backdrop).not.toBeNull()
    ;(backdrop as NonNullable<typeof backdrop>).sync()
    expect(gl.drawCount).toBe(1)
    expect(win.callbacks.size).toBe(0)
  })

  it('stops rAF and freezes time while the page is hidden, then repaints on return', () => {
    const { doc, win, gl } = harness()
    win.flush(1000)
    win.flush(1042)
    expect(lastUniform(gl, 'u_time')).toEqual([0.042])
    const before = gl.drawCount
    doc.hidden = true
    for (const listener of doc.visibility) listener()
    expect(win.callbacks.size).toBe(0)
    win.flush(6000)
    expect(gl.drawCount).toBe(before)
    doc.hidden = false
    for (const listener of doc.visibility) listener()
    expect(gl.drawCount).toBe(before + 1)
    expect(lastUniform(gl, 'u_time')).toEqual([0.042])
    expect(win.callbacks.size).toBe(1)
  })

  it('switches style in place, deletes the old program and repaints', () => {
    const { backdrop, gl } = harness({ style: 'liquid' })
    expect(backdrop?.setStyle('grain')).toBe(true)
    expect(backdrop?.stats.style).toBe('grain')
    expect(gl.deleteProgramCount).toBe(1)
    expect(gl.drawCount).toBe(2)
    expect(backdrop?.setStyle('grain')).toBe(true)
    expect(gl.deleteProgramCount).toBe(1)
  })
})

describe('createShaderBackdrop: release and context loss', () => {
  it('destroy cancels rAF, detaches listeners, deletes GPU objects and loses the context', () => {
    const gl = fakeGL()
    const doc = fakeDoc(gl)
    const win = fakeWin()
    const host = fakeHost()
    const backdrop = createShaderBackdrop({ doc, win, host, style: 'liquid' })
    expect(backdrop).not.toBeNull()
    ;(backdrop as NonNullable<typeof backdrop>).sync()
    ;(backdrop as NonNullable<typeof backdrop>).destroy()
    expect(win.callbacks.size).toBe(0)
    expect(doc.visibility.size).toBe(0)
    expect(doc.canvases[0].listeners.size).toBe(0)
    expect(doc.canvases[0].removed).toBe(true)
    expect(gl.deleteProgramCount).toBe(1)
    expect(gl.deleteBufferCount).toBe(1)
    expect(gl.loseCount).toBe(1)
    expect((backdrop as NonNullable<typeof backdrop>).stats.alive).toBe(false)
  })

  it('reports a lost context once and never recovers on its own', () => {
    const gl = fakeGL()
    const doc = fakeDoc(gl)
    const win = fakeWin()
    const host = fakeHost()
    const reasons: string[] = []
    const backdrop = createShaderBackdrop({ doc, win, host, style: 'liquid', onFallback: (reason) => reasons.push(reason) })
    expect(backdrop).not.toBeNull()
    ;(backdrop as NonNullable<typeof backdrop>).sync()
    const canvas = doc.canvases[0]
    let prevented = 0
    const event = { preventDefault() { prevented++ } }
    for (const listener of canvas.listeners) listener(event)
    expect(prevented).toBe(1)
    expect(reasons).toEqual(['context-lost'])
    expect(win.callbacks.size).toBe(0)
    const before = gl.drawCount
    win.flush(2000)
    expect(gl.drawCount).toBe(before)
    ;(backdrop as NonNullable<typeof backdrop>).destroy()
    expect(gl.loseCount).toBe(0)
  })
})
