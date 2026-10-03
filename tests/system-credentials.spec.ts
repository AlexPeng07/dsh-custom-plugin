/**
 * Tests for the SystemCredentialStore itself (the interface is exercised
 * via fakes elsewhere): this repository does not install keytar — it
 * resolves from the dsh profile tree at runtime — so the absent path is
 * the one minimal/headless installs actually run.
 * @module @alexpeng/dsh-custom-plugin/tests/system-credentials
 */

import { describe, expect, it } from 'vitest'
import { SystemCredentialStore } from '../src/system-credentials.ts'

const store = new SystemCredentialStore()

describe('SystemCredentialStore without keytar', () => {
  it.skipIf(store.available === true)('fails soft on every operation', async () => {
    expect(store.available).toBe(false)
    await expect(store.get()).resolves.toBe('')
    await expect(store.set('sk-placeholder')).resolves.toBe(false)
    await expect(store.clear()).resolves.toBe(false)
  })
})
