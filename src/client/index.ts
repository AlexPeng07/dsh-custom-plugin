/**
 * Browser-half entry for dsh-custom-plugin.
 *
 * Mounts the Custom UI surfaces (overlay, timeline, folders, prompts,
 * balance, quote reply) through eight injections into seven official slots.
 * The slots ledger is
 * the only coupling point: the declarations are provided by the web shell
 * itself, so this plugin needs no family-side integration to work. All
 * surfaces ship plain Chinese copy, with no i18n registration and no polling
 * additions.
 * @module @alexpeng/dsh-custom-plugin/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { installCustomPlugin } from './custom.tsx'
import { apiDiagReport } from './api.ts'

/**
 * Required services. Deliberately empty: the mount waits on `slots` inside
 * `apply` (a child fiber) instead of declaring it here, so this entry can
 * never sit "pending (waiting for services)" — a top-level fiber that waits
 * on a service name the client runtime never provides would block the whole
 * web boot behind the "Loading plugins…" gate forever.
 */
export const inject = []

/**
 * Mount the Custom suite once the slots service is available.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    // The slots provider (client-ui-layout) may activate after this entry on
    // newer dsh builds — a synchronous `ctx.get('slots')` here would lose
    // that race and silently skip every surface. `ctx.inject` re-runs the
    // mount whenever the service (re)appears, while staying fail-soft: if the
    // service never shows up, the GUI boots without this plugin's surfaces.
    ctx.inject(['slots'], (slotCtx) => {
      try {
        return installCustomPlugin(slotCtx, apiDiagReport)
      } catch (error) {
        // Fail soft: a broken plugin must degrade to a diagnostic line, never
        // fail its fiber (which would take the entire GUI boot down with it).
        const message = `install failed: ${String((error as Error)?.message ?? error)}`
        console.error(`[custom-plugin] ${message}`)
        apiDiagReport(message)
        return () => {}
      }
    })
    return () => {}
  }, 'custom-plugin: surfaces')
}
