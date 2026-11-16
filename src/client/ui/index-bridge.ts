/**
 * Pure helpers for the settings-page index bridge.
 * @module @alexpeng/dsh-custom-plugin/client/ui/index-bridge
 */

/** De-duplicate host ids while preserving their order and dropping junk. */
export function uniqueIds(ids: readonly unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of ids) {
    if (typeof value !== 'string' || value === '') continue
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}
