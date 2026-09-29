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
  version at install and startup and skips a bundle that does not match. The
  declared floor is the release this package was built and verified against;
  `^0.1.7-rc.2` additionally admits later 0.1.x releases that have not been
  re-verified, and `engines.dsh` is declarative — no part of dsh reads it.
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

- **The timeline rail, export, and quote features lost the current session.**
  The session list snapshot has had no `current` field since dsh
  0.1.6-alpha.2 (view selection moved to the Workspace browser), so the rail
  tracked nothing. The viewed session now comes from the standard `sessionId`
  prop every session-scoped slot entry receives.
- **Opening a session or a workspace failed silently.** `ctx.sessions.open` is
  gone; navigation goes through `ctx.uiWorkspace.openSession()` /
  `connectWorkspace()`. Branching and full-text search go through
  `ctx.remote.session.fork()` / `.search()` — `ctx.sessions` still declares
  those two, but the remote namespace is the documented surface — each with an
  honest failure message when the service is absent.
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
  new rules were confirmed red by breaking them on purpose. The
  `dsh.client.inject` rows are counted, not resolved: only a running shell knows
  which module ids it serves, so a retired name there is caught by the live
  boot-graph probe below, not by this gate.
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
  a UTF-8 state round trip, the Mermaid engine route, the client→host diagnostic
  ring, both fences, and the boot graph the shell serves), exiting non-zero on
  any failure. CI has no harness to talk to, so this is the check to run when a
  dsh release lands. Verified against 0.1.7-rc.2 with 19 probes green; the
  session-dependent ones `SKIP` — and the closing line counts them instead of
  claiming a clean sweep — when the scratch home holds no session, and the UTF-8
  probe was shown to distinguish a correct write from the mangled-bytes write it
  guards against.
- The live check itself was then tested against a dead endpoint and found two of
  its own probes green-by-absence; the restore probe now refuses to pass when the
  append it restores never landed. Running it against a real profile exposed five
  more defects in the tool, all fixed: restoring the prompt library through
  `curl -d "$var"` mangled non-ASCII to U+FFFD (Git Bash re-encodes non-ASCII
  argv for `curl.exe`), so bodies are now written by node and sent with
  `--data-binary @file`; the script checked out with CRLF endings (the stored
  blobs were already LF — `core.autocrlf` was rewriting them on checkout, now
  pinned by `.gitattributes`); its search probe read the query word with a greedy
  `sed` that needed *some* six-letter run anywhere after the last `"text":"`, so
  it silently `SKIP`ped the one probe covering the scan path; it looked for
  sessions under `<state file>/../sessions`, which only finds anything because
  Windows folds the path lexically and would see nothing on a POSIX shell; and
  the real-home guard missed a `DSH_HOME` written with a trailing separator,
  which is exactly the spelling that would have probed a developer's own harness
  home.
- The READMEs add a plugin-to-dsh compatibility table. A mismatched pair is not
  silent — dsh logs `disabling profile plugin …` on stderr, rejects the install,
  and models the state as `incompatible` in the plugin manager — but none of that
  reaches the page a user is looking at, so the supported window belongs in the
  README.

### Verified by independent review

Four reviewers were dispatched against `30e025b..HEAD` with separate charters
(code correctness, claims-vs-evidence, contract-vs-installed-runtime, and a
deep re-audit pinned to the previous commit). Their findings were each
re-verified before being acted on; three of their "critical" items were
refuted by measurement and are recorded below so nobody re-litigates them.

- Fixed: `package.json` declared `"icon"` twice. `JSON.parse` keeps the last
  value, so every gate stayed green on a manifest npm would warn about. `pnpm
  smoke` now counts top-level keys in the file text and compares them with what
  survived parsing, and separately checks that `engines.dsh`'s floor names the
  installed dsh-tools release (nothing in dsh reads `engines.dsh`, so this is
  the only place that keeps it honest).
- Fixed: the session probes looked under `<state file>/../sessions`, which only
  resolves because Windows folds the path lexically; they now use the home
  directory directly. Skips are counted and named in the closing line, a missing
  boot-graph URL line fails instead of vanishing, the Mermaid probe reads
  `mermaidSource` rather than inferring "local" from a byte count, and a
  rejected state write now carries the host's own error text.
- Fixed: the restore probe was vacuously green — it never checked that the
  append it restores had landed. It now refuses to pass when the write failed,
  verified by mutating the write condition and watching exactly that line go
  red.
- Fixed: the client's last-holder clear left `turns` and the rail positions
  behind with no session identity, and a holder whose `sessionId` prop flipped to
  null could wipe the identity other holders were still rendering. A null holder
  now claims nothing at all.
- Fixed: `slots.inject`'s callback registered the component outside the
  surrounding `try`, so a rejected registration would take a surface down
  silently while the diagnostic ring still read green; the deferred `register`
  has its own guard now, and the summary line reports how many injection
  requests it actually submitted rather than asserting "8 / 7" — dsh defers the
  callback until a slot is declared, so no line printed at install time can
  claim a surface materialized; the per-slot `ok` / `register` lines do that.
- Fixed: the search request was passed as `as never`, which hid that `values`
  must be `keyof SessionEventMap` rather than `string`; typed, the compiler
  caught it immediately. A synchronous throw from `searchEvents` now degrades to
  the scan path like a rejection does, a log with exactly 100 hits no longer
  claims there are more, and the scan's role filter is exercised by a fixture
  that only it can exclude. Each of the three is pinned by a test that fails
  against the code it replaces (verified by reverting one at a time).
- Fixed: the sidebar footer button ignored the `wide` prop the host supplies, so
  its label wrapped into a vertical stack inside the 56px rail — measured both
  ways on a live profile: 36px icon-only when collapsed, "项目" again at 280px.
- Added `scripts/check-boot-graph.mjs`, run by the live check: the served
  `__DSH_BOOT__` graph must contain our row, every `dsh.client.inject` target,
  and reachable client bytes. This is the only gate that can see the failure
  shape that started this whole upgrade — a manifest naming a module the shell no
  longer serves — and it was confirmed red by pointing the inject list at the
  retired `@deepseek-ai/dsh-client-runtime`.
- Measured against dsh 0.2.0-rc.1 (published the day after this release):
  `dsh plugin add` rejects the bundle and rolls the profile back; with the
  exact-version exemption granted, the source typechecks against 0.2's own
  types, 111/111 unit tests pass, 19/19 live probes pass, and the browser
  behaves as on 0.1.7 — eight slot registrations, the rail, prompt insertion,
  the `Ctrl+K` palette with title search, and quote-reply. The peer range is
  deliberately not widened: `^0.2.0-rc.1` would silently admit every 0.2.x
  release, including a stable nobody has reviewed — the very failure this
  upgrade exists to prevent. What stays unverified there (branch / Mermaid /
  LaTeX chips) is unverified here too: those need a real model reply.
- Accepted and published: a human walked the isolated 0.1.7-rc.2 profile in a
  browser (personalization panel, prompts into the composer, project folders, the
  timeline rail, quote reply, export entries, `Ctrl+K`) and reported it behaving.
  The same person then ran 0.5.0 on their own machine — dsh upgraded to
  0.1.7-rc.2, plugin updated through the in-app market — and reported it
  behaving there too. That install's `lib/client.js` is md5
  `6639a0aebbe7d0eed32b0c2c5c50c544`, 207762 bytes: byte-identical to the repo
  build this section describes, so the chain "what was verified = what was
  published = what a user runs" is closed at both ends.
  Not covered by either pass, in this or any release until someone runs it with a
  key: the per-turn chips (branch, Mermaid render, LaTeX/MathML) and the real
  balance figures, all of which need an actual model reply. `0.5.0` was then
  published to npm, and the tarball pulled back from the registry was verified
  byte-identical to the `lib/` this section describes (34 files, 215634 B).
- Retracted after re-measurement, so the record does not carry them: "the
  `slots.inject(key, fn)` service method does not exist in 0.1.7" (it is
  declared at `dsh-client-ui-renderer`'s registry interface, and all eight
  surfaces materialize in a live browser); "`data-chat-flow-kind` is gone, so the
  rail has no anchors" (the reading was taken while the host's trajectory tab had
  the chat flow unmounted); "`WorkspaceSnapshot.state` was renamed to `phase`"
  (both axes ship side by side). Corrected in place: `ctx.sessions` still
  declares `fork()` and `search()` (only `open` is gone), the `current` field and
  the turnTail kind change both landed in 0.1.6-alpha.2 rather than 0.1.7, and
  the bilingual README gate enforces hash freshness, not content parity.

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
