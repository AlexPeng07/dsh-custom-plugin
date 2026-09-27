# Changelog

All notable changes to this project are documented here. The format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
follow [Semantic Versioning](https://semver.org/).

## 0.5.0 — 2026-09-28

### Changed

- **Target dsh 0.1.7-rc.2.** All `@deepseek-ai/dsh-*` dependencies, the
  `@deepseek-ai/dsh-tools` peer range, and `@deepseek-ai/cordis` moved to the
  versions that release ships, and `engines.dsh` now states the supported range.
  dsh checks a bundle's `@deepseek-ai/dsh-*` peer ranges against its own runtime
  version at install and startup and skips a bundle that does not match, so the
  declared range is the release this package was built and verified against.
- The browser half declares `dsh.client.inject` as the five packages that own
  the slots it registers into, replacing the retired
  `@deepseek-ai/dsh-client-runtime` row.
- Slot-provided data shapes (`SessionListState`, `WorkspaceListState`,
  `TurnLocation`) are now declared locally instead of imported from harness
  controller packages that rename across releases; only `SnapshotSelectorHook`
  still comes from the slot SDK.
- In-session search uses dsh's event index when the deployment opens one and
  otherwise scans the session log it already read, reporting which path answered
  in the panel. dsh's shipped `web` profile configures the index with
  `openAt: never`, so the indexed route was unavailable on a default install.
- Plugin Manager cards, bundle details, and the settings inventory now show a
  real name and icon: `locale/en.json`, `locale/zh.json`, and `icon.svg`.

### Fixed

- **The timeline rail, export, and quote features lost the current session on
  dsh 0.1.7.** The session list snapshot dropped its `current` field (view
  selection moved to the Workspace browser), so the rail tracked nothing. The
  viewed session now comes from the standard `sessionId` prop every
  session-scoped slot entry receives.
- **Opening a session, a workspace, a branch, or a cross-session search failed
  silently.** `ctx.sessions` no longer exposes `open`, `fork`, or `search`;
  navigation goes through `ctx.uiWorkspace`, and branching and full-text search
  through `ctx.remote.session.fork()` / `.search()`, each with an honest
  failure message when the service is absent.
- **Exports lost tool results and the new model-visible messages.** The
  `tool-result` content block was replaced by a tool-role message whose call id
  now sits on the message (`toolCallId`, still falling back to `source.callId`
  for older logs); `system/message` and `developer/message` are exported as
  injected context; and `file`, `tool-addition`, `tool-removal`, and offloaded
  `image` blocks are named instead of dropped.
- `conversation.chat.turnTail` changed from a chain slot to a list slot, so its
  `select` registration option no longer applies and was replaced by an id and
  order.
- Client diagnostics are throttled per message kind. The previous single shared
  window let the frequently emitted rail line swallow the one-shot timeline
  result line, which made a successful timeline fetch look like zero turns.
- `pnpm smoke` now checks the manifest fields dsh reads before it activates a
  bundle (client platform and `./client` export, patch path, icon size, locale
  display metadata, and peer ranges agreeing with the build target), so an
  unsupported or stale declaration fails the local gate instead of being skipped
  silently in a user's profile. The peer check refuses to read a range form it
  cannot interpret, and every `files` entry must resolve to something in the tree
  — an entry matching nothing used to publish a bundle missing that piece. Both
  new rules were confirmed red by breaking them on purpose.
- A search excerpt now extends its window so a pasted query longer than two
  thirds of the excerpt is still shown whole. Measured first: the previous
  centering already covered ordinary queries, including a hit at the very end of
  a long message, so only the long-query case was affected — the fix is narrow,
  and the added test fails against the old formula.
- Exports no longer fail outright on a `tool/result` event whose `message` is
  absent, and the scan fallback reads each event shape through its own typed
  case instead of a cast that hid real field drift.
- When cross-session full-text search is unavailable, the palette says what still
  works (title matching over sessions and workspaces) instead of showing a bare
  error.
- Added `scripts/live-dsh-check.sh`: a manual probe that runs against a *running*
  isolated dsh profile and exercises the host half on real session data
  (timeline, the three export formats, the search scan path, usage scan, backup,
  a UTF-8 state round trip, and the loopback/same-origin fence), exiting
  non-zero on any failure. CI has no harness to talk to, so this is the check to
  run when a dsh release lands. Verified against 0.1.7-rc.2 (11 probes), and the
  UTF-8 probe was shown to distinguish a correct write from the mangled-bytes
  write it guards against.
- The READMEs add a plugin-to-dsh compatibility table, since the peer gate makes
  a mismatched pair fail invisibly rather than loudly.

## 0.4.2 — 2026-09-12

### Fixed

- **Exports fail on forked/resumed sessions with "读取会话失败: seeded
  session constructor seed must equal its inherited prefix".** Newer dsh
  builds replay-validate inside `sessionQuery.readSession()` through a
  snapshot-mode constructor that rejects any seeded (forked or resumed) session
  whose log outgrew its seed boundary, so timeline, export, in-session
  search, and usage scans all failed on those sessions. Every read now goes
  through a shared helper that falls back to `observeSession()` (the live and
  restore paths dsh's own session page uses) when `readSession()` rejects, and
  surfaces the original error only when no fallback exists.
- **The "PDF（含图片）" export button produced an `.html` file.** The button and
  its description now say what actually lands on disk: "HTML（含图片）", a
  print-ready HTML document you turn into a PDF via the browser print dialog.
- **Weather FX are invisible on light backgrounds.** Snow, rain, and sakura
  colors were tuned for the dark theme only — pure-white flakes, 6%-alpha pale
  rain, and 90%-lightness pink petals all vanish over the near-white palette
  backgrounds. The FX canvas now picks a darker particle palette (cool slate
  snow, steel-blue rain, deeper rose petals, each with a lifted alpha floor)
  whenever the resolved theme is light or the saturated aurora background is
  active, and swaps palettes live on theme/background changes without
  rebuilding the particle field.

## 0.4.1 — 2026-09-09

### Fixed

- **Fresh installs show nothing after a "successful" install.** `keytar` (a
  native optional dependency) tripped pnpm 11's strict build-script gate, so
  `dsh plugin add` exited non-zero and the harness never reconciled the bundle
  layer — the package sat inert in `dependencies` with no host half and no
  browser half. `keytar` is no longer a dependency: the OS-keyring adapter
  still detects a `keytar` module present in the profile's `node_modules`, and
  users who want the OS keyring can add it themselves
  (`dsh plugin --profile web add keytar`).
- The browser half now waits for the `slots` service (a child fiber) before
  mounting its surfaces instead of reading it synchronously: newer dsh builds
  activate the slots provider after this plugin's entry, and the synchronous
  read lost that race every time, logging "slots service unavailable" and
  skipping all UI. The mount stays fail-soft — the GUI boots even when the
  service never appears.

## 0.4.0 — 2026-09-03

### Added

- 7 / 30 / 90-day usage trends, per-model summaries, CSV export, and local monthly CNY budget warnings.
- Versioned, secret-free state backup with previewed merge/replace import and automatic recovery copies.
- Editable, tagged, sortable favorite prompts with usage recency, `{{variable}}` templates, and JSON / Markdown portability.
- Indexed current-session search and a Ctrl/Cmd+K command palette backed by DSH's official search APIs.

### Changed

- Batch archive skips running sessions and reports separate success and failure counts.
- Existing prompt and config documents are normalized for the new optional fields.

### Fixed

- State-dependent routes now wait for the initial local state load; usage events
  arriving during an import, edit, or usage scan are queued and persisted instead
  of racing a stale snapshot.
- Backup imports reject malformed counters/configuration, honor imported folder
  parents and sibling order, and keep the 5 MiB document boundary distinct from
  the JSON request envelope.
- Search hits carry their session id and archive batches retain per-item errors;
  stale cross-session clicks and swallowed archive failures now surface clearly.
- Malformed persisted peak counters, invalid calendar buckets, failed usage
  rebuilds, and partial state edits are handled without presenting or keeping
  a misleading snapshot; backup requests now validate their envelope fields.

### Security

- Backups exclude API keys and credential metadata; imports preserve the active credential.
- Archive restore remains deferred until DSH exposes an official API.

## 0.1.6 — 2026-09-02

### Fixed

- Usage scans now preserve the live ledger when a session read fails or new
  usage arrives during replay, and return the replayed Beijing day so a
  midnight-crossing scan cannot relabel its result.
- Legacy API-key migration no longer overwrites an existing system credential;
  failed system-key deletion is reported instead of being treated as success.
- Legacy usage rows without a recoverable peak/off-peak split are marked as
  inexact and are no longer shown with a misleading cost estimate.
- DeepSeek peak/off-peak cost estimates now treat only Beijing Monday-Friday
  09:00–12:00 / 14:00–18:00 as peak; weekends are off-peak.
- The browser usage panel now uses the same Beijing-time day bucket as the
  Host, including when the desktop host runs outside UTC+8.
- Client state snapshots are serialized in invocation order so rapid settings
  changes cannot be overwritten by an older save completing later.
- Timeline refreshes ignore stale session/request responses and follow live
  conversation running-state changes.
- Mermaid modal changes reload correctly, while concurrent CDN loads share one
  in-flight request; the balance hover panel also remains reachable across its
  trigger gap.

### Changed

- Centralized the cost formula, added explicit `deepseek-v4-flash-vision-exp`
  pricing, and covered the rule with unit tests.
- Usage history is pruned to 90 Beijing calendar days; usage scans use four
  concurrent reads and share one in-flight scan instead of duplicating work.
- The balance panel now shows the peak/off-peak token and cost split, pricing
  source link, and the built-in rule check date.
- Saved panel keys prefer the optional OS credential store, migrate legacy
  state-file keys when possible, and no longer cross the browser state boundary.
- Light/dark root theme styles now take precedence over the host OS preference,
  and the build uses the current tsdown dependency configuration without
  deprecation warnings.

### Added

- Regression coverage for ordered state saves and shared in-flight Mermaid
  loading.

## 0.1.3 — 2026-08-23

### Fixed

- Concurrent state saves are serialized per state file: two racing saves could
  collide on the shared `.tmp` file and fail the rename on Windows; a failed
  debounced save now surfaces in the status-tool diagnostics instead of being
  swallowed silently.

### Added

- CI: bilingual README hash consistency check (`node scripts/check-readme-i18n.mjs`)
  — editing one language without the other, or forgetting to re-record the
  hashes in `README.i18n.yaml`, now fails the build instead of drifting silently.
- CI: Dependabot with monthly schedules (GitHub Actions and grouped npm
  minor/patch bumps); workflow actions upgraded to current majors.
- `pnpm smoke` — post-build smoke script: headless Edge loads `lib/client.js`
  against a stubbed module loader and asserts the registration handshake, plus
  artifact contract checks (loader banner/footer, node-half ESM import,
  patch row, local Mermaid engine).
- Tests: the balance key resolution chain (panel → environment → DSH
  credentials, via a new credential-reader seam), state merge edge cases, and
  concurrent-save serialization.
- Docs: the security section now states explicitly that the panel-pasted key
  is stored in plaintext in the state file (same trust domain as DSH's own
  credentials).
- This changelog (also shipped in the npm tarball).

## 0.1.2 — 2026-08-23

### Fixed

- **Mermaid diagrams in assistant replies now render in place.** The rendering
  entry previously hooked only user messages, so assistant-generated diagrams —
  mindmaps in particular — never got an entry point. A `MutationObserver` now
  scans GUI code blocks and renders ```mermaid``` fences where they are
  (`MermaidInPlace`), without moving any React-owned nodes.

### Changed

- Mermaid engine is a local runtime dependency served by the host; the CDN
  mirrors are a fallback only. The source (`local` / `cdn`) is visible in the
  status tool diagnostics.

### Added (repository-side)

- GitHub Actions CI (Node 22 + pnpm 11: typecheck / test / build), README
  badges, and a bilingual screenshot gallery under `docs/`.

## 0.1.1 — 2026-08-22

### Security

- Mermaid rendering hardened: `securityLevel: strict` (was `loose`), and the
  `/custom-plugin/mermaid.js` engine route is behind the same loopback trust
  fence as every other route.

### Fixed

- Peak/off-peak pricing and daily usage buckets are computed in Beijing time
  (UTC+8) regardless of the host machine's timezone; tests are
  timezone-independent.

### Changed

- `@deepseek-ai/dsh-tools` moved to `peerDependencies` and externalized from
  the bundle — `lib/index.js` shrinks from ~245 KB to ~45 KB and shares the
  harness instance at runtime.
- Dead code removed: unused `afterSeq` incremental timeline protocol and cache,
  unused type re-exports, dead client state fields, unconditional startup log.

### Added

- Self-contained `prepare` script — GitHub source installs build themselves
  (pnpm ≥ 10 users: allowlist the build script, see README).
- Package metadata: `repository`, `author`, `bugs`, `homepage`,
  `engines` (Node ≥ 22); LICENSE copyright line filled in.

## 0.1.0 — 2026-08-22

Initial release: a personalization suite for the DSH web GUI, mounted through
the official profile mechanism without touching DSH source.

- Appearance: background palettes, liquid glass, weather effects
  (rain / sakura / snow).
- Per-user-message timeline rail with stars and branching.
- Multi-level project folders; prompt library.
- Conversation export (JSON / Markdown / PDF with images).
- Mermaid rendering; quote reply.
- DeepSeek balance and daily token usage (peak/off-peak aware).
- `custom_plugin_status` agent-facing diagnostic tool.
