/**
 * DSH credential refs reader for dsh-custom-plugin.
 *
 * DSH keeps model API keys in `$DSH_HOME/.credentials.yaml` as a flat
 * `refs:` block (`DEEPSEEK_API_KEY: sk-...`) and injects them per outgoing
 * request — they are NOT exported to the process environment. The balance
 * panel therefore reads the same file so a key configured once in DSH is
 * picked up automatically instead of requiring a second paste in the plugin.
 * @module @alexpeng/dsh-custom-plugin/credentials
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHome } from './dsh-home.ts'

/** File name of the DSH credential refs document. */
export const CREDENTIALS_FILE = '.credentials.yaml'

/** Environment/ref keys that may hold the DeepSeek balance credential. */
export const DEEPSEEK_REF_KEYS = ['DEEPSEEK_API_KEY', 'DEEPSEEK_KEY', 'DEEPSEEK_TOKEN'] as const

/** Parse the `refs:` block of DSH's credentials YAML (flat `NAME: value`). */
export function parseCredentialsRefs(text: string): Record<string, string> {
  const refs: Record<string, string> = {}
  let inRefs = false
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd()
    if (inRefs) {
      // A top-level key (no indentation) ends the refs block; comments and
      // blank lines are skipped inside it.
      if (line === '' || line.startsWith('#')) continue
      if (!/^\s/.test(line)) {
        inRefs = false
        continue
      }
      const match = /^\s*([A-Za-z_][A-Za-z0-9_-]*):\s*(.*?)\s*$/.exec(line)
      if (match !== null) {
        const value = match[2].replace(/^['"]|['"]$/g, '').trim()
        if (value !== '') refs[match[1]] = value
      }
      continue
    }
    if (/^refs:\s*$/.test(line)) inRefs = true
  }
  return refs
}

/** Read the DeepSeek credential from DSH's credentials file ('' when absent). */
export async function readDeepSeekCredential(home: string = dshHome()): Promise<string> {
  try {
    const text = await readFile(join(home, CREDENTIALS_FILE), 'utf8')
    const refs = parseCredentialsRefs(text)
    for (const name of DEEPSEEK_REF_KEYS) {
      const value = (refs[name] ?? '').trim()
      if (value !== '') return value
    }
  } catch {
    // file missing or unreadable — no credential
  }
  return ''
}
