/**
 * Unit tests for the balance route's network-failure handling: TLS-intercepting
 * proxies make the host's outbound call fail intermittently with an opaque
 * "fetch failed" (real reason in error.cause), so the envelope must carry a
 * message the user can act on — and keep keyConfigured so the pill reads as
 * "额度?" (retry-worthy) instead of flipping to the key-free estimate.
 * @module dsh-custom-plugin/tests/host-balance
 */

import { describe, expect, it, vi } from 'vitest'
import { CustomPluginHost, readableFetchError } from '../src/host-service.ts'
import { defaultState } from '../src/state.ts'
import type { CredentialStore } from '../src/system-credentials.ts'

class MemoryCredentialStore implements CredentialStore {
  readonly available = true
  value = 'sk-test'
  async get(): Promise<string> { return this.value }
  async set(value: string): Promise<boolean> { this.value = value; return true }
  async clear(): Promise<boolean> { this.value = ''; return true }
}

function makeHost(): CustomPluginHost {
  return new CustomPluginHost({
    sessionQuery: {} as never,
    state: defaultState(),
    statePath: () => 'custom-plugin-state.json',
    saveNow: async () => {},
    reportDiag: () => {},
    diagReports: [],
    readCredential: async () => '',
    credentialStore: new MemoryCredentialStore(),
  })
}

/** Node wraps connection-level failures in a TypeError "fetch failed" with
 * the real reason in `.cause` — reproduce that shape exactly. */
function fetchFailure(code: string): TypeError {
  return new TypeError('fetch failed', { cause: { code } })
}

describe('balance network failures', () => {
  it('translates a TLS-intercepting proxy into an actionable message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw fetchFailure('SELF_SIGNED_CERT_IN_CHAIN') }))
    const result = await makeHost().balanceGet()
    expect(result.ok).toBe(false)
    expect(result.keyConfigured).toBe(true)
    expect(result.error).toContain('TLS 证书校验失败')
    expect(result.error).toContain('api.deepseek.com')
  })

  it('keeps keyConfigured on a DNS failure instead of reading as "no key"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw fetchFailure('ENOTFOUND') }))
    const result = await makeHost().balanceGet()
    expect(result.ok).toBe(false)
    expect(result.keyConfigured).toBe(true)
    expect(result.error).toContain('DNS 解析失败')
  })

  it('keeps keyConfigured on a bare fetch failure with no cause code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const result = await makeHost().balanceGet()
    expect(result.ok).toBe(false)
    expect(result.keyConfigured).toBe(true)
    expect(result.error).toContain('网络请求失败')
  })

  it('reports an upstream auth failure as 认证失败', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))
    const result = await makeHost().balanceGet()
    expect(result.ok).toBe(false)
    expect(result.keyConfigured).toBe(true)
    expect(result.error).toContain('认证失败')
  })

  it('surfaces a successful balance payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '12.34', granted_balance: '1.00', topped_up_balance: '11.34' }],
    })))
    const result = await makeHost().balanceGet()
    expect(result.ok).toBe(true)
    expect(result.balance?.total).toBe('12.34')
  })

  it('maps bare fetch-failed and unknown causes readably', () => {
    expect(readableFetchError(new TypeError('fetch failed'))).toContain('网络请求失败')
    expect(readableFetchError(new TypeError('fetch failed', { cause: { code: 'ETIMEDOUT' } }))).toContain('ETIMEDOUT')
    expect(readableFetchError(new Error('boom'))).toBe('boom')
  })
})
