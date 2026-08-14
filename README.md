# dsh-custom-plugin

English | [中文](README.zh.md)

Custom convenience suite for the DeepSeek Harness (DSH) Web GUI: personalization, weather FX, liquid glass, a per-user-message timeline rail, project folders, prompts, conversation export, Mermaid rendering, quote reply, and DeepSeek balance / daily token usage. Ships as a dual-face plugin (host state + browser UI) mounted through the official profile mechanism — the browser half talks to the host's `/api/custom-plugin` routes over same-origin fetch, with no DSH source changes.

## What it does

### Appearance

- **Background colors**: 20 muted low-saturation palettes (each with a matching tab color) plus "no color" (default theme) and the high-saturation aurora gradient. In dark mode only "no color" and "aurora" stay selectable; the other colors are disabled and the plugin text turns white for readability.
- **Weather FX**: one-click overlays — falling snow, cinematic rain (three depth layers with splashes), and drifting sakura petals (canvas-rendered, pointer-transparent).
- **Glass**: frosted glass on every Custom surface, or liquid glass (Chromium displacement refraction, no chromatic dispersion, slight backdrop blur; Safari/Firefox fall back to frosted). A global-glass option applies backdrop blur to dialogs, menus, tooltips and listboxes.

### Timeline navigation

Every direct user message gets a node on a right-side (or left-side) rail: hover for a preview popover, click to jump to that message, drag the thumb to scroll. Nodes can be starred (and the rail can show only starred ones), forked into a new session at that message, or copied in full; LaTeX / MathML / Mermaid markers show directly in the preview.

### Project folders

A multi-level folder tree, persisted in the user home directory, shared across workspaces. Any workspace or session can be folded in; folders support drag-to-reorder (before / inside / after), rename, delete, and add-current-session shortcuts.

### Prompts

A prompt library with add / copy / delete, search, and a "Prompts" button in the session header for one-click insertion into the input box.

### Conversation export

Export the current session as JSON (standard messages structure, importable elsewhere), Markdown, or a print-ready PDF variant with embedded images (open the HTML and save as PDF).

### Mermaid

When a message contains a ```mermaid block, a render chip appears under it; the modal renders the diagram with the host-fetched Mermaid engine and offers a mermaid.live fallback link. The engine can be preloaded from the Mermaid tab.

### Efficiency tools

- **Quote reply**: select text in the conversation and a "quote reply" button inserts it as a blockquote into the input box.
- **Anti auto-scroll**: force `scroll-behavior: auto` so sends never yank the view to the bottom.
- **Formula copy**: LaTeX / MathML copy chips under matching messages (MathML pastes into Word).
- **Batch archive**: select sessions and archive them in bulk (logs stay in storage).

### Balance and usage

A balance badge in the session header (next to the session-log button): DeepSeek balance via the official balance endpoint (key pasted in the balance panel, stored only in the local state file, or auto-detected from the environment), plus today's per-model token ledger with a cost estimate table and a "scan today's session logs" refresh.

### Settings entry

The Settings → 个性化 section provides the full appearance and tool-toggle page (background, weather, glass, timeline, feature switches, Mermaid engine preload); the 个性化 buttons in the session header and the sidebar footer open the same panel.

### Agent integration

The `custom_plugin_status` tool reports appearance config, today's usage, balance, a timeline sample, Mermaid engine state and client diagnostics.

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

The plugin reads one JSON document at `$DSH_HOME/custom-plugin-state.json` (appearance config, folders, prompts, stars, API key, usage ledger).

## Security model

The browser talks to the host through loopback-only `/api/custom-plugin` routes behind the same-origin fence; the DeepSeek API key stays in the local state file (user home directory, never sent to the browser UI server logs) and is only used to call `https://api.deepseek.com/user/balance`. Conversation exports and the timeline stay on the local host.

## Known limitations

- Mermaid rendering needs a reachable CDN on first use (host caches the engine for its lifetime).
- The usage ledger folds token counts from live `session/event` records; a manual "scan" re-reads today's session logs when live events were missed.
- Cost estimates use DeepSeek official list prices × 7.25 exchange rate and are indicative only.
- Dark-mode background restriction is deliberate: only "no color" and "aurora" are selectable in dark mode.

## License

Apache-2.0. Portions of the code reference [Nagi-ovo/voyager](https://github.com/Nagi-ovo/voyager) and [unovue/inspira-ui](https://github.com/unovue/inspira-ui).
