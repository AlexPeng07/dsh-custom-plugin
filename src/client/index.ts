/**
 * Browser-half entry for dsh-custom-plugin.
 *
 * Mounts the Custom UI surfaces (overlay, timeline, folders, prompts,
 * balance, quote reply) through the nine slot injections. The slots ledger is
 * the only coupling point: the declarations are provided by the web shell
 * itself, so this plugin needs no family-side integration to work. All
 * surfaces ship plain Chinese copy, with no i18n registration and no polling
 * additions.
 * @module @alexpeng/dsh-custom-plugin/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { installCustomPlugin } from './custom.tsx'
import { apiDiagReport } from './api.ts'

/**
 * Required services. Deliberately empty: every surface is looked up lazily
 * (with a graceful no-op fallback), so this plugin can never sit "pending
 * (waiting for services)" — a fiber that waits on a service name the client
 * runtime never provides would block the whole web boot behind the
 * "Loading plugins…" gate forever.
 */
export const inject = []

/**
 * Mount the Custom suite.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    try {
      return installCustomPlugin(ctx, apiDiagReport)
    } catch (error) {
      // Fail soft: a broken plugin must degrade to a diagnostic line, never
      // fail its fiber (which would take the entire GUI boot down with it).
      const message = `install failed: ${String((error as Error)?.message ?? error)}`
      console.error(`[custom-plugin] ${message}`)
      apiDiagReport(message)
      return () => {}
    }
  }, 'custom-plugin: surfaces')
}
