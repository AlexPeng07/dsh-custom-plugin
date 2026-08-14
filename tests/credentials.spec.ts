/**
 * Unit tests for the DSH credential refs reader: minimal YAML parsing of the
 * `refs:` block and the DeepSeek credential lookup.
 * @module @alexpeng/dsh-custom-plugin/tests/credentials
 */

import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CREDENTIALS_FILE, parseCredentialsRefs, readDeepSeekCredential } from '../src/credentials.ts'

const SAMPLE = `version: 1
refs:
  DEEPSEEK_API_KEY: sk-test-fixture-key
  # another provider, ignored for DeepSeek
  OPENAI_API_KEY: sk-other
`

describe('parseCredentialsRefs', () => {
  it('extracts the refs block as a flat map', () => {
    const refs = parseCredentialsRefs(SAMPLE)
    expect(refs.DEEPSEEK_API_KEY).toBe('sk-test-fixture-key')
    expect(refs.OPENAI_API_KEY).toBe('sk-other')
  })

  it('strips surrounding quotes and ignores blank/comment lines', () => {
    const refs = parseCredentialsRefs('version: 1\nrefs:\n  A: "quoted"\n  B: \'single\'\n  C: plain\n  # comment\n\n')
    expect(refs.A).toBe('quoted')
    expect(refs.B).toBe('single')
    expect(refs.C).toBe('plain')
  })

  it('ignores keys outside the refs block', () => {
    const refs = parseCredentialsRefs('version: 1\nDEEPSEEK_API_KEY: sk-top\nrefs:\n  DEEPSEEK_API_KEY: sk-nested\n')
    expect(refs.DEEPSEEK_API_KEY).toBe('sk-nested')
  })

  it('skips empty values and tolerates garbage input', () => {
    const refs = parseCredentialsRefs('refs:\n  A:\n  B:   \nnot: yaml at all')
    expect(refs.A).toBeUndefined()
    expect(refs.B).toBeUndefined()
    expect(parseCredentialsRefs('')).toEqual({})
    expect(parseCredentialsRefs('no refs here')).toEqual({})
  })
})

describe('readDeepSeekCredential', () => {
  it('returns the DEEPSEEK_API_KEY ref from a real file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'custom-plugin-credentials-'))
    try {
      await writeFile(join(dir, CREDENTIALS_FILE), SAMPLE)
      expect(await readDeepSeekCredential(dir)).toBe('sk-test-fixture-key')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('falls through the candidate ref keys', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'custom-plugin-credentials-'))
    try {
      await writeFile(join(dir, CREDENTIALS_FILE), 'version: 1\nrefs:\n  DEEPSEEK_TOKEN: sk-token-only\n')
      expect(await readDeepSeekCredential(dir)).toBe('sk-token-only')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns an empty string when the file is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'custom-plugin-credentials-'))
    try {
      expect(await readDeepSeekCredential(dir)).toBe('')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
