# dsh-custom-plugin

Standalone convenience suite for the DeepSeek Harness (DSH) Web GUI:
personalization (appearance, weather FX, glass), project folders, prompts,
conversation export, Mermaid rendering, quote reply, and DeepSeek balance /
daily token usage.

## Package rules

- The host half lives in `src/` and the browser half in `src/client/`;
  `src/protocol.ts` carries the JSON wire types shared by both sides.
- The browser half talks to the host through the `/api/custom-plugin` fetch
  routes; styles are injected through one owned style element
  (`src/client/styles.ts`) with plain CSS (no CSS Modules, no `:global`
  wrappers).
- UI copy is plain Chinese; there is no i18n registration.
- `src/dsh-home.ts`, `src/mount-once.ts`, `src/loopback.ts` are standalone
  utility modules kept in-tree so the package builds standalone.
- Background palettes and their dark-mode derivation live in
  `src/client/palette.ts` (`toDarkRamp`: keep hue, compress saturation ×0.55,
  drop lightness onto the dark ramp). Palettes are selectable in both themes —
  there is no dark-mode forcing back to default, and theme flips re-run the
  appearance painter (`s.dark` is in its effect deps).
- The Host state file is `$DSH_HOME/custom-plugin-state.json`. It is shared by
  every dsh host under that home — including dsh Desktop's separate profile —
  so an atomic replace there must name its temp file after the writing process
  (`tempPathFor`); a fixed temp name is a cross-process race, not just an
  in-process one.
- State-document invariants (all covered by `tests/state.spec.ts` /
  `tests/loader-entry.spec.ts` — keep them holding when touching
  `src/state.ts`, `src/index.ts`, `src/host-service.ts`):
  - `loadStateFile` distinguishes ENOENT (fresh install) from transient read
    errors (1.5s/3s/6s retry ladder) and corruption (rename aside as
    `.corrupt-<pid>` before adopting defaults). A syntactically valid document
    whose folders/stars fail the same shape gates the browser uses is treated
    as corruption too — it is quarantined before defaults, never adopted.
    Usage rows are normalized on load (`normalizeUsageMap`), so a hand-edited
    counter can never make a later fold concatenate a string. Only a document
    that can be neither read nor quarantined makes it reject, and the loader
    then flips the read-only gate (`stateWritable` funnels through
    `saveNow`/`saveSoon`) instead of ever persisting never-loaded defaults.
  - Every save stat-compares (mtime+size) against the last-seen baseline and
    three-way-merges an externally written document back in; the usage ledger
    unions per counter (`theirs + ours − base`). A whole-file overwrite on top
    of a foreign write is the bug this exists to prevent.
  - Browser edits are gated by `normalizeFolders` / `normalizeStars`
    (`src/state.ts`): reject the whole edit, never truncate — the client owns
    the full document. `credentialStatus` is a 5s-TTL cache invalidated by
    `applyEdit` and `migrateLegacyApiKey`; keep save responses truthful about
    the edit just applied. `applyEdit`/backup-import rollback keeps section
    references, never a deep clone of the 90-day usage ledger.
- The client's uninstall disposer must revert every page-global side effect
  (theme token overrides, `<html>` root classes, the liquid-glass SVG filter,
  anti-scroll's `scroll-behavior`/`data-vx-anti` attributes, in-place Mermaid
  wrappers, pending balance/load-retry/greeting timers); a new global effect
  added to the appearance painter or the chat-DOM scanner needs a matching
  line in the disposer at the bottom of `src/client/custom.tsx`. `saveCfg`
  refuses to POST until a state read has succeeded (`cfgLoaded`) — unloaded
  factory defaults must never reach the host.
- The client store fan-out stays a single listener set; per-turn hot paths
  (`TurnTailEntry`) and the FX canvas subscribe through `useSSelector` so an
  unrelated balance/toast write does not re-render every turn-tail row.
  `fetchTurns` must reuse unchanged items (`reuseTimelineItems`), skip the
  store write when nothing changed, pause while `document.hidden`, and never
  stack a second poll on an in-flight request. `HeaderBalance` also selects
  only its three fields (`balance`, today's usage row, `balanceOpen`) so a
  streaming turn cannot re-render the header or recompute the ledger; the
  always-mounted `MermaidInPlace`, `QuoteDock`, `QuoteButton` and `Toasts`
  components select only their own fields too. `OverlayRoot` selects the
  overlay/config/theme/session fields it renders, and each `FolderNode` selects
  only its add/pick/drop state. Components that render null most of the time
  must not subscribe to the whole store.
- Accessibility contracts: weather FX honors `prefers-reduced-motion` (no
  animation frame when reduced) and its decorative canvas carries
  `aria-hidden`; the 60 s balance poll pauses while `document.hidden` and
  refreshes on return; every overlay uses `useDialogFocus` for
  `role="dialog"` / `aria-modal`, focus entry, a Tab trap, Escape and focus
  restore; icon-only buttons need `aria-label`.
- The only agent-facing surface is the `custom_plugin_status` tool; the
  plugin never injects system-prompt announcements.

## Compatibility

- The runtime compatibility gate changed in dsh 0.2.1-alpha.4: it reads
  **`engines.dsh` first** and falls back to `peerDependencies` named
  `@deepseek-ai/dsh` or `@deepseek-ai/dsh-*` only when `engines.dsh` is absent,
  testing the range with
  `semver.satisfies(v, range, {includePrerelease: true})`. This package declares
  **one open lower bound, `>=0.1.7-rc.2`, in both places**: hosts before
  0.2.1-alpha.4 read the peers, later hosts read `engines.dsh`, and every release
  above the floor is admitted on purpose. The gate is binary — refusing an
  unmeasured version makes its users wait for a plugin release — so the product
  decision is to admit first and detect breakage automatically. Measured versions
  are evidence in README/CHANGELOG, never a gate. The build-and-test cohort moved
  to 0.2.1-rc.5 on 2026-10-30; the 11-entry client seed table is unchanged, and
  the published 0.9.3 artifact was re-verified on rc.4/rc.5 (canary) and on a
  live Desktop rc.5 host (desktop-shape probe 11 / 0). `pnpm smoke` asserts the
  floor (`0.1.7-rc.1` refused), the open upper bound (`99.0.0` admitted), that the
  installed build target satisfies the range, that `engines.dsh` and the peer
  range agree across the release history, and that every `@deepseek-ai/dsh-*`
  devDependency is one exact cohort; `tests/manifest.spec.ts` pins the
  admitted/refused list.
- Do not reintroduce an upper bound to express "not measured yet". The scheduled
  `.github/workflows/compat-canary.yml` (daily, newest of npm `latest`/`next`)
  installs the published plugin into a scratch profile, boots it, and runs
  `scripts/live-dsh-check.sh`; it opens an issue on failure. Fixes ship in the
  next release; users are not blocked in the meantime.
- dsh Desktop is an Electron shell around the same Web half. It pins the shell
  and `@deepseek-ai/dsh` to one version (0.2.1-rc.5 as of 2026-10-29), owns
  `$DSH_HOME/profiles/desktop`, and only the `dsh` command shipped with Desktop
  may manage that profile. Since 0.2.1-alpha.1 Desktop asks the OS for its port
  instead of defaulting to a fixed one, so nothing here may hardcode a port or a
  profile name. The authority on which dsh version a given install runs is that
  install's `resources/app.asar/dsh/desktop-runtime.json` — not the repository;
  `scripts/desktop-runtime.mjs` reads it, mirrors the `engines.dsh`-first gate,
  and reports whether the declared range admits it.
- The desktop renderer runs at `dsh-app://app` and the shell forwards its
  requests to its own Host after deleting `host`, `origin`, `sec-fetch-site` and
  `cookie`, so the route guard accepts the unmarked loopback shape — its
  semantics mirror the platform fence (`loopback.ts`: loopback socket + loopback
  Host, non-`cross-site`, Origin absent or matching; absent markers are
  trusted). A foreign Origin or a cross-site marker stays 403. The WebSocket
  upgrade path rewrites `Origin` to the Host authority instead.
  `scripts/desktop-shape-probe.mjs` verifies every route against a running
  Desktop Host in exactly that header shape. `dsh.client.platform` has exactly
  one accepted value, `'web'` — any other value makes `dsh-client-modules` drop
  the row, and desktop reuses the web shell, so the declaration stays `'web'`.
- The served client bundle is larger than `lib/client.js`: dsh's composite
  `/plugins/??…` route concatenates modules and rewrites the
  `sourceMappingURL`. Byte-identity checks compare the installed file, never the
  HTTP response.
- The Mermaid engine is loaded locally first; the CDN fallback version comes
  from the installed `mermaid/package.json` (never hardcode a version), the
  local file is read asynchronously, and byte counts are UTF-8 lengths. The
  script route revalidates with an `ETag` + `Cache-Control: no-cache` (304 on a
  matching `If-None-Match`) so a page reload does not re-transfer ~3.5 MB.
  A failed in-place render stores only `mermaidCodeKey(code)` in the DOM, and
  engine recovery clears those markers and triggers a rescan.
- Mermaid rendering lives in `src/client/mermaid-render.ts` (dependency-free;
  `scripts/smoke.mjs` transpiles it into the headless page). Keep
  `suppressErrorRendering: true` and the `finally` scratch cleanup: Mermaid
  appends `div#d<id>` to `<body>` before a rejected render throws, so a
  catch-only caller leaves its error card behind. `pnpm smoke` drives the real
  engine against valid and invalid blocks (no `body > div#dvx-mmd-*`, no
  "Syntax error" text), sweeps a legacy card, and checks the missing-engine
  path; `tests/mermaid-render.spec.ts` covers the cleanup at unit level.
- In-place scanning lives in `src/client/mermaid-scan.ts`; keep the wrapper /
  toggle / restore behaviour and the 400 ms body observer. `pnpm bench:mermaid`
  builds a synthetic long turn in headless Edge: at 1000 blocks the warm scan
  p95 is ~2.8 ms, while real Mermaid rendering is ~10 ms/diagram. Scan narrowing
  is not worth the complexity; viewport laziness only pays off for turns with
  many diagrams, so measure before changing either.
- The client bundle resolves its modules against the web shell's frozen seed
  table; `tsdown.config.ts` `PLATFORM_MODULES` mirrors it (0.2.1 added `zod` and
  `@tanstack/react-virtual` to the table), and any extra runtime `require()`
  needs a `dsh.client.external` declaration. `pnpm smoke` now cross-checks this
  statically (bundle `require()` literals ⊆ PLATFORM_MODULES) and fails on a
  stale `lib/client.js`, so drift cannot ship silently; CI runs the full smoke
  including the headless-Chromium registration handshake.
- Slot-prop data shapes are declared locally (`src/client/custom.tsx`) rather
  than imported from harness controller packages, which rename between releases.
  Only `SnapshotSelectorHook` comes from the slot SDK.
- Anything the client can only learn from a session-scoped slot (the viewed
  session id) must not assume the list snapshot carries selection: dsh moved view
  selection to `ctx.uiWorkspace`.

- Run before committing:
  `pnpm check:readme`
  `pnpm typecheck`
  `pnpm test`
  `pnpm build`
  `pnpm smoke`
  CI runs all of these (`check:readme` first), so a stale README hash or a
  failed build breaks the branch even if the local list was skipped.
  Use pnpm 11.28.5 (`packageManager` pins it) — pnpm 11.7's lockfile policy
  check ignores `minimumReleaseAgeExclude`, so a same-day `@deepseek-ai/dsh-*`
  cohort turns every script red even though the install and the committed
  exemptions are correct.
- Git identity: the GitHub account blocks pushes that expose the real email,
  so commits must use the noreply address — repo-local `git config
  user.email` is already `309235349+AlexPeng07@users.noreply.github.com`;
  don't override it with the global outlook.com one.
