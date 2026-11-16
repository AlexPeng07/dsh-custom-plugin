/**
 * Unit tests for the settings index bridge helpers.
 * @module @alexpeng/dsh-custom-plugin/tests/index-bridge
 */

import { describe, expect, it } from 'vitest'
import { uniqueIds } from '../src/client/ui/index-bridge.ts'

describe('uniqueIds', () => {
  it('keeps order and removes duplicates', () => {
    expect(uniqueIds(['b', 'a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c'])
  })
  it('drops non-strings and empty ids', () => {
    expect(uniqueIds([null, undefined, 3, '', 'a'])).toEqual(['a'])
  })
})
