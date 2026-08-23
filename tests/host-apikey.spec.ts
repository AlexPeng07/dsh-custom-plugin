/**
 * Unit tests for the balance key resolution chain: panel state first, then
 * environment candidates, then the DSH credentials file seam.
 * @module @alexpeng/dsh-custom-plugin/tests/host-apikey
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { CustomPluginHost } from '../src/host-service.ts'
import { defaultState } from '../src/state.ts'

function makeHost(options: { apiKey?: string, credential?: string } = {}): { host: CustomPluginHost, resolve: () => Promise<string> } {
  const state = defaultState()
  state.apiKey = options.apiKey ?? ''
  const host = new CustomPluginHost({
    sessionQuery: {} as never,
    state,
    statePath: () => 'custom-plugin-state.json',
    saveNow: async () => {},
    reportDiag: () => {},
    diagReports: [],
    readCredential: async () => options.credential ?? '',
  })
  return { host, resolve: () => (host as unknown as { resolveApiKey: () => Promise<string> }).resolveApiKey() }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

/** The host machine may carry a real DEEPSEEK_* environment; every test that
 * needs an "empty" environment tier stubs all three candidates to '' so the
 * chain's fall-through is deterministic. */
function stubEmptyEnv(): void {
  vi.stubEnv('DEEPSEEK_API_KEY', '')
  vi.stubEnv('DEEPSEEK_KEY', '')
  vi.stubEnv('DEEPSEEK_TOKEN', '')
}

describe('resolveApiKey three-tier chain', () => {
  it('the panel key wins over environment and credentials', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'sk-env-ignored')
    const { resolve } = makeHost({ apiKey: '  sk-panel-value  ', credential: 'sk-cred-ignored' })
    expect(await resolve()).toBe('sk-panel-value')
  })

  it('falls to the environment when the panel is empty, API_KEY before KEY before TOKEN', async () => {
    stubEmptyEnv()
    vi.stubEnv('DEEPSEEK_KEY', 'sk-key-value')
    vi.stubEnv('DEEPSEEK_TOKEN', 'sk-token-value')
    expect((await makeHost().resolve())).toBe('sk-key-value')
    vi.stubEnv('DEEPSEEK_API_KEY', 'sk-apikey-value')
    expect((await makeHost().resolve())).toBe('sk-apikey-value')
  })

  it('an environment candidate without the sk- prefix is ignored, not rejected wholesale', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'not-a-key')
    vi.stubEnv('DEEPSEEK_KEY', 'sk-key-value')
    vi.stubEnv('DEEPSEEK_TOKEN', '')
    const { resolve } = makeHost()
    expect(await resolve()).toBe('sk-key-value')
  })

  it('the DSH credentials seam answers when state and environment are empty', async () => {
    stubEmptyEnv()
    const { resolve } = makeHost({ credential: 'sk-cred-file' })
    expect(await resolve()).toBe('sk-cred-file')
  })

  it('a non-sk credential is ignored and the chain resolves empty', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'garbage')
    vi.stubEnv('DEEPSEEK_KEY', 'also-garbage')
    vi.stubEnv('DEEPSEEK_TOKEN', '')
    const { resolve } = makeHost({ credential: 'also-garbage' })
    expect(await resolve()).toBe('')
  })

  it('a throwing credentials seam stays fail-soft', async () => {
    const state = defaultState()
    const host = new CustomPluginHost({
      sessionQuery: {} as never,
      state,
      statePath: () => 'custom-plugin-state.json',
      saveNow: async () => {},
      reportDiag: () => {},
      diagReports: [],
      readCredential: async () => { throw new Error('credentials unreadable') },
    })
    expect(await (host as unknown as { resolveApiKey: () => Promise<string> }).resolveApiKey()).toBe('')
  })
})
