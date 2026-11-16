/**
 * Unit tests for the account-only balance envelope: the host reuses the same
 * recharge + bonus wallet query Settings → 账号与余额 renders, and must report
 * signed-out / pending / failed separately so the card can show the right hint
 * instead of a generic failure or a stale API-key error.
 * @module dsh-custom-plugin/tests/host-balance
 */

import { describe, expect, it } from 'vitest'
import { balanceFromAccountWallets, CustomPluginHost } from '../src/host-service.ts'
import type { AccountBalanceOutcome } from '../src/host-service.ts'
import { defaultState } from '../src/state.ts'

const LINKS = { usageUrl: 'https://platform.deepseek.com/usage', topUpUrl: 'https://platform.deepseek.com/top_up' }

function makeHost(accountBalance?: () => Promise<AccountBalanceOutcome | undefined>): CustomPluginHost {
  return new CustomPluginHost({
    sessionQuery: {} as never,
    state: defaultState(),
    statePath: () => 'custom-plugin-state.json',
    saveNow: async () => {},
    reportDiag: () => {},
    diagReports: [],
    readCredential: async () => '',
    credentialStore: { available: false, get: async () => '', set: async () => false, clear: async () => false },
    accountBalance,
  })
}

describe('account balance', () => {
  it('maps the ready wallets and forwards the platform links', async () => {
    const result = await makeHost(async () => ({
      status: 'ready',
      value: [{ currency: 'CNY', balance: '10.00' }],
      bonusWallets: [{ currency: 'CNY', balance: '2.50' }],
      links: LINKS,
    })).balanceGet()
    expect(result.ok).toBe(true)
    expect(result.source).toBe('account')
    expect(result.balance).toEqual({ currency: 'CNY', total: '12.50', granted: '2.50', toppedUp: '10.00' })
    expect(result.links).toEqual(LINKS)
  })

  it('reports a signed-out account with the platform links', async () => {
    const result = await makeHost(async () => ({ status: 'signed-out', links: LINKS })).balanceGet()
    expect(result.ok).toBe(false)
    expect(result.accountSignedOut).toBe(true)
    expect(result.links).toEqual(LINKS)
    expect(result.error).toContain('未登录')
  })

  it('reports a settling account as pending instead of an error', async () => {
    const result = await makeHost(async () => ({ status: 'pending', links: LINKS })).balanceGet()
    expect(result.ok).toBe(false)
    expect(result.accountPending).toBe(true)
    expect(result.accountSignedOut).not.toBe(true)
  })

  it('reports a failed wallet query', async () => {
    const result = await makeHost(async () => ({ status: 'failed', links: LINKS })).balanceGet()
    expect(result.ok).toBe(false)
    expect(result.accountError).toBe('账号余额读取失败')
  })

  it('reports an absent account service instead of inventing a balance', async () => {
    const result = await makeHost().balanceGet()
    expect(result.ok).toBe(false)
    expect(result.accountUnavailable).toBe(true)
    expect(result.balance).toBeUndefined()
  })
})

describe('account wallet mapping', () => {
  it('sums recharge and bonus wallets into the card shape', () => {
    expect(balanceFromAccountWallets(
      [{ currency: 'CNY', balance: '10.10' }],
      [{ currency: 'CNY', balance: '2.25' }],
    )).toEqual({ currency: 'CNY', total: '12.35', granted: '2.25', toppedUp: '10.10' })
  })

  it('prefers CNY and ignores wallets in the other currency', () => {
    expect(balanceFromAccountWallets(
      [{ currency: 'USD', balance: '3.00' }],
      [{ currency: 'CNY', balance: '1.23' }, { currency: 'USD', balance: '4.00' }],
    )).toEqual({ currency: 'CNY', total: '1.23', granted: '1.23', toppedUp: '0.00' })
  })

  it('returns null when there is no usable wallet', () => {
    expect(balanceFromAccountWallets([], [])).toBeNull()
    expect(balanceFromAccountWallets([{ currency: 'EUR', balance: '1' }], [])).toBeNull()
  })
})
