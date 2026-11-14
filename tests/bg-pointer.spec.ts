/**
 * Interaction plumbing: passive listeners, touch filtering, eased position and
 * velocity, the slow-drift dead zone, idle damping, click pulses and a
 * disposer that leaves no listener behind. The background can never capture
 * the pointer, so these are the only behaviours the scene may rely on.
 * @module @alexpeng/dsh-custom-plugin/tests/bg-pointer
 */

import { describe, expect, it } from 'vitest'
import {
  attachBgPointer,
  createBgPointerState,
  POINTER_IDLE_MS,
  resetBgPointerState,
  syncBgPointer,
  type BgPointerEventLike,
  type BgPointerTargetLike,
} from '../src/client/bg-pointer.ts'

interface FakeTarget extends BgPointerTargetLike {
  listeners: Map<string, Array<(event: BgPointerEventLike) => void>>
  passive: boolean[]
}

function fakeTarget(): FakeTarget {
  const target: FakeTarget = {
    listeners: new Map(),
    passive: [],
    addEventListener(type, listener, options) {
      const list = target.listeners.get(type) ?? []
      list.push(listener)
      target.listeners.set(type, list)
      if (options?.passive === true) target.passive.push(true)
    },
    removeEventListener(type, listener) {
      const list = target.listeners.get(type) ?? []
      target.listeners.set(type, list.filter((entry) => entry !== listener))
    },
  }
  return target
}

function emit(target: FakeTarget, type: string, event: BgPointerEventLike): void {
  for (const listener of [...(target.listeners.get(type) ?? [])]) listener(event)
}

describe('attachBgPointer', () => {
  it('eases the position toward the raw sample instead of teleporting', () => {
    const target = fakeTarget()
    const state = createBgPointerState()
    let now = 1000
    const detach = attachBgPointer(target, state, () => now)
    emit(target, 'pointermove', { clientX: 10, clientY: 20, pointerType: 'mouse' })
    now = 1016
    emit(target, 'pointermove', { clientX: 30, clientY: 20, pointerType: 'mouse' })
    expect(state.active).toBe(true)
    // The event moves the target; the eased position catches up on frames.
    expect(state.targetX).toBe(30)
    expect(state.x).toBe(10)
    now = 1066
    syncBgPointer(state, now)
    expect(state.x).toBeGreaterThan(10)
    expect(state.x).toBeLessThan(30)
    now = 3000
    syncBgPointer(state, now)
    expect(state.x).toBe(30)
    expect(target.passive.every(Boolean)).toBe(true)
    detach()
  })

  it('starts at the first sample instead of gliding in from the origin', () => {
    const target = fakeTarget()
    const state = createBgPointerState()
    const detach = attachBgPointer(target, state, () => 0)
    emit(target, 'pointermove', { clientX: 400, clientY: 300, pointerType: 'mouse' })
    expect(state.x).toBe(400)
    expect(state.y).toBe(300)
    expect(state.lastInputAt).toBe(0)
    detach()
  })

  it('ignores touch moves so scrolling never paints a wake', () => {
    const target = fakeTarget()
    const state = createBgPointerState()
    const detach = attachBgPointer(target, state, () => 0)
    emit(target, 'pointermove', { clientX: 10, clientY: 20, pointerType: 'touch' })
    expect(state.active).toBe(false)
    expect(state.x).toBe(0)
    detach()
  })

  it('turns a primary press into one pulse and ignores secondary buttons', () => {
    const target = fakeTarget()
    const state = createBgPointerState()
    const detach = attachBgPointer(target, state, () => 0)
    emit(target, 'pointerdown', { clientX: 40, clientY: 60, button: 0, pointerType: 'mouse' })
    expect(state.down).toBe(true)
    expect(state.pulseId).toBe(1)
    expect(state.pulseX).toBe(40)
    expect(state.pulseY).toBe(60)
    // A press is an impact: the eased position lands on the click point.
    expect(state.x).toBe(40)
    expect(state.y).toBe(60)
    emit(target, 'pointerdown', { clientX: 1, clientY: 2, button: 2, pointerType: 'mouse' })
    expect(state.pulseId).toBe(1)
    emit(target, 'pointerup', { clientX: 40, clientY: 60, pointerType: 'mouse' })
    expect(state.down).toBe(false)
    detach()
  })

  it('reports no force below the dead speed and a real force above it', () => {
    const target = fakeTarget()
    const state = createBgPointerState()
    let now = 1000
    const detach = attachBgPointer(target, state, () => now)
    emit(target, 'pointermove', { clientX: 10, clientY: 20, pointerType: 'mouse' })
    now = 1016
    emit(target, 'pointermove', { clientX: 11, clientY: 20, pointerType: 'mouse' })
    // 1 px in 16 ms is a slow drift (62.5 px/s): it must not stir anything.
    expect(state.rawVx).toBeGreaterThan(0)
    expect(state.vx).toBe(0)
    now = 1032
    emit(target, 'pointermove', { clientX: 31, clientY: 20, pointerType: 'mouse' })
    expect(state.vx).toBeGreaterThan(150)
    detach()
  })

  it('damps velocity while the pointer rests and zeroes it after the idle window', () => {
    const target = fakeTarget()
    const state = createBgPointerState()
    let now = 1000
    const detach = attachBgPointer(target, state, () => now)
    emit(target, 'pointermove', { clientX: 10, clientY: 20, pointerType: 'mouse' })
    now = 1016
    emit(target, 'pointermove', { clientX: 110, clientY: 20, pointerType: 'mouse' })
    const raw = state.rawVx
    expect(raw).toBeGreaterThan(500)

    now = 1016 + 400
    syncBgPointer(state, now)
    expect(state.vx).toBeGreaterThan(0)
    expect(state.vx).toBeLessThan(raw)

    now = 1016 + POINTER_IDLE_MS
    syncBgPointer(state, now)
    expect(state.vx).toBe(0)
    expect(state.vy).toBe(0)
    expect(state.x).toBe(state.targetX)
    expect(state.y).toBe(state.targetY)
    detach()
  })

  it('clears activity on leave and removes every listener in the disposer', () => {
    const target = fakeTarget()
    const state = createBgPointerState()
    const detach = attachBgPointer(target, state, () => 0)
    emit(target, 'pointermove', { clientX: 40, clientY: 60, pointerType: 'mouse' })
    emit(target, 'pointerleave', { clientX: 0, clientY: 0, pointerType: 'mouse' })
    expect(state.active).toBe(false)
    expect(state.vx).toBe(0)
    expect(state.vy).toBe(0)
    expect(state.lastInputAt).toBe(-1)
    const before = [...target.listeners.values()].reduce((sum, list) => sum + list.length, 0)
    expect(before).toBeGreaterThan(0)
    detach()
    const after = [...target.listeners.values()].reduce((sum, list) => sum + list.length, 0)
    expect(after).toBe(0)
  })

  it('resets in place without allocating a replacement state', () => {
    const state = createBgPointerState()
    state.x = 10
    state.y = 20
    state.active = true
    state.down = true
    state.vx = 5
    state.vy = -5
    state.pulseId = 3
    state.targetX = 12
    state.targetY = 24
    state.rawVx = 5
    state.rawVy = -5
    state.lastInputAt = 123
    state.lastPosAt = 123
    resetBgPointerState(state)
    expect(state).toEqual(createBgPointerState())
  })
})
