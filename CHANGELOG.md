# Changelog

All notable changes to this project are documented here. The format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
follow [Semantic Versioning](https://semver.org/).

## Unreleased

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
