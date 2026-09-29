# dsh-custom-plugin

[![npm version](https://img.shields.io/npm/v/%40alexpeng%2Fdsh-custom-plugin?style=flat-square)](https://www.npmjs.com/package/@alexpeng/dsh-custom-plugin)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?style=flat-square)](#install)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![CI](https://github.com/AlexPeng07/dsh-custom-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/AlexPeng07/dsh-custom-plugin/actions/workflows/ci.yml)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

English | [中文](README.zh.md)

Custom convenience suite for the DeepSeek Harness (DSH) Web GUI: personalization, weather FX, glass effects, project folders, enhanced prompts, conversation export/search, Mermaid rendering, quote reply, 7/30/90-day usage analytics, budget and key-free local backups, plus a Ctrl/Cmd+K command palette.

The plugin is dual-face: the host half (`src/`) owns the state document, registers the `/api/custom-plugin` routes and the `custom_plugin_status` agent tool; the browser half (`src/client/`) injects its UI through eight injections into seven official slots and talks to the host over same-origin fetch. Mounted through the official profile mechanism — no DSH source changes.

<p align="center">
  <img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/overview.png" alt="dsh-custom-plugin overview" width="100%">
</p>

## Selected screenshots

<table>
<tr>
<td width="50%" valign="top"><b>Settings → 个性化: the full-page appearance config</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/settings-appearance.png" alt="Settings → 个性化 full appearance page" width="100%"></td>
<td width="50%" valign="top"><b>The same panel as a popover from the session header (light theme)</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/personalization-panel.png" alt="Personalization popover" width="100%"></td>
</tr>
<tr>
<td width="50%" valign="top"><b>Liquid glass (displacement refraction on Custom surfaces)</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/liquid-glass.png" alt="Liquid glass" width="100%"></td>
<td width="50%" valign="top"><b>Multi-level project folders</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/project-folders.png" alt="Project folders" width="100%"></td>
</tr>
<tr>
<td width="50%" valign="top"><b>Mermaid mindmap rendered in place</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/mermaid-mindmap.png" alt="Mermaid mindmap" width="100%"></td>
<td width="50%" valign="top" align="center"><b>Balance and today's per-model usage</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/balance-usage.png" alt="Balance and usage panel" width="100%"></td>
</tr>
<tr>
<td width="50%" valign="top" align="center"><b>Rain (three depth layers)</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/weather-rain.gif" alt="Rain effect" width="100%"></td>
<td width="50%" valign="top" align="center"><b>Sakura</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/weather-sakura.gif" alt="Sakura effect" width="100%"></td>
</tr>
<tr>
<td width="50%" valign="top" align="center"><b>Snow</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/weather-snow.gif" alt="Snow effect" width="100%"></td>
</tr>
</table>

Weather FX is shown in dark mode, where only "no color" and "aurora" backgrounds are selectable. Usage history, backup-import previews, session search, and the command palette are dynamic views of the same panel; open them inside DSH to inspect the live UI — no additional fixed screenshots are included.

## What it does

### Appearance

- **Background colors**: 20 muted low-saturation palettes (each with a matching tab color, `天青灰` by default) plus "no color" (follows the GUI default theme) and the high-saturation aurora gradient. In dark mode only "no color" and "aurora" stay selectable; the other colors are disabled and the plugin text turns white for readability.
- **Weather FX**: canvas-rendered, pointer-transparent one-click overlays — falling snow, cinematic rain (three depth layers with splashes), and drifting sakura petals; turning it off clears the canvas.
- **Glass**: frosted glass on every Custom surface, or liquid glass (Chromium displacement refraction, no chromatic dispersion, slight backdrop blur; Safari/Firefox fall back to frosted). A global-glass option applies backdrop blur to dialogs, menus, tooltips and listboxes.

### Project folders

A multi-level folder tree persisted in the `$DSH_HOME` state file, shared across workspaces. Any workspace or session can be folded in; folders support drag-to-reorder (before / inside / after), rename, delete, and add-current-session shortcuts.

### Prompts

A prompt library with add / edit / copy / delete, search, favorites, tags, drag sorting, recency and use counts. `{{variable}}` placeholders open a fill-in form before insertion. The library supports versioned JSON and heading-based Markdown import/export.

### Conversation export

Export the current session in three formats (file names carry a date stamp):

- **JSON**: standard `messages` structure (user / assistant / tool), with a meta block carrying the session title, creation time, working directory and export time — importable elsewhere;
- **Markdown**: role-sectioned plain text;
- **PDF**: an A4 print-layout HTML opened in the browser and saved as PDF; images embed as base64 (up to 30 images, 12 MB total, 4 MB each).

Tool rows carry the tool name and an argument digest (resolved from the paired tool/call events).

Plugin state can be exported as a versioned JSON backup containing appearance, folders, prompts, stars, usage, and budget settings. API keys and credential metadata are excluded. Imports show a conflict preview, support merge or non-secret replacement, and create a recovery copy first.

### Mermaid

```mermaid blocks anywhere in the chat — assistant replies included (mindmaps, flowcharts, sequence diagrams, …) — render in place automatically: a diagram/code toggle bar with a mermaid.live fallback link appears above the block, streaming blocks preview once their content is complete, diagrams re-render on GUI theme flips, and a failed render keeps the raw code. Detection keys off the fence language label; with a blank label (mid-stream) a content heuristic decides (keyword prefix + completeness checks, so blocks labeled with a real language are never touched). The engine loads from the mermaid 11 dependency installed with the plugin (works offline), falling back to jsdelivr / fastly / unpkg mirrors and caching in the host process; the render chips under user messages and the multi-diagram modal stay, and the mermaid.live link uses the DEFLATE-compressed `#pako:` format that restores the diagram on open.

### Efficiency tools

- **Quote reply**: select text in the conversation and a "quote reply" button inserts it as a blockquote into the input box;
- **Anti auto-scroll**: force `scroll-behavior: auto` so sends never yank the view to the bottom (off by default);
- **Formula copy**: LaTeX / MathML copy chips under matching messages (MathML pastes into Word);
- **Batch archive**: select sessions and archive them in bulk; running sessions are unavailable and completion reports separate success/failure counts. DSH exposes no restore API yet, so the plugin provides no restore entry point.
- **Session search**: search current-session user, assistant, and tool content and jump to the containing turn; superseded requests are cancelled. DSH's event index is used when the deployment opens one, and otherwise the plugin scans the session log it already read (the panel says which path answered).
- **Command palette**: press `Ctrl+K` / `Cmd+K` outside editors to search sessions, workspaces, prompts, and common actions; cross-session content search uses DSH's official API and reports its own unavailability.
- **Reliable archive**: running sessions are unavailable by default and batch completion reports separate success and failure counts.

### Balance and usage

A balance badge sits in the session header (clickable to pin); the balance panel provides:

- **Balance**: the official `https://api.deepseek.com/user/balance` endpoint, CNY preferred, granted and topped-up balances listed separately, with the account availability flag.
- **Key resolution order**: the system credential store (when available) → the legacy plugin state-file key → environment variables `DEEPSEEK_API_KEY` / `DEEPSEEK_KEY` / `DEEPSEEK_TOKEN` (values must start with `sk-`) → the DSH credentials file `$DSH_HOME/.credentials.yaml` (reuses the DeepSeek key already configured in DSH — no duplicate setup).
- **Today's usage**: per-model input / output / cache token counters and call counts, folded live from `session/event` records.
- **Cost estimate**: DeepSeek's current official peak/off-peak table — peak hours are Beijing Monday–Friday 09:00–12:00 / 14:00–18:00; all other hours, including weekends, are off-peak at half price: `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` ¥3 / ¥9, `deepseek-v4-pro` ¥9 / ¥27 (CNY per 1M tokens in / out, cache writes ¥0.1 / ¥0.3; the retired `deepseek-chat` / `deepseek-reasoner` price as v4-flash). Indicative only.
- **Scan**: "scan today's session logs" replays every session and buckets usage events by their own timestamp (cross-midnight sessions keep contributing today's usage), reporting how many active sessions were scanned.
- **History and budget**: inspect 7 / 30 / 90-day trends and per-model totals, export UTF-8 CSV, and set a local monthly CNY budget with an in-plugin warning threshold.

### Settings entry

The Settings → 个性化 section provides the full appearance and tool-toggle page; the 个性化 buttons in the session header and the sidebar footer open the same panel as a popover.

### Agent integration

The `custom_plugin_status` tool reports appearance config, today's per-model usage, balance, a timeline sample, Mermaid engine state, the state file path and client diagnostics. The plugin never injects system-prompt announcements.

## Compatibility

| plugin release | dsh it was built and verified against | status |
| --- | --- | --- |
| 0.6.x | dsh 0.1.7-rc.2 and dsh 0.2.0-rc.2 (peer range names both; see Install) | this release |
| 0.5.x | dsh 0.1.7-rc.2 (peer range `>=0.1.7-rc.2 <0.2.0-0`) | fine on 0.1.x; refused on any 0.2.x host, including dsh Desktop |
| 0.4.2 | dsh 0.1.1-rc.1 … 0.1.6 era | superseded; do not expect it to work on 0.1.7+ |

0.1.7 changed the plugin-facing contracts this suite depends on (session
navigation moved to `ctx.uiWorkspace`, the session list stopped publishing the
viewed session, and the message model dropped the `tool-result` content block),
so neither release substitutes for the other. dsh 0.1.7+ validates a bundle's
`@deepseek-ai/dsh-*` peer ranges against its own version at install and startup
and skips a bundle that does not match. Runtimes predating that gate load the
bundle anyway and degrade instead: on 0.1.1-rc.2, 7 of 8 slot registrations
succeed, the turn-tail entry is rejected (that slot became a list slot back in
0.1.6-alpha.2), and the open-session / branch / cross-session actions
report their service as missing rather than throwing.

## Install

Prerequisites: Node 22+, pnpm, and the `dsh` CLI (the official `@deepseek-ai/dsh` npm package; `npx @deepseek-ai/dsh` stands in for `dsh` when it is not installed globally). This release targets **dsh 0.1.7-rc.2 through the rest of 0.1.x, plus 0.2.0-rc.2** — dsh checks a bundle's `@deepseek-ai/dsh-*` peer ranges against its own version at install and startup, and skips a bundle that does not match, so `package.json` names only the releases this package was actually built and verified against. 0.6.0 is type-checked and built against 0.2.0-rc.2, and the same artifact was run through the live host probes on both runtime lines: 18 of 19 probes pass on 0.2.0-rc.2 (boot graph of 66 module rows) and on 0.1.7-rc.2 (65 rows), the one skip being the probe that needs a real session. What stays unverified is what was always unverified: the per-turn chips (branch, Mermaid render, LaTeX) need a real model reply, so a credential-free scratch home cannot reach them, and slot rendering still needs a browser pass. The range deliberately excludes 0.2.0-rc.1 (a superseded prerelease), 0.2.0-rc.3 and later prereleases nobody has looked at, and 0.2.0 stable until someone does. Range spelling matters here: `^0.1.7-rc.2` desugars to `>=0.1.7-rc.2 <0.2.0-0`, and every `0.2.0-rc.N` sorts *above* `0.2.0-0`, so a verified prerelease has to be named in its own clause — `pnpm smoke` checks that the build target actually satisfies the declared range and that `engines.dsh` admits the same versions. On an older dsh, install the matching older plugin release (`0.5.0` targets 0.1.7-rc.2) rather than granting a compatibility exemption.

### From npm

```sh
dsh plugin --profile web add @alexpeng/dsh-custom-plugin
# restart dsh web
```

The registry tarball ships prebuilt output — no source build on the installing machine.

### On dsh Desktop

dsh Desktop is an Electron shell around the same Web application, and it bundles
**exactly dsh 0.2.0-rc.2** — the desktop release line pins the shell and the
runtime together, so a Desktop install is always a 0.2.x runtime. 0.6.0 names
that version in its peer range and installs there with no compatibility
exemption; 0.5.0 did not, and was refused with the same message a 0.2.x Web
profile prints.

Measured against 0.2.0-rc.2: the boot graph carries our row and all five inject
targets, the Mermaid engine loads locally, and the host probes score the same
there as on 0.1.7-rc.2. The access fence shares the platform fence's trust
semantics: a loopback socket naming a loopback Host, a non-`cross-site` marker,
and an Origin that is absent or matches the Host authority. The shell forwards
renderer requests to its own Host after deleting `host`, `origin`,
`sec-fetch-site` and `cookie`, then attaches its own credential — that unmarked
shape is accepted outright (through 0.6.0 the fence additionally required a
same-origin marker and rejected exactly this shape with `forbidden`; fixed in
0.7.0 with fence-level unit tests). Foreign-origin and cross-site requests are
still 403. What has *not* been done is opening this plugin inside a Desktop
window; that pass belongs to whoever installs it, and it needs your login.

Managing the desktop profile takes the `dsh` command that ships with Desktop, not
the npm one — the public CLI refuses the reserved `desktop` profile:

1. Start Desktop once so the profile exists, then quit it fully (closing the
   window only hides it; on Windows use the tray).
2. `dsh plugin --profile desktop add @alexpeng/dsh-custom-plugin`
3. Reopen Desktop. The in-app Plugin Manager installs and updates against the
   same profile using Desktop's own bundled pnpm, if you would rather not open a
   terminal.

Appearance, prompt library, project folders, stars and usage all live in
`$DSH_HOME/custom-plugin-state.json`, which Desktop and Web share by design —
each keeps its own `profiles/<name>` for code, never for that file — so
switching between the two shows the same data. Both hosts can therefore write it
at once, which is why the state replace names its temp file after the writing
process.

### From GitHub (source install)

```sh
dsh plugin --profile web add github:AlexPeng07/dsh-custom-plugin
# restart dsh web
```

Git installs pull sources; the `prepare` script builds `lib/` on the installing machine. pnpm ≥10 asks you to approve that build once — copy the exact package key it prints into the profile's `pnpm-workspace.yaml` under `allowBuilds`, then re-run the add. The npm route above skips the build-approval step.

### Local link (development)

```sh
# build (run from this repo root)
pnpm install
pnpm build
# add to the web profile. The link path must not contain spaces: on Windows,
# create a space-free directory junction first and link to the junction path
dsh plugin --profile web add link:F:/dsh-plugin-dev
# restart dsh web
```

The package declares its manifest per the official bundle protocol: `dsh.bundle.patch` in `package.json` points at the `cordis.patch.yml` config layer (row id `custom-plugin`) and `dsh.client` declares the browser half. `dsh plugin add` forwards to pnpm inside the profile directory; the installed package joins `dsh.profile.bundles` automatically because of that declaration, and the browser half loads via the official client module system from the same row.

## Config

The plugin reads and writes one JSON document at `$DSH_HOME/custom-plugin-state.json` (`~/.dsh` by default, overridable via the `DSH_HOME` environment variable): appearance config, folders, prompts, stars, legacy compatibility data, and a 90-day per-day usage ledger. Writes are atomic (temp file + rename), so a crash never truncates the document.

Appearance and feature toggles (the `cfg` field, all with defaults):

| Key | Default | Meaning |
|---|---|---|
| `bg` | `天青灰` | `default` (no color) / `aurora` / one of the 20 palette names |
| `weather` | `none` | `none` / `snow` / `rain` / `sakura` |
| `glass` | `true` | master glass toggle for Custom surfaces |
| `glassMode` | `frost` | `frost` frosted / `liquid` displacement glass |
| `globalGlass` | `true` | blur global overlays (dialogs/menus/tooltips) |
| `quote` | `true` | selection quote reply |
| `antiScroll` | `false` | anti auto-scroll |
| `mermaid` | `true` | automatic in-place Mermaid rendering (plus render chips) |
| `formula` | `true` | LaTeX / MathML copy chips |
| `monthlyBudgetCny` | `0` | Monthly CNY budget; `0` disables warnings |
| `budgetWarningPercent` | `80` | Monthly warning threshold (1–100) |

## Security model

- The browser talks to the host only through loopback `/api/custom-plugin` routes; every route checks a loopback socket address, a loopback Host header, and browser same-origin markers (`sec-fetch-site` / `Origin`). `X-Forwarded-For` is never trusted.
- The browser never receives the saved DeepSeek API key. New panel keys use the OS credential store through `keytar` when it is present; older plaintext state keys are migrated on startup when that store is available. `keytar` ships as no dependency of this plugin (a native module would trip pnpm 11's strict build gate and silently keep the whole bundle from activating); users who want the OS keyring can add it to the profile themselves: `dsh plugin --profile web add keytar`.
- If the OS credential store is unavailable, the plugin keeps a compatibility fallback in `$DSH_HOME/custom-plugin-state.json`; protect `$DSH_HOME` accordingly. DSH's own `$DSH_HOME/.credentials.yaml` remains a supported plaintext fallback.
- Conversation exports and timeline data stay on the local host.

## Known limitations

- The Mermaid engine comes from the dependency installed with the plugin and works offline; only a missing dependency falls back to a CDN fetch (cached for the host process lifetime).
- The usage ledger folds token counts from live `session/event` records, retains 90 Beijing calendar days, and a manual "scan" re-reads today's session logs with four concurrent reads when live events were missed.
- The balance panel shows the peak/off-peak token and cost split plus a link to the official pricing page; legacy rows without peak counters are marked inexact and excluded from cost totals until rescanned.
- OS credential storage detects a `keytar` module present in the profile's `node_modules` when the host starts; when it cannot be loaded, the compatibility state-file fallback is used.
- Cost estimates use DeepSeek's official peak/off-peak list prices and are indicative only.
- Dark-mode background restriction is deliberate: only "no color" and "aurora" are selectable in dark mode.
- DSH currently exposes no archive-restore API; the plugin does not bypass that boundary by editing the underlying registry.
- The command palette owns `Ctrl+K` / `Cmd+K` (no Alt/Shift, ignored inside editors). dsh's own default on the **web** profile is `Ctrl+Alt+K` (the desktop default is plain `Ctrl+K`), so nothing collides out of the box — but dsh 0.1.7 lets you rebind host shortcuts, and if you assign a host command to plain `Ctrl+K`, both fire. Keep the palette key reserved, or pick another binding there.
- dsh's shipped `web` profile composes its session-query index with `openAt: never`, so full-text search is off unless the deployment enables it. In-session search therefore answers from a direct log scan (ordered, capped at 100 hits) and the palette's cross-session search shows dsh's own refusal.

## Development

```sh
pnpm typecheck      # type check
pnpm test           # vitest unit tests
pnpm build          # build the node ESM library and the browser bundle into lib/
pnpm check:readme   # bilingual README hash consistency
pnpm smoke          # post-build contract checks: loader handshake, manifest
                    # fields dsh reads, patch row, local Mermaid engine
```

`scripts/live-dsh-check.sh` is a separate, manual probe against a **running**
isolated dsh profile (`DSH_HOME=… DSH_PORT=… bash scripts/live-dsh-check.sh`):
it exercises the host half on real session data — timeline, the three export
formats, the search scan path, usage scan, backup, the Mermaid engine route, the
client→host diagnostic ring, a UTF-8 state round trip that restores and then
verifies your prompt library, and the three trust-fence shapes (an unmarked
loopback request passes, a foreign Origin and a cross-site marker are
rejected). It refuses to run against a
real `~/.dsh` unless you set `ALLOW_REAL_DSH_HOME=1`, reports `PASS`/`FAIL` per
probe, counts and names anything it `SKIP`s, and exits non-zero on any failure.
CI has no harness to talk to, so run it whenever a dsh release lands; slot
registration and rendering still need the browser pass described above.

Checking a new dsh release takes four commands, and never touches your own
harness home:

```bash
mkdir -p /tmp/dshnext && cd /tmp/dshnext && npm init -y && npm i @deepseek-ai/dsh@<version>
DSH_HOME=/tmp/dshnext-home node node_modules/@deepseek-ai/dsh/lib/bin.js plugin --profile web add <packed.tgz>
DSH_HOME=/tmp/dshnext-home node node_modules/@deepseek-ai/dsh/lib/bin.js --profile web --no-open --port 13999 &
DSH_HOME=/tmp/dshnext-home DSH_PORT=13999 COOKIE_JAR=/tmp/dshnext/jar.txt bash scripts/live-dsh-check.sh
```

If the release falls outside the declared peer range, the second command refuses
and rolls the profile back; `dsh plugin --profile web allow-version <pkg>@<ver>
--dsh-version <version> --accept-risk` grants the exact-version exemption, so the
probe can tell you *what* actually breaks instead of what the gate already
refused.

For a **dsh Desktop** release, start one step earlier, because the repository
cannot tell you what an installer runs: Desktop pins its shell and
`@deepseek-ai/dsh` to one exact version and ships the whole runtime inside
`resources/app.asar`. Read it off the installed app instead — the command is
read-only, and it prints that version together with whether the peer range
declared here admits it:

```bash
node scripts/desktop-runtime.mjs "D:/DSH"                    # the installation dir
node scripts/desktop-runtime.mjs "D:/DSH/resources/app.asar" # or the archive itself
```

Then run the four commands above against the version it names.

## License

Apache-2.0. Portions of the code reference [Nagi-ovo/voyager](https://github.com/Nagi-ovo/voyager) and [unovue/inspira-ui](https://github.com/unovue/inspira-ui).
