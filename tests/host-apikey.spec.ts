/**
 * Unit tests for the balance key resolution chain: panel state first, then
 * environment candidates, then the DSH credentials file seam.
 * @module @alexpeng/dsh-custom-plugin/tests/host-apikey
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { CustomPluginHost } from '../src/host-service.ts'
import { defaultState } from '../src/state.ts'
import type { CredentialStore } from '../src/system-credentials.ts'

class MemoryCredentialStore implements CredentialStore {
  readonly available = true
  value = ''
  async get(): Promise<string> { return this.value }
  async set(value: string): Promise<boolean> { this.value = value; return true }
  async clear(): Promise<boolean> { this.value = ''; return true }
}

function makeHost(options: { apiKey?: string, credential?: string, store?: CredentialStore } = {}): { host: CustomPluginHost, resolve: () => Promise<string>, store: CredentialStore } {
  const state = defaultState()
  state.apiKey = options.apiKey ?? ''
  const store = options.store ?? new MemoryCredentialStore()
  const host = new CustomPluginHost({
    sessionQuery: {} as never,
    state,
    statePath: () => 'custom-plugin-state.json',
    saveNow: async () => {},
    reportDiag: () => {},
    diagReports: [],
    readCredential: async () => options.credential ?? '',
    credentialStore: store,
  })
  return { host, resolve: () => (host as unknown as { resolveApiKey: () => Promise<string> }).resolveApiKey(), store }
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

  it('prefers the system credential and never exposes the key in the public state view', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'sk-env-ignored')
    const store = new MemoryCredentialStore()
    store.value = 'sk-system-value'
    const { host, resolve } = makeHost({ apiKey: 'sk-legacy-value', store })
    expect(await resolve()).toBe('sk-system-value')
    const view = await host.stateView()
    expect(view.apiKeyConfigured).toBe(true)
    expect(view.credentialStorage).toBe('system')
    expect((view as Record<string, unknown>).apiKey).toBeUndefined()
  })

  it('migrates a legacy state key into the system credential store', async () => {
    const store = new MemoryCredentialStore()
    const { host } = makeHost({ apiKey: 'sk-legacy-value', store })
    expect(await host.migrateLegacyApiKey()).toBe(true)
    expect(store.value).toBe('sk-legacy-value')
    expect((host as unknown as { state: { apiKey: string } }).state.apiKey).toBe('')
  })

  it('does not overwrite an existing system credential during legacy migration', async () => {
    const store = new MemoryCredentialStore()
    store.value = 'sk-system-value'
    const { host } = makeHost({ apiKey: 'sk-old-state-value', store })
    expect(await host.migrateLegacyApiKey()).toBe(true)
    expect(store.value).toBe('sk-system-value')
    expect((host as unknown as { state: { apiKey: string } }).state.apiKey).toBe('')
  })

  it('writes and clears the custom key through the system store', async () => {
    const store = new MemoryCredentialStore()
    const { host } = makeHost({ store })
    await host.applyEdit({ apiKey: 'sk-new-value' })
    expect(store.value).toBe('sk-new-value')
    expect((await host.credentialStatus()).credentialStorage).toBe('system')
    await host.applyEdit({ apiKey: '' })
    expect(store.value).toBe('')
    expect((await host.credentialStatus()).credentialStorage).toBe('none')
  })

  it('does not report success when the system credential cannot be cleared', async () => {
    const store: CredentialStore = {
      available: true,
      get: async () => 'sk-system-value',
      set: async () => true,
      clear: async () => false,
    }
    const { host } = makeHost({ apiKey: 'sk-legacy-value', store })
    await expect(host.applyEdit({ apiKey: '' })).rejects.toThrow('系统凭据清除失败')
    expect((host as unknown as { state: { apiKey: string } }).state.apiKey).toBe('sk-legacy-value')
    expect(await host.credentialStatus()).toMatchObject({ apiKeyConfigured: true, credentialStorage: 'system' })
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
      credentialStore: new MemoryCredentialStore(),
    })
    expect(await (host as unknown as { resolveApiKey: () => Promise<string> }).resolveApiKey()).toBe('')
  })
})
