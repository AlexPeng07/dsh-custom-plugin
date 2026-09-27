# dsh-custom-plugin

Standalone convenience suite for the DeepSeek Harness (DSH) Web GUI:
personalization (appearance, weather FX, glass), a per-user-message timeline
rail, project folders, prompts, conversation export, Mermaid rendering, quote
reply, and DeepSeek balance / daily token usage.

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
- The Host state file is `$DSH_HOME/custom-plugin-state.json`.
- The only agent-facing surface is the `custom_plugin_status` tool; the
  plugin never injects system-prompt announcements.

## Compatibility

- Targets the dsh release named by `engines.dsh` and the `@deepseek-ai/dsh-*`
  peer range in `package.json` (currently 0.1.7-rc.2). dsh validates that peer
  range against its own runtime version at install and startup and skips the
  whole bundle when it does not match, so bumping devDependencies without the
  peer range (or the reverse) is a silent breakage for users.
- The client bundle resolves its modules against the web shell's frozen seed
  table; `tsdown.config.ts` `PLATFORM_MODULES` mirrors it, and any extra runtime
  `require()` needs a `dsh.client.external` declaration.
- Slot-prop data shapes are declared locally (`src/client/custom.tsx`) rather
  than imported from harness controller packages, which rename between releases.
  Only `SnapshotSelectorHook` comes from the slot SDK.
- Anything the client can only learn from a session-scoped slot (the viewed
  session id) must not assume the list snapshot carries selection: dsh moved view
  selection to `ctx.uiWorkspace`.

- Run before committing:
  `pnpm typecheck`
  `pnpm test`
  `pnpm build`
  `pnpm smoke`
