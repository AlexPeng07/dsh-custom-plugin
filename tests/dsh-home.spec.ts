/**
 * Tests for DSH_HOME resolution: this 33-line module decides where the
 * state file lives for both hosts, so `~` handling and the relative-path
 * anchor are worth locking down.
 * @module @alexpeng/dsh-custom-plugin/tests/dsh-home
 */

import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { expandHome, resolveDshHome } from '../src/dsh-home.ts'

describe('expandHome', () => {
  it('expands ~ and the ~/ ~\\ prefixes only', () => {
    expect(expandHome('~', '/h')).toBe('/h')
    expect(expandHome('~/x', '/h')).toBe(join('/h', 'x'))
    expect(expandHome('~\\x', '/h')).toBe(join('/h', 'x'))
    // No ~user expansion: the path passes through untouched.
    expect(expandHome('~user/x', '/h')).toBe('~user/x')
    expect(expandHome('/abs', '/h')).toBe('/abs')
  })
})

describe('resolveDshHome', () => {
  it('falls back to <home>/.dsh when DSH_HOME is unset or blank', () => {
    expect(resolveDshHome({}, '/h')).toBe(join('/h', '.dsh'))
    expect(resolveDshHome({ DSH_HOME: '   ' }, '/h')).toBe(join('/h', '.dsh'))
  })

  it('honors an absolute DSH_HOME as-is, ~ included', () => {
    expect(resolveDshHome({ DSH_HOME: '/abs/dsh' }, '/h')).toBe('/abs/dsh')
    expect(resolveDshHome({ DSH_HOME: '~' }, '/h')).toBe('/h')
    expect(resolveDshHome({ DSH_HOME: ' ~/dsh ' }, '/h')).toBe(join('/h', 'dsh'))
  })

  it('anchors a relative DSH_HOME at the cwd', () => {
    expect(resolveDshHome({ DSH_HOME: 'rel/dsh' }, '/h')).toBe(join(process.cwd(), 'rel/dsh'))
  })
})
