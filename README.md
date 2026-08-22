# dsh-custom-plugin

English | [中文](README.zh.md)

Custom convenience suite for the DeepSeek Harness (DSH) Web GUI: personalization, weather FX, glass effects, a per-user-message timeline rail, project folders, prompts, conversation export, Mermaid rendering, quote reply, and DeepSeek balance / daily token usage.

The plugin is dual-face: the host half (`src/`) owns the state document, registers the `/api/custom-plugin` routes and the `custom_plugin_status` agent tool; the browser half (`src/client/`) injects its UI through nine official slots and talks to the host over same-origin fetch. Mounted through the official profile mechanism — no DSH source changes.

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

When a message contains a ```mermaid block, a render chip appears under it; the modal renders the diagram with the host-fetched Mermaid 11 engine (jsdelivr / fastly / unpkg mirror fallback, cached for the host process lifetime, preloadable from the Mermaid tab), plus a mermaid.live fallback link (DEFLATE-compressed `#pako:` format that restores the diagram on open).

### Efficiency tools

- **Quote reply**: select text in the conversation and a "quote reply" button inserts it as a blockquote into the input box;
- **Anti auto-scroll**: force `scroll-behavior: auto` so sends never yank the view to the bottom (off by default);
- **Formula copy**: LaTeX / MathML copy chips under matching messages (MathML pastes into Word);
- **Batch archive**: select sessions and archive them in bulk with a confirmation guard (logs stay in storage).

### Balance and usage

A balance badge sits in the session header (clickable to pin); the balance panel provides:

- **Balance**: the official `https://api.deepseek.com/user/balance` endpoint, CNY preferred, granted and topped-up balances listed separately, with the account availability flag.
- **Key resolution order**: pasted in the panel (stored only in the local state file) → environment variables `DEEPSEEK_API_KEY` / `DEEPSEEK_KEY` / `DEEPSEEK_TOKEN` → the DSH credentials file `$DSH_HOME/.credentials.yaml` (reuses the DeepSeek key already configured in DSH — no duplicate setup).
- **Today's usage**: per-model input / output / cache token counters and call counts, folded live from `session/event` records.
- **Cost estimate**: DeepSeek's official peak/off-peak table (effective 2026-08-17) — peak hours (Beijing 09:00–12:00 / 14:00–18:00) at full price, off-peak at half: `deepseek-v4-flash` ¥3 / ¥9, `deepseek-v4-pro` ¥9 / ¥27 (CNY per 1M tokens in / out, cache writes ¥0.1 / ¥0.3; the retired `deepseek-chat` / `deepseek-reasoner` price as v4-flash). Indicative only.
- **Scan**: "scan today's session logs" replays every session and buckets usage events by their own timestamp (cross-midnight sessions keep contributing today's usage), reporting how many active sessions were scanned.

### Settings entry

The Settings → 个性化 section provides the full appearance and tool-toggle page; the 个性化 buttons in the session header and the sidebar footer open the same panel as a popover.

### Agent integration

The `custom_plugin_status` tool reports appearance config, today's per-model usage, balance, a timeline sample, Mermaid engine state, the state file path and client diagnostics. The plugin never injects system-prompt announcements.

## Install

This is a standalone plugin: it is not registered in any marketplace or community-plugin set, and installs into a DSH profile as a local link:

```sh
# build (run from this repo root; requires Node 22+ and pnpm)
pnpm install
pnpm build
# add to the web profile. The link path must not contain spaces: on Windows,
# create a space-free directory junction first and link to the junction path
dsh plugin --profile web add link:F:/dsh-plugin-dev
# restart dsh web
```

`dsh plugin add` writes the profile dependency and automatically joins the package to `dsh.profile.bundles` (row id `custom-plugin`); the browser half loads via the official client module system from the same row.

## Config

The plugin reads and writes one JSON document at `$DSH_HOME/custom-plugin-state.json` (`~/.dsh` by default, overridable via the `DSH_HOME` environment variable): appearance config, folders, prompts, stars, the API key, and the per-day usage ledger. Writes are atomic (temp file + rename), so a crash never truncates the document.

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
| `mermaid` | `true` | Mermaid render chips |
| `formula` | `true` | LaTeX / MathML copy chips |

## Security model

- The browser talks to the host only through loopback `/api/custom-plugin` routes; every route checks a loopback socket address, a loopback Host header, and browser same-origin markers (`sec-fetch-site` / `Origin`). `X-Forwarded-For` is never trusted.
- The DeepSeek API key stays in the local state file (or reuses DSH's own credentials) and is only used to call the official DeepSeek balance endpoint.
- Conversation exports and timeline data stay on the local host.

## Known limitations

- Mermaid rendering needs a reachable CDN on first use (the host caches the engine for its lifetime).
- The usage ledger folds token counts from live `session/event` records; a manual "scan" re-reads today's session logs when live events were missed.
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
