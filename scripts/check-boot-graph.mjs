/**
 * Read the boot graph a RUNNING dsh shell serves, and check our bundle's place
 * in it against the manifest we ship.
 *
 * `dsh.client.inject` names modules the shell is expected to have already
 * loaded. When one of those names stops existing, dsh skips the whole bundle and
 * the plugin silently disappears — a repo-side gate cannot see it, because only
 * the running shell knows which module ids it serves. So this runs from
 * live-dsh-check.sh, against the HTML of a live profile.
 *
 * Usage: node scripts/check-boot-graph.mjs <package.json> <shell.html>
 * Prints `OK <claim>` / `BAD <claim>` lines plus `URL <combo path>` for our own
 * row; always exits 0 and leaves the verdict to the caller.
 */
import { readFileSync } from 'node:fs'

const [manifestPath, htmlPath] = process.argv.slice(2)
if (!manifestPath || !htmlPath) {
  console.log('BAD usage: node scripts/check-boot-graph.mjs <package.json> <shell.html>')
  process.exit(0)
}

const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
const html = readFileSync(htmlPath, 'utf8')
const client = pkg.dsh?.client ?? {}
const targets = client.inject ?? []

const match = html.match(/globalThis\["__DSH_BOOT__"\]\s*=\s*(\{.*?\})\s*<\/script>/s)
if (!match) {
  console.log('BAD served HTML carries no __DSH_BOOT__ graph (wrong page, or auth redirected)')
  process.exit(0)
}

let graph
try {
  graph = JSON.parse(match[1])
} catch {
  console.log('BAD __DSH_BOOT__ graph is not parseable JSON')
  process.exit(0)
}

const rows = graph.entries ?? []
console.log(`OK boot graph rev=${graph.rev ?? '?'} carries ${rows.length} module rows`)

const row = rows.find((r) => r.id === pkg.name)
if (!row) {
  console.log(`BAD ${pkg.name} has no row in the served boot graph — the host skipped the bundle`)
  process.exit(0)
}
console.log(`OK ${pkg.name} is served as ${row.url}`)
console.log(`URL ${row.url}`)

// A row can be present while its declared prerequisites are not: that is the
// exact shape of the 0.1.7 breakage, where the manifest still named a package
// the shell no longer ships.
const ids = new Set(rows.map((r) => r.id))
const missing = targets.filter((name) => !ids.has(name))
if (missing.length > 0) {
  console.log(`BAD dsh.client.inject names absent from the boot graph: ${missing.join(', ')}`)
} else if (targets.length === 0) {
  console.log('BAD dsh.client.inject is empty — nothing declares our slots\' host modules')
} else {
  console.log(`OK all ${targets.length} dsh.client.inject targets exist in the boot graph`)
}
