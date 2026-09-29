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
- The Host state file is `$DSH_HOME/custom-plugin-state.json`. It is shared by
  every dsh host under that home — including dsh Desktop's separate profile —
  so an atomic replace there must name its temp file after the writing process
  (`tempPathFor`); a fixed temp name is a cross-process race, not just an
  in-process one.
- The only agent-facing surface is the `custom_plugin_status` tool; the
  plugin never injects system-prompt announcements.

## Compatibility

- The runtime compatibility gate reads **only** `peerDependencies` named
  `@deepseek-ai/dsh` or `@deepseek-ai/dsh-*` and checks them against the running
  dsh version with `semver.satisfies(v, range, {includePrerelease: true})`;
  `engines.dsh` is declarative and nothing reads it. This package declares one
  such peer, `@deepseek-ai/dsh-tools`, so bumping the `@deepseek-ai/dsh-*`
  devDependencies without it (or the reverse) is a silent breakage for users —
  `pnpm smoke` asserts the installed build target satisfies that range and that
  `engines.dsh` admits the same versions, and only the peer's range decides
  whether a host activates the bundle.
- Range spelling matters: `^0.1.7-rc.2` desugars to `>=0.1.7-rc.2 <0.2.0-0`, and
  **every `0.2.0-rc.N` sorts above `0.2.0-0`**, so no prerelease of 0.2.0 is
  admitted by it — a measured version must be named explicitly. Conversely
  `<0.2.0-0` cannot be used as an upper bound to "allow the 0.2 prereleases"
  (that admits nothing); the verified prerelease needs its own clause.
- dsh Desktop is an Electron shell around the same Web half. It pins the shell
  and `@deepseek-ai/dsh` to one version (0.2.0-rc.2 as of 2026-09-29), owns
  `$DSH_HOME/profiles/desktop`, defaults to port 19387 instead of 3080, and only
  the `dsh` command shipped with Desktop may manage that profile. Nothing here
  may hardcode a port or a profile name.
- The desktop renderer runs at `dsh-app://app` and the shell forwards its
  requests to its own Host after deleting `host`, `origin`, `sec-fetch-site` and
  `cookie`, so `src/loopback.ts` accepts them through its
  missing-`origin` branch; the WebSocket upgrade path rewrites `Origin` to the
  Host authority instead. `dsh.client.platform` has exactly one accepted value,
  `'web'` — any other value makes `dsh-client-modules` drop the row, and desktop
  reuses the web shell, so the declaration stays `'web'`.
- The served client bundle is larger than `lib/client.js`: dsh's composite
  `/plugins/??…` route concatenates modules and rewrites the
  `sourceMappingURL`. Byte-identity checks compare the installed file, never the
  HTTP response.
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
  `pnpm check:readme`
  `pnpm typecheck`
  `pnpm test`
  `pnpm build`
  `pnpm smoke`
  CI runs all of these (`check:readme` first), so a stale README hash or a
  failed build breaks the branch even if the local list was skipped.
