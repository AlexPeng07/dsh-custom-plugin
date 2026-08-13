/**
 * Date helpers for the token-usage ledger.
 * @module @alexpeng/dsh-custom-plugin/usage
 */

/** Local-timezone day key `YYYY-MM-DD`. */
export function dayKey(time?: number): string {
  const d = time === undefined ? new Date() : new Date(time)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
