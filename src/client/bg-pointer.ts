/**
 * Passive pointer state for the background pieces.
 *
 * The backdrop canvas deliberately carries `pointer-events:none` and sits
 * below the content surfaces, so it can never receive a pointer event itself.
 * A window-level listener is the only way to know where the pointer is, and it
 * must be *passive*: the background is decoration, never allowed to delay a
 * scroll, a selection or a click. Nothing here starts a frame — the renderer
 * calls {@link syncBgPointer} once per existing frame, so interaction adds no
 * second rAF loop.
 *
 * Two rules make the pointer read as weight instead of a teleporting cursor:
 * the position follows the raw sample with a short time constant
 * ({@link POINTER_POS_TAU_MS}) and the velocity with a slightly longer one
 * ({@link POINTER_VEL_TAU_MS}). Both are advanced by the event handlers *and*
 * by `syncBgPointer` against one monotonic clock, so the easing is frame-rate
 * independent instead of depending on how often the browser delivers moves.
 * While the pointer rests the velocity is damped out and is exactly zero after
 * {@link POINTER_IDLE_MS}, so an inertia field cannot keep blowing on a stale
 * sample; a drift slower than {@link POINTER_DEAD_SPEED} reports no force at
 * all, which is what keeps a hand resting on the mouse from stirring the page.
 * @module @alexpeng/dsh-custom-plugin/client/bg-pointer
 */

/** The slice of `PointerEvent` this module reads. Structural so tests can
 * dispatch plain objects and the DOM needs no cast at the call site. */
export interface BgPointerEventLike {
  clientX: number
  clientY: number
  pointerType?: string
  button?: number
}

/** The slice of a `Window`-shaped target this module touches. */
export interface BgPointerTargetLike {
  addEventListener(type: string, listener: (event: BgPointerEventLike) => void, options?: { passive?: boolean }): void
  removeEventListener(type: string, listener: (event: BgPointerEventLike) => void, options?: { passive?: boolean }): void
}

/** Mutable state the renderer reads once per frame. */
export interface BgPointerState {
  /** Eased position in CSS pixels, heading for `targetX` / `targetY`. */
  x: number
  y: number
  /** A pointer has been seen and has not left the window since. */
  active: boolean
  /** Primary button held down. */
  down: boolean
  /** Reported smoothed velocity in CSS pixels per second. Zero below the dead
   * speed and after {@link POINTER_IDLE_MS} of no input. */
  vx: number
  vy: number
  /** Increments once per primary press. */
  pulseId: number
  /** Press position in CSS pixels (raw, never eased: a click lands where the
   * user clicked). */
  pulseX: number
  pulseY: number
  /** Raw position the eased one is heading for, CSS pixels. */
  targetX: number
  targetY: number
  /** Smoothed velocity at the last accepted move, before the idle damping;
   * `vx` / `vy` are derived from it on every frame. */
  rawVx: number
  rawVy: number
  /** Clock reading of the last accepted input, ms. -1 until the first one,
   * and again after the pointer leaves. */
  lastInputAt: number
  /** Clock reading of the last eased-position step, ms. */
  lastPosAt: number
}

/** Time constant of the position follow. At a 110 Hz pointer this is the
 * `lerp ≈ 0.15` feel the interaction round settled on; because the step is
 * time-based it stays the same at 60 Hz or 1000 Hz. */
export const POINTER_POS_TAU_MS = 70

/** Smallest time step one position update may carry. Coalesced pointer
 * samples can share a timestamp, and a synthetic harness drives frames
 * without wall-clock time passing; the eased point still has to move. */
const POINTER_MIN_STEP_MS = 8

/** Time constant of the velocity smoothing. Longer than the position: force
 * should ramp, not spike, when the hand changes direction. */
export const POINTER_VEL_TAU_MS = 90

/** Below this speed the reported velocity is zero: a slow drift must not
 * stir the fog, bend the rain or spin the eddy. The onset is a smoothstep up
 * to twice this value, so crossing it never steps the force. */
export const POINTER_DEAD_SPEED = 80

/** No input for this long and every interaction value is zero. */
export const POINTER_IDLE_MS = 1500

/** Velocity starts damping this long after the last input; before that the
 * sample is held, so a normal 60–120 Hz event stream never reads a dip. */
const POINTER_HOLD_MS = 90

/** Time constant of that damping. By {@link POINTER_IDLE_MS} the residue is
 * under 0.4% of the last sample, so the final zero is a snap with no visible
 * step. */
const POINTER_DECAY_TAU_MS = 250

/** Largest instantaneous velocity accepted, CSS px/s. A synthesized jump
 * (tab switch, device change) must not fire a wave across the page. */
const MAX_SPEED = 6000

/** One monotonic clock for the listeners and the frame-time sync. Exported so
 * a test or a harness can drive both sides on the same clock. */
export function bgPointerClock(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

/** A fresh, inactive state. The struct is reused for the life of a renderer. */
export function createBgPointerState(): BgPointerState {
  return {
    x: 0,
    y: 0,
    active: false,
    down: false,
    vx: 0,
    vy: 0,
    pulseId: 0,
    pulseX: 0,
    pulseY: 0,
    targetX: 0,
    targetY: 0,
    rawVx: 0,
    rawVy: 0,
    lastInputAt: -1,
    lastPosAt: 0,
  }
}

/** Reset in place (destroy / preset switch); no allocation. */
export function resetBgPointerState(state: BgPointerState): void {
  state.x = 0
  state.y = 0
  state.active = false
  state.down = false
  state.vx = 0
  state.vy = 0
  state.pulseId = 0
  state.pulseX = 0
  state.pulseY = 0
  state.targetX = 0
  state.targetY = 0
  state.rawVx = 0
  state.rawVy = 0
  state.lastInputAt = -1
  state.lastPosAt = 0
}

/** Advance the eased position toward the raw target by the elapsed time. A
 * gap larger than a second (tab restore) lands exactly on the target instead
 * of gliding across the page. Every step is worth at least {@link
 * POINTER_MIN_STEP_MS}: two samples can share a timestamp (coalesced moves,
 * synthetic input), and a frame still has to advance the eased point even
 * when almost no wall time passed since the last one. */
function advancePosition(state: BgPointerState, now: number): void {
  const dt = Math.min(100, Math.max(POINTER_MIN_STEP_MS, now - state.lastPosAt))
  state.lastPosAt = now
  if (state.x === state.targetX && state.y === state.targetY) return
  const alpha = 1 - Math.exp(-dt / POINTER_POS_TAU_MS)
  state.x += (state.targetX - state.x) * alpha
  state.y += (state.targetY - state.y) * alpha
  if (Math.abs(state.targetX - state.x) < 0.05) state.x = state.targetX
  if (Math.abs(state.targetY - state.y) < 0.05) state.y = state.targetY
}

/** Write the damped velocity into `vx` / `vy`, gated by the dead speed. */
function reportVelocity(state: BgPointerState, damp: number): void {
  const vx = state.rawVx * damp
  const vy = state.rawVy * damp
  const speed = Math.sqrt(vx * vx + vy * vy)
  if (speed <= POINTER_DEAD_SPEED) {
    state.vx = 0
    state.vy = 0
    return
  }
  if (speed < POINTER_DEAD_SPEED * 2) {
    const t = (speed - POINTER_DEAD_SPEED) / POINTER_DEAD_SPEED
    const scale = t * t * (3 - 2 * t)
    state.vx = vx * scale
    state.vy = vy * scale
    return
  }
  state.vx = vx
  state.vy = vy
}

/**
 * Advance interaction time once per rendered frame. Called by both tiers
 * before they read the pointer: the eased position keeps converging after the
 * last event, the velocity damps out while the pointer rests, and after
 * {@link POINTER_IDLE_MS} every value is exactly zero with the position
 * snapped onto the target. A renderer that is not drawing never calls this,
 * so a paused page cannot be woken up by the pointer.
 */
export function syncBgPointer(state: BgPointerState, now: number = bgPointerClock()): void {
  if (state.lastInputAt < 0) return
  advancePosition(state, now)
  const idle = now - state.lastInputAt
  if (idle >= POINTER_IDLE_MS) {
    state.rawVx = 0
    state.rawVy = 0
    state.vx = 0
    state.vy = 0
    state.x = state.targetX
    state.y = state.targetY
    return
  }
  reportVelocity(state, idle <= POINTER_HOLD_MS ? 1 : Math.exp(-(idle - POINTER_HOLD_MS) / POINTER_DECAY_TAU_MS))
}

/**
 * Attach the passive listeners. Touch moves are ignored (the user is
 * scrolling); a touch tap still counts as a press. Returns the disposer, which
 * removes exactly the listeners it added.
 */
export function attachBgPointer(
  target: BgPointerTargetLike,
  state: BgPointerState,
  clock: () => number = bgPointerClock,
): () => void {
  // Raw previous sample, only used for the instantaneous velocity. Kept in the
  // closure: nothing outside the listeners needs it.
  let lastRawX = 0
  let lastRawY = 0
  let lastRawAt = 0

  const onMove = (event: BgPointerEventLike): void => {
    if (event.pointerType === 'touch') return
    const x = event.clientX
    const y = event.clientY
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    const time = clock()
    // First sighting after a leave starts at the sample instead of gliding in
    // from wherever the pointer left the window.
    if (!state.active || state.lastInputAt < 0) {
      state.x = x
      state.y = y
      state.rawVx = 0
      state.rawVy = 0
      state.vx = 0
      state.vy = 0
      state.lastPosAt = time
    } else {
      advancePosition(state, time)
    }
    state.targetX = x
    state.targetY = y
    state.active = true
    if (lastRawAt !== 0) {
      const dt = Math.min(100, Math.max(1, time - lastRawAt))
      const instX = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, ((x - lastRawX) / dt) * 1000))
      const instY = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, ((y - lastRawY) / dt) * 1000))
      const alpha = 1 - Math.exp(-dt / POINTER_VEL_TAU_MS)
      state.rawVx += (instX - state.rawVx) * alpha
      state.rawVy += (instY - state.rawVy) * alpha
    }
    state.lastInputAt = time
    lastRawX = x
    lastRawY = y
    lastRawAt = time
    reportVelocity(state, 1)
  }

  const onDown = (event: BgPointerEventLike): void => {
    // A touch tap is allowed (it is a deliberate press); a scroll gesture is
    // never seen here because touch moves are filtered above.
    if (event.pointerType === 'touch' && event.button !== undefined && event.button !== 0) return
    if (event.button !== undefined && event.button !== 0) return
    const x = event.clientX
    const y = event.clientY
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    const time = clock()
    // A press is an impact: land on the click point so the splash happens
    // under the cursor. The velocity is deliberately kept — a flick that ends
    // in a click carries its momentum into the piece (`ripple` throws a harder
    // ring), and the idle damping already zeroes it once the hand rests.
    state.x = x
    state.y = y
    state.targetX = x
    state.targetY = y
    state.active = true
    state.down = true
    state.lastInputAt = time
    state.lastPosAt = time
    state.pulseId++
    state.pulseX = x
    state.pulseY = y
    lastRawX = x
    lastRawY = y
    lastRawAt = time
  }

  const onUp = (): void => {
    state.down = false
  }

  const onLeave = (): void => {
    state.active = false
    state.down = false
    state.vx = 0
    state.vy = 0
    state.rawVx = 0
    state.rawVy = 0
    state.lastInputAt = -1
    state.lastPosAt = 0
    lastRawAt = 0
  }

  const add = (type: string, listener: (event: BgPointerEventLike) => void): void => {
    target.addEventListener(type, listener, { passive: true })
  }
  const remove = (type: string, listener: (event: BgPointerEventLike) => void): void => {
    target.removeEventListener(type, listener, { passive: true })
  }

  add('pointermove', onMove)
  add('pointerdown', onDown)
  add('pointerup', onUp)
  add('pointercancel', onUp)
  add('pointerleave', onLeave)
  add('blur', onLeave)

  return () => {
    remove('pointermove', onMove)
    remove('pointerdown', onDown)
    remove('pointerup', onUp)
    remove('pointercancel', onUp)
    remove('pointerleave', onLeave)
    remove('blur', onLeave)
    onLeave()
  }
}
