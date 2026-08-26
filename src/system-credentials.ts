/**
 * Optional OS credential-store adapter.
 *
 * `keytar` is optional so the plugin still works in minimal/headless
 * installations. When present, it delegates storage to the platform keyring
 * (Windows Credential Manager, macOS Keychain, or the Linux Secret Service
 * backend exposed by keytar). The caller owns the legacy state-file fallback.
 * @module @alexpeng/dsh-custom-plugin/system-credentials
 */

import { createRequire } from 'node:module'

export const CREDENTIAL_SERVICE = '@alexpeng/dsh-custom-plugin'
export const CREDENTIAL_ACCOUNT = 'deepseek-api-key'

export interface CredentialStore {
  readonly available: boolean
  get(): Promise<string>
  set(value: string): Promise<boolean>
  clear(): Promise<boolean>
}

interface KeytarLike {
  getPassword(service: string, account: string): Promise<string | null>
  setPassword(service: string, account: string, password: string): Promise<void>
  deletePassword(service: string, account: string): Promise<boolean>
}

function loadKeytar(): KeytarLike | null {
  try {
    const required = createRequire(import.meta.url)('keytar') as unknown
    const candidate = required !== null && typeof required === 'object' && 'default' in required
      ? (required as { default?: unknown }).default
      : required
    if (candidate === null || typeof candidate !== 'object') return null
    const module = candidate as Partial<KeytarLike>
    if (typeof module.getPassword !== 'function' || typeof module.setPassword !== 'function' || typeof module.deletePassword !== 'function') return null
    return module as KeytarLike
  } catch {
    return null
  }
}

/** Safe wrapper around the optional keytar dependency. */
export class SystemCredentialStore implements CredentialStore {
  private readonly keytar: KeytarLike | null = loadKeytar()

  get available(): boolean {
    return this.keytar !== null
  }

  async get(): Promise<string> {
    if (this.keytar === null) return ''
    try {
      return (await this.keytar.getPassword(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT) ?? '').trim()
    } catch {
      return ''
    }
  }

  async set(value: string): Promise<boolean> {
    if (this.keytar === null) return false
    try {
      await this.keytar.setPassword(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT, value)
      return true
    } catch {
      return false
    }
  }

  async clear(): Promise<boolean> {
    if (this.keytar === null) return false
    try {
      await this.keytar.deletePassword(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT)
      return true
    } catch {
      return false
    }
  }
}
