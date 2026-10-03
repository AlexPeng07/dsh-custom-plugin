/**
 * Tests for the host single-instance guard: the cordis effect subtlety
 * (the unmarker is RETURNED, not run) is one refactor away from "second
 * mount is a permanent no-op" or "double-mount boot failure".
 * @module @alexpeng/dsh-custom-plugin/tests/mount-once
 */

import { describe, expect, it } from 'vitest'
import { mountOnce } from '../src/mount-once.ts'

const MOUNT_KEY = Symbol.for('dsh-custom-plugin.mounted-plugins')
const NAME = 'mount-once-spec-package'

function reset(): void {
  const mounted = (globalThis as unknown as { [key: symbol]: Set<string> | undefined })[MOUNT_KEY]
  mounted?.delete(NAME)
}

function ctxWithEffects(): { ctx: { effect(effect: () => unknown): unknown }; dispose(): void } {
  const disposers: Array<() => void> = []
  return {
    ctx: {
      effect(effect: () => unknown): unknown {
        const dispose = effect()
        // typeof narrows unknown to Function, which is not assignable to the
        // array's element type — the cast is the contract, not a workaround.
        if (typeof dispose === 'function') disposers.push(dispose as () => void)
        return dispose
      },
    },
    dispose(): void {
      for (const run of disposers.splice(0)) run()
    },
  }
}

describe('mountOnce', () => {
  it('runs the first apply, no-ops later mounts, and re-arms on fiber disposal', () => {
    reset()
    try {
      let calls = 0
      const apply = mountOnce(NAME, (_ctx: unknown): void => { calls++ })
      const first = ctxWithEffects()
      apply(first.ctx)
      expect(calls).toBe(1)
      // A second instance of the same package (npm copy vs repository link)
      // mounts nothing for the lifetime of the first.
      apply(ctxWithEffects().ctx)
      expect(calls).toBe(1)
      // The effect must have RETURNED the unmarker without running it —
      // still mounted here, so a third mount is still a no-op.
      apply(ctxWithEffects().ctx)
      expect(calls).toBe(1)
      // Fiber disposal unmarks; the next mount applies again.
      first.dispose()
      apply(ctxWithEffects().ctx)
      expect(calls).toBe(2)
    } finally {
      reset()
    }
  })
})
