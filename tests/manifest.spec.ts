/**
 * Manifest compatibility contract: dsh 0.2.1-alpha.4+ reads `engines.dsh`
 * first and falls back to the @deepseek-ai/dsh-* peers only when it is absent.
 * The two declarations are edited by hand in different places, so a release
 * that widens one and not the other would make the support line depend on
 * which dsh version asks.
 * @module @alexpeng/dsh-custom-plugin/tests/manifest
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
/** semver ships no types here; only `satisfies` is used. */
const semver = require('semver') as {
  satisfies(version: string, range: string, options?: { includePrerelease?: boolean }): boolean
}

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string
  engines: { dsh?: string }
  peerDependencies: Record<string, string>
  devDependencies: Record<string, string>
}
const declared = String(manifest.engines.dsh ?? '')
const peer = String(manifest.peerDependencies['@deepseek-ai/dsh-tools'] ?? '')
const gate = { includePrerelease: true }

describe('manifest compatibility range', () => {
  it('declares engines.dsh, the dsh 0.2.1+ primary gate', () => {
    expect(declared).not.toBe('')
    expect(peer).not.toBe('')
  })

  it('keeps engines.dsh and the dsh-tools peer in lockstep', () => {
    expect(declared).toBe(peer)
  })

  it('admits every release line this package was built and verified against', () => {
    for (const version of ['0.1.7-rc.2', '0.2.0-rc.2', '0.2.1-rc.2']) {
      expect(semver.satisfies(version, declared, gate), version).toBe(true)
    }
  })

  it('refuses releases that were never verified', () => {
    for (const version of [
      '0.1.7-rc.1', // below the 0.1.7 floor
      '0.2.0-rc.1', // superseded 0.2.0 prerelease
      '0.2.0', // 0.2.0 stable was never probed
      '0.2.1-alpha.5', // prerelease before the verified rc
      '0.2.1-rc.3', // later prereleases are not covered by the measured rc
      '0.2.1', // stable 0.2.1 is a separate verification round
      '0.2.2-alpha.1',
      '0.3.0',
    ]) {
      expect(semver.satisfies(version, declared, gate), version).toBe(false)
    }
  })

  it('pins one exact @deepseek-ai/dsh-* build cohort', () => {
    const cohort = Object.entries(manifest.devDependencies)
      .filter(([name]) => name.startsWith('@deepseek-ai/dsh'))
      .map(([, version]) => version)
    expect(new Set(cohort).size).toBe(1)
    expect(semver.satisfies(cohort[0], declared, gate), cohort[0]).toBe(true)
  })
})
