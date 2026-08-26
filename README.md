# dsh-custom-plugin

[![npm version](https://img.shields.io/npm/v/%40alexpeng%2Fdsh-custom-plugin?style=flat-square)](https://www.npmjs.com/package/@alexpeng/dsh-custom-plugin)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?style=flat-square)](#install)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![CI](https://github.com/AlexPeng07/dsh-custom-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/AlexPeng07/dsh-custom-plugin/actions/workflows/ci.yml)
[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

English | [中文](README.zh.md)

Custom convenience suite for the DeepSeek Harness (DSH) Web GUI: personalization, weather FX, glass effects, a per-user-message timeline rail, project folders, prompts, conversation export, Mermaid rendering, quote reply, and DeepSeek balance / daily token usage.

The plugin is dual-face: the host half (`src/`) owns the state document, registers the `/api/custom-plugin` routes and the `custom_plugin_status` agent tool; the browser half (`src/client/`) injects its UI through eight injections into seven official slots and talks to the host over same-origin fetch. Mounted through the official profile mechanism — no DSH source changes.

## Selected screenshots

<table>
<tr>
<td width="50%" valign="top"><b>Settings → 个性化: the full-page appearance config</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/settings-appearance.png" alt="Settings → 个性化 full appearance page" width="100%"></td>
<td width="50%" valign="top"><b>The same panel as a popover from the session header (light theme)</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/personalization-panel.png" alt="Personalization popover" width="100%"></td>
</tr>
<tr>
<td width="50%" valign="top"><b>Liquid glass (displacement refraction on Custom surfaces)</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/liquid-glass.png" alt="Liquid glass" width="100%"></td>
<td width="50%" valign="top"><b>Timeline rail with hover preview</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/timeline.png" alt="Timeline rail" width="100%"></td>
</tr>
<tr>
<td width="50%" valign="top"><b>Multi-level project folders</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/project-folders.png" alt="Project folders" width="100%"></td>
<td width="50%" valign="top"><b>Mermaid mindmap rendered in place</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/mermaid-mindmap.png" alt="Mermaid mindmap" width="100%"></td>
</tr>
<tr>
<td width="50%" valign="top" align="center"><b>Balance and today's per-model usage</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/balance-usage.png" alt="Balance and usage panel" width="100%"></td>
<td width="50%" valign="top" align="center"><b>Rain — three depth layers</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/weather-rain.gif" alt="Rain FX" width="100%"></td>
</tr>
<tr>
<td width="50%" valign="top" align="center"><b>Sakura petals</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/weather-sakura.gif" alt="Sakura FX" width="100%"></td>
<td width="50%" valign="top" align="center"><b>Snow</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/weather-snow.gif" alt="Snow FX" width="100%"></td>
</tr>
</table>

Weather FX is shown in dark mode, where only "no color" and "aurora" backgrounds are selectable.

## What it does

### Appearance

- **Background colors**: 20 muted low-saturation palettes (each with a matching tab color, `天青灰` by default) plus "no color" (follows the GUI default theme) and the high-saturation aurora gradient. In dark mode only "no color" and "aurora" stay selectable; the other colors are disabled and the plugin text turns white for readability.
- **Weather FX**: canvas-rendered, pointer-transparent one-click overlays — falling snow, cinematic rain (three depth layers with splashes), and drifting sakura petals; turning it off clears the canvas.
- **Glass**: frosted glass on every Custom surface, or liquid glass (Chromium displacement refraction, no chromatic dispersion, slight backdrop blur; Safari/Firefox fall back to frosted). A global-glass option applies backdrop blur to dialogs, menus, tooltips and listboxes.

### Timeline navigation

Every direct user message gets a node on a right-side (or left-side) rail:

- hover for a preview popover (overflow-aware positioning) with LaTeX / MathML / Mermaid markers rendered inline;
- click to jump to that message (the chat scrollport is driven directly, so rows inside nested scrollers still land centered);
- drag the thumb or wheel over the rail to scroll (the rail replaces the native scrollbar);
- nodes can be starred (and the rail can show only starred ones), forked into a new session at that message, or copied in full.

Nodes are sourced from the rendered user-message rows (DOM positioning) and refresh automatically after history loads; the rail keeps up to 400 tail nodes.

### Project folders

A multi-level folder tree persisted in the `$DSH_HOME` state file, shared across workspaces. Any workspace or session can be folded in; folders support drag-to-reorder (before / inside / after), rename, delete, and add-current-session shortcuts.

### Prompts

A prompt library with add / copy / delete, search, and a "Prompts" button in the session header for one-click insertion into the input box.

### Conversation export

Export the current session in three formats (file names carry a date stamp):

- **JSON**: standard `messages` structure (user / assistant / tool), with a meta block carrying the session title, creation time, working directory and export time — importable elsewhere;
- **Markdown**: role-sectioned plain text;
- **PDF**: an A4 print-layout HTML opened in the browser and saved as PDF; images embed as base64 (up to 30 images, 12 MB total, 4 MB each).

Tool rows carry the tool name and an argument digest (resolved from the paired tool/call events).

### Mermaid

```mermaid blocks anywhere in the chat — assistant replies included (mindmaps, flowcharts, sequence diagrams, …) — render in place automatically: a diagram/code toggle bar with a mermaid.live fallback link appears above the block, streaming blocks preview once their content is complete, diagrams re-render on GUI theme flips, and a failed render keeps the raw code. Detection keys off the fence language label; with a blank label (mid-stream) a content heuristic decides (keyword prefix + completeness checks, so blocks labeled with a real language are never touched). The engine loads from the mermaid 11 dependency installed with the plugin (works offline), falling back to jsdelivr / fastly / unpkg mirrors and caching in the host process; the render chips under user messages and the multi-diagram modal stay, and the mermaid.live link uses the DEFLATE-compressed `#pako:` format that restores the diagram on open.

### Efficiency tools

- **Quote reply**: select text in the conversation and a "quote reply" button inserts it as a blockquote into the input box;
- **Anti auto-scroll**: force `scroll-behavior: auto` so sends never yank the view to the bottom (off by default);
- **Formula copy**: LaTeX / MathML copy chips under matching messages (MathML pastes into Word);
- **Batch archive**: select sessions and archive them in bulk with a confirmation guard (logs stay in storage).

### Balance and usage

A balance badge sits in the session header (clickable to pin); the balance panel provides:

- **Balance**: the official `https://api.deepseek.com/user/balance` endpoint, CNY preferred, granted and topped-up balances listed separately, with the account availability flag.
- **Key resolution order**: the system credential store (when available) → the legacy plugin state-file key → environment variables `DEEPSEEK_API_KEY` / `DEEPSEEK_KEY` / `DEEPSEEK_TOKEN` (values must start with `sk-`) → the DSH credentials file `$DSH_HOME/.credentials.yaml` (reuses the DeepSeek key already configured in DSH — no duplicate setup).
- **Today's usage**: per-model input / output / cache token counters and call counts, folded live from `session/event` records.
- **Cost estimate**: DeepSeek's current official peak/off-peak table — peak hours are Beijing Monday–Friday 09:00–12:00 / 14:00–18:00; all other hours, including weekends, are off-peak at half price: `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` ¥3 / ¥9, `deepseek-v4-pro` ¥9 / ¥27 (CNY per 1M tokens in / out, cache writes ¥0.1 / ¥0.3; the retired `deepseek-chat` / `deepseek-reasoner` price as v4-flash). Indicative only.
- **Scan**: "scan today's session logs" replays every session and buckets usage events by their own timestamp (cross-midnight sessions keep contributing today's usage), reporting how many active sessions were scanned.

### Settings entry

The Settings → 个性化 section provides the full appearance and tool-toggle page; the 个性化 buttons in the session header and the sidebar footer open the same panel as a popover.

### Agent integration

The `custom_plugin_status` tool reports appearance config, today's per-model usage, balance, a timeline sample, Mermaid engine state, the state file path and client diagnostics. The plugin never injects system-prompt announcements.

## Install

Prerequisites: Node 22+, pnpm, and the `dsh` CLI (the official `@deepseek-ai/dsh` npm package; `npx @deepseek-ai/dsh` stands in for `dsh` when it is not installed globally).

### From npm

```sh
dsh plugin --profile web add @alexpeng/dsh-custom-plugin
# restart dsh web
```

The registry tarball ships prebuilt output — no source build on the installing machine.

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
| `timeline` | `true` | timeline rail toggle |
| `timelineLeft` | `false` | rail on the left |
| `starsOnly` | `false` | show only starred nodes |
| `quote` | `true` | selection quote reply |
| `antiScroll` | `false` | anti auto-scroll |
| `mermaid` | `true` | automatic in-place Mermaid rendering (plus render chips) |
| `formula` | `true` | LaTeX / MathML copy chips |

## Security model

- The browser talks to the host only through loopback `/api/custom-plugin` routes; every route checks a loopback socket address, a loopback Host header, and browser same-origin markers (`sec-fetch-site` / `Origin`). `X-Forwarded-For` is never trusted.
- The browser never receives the saved DeepSeek API key. New panel keys use the optional OS credential store through `keytar`; older plaintext state keys are migrated on startup when that store is available.
- If the OS credential store is unavailable, the plugin keeps a compatibility fallback in `$DSH_HOME/custom-plugin-state.json`; protect `$DSH_HOME` accordingly. DSH's own `$DSH_HOME/.credentials.yaml` remains a supported plaintext fallback.
- Conversation exports and timeline data stay on the local host.

## Known limitations

- The Mermaid engine comes from the dependency installed with the plugin and works offline; only a missing dependency falls back to a CDN fetch (cached for the host process lifetime).
- The usage ledger folds token counts from live `session/event` records, retains 90 Beijing calendar days, and a manual "scan" re-reads today's session logs with four concurrent reads when live events were missed.
- The balance panel shows the peak/off-peak token and cost split plus a link to the official pricing page; legacy rows without peak counters are estimated as off-peak until rescanned.
- OS credential storage depends on the optional `keytar` backend; when it cannot be loaded, the compatibility state-file fallback is used.
- Cost estimates use DeepSeek's official peak/off-peak list prices and are indicative only.
- Dark-mode background restriction is deliberate: only "no color" and "aurora" are selectable in dark mode.

## Development

```sh
pnpm typecheck   # type check
pnpm test        # vitest unit tests
pnpm build       # build the node ESM library and the browser bundle into lib/
```

## License

Apache-2.0. Portions of the code reference [Nagi-ovo/voyager](https://github.com/Nagi-ovo/voyager) and [unovue/inspira-ui](https://github.com/unovue/inspira-ui).
