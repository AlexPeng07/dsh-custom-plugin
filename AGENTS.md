# dsh-custom-plugin

> 会话进度、当前参数、验证/安装流程与已知坑见 `PROJECT_HANDOFF.md`（接手必读，规则以本文件为准）。

Standalone convenience suite for the DeepSeek Harness (DSH) Web GUI:
personalization (appearance, weather FX, glass), project folders, prompts,
conversation export, Mermaid rendering, and DeepSeek balance /
daily token usage.

## Package rules

- The host half lives in `src/` and the browser half in `src/client/`;
  `src/protocol.ts` carries the JSON wire types shared by both sides.
- The browser half talks to the host through the `/api/custom-plugin` fetch
  routes; styles are injected through one owned style element
  (`src/client/styles.ts`) with plain CSS (no CSS Modules, no `:global`
  wrappers).
- UI copy is plain Chinese; there is no i18n registration.
- UI surfaces follow the host design system (`src/client/styles.ts`): colours,
  radii, shadows, type and motion come from `--dsw-*` / `--ds-*` tokens;
  popovers use the host menu material + `--dsw-menu-backdrop-filter`, dialogs
  use the opaque `--dsw-alias-bg-layer-3` with `--dsw-elevation-prominent`,
  and settings content is card-based. Do not reintroduce self-drawn fills,
  fixed 430px windows or draggable popovers.
- Balance is **DSH account only** (2026-11-14): the host reuses the
  `deepseekAccount` service (`getState()` then `getBalance(AccountClientMetadata)`),
  which is the same recharge + bonus wallet query Settings → 账号与余额
  renders. Resolve it lazily with `ctx.get('deepseekAccount')`; do **not** add
  it to `inject` (the web profile may not ship the account bundle). Signed out →
  the card keeps the local estimate and points to Settings → 账号与余额; a null
  wallet result while `getState()` says `credential-stored` is `pending` (retry,
  never an error); a failed wallet query retries. Do not reintroduce an API-key
  balance path, a key form, or a Node/curl balance transport. The card shows
  granted/topped-up amounts, a zero-balance hint and the account service's
  usage/topUp links. The legacy `apiKey` state/credential helpers remain only
  for old state documents and status diagnostics, not as a balance source.
- Tariff rules (2026-11-14): the official page lists **peak** CNY prices per 1M
  tokens — Flash 2 / 0.04 / 8 and Pro 9 / 0.30 / 27 for input / cache-hit /
  output — and off-peak is exactly half. Peak = Beijing weekdays 09–12 / 14–18
  **excluding Chinese statutory holidays**; weekends and holidays are off-peak
  all day. `src/usage.ts` carries the holiday ranges (2026/2027, checked from
  the State Council notices) and must be extended when the next notice ships.
  `src/pricing.ts` is the single source (checked date + one-line note); `peak*`
  counters drive the split and `exact` stays false until a rescan fills them.
  The docs page's markdown conversion can collapse the table and drop the peak
  rows and footnote — verify against the raw HTML/curl, never WebFetch alone.
- Usage attribution: an event that arrives before its own `request/context`
  (title generation) falls back to the session model, then the last model seen
  anywhere — never a fake `unknown` row. The first open of the balance card
  backfills today's ledger with one rescan when it is empty or still contains
  `unknown`; keep that one-shot guard so a card open cannot become a scan loop.
- Floating surfaces are built from `src/client/ui/overlays.tsx`: `Popover`
  (anchored, flip/clamp, Escape/outside close, focus return), `Dialog`,
  `usePresence` (exit animation) and `ToastStack`. Open/close motion is
  150–220 ms (the popover leaves from its anchor side via `--vx-pop-shift`;
  dismissed toasts stay mounted in place for their exit) and is disabled under
  `prefers-reduced-motion`.
- Motion tokens (`--vx-ease-out`, `--vx-dur-pop`, …) live on `:root`, not
  `.vx-root`: the settings page and the dialogs/toasts it owns render outside
  our overlay layer, and an undefined custom property invalidates the whole
  `animation`/`transition` shorthand there. Extend the reduced-motion block
  when adding a surface outside `.vx-root`.
- Liquid glass is one SVG filter owned by `custom.tsx` and referenced from
  `backdrop-filter`. The displacement map is generated from a rounded-rect SDF
  at alpha 255 (Chromium premultiplies transparent PNGs to zeros), encodes the
  normal in R/G, and uses `primitiveUnits="objectBoundingBox"` with `feImage`
  at 0..1 (percentage values only refract the bottom/right edges). Extend the
  filter region past the box and end with `feMerge` of the displacement result
  only. Keep the fill around 70% of the host menu token; lower values make the
  text panels unreadable. Liquid popovers animate with translate/fade only —
  `transform: scale()` distorts the filter coordinate space.
- While a **page-level** background renderer is live, `<html>` carries
  `vx-bg-live`: glass uses a radial centre-solid / edge-clear fill and a
  contrast-boosted backdrop chain so the animated texture stays visible at the
  rim without hurting the copy. Do not reuse the uniform idle fill there — with
  the faint ASCII layer behind it, the material looks like the glass switch did
  nothing. `ocean` renders in the conversation column, so it must not set this
  class or the live filter: there is no page texture behind the header/settings.
- The non-backdrop palette token set keeps `--dsw-alias-bg-layer-2` opaque: the
  shell settings dialog paints itself with that token, and an alpha there lets
  the conversation text bleed through the settings page whenever no page
  renderer installed the backdrop set. The page renderer also gets a bounded
  self-heal (three retries) if its first DOM append is lost while the shell
  settles.
- Every anchored card shares one shell in `styles.ts`: `.vx-popover` is a flex
  column with `overflow:hidden`, the head is `12px 14px 6px`, the single
  scrolling `.vx-pop-body` is `4px 14px 10px`, and an optional `.vx-pop-foot`
  is `6px 14px 12px` with a top border. Do not give a card its own padding or
  scroll container — that is how the balance card drifted into a different
  surface. The header balance card is a one-screen summary (today + monthly
  budget + 刷新/扫描/完整用量); 7/30/90-day ranges, CSV and balance detail stay
  in Settings → 用量与额度.
- dsh Desktop 0.2.2-rc.3 renders plugin popovers in a **separate transparent
  window** (UI Automation exposes the 个性化 popover as a `window`; the main
  document has no `.vx-popover`, no iframe, and `body` contains only the icon
  sprite, `#root`, `#vx-lg-filter` and `#vx-bg`). `backdrop-filter` therefore
  has no page pixels to sample there: a translucent glass fill shows the body
  text / weather / live background crisply through the panel, which is the
  "背景动效与玻璃无法并存" report. Plugin floating surfaces must carry a
  legible fill of their own and treat blur/refraction as a Web enhancement,
  never as the readability mechanism. The two modes are a real material pair,
  not two fills: frost is an opaque milk pane (~90% neutral white + 30px blur)
  with no edge optics; liquid is Apple-style clear glass — a colourless body at
  86%→78% (popovers/dialogs) and 90%→82% (settings sheet), with the lens carried
  by edge optics: a 1px specular rim with a faint cyan/magenta dispersion, a
  bright top bevel and a darker bottom inner shade. The settings page is one
  glass sheet painted from neutral colours, never the host's per-mode tokens,
  so 背景动效 关闭/字符/光影 only nudges transmission by two points and can never
  turn it flat white; cards inside are transparent groups. The settings page and
  the popovers live in separate floating documents, so cross-window backdrop
  refraction is unavailable — the edge optics are the material, and any
  `backdrop-filter` is a Web-only enhancement. `:root.vx-dark` swaps the same
  recipes to their dark values. Appearance saves are broadcast on
  `vx-custom-plugin-state`; a settings surface that runs as a separate plugin
  instance updates the main store, and the receiver only applies cfg, never
  re-saves. Calibrated 2026-11-16 on the live Desktop host.
- Entry map: the header 「个性化」 button opens only the appearance popover
  (`QuickAppearancePanel`); everything else lives in the settings-page hub
  (`SettingsPage`, sections appearance/folders/prompts/search/export/
  extensions/usage/data). Keep one primary entry per feature. Management links
  that need the settings page (balance card 完整用量, appearance 完整设置,
  prompt 管理提示词, palette actions) call `openHostSettings`, which drives the
  host's real entry controls (account menu → 设置, or a direct trigger) and then
  selects our 个性化 nav cell; keep the `Ctrl+Alt+,` toast only as the
  unreachable fallback.
- Pure UI models live in `src/client/ui/`: `anchor.ts` (placement),
  `prompt-model.ts` (validation/tags/filter/sort/import), `folders-model.ts`
  (tree mutations), `command-model.ts` (filter/group/recent). Keep them
  DOM-free and covered by their spec files when changing behaviour.
- Settings-page components may not receive the session/workspace hooks; the
  folder tree degrades to ids instead of failing. Do not assume `useSessions`
  props exist on `settings.section`.
- The host settings overlay is a body-level `position:fixed` layer at
  `z-index:1000`, above the shell overlay layer that contains `.vx-root`.
  While our hub is mounted it sets `settingsSurfaceOpen`; global modals, the
  command palette and toasts then render from `SettingsOverlays` inside that
  page. Rendering them from `.vx-root` while settings are open makes them
  invisible behind the host panel.
- All decision surfaces use `ui/overlays.tsx`'s `Dialog`; do not reintroduce
  the retired `.vx-modal` / `.vx-modal-mask` classes. The prompt editor must
  confirm before discarding a dirty draft on Escape/mask/Cancel.
- `settings.section` may receive no session/workspace hooks. `SettingsPage`
  falls back to `useBridgedSessions` / `useBridgedWorkspaces`, which read the
  shallow snapshots mirrored into `sessionIndex` / `workspaceIndex` by the
  always-mounted `OverlayRoot`. Keep those snapshots reference-stable to avoid
  a store render loop.
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
  in-process one. On Windows a rename can still hit EPERM/EACCES/EBUSY while a
  scanner or the other host holds the destination: `replaceStateFile` retries
  with backoff, fails fast when the target is a directory, and only then falls
  back to an in-place write verified by reading the document back.
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
  the `vx-bg` background layer, anti-scroll's
  `scroll-behavior`/`data-vx-anti` attributes, in-place Mermaid
  wrappers, pending balance/load-retry/greeting timers, the calm-zone measure
  poll); a new global effect
  added to the appearance painter or the chat-DOM scanner needs a matching
  line in the disposer at the bottom of `src/client/custom.tsx`. `saveCfg`
  refuses to POST until a state read has succeeded (`cfgLoaded`) — unloaded
  factory defaults must never reach the host.
- Page-scoped presets use the page-background layer (`div#vx-bg`), appended to `<body>`, never
  inside `.vx-root`: the overlay slot's ancestor is the shell's
  `.pI_x6G_overlayLayer` (`position:absolute; z-index:20`), so `.vx-root`'s
  2147483000 only orders plugin surfaces locally and native dialogs at body-level
  `z-index:1000` paint above the weather FX (measured live on 0.2.1-rc.5). The
  layer is `position:fixed; inset:0; z-index:-1; pointer-events:none;
  aria-hidden="true"`. `<html>` is transparent while `body` carries the opaque
  canvas fill, so a negative z-index child paints above the body fill and below
  every content surface. Those surfaces are translucent only with glass on,
  and even then they are not "one" surface: the reading column stacks three of
  them (`--dsw-alias-bg-base` twice and `--dsw-alias-bg-layer-1` once), so the
  ink that reaches the eye is the product of their *complements*. At the
  shell's glass values (0.5 / 0.5 / 0.6) that is **0.10** in the column and
  0.24 in the sidebar — an ink step of 162 raw luma composited to 16 luma.
  That, not the ink ΔL (already near-black), is the real "看不见" bottleneck:
  every previous calibration measured its numbers through a 10% window and the
  user was right that it read as a flat wash. Measured live 2026-11-08
  (1280×822 CSS / DPR 1.5, light 天青灰, glass on); with `glass:false` the
  shell paints the same surfaces fully opaque, i.e. 0% reachable.
  - The **backdrop token set** is the fix, and it is part of the layer
    contract: while *any* renderer is mounted — glass on or off —
    `applyAppearance` overrides the three shell fill tokens above at
    `BACKDROP_ALPHA_BASE = 0.25` / `BACKDROP_ALPHA_LAYER1 = 0.27` /
    `BACKDROP_ALPHA_SIDEBAR = 0.27` (palette.ts), keeping each token's own RGB.
    The complements multiply out to ≈0.41 in the column and ≈0.40 in the
    sidebar — 4× the ink — and because the canvas tint equals the same family
    colour, the page hue does not move at all: the on/off delta is pure ink.
    Cards (`.GRgSLq_card`), dialogs, menus and the composer keep their own
    untargeted opaque fills, so text-heavy surfaces never get texture behind
    them; `-bg-layer-2` and `-bg-overlay` are deliberately left alone (they
    paint menus, and no measured content surface sits behind them).
    `appearanceTokenKey(bg, glass, backdrop)` folds the flag into the key
    (`'backdrop'` for the neutral family, `|backdrop:1` for a palette), and the
    panel note states that the page fills go translucent while the effect is
    on; the glass toggle is never overridden. Do not raise these back toward
    the shell's glass values — that is exactly the 10%-transmission state the
    user rejected, and no ink delta can compensate for it.
  `applyAppearance` creates/updates the layer through `src/client/bg-layer.ts`
  (`decideBgLayer` / `mountBgLayer`), and the disposer destroys the renderer and
  then calls `unmountBgLayer` because slot unmount can run after the disposer.
  Config is `bgFx: 'none' | 'ascii' | 'shader'` (default `'none'`) plus
  `bgFxPreset` (default `'flow'`), one flat field shared by both tiers: the
  ASCII tier owns `flow`/`rain`/`ocean`/`starfield`/`ripple`/`static`, the
  shader tier owns `liquid`/`grain`. `normalizeCfg` narrows it one-way by the
  current tier (`shader` → any id outside the shader list becomes `'liquid'`;
  `ascii`/`none` → any id outside the ASCII list becomes `'flow'`), and the
  Phase 1 boolean archive migrates `true → 'ascii'`, `false → 'none'`, any
  other value → `'none'`.
  Gate: the shader tier needs WebGL1 and falls back to ASCII when only
  `canvas2d` is available; the ASCII tier needs `canvas2d`; with neither the
  layer does not mount and the body tint stays. `prefers-reduced-motion` →
  `data-vx-bg-motion="static"`; hidden → `"paused"`; theme palettes flow in
  through `--vx-bg-tint` (`bgLayerTint` uses `toDarkRamp`).
- The calm zone (内容区感应淡出) is the second half of that contract:
  `src/client/bg-focus.ts` is the pure geometry both renderers share. The zone
  is the reading column — the **composer's span** horizontally, from the
  transcript viewport's top down to the composer top — measured live every
  350 ms (`measureFocusRect` in `custom.tsx`, poll owned by the disposer) plus
  once per appearance repaint, so resize, sidebar collapse/expand, panel
  open/close and full-screen all move the mask with the text. Round 4 corrected
  the horizontal rule after the user reported "内容区感应淡出好像并未生效": the
  round-2/3 rect took the transcript viewport's content box (`x 280..1273`,
  993 px), but the body copy measures only `x 437..1112` (675 px) and the
  composer `421..1129` (708 px) — the 157/161 px on each side are visible
  **gutters** of the content surface with no text in them. With the viewport
  rect the whole content area sat at the floor and the only full-strength bands
  were under the header (y < 116) and the sidebar (x < 280): the mask was
  numerically present (canvas column mean ink 0.0151 vs sidebar 0.0599, 3.96×,
  coverage 9.6% vs 24.2%) and visually absent — a page-scale A/B of mask on vs
  floor 1 read as one flat wash. The composer span matches the text measure
  within 16 px on each side, so no glyph ever lands outside the zone and the
  gutter keeps the texture. The composer is the anchor *and* the horizontal
  source — the lowest wide `[role="textbox"]` locates the transcript and
  supplies the bottom edge; with no scroll ancestor (hero layout) the zone
  falls back to the composer's own span with the viewport top at 0.
  `focusWeight` uses the *diagonal* distance outside the rect (`hypot` of
  per-axis overflow, not `min`), normalises by `FOCUS_FEATHER_PX = 150` and
  smoothsteps from `FOCUS_FLOOR = 0.15` to 1, so the edge is a feathered band
  and the centre keeps a barely-there texture rather than going blank.
  Both numbers are measured, not taste. Round 4 lowered the floor 0.45 → 0.15:
  a uniform 45% inside a zone that covers the reading area has nothing to be
  compared against, and the 0.3/0.6/0.45 A/B above was taken while the rect
  covered the whole viewport. At 0.15 the paragraph area measures 0.0060 mean
  ink (4.75% coverage, static flow) against 0.0744 in the sidebar, and the text
  contrast can only improve from the 14.32:1 measured at 0.45. The feather stays
  150 for the opposite reason: it was A/B'd at 220 and rejected — a band wider
  than the 141 px gutter pushes full strength outside the visible content
  surface (gutter mean 0.0141, ratio to the column 2.37×, i.e. the effect
  shrinks again). At 150 the weight reaches 0.97 at the gutter's outer edge,
  so the gutter ramps 0.15 → ~1 across the width the eye can see. Round 4's
  final numbers were re-taken on a harness that mounts the real `bg-ascii`
  module into a real DOM at 1280×822 / DPR 1.5, because the live host stopped
  booting mid-round (Desktop auto-updated to 0.2.2-rc.1 and its shell aborts
  with `desktop welcome: Web authentication failed`, leaving the page on
  "Loading plugins…"). The harness reproduces the live column reading exactly
  (0.00597 mean / 4.75% coverage) and at feather 150 reports sidebar/column
  **12.39×** and left-gutter/column **3.83×**; the x 281→461 profile is flat
  without the mask (0.023–0.046, only the piece's own variance) and collapses
  monotonically inside the zone with it (0.0455 → 0.0097). With
  `bgFocus:false` the same region reads 0.0567 mean / 23.08% coverage — 9.5×
  the masked value — while the sidebar stays bit-identical at 0.0740, i.e. the
  mask is out of the pipeline rather than neutralised. Preset survival at this
  floor (masked/unmasked coverage): flow & static 0.21, rain 0.43, ocean 0.44,
  starfield 0.21, ripple 0.54 — none is flattened to a blank page.
  A **shallow ellipse** was A/B'd and rejected: at the same floor it put 25.9% ink coverage
  in the column's top-left 120 px corner against 11.1% for the soft rectangle
  (16.0% vs 8.4% bottom-right), i.e. full-strength `@` behind the first
  lines. A rectangle with diagonal corners keeps the fade band parallel to
  the text edges, which is the property that matters — the zone is a
  rectangle because the text is a rectangle. ASCII caps every cell's level
  with `buildFocusCaps` (`cap = round(lastLevel × weight + dither)`, one
  reused `Uint8Array`, rebuilt only on grid/zone change, read once per cell
  in the blit); shader passes `u_focus` (vec4 CSS px) with `u_focusFeather` /
  `u_focusFloor` and multiplies the ink by the same `focusWeight()` in GLSL,
  `u_focus.z <= 0` disabling it. `tests/bg-focus.spec.ts` pins the shipped
  floor into 0.10–0.20 and the feather into 120–180 so a drive-by retune fails
  while a deliberate one still passes, and pins `focusRectFor` (below) so the
  off state can never quietly fall back to "weight 1 everywhere".
  The toggle contract: `bgFocus` is one flat cfg boolean (default `true`; a
  document written before the field existed reads as `true` with no migration).
  When it is `false`, `focusRectFor` returns `null` and that is the *only*
  thing the renderers receive — no `buildFocusCaps` allocation, no `u_focus`
  upload, no 350 ms measure poll (the appearance repaint pushes `null` and
  stops the timer). It is deliberately not "set the floor to 1": that would
  keep the whole pipeline running to produce a page identical to no mask.
  Live A/B with the backdrop token set (flow, light, standard ink, corrected
  rect, 2026-11-08): the page moved >2 luma on **31.0%** of pixels (p99 47,
  mean 4.25), the commit sidebar on 94.6% (mean 7.8) and the header on
  48.9%, while the reading column stayed at 9.4% moved / mean 3.0 / max 96 —
  at 1:1 the edges read as an unmistakable character field and the column as
  a faint texture that never obscures the copy. Measured directly on the
  renderer's own canvas: the column sits at 10.2% ink coverage against 25.9%
  in the sidebar and 11.0% above the column, and the cap follows the composer
  across 1280×822 → 1600×1000 → back, survives a sidebar collapse (mask moves
  to `x 0`, width 1273) and a panel open/close (composer top 702 → 482 → 702).
  `liquid` at intensity 0.70 moves 74.4% of the page with the column at
  77.1% moved / mean 9.6 — it is a continuous field, so the floor reads as a
  full-surface wash rather than glyph texture; that is the honest shape of
  the tier, not a mask bug.
- Round-3 cross-check (2026-11-08, same host, 48 cells: six ASCII pieces +
  two shader styles × light/dark × soft/standard/strong) fixed the *ruler* as
  much as the values: **measure the renderer's own canvas** (hide every
  `body > *` except `#vx-bg`) or read the fade band's profile. Neither
  page-level ruler is universal — a page-level `|on−off|` mean is diluted by
  the sidebar's opaque cards (that is how `grain` read 0.90 while its canvas
  reads 0.46), and the ASCII canvas coverage ruler only holds on light (it
  assumes ink darker than the surface; dark ink is lighter, so it reads
  98–100% everywhere). `strength` is a second axis, not a mask knob: light
  `flow` holds 0.39/0.40/0.40 across the three steps while ink mass climbs
  2.49 → 3.85 luma. Per-piece survival on the light canvas (column vs left,
  coverage/mean): flow & static 10.2%/0.017 vs 25.8%/0.065, rain 6.5 vs 7.8,
  ocean 2.5%/0.004 vs 3.7%/0.010, ripple 8.3 vs 8.1 (the feather does not cut
  the contours), starfield 0.1 vs 0.2 — starfield is the one 偏弱 cell: half
  its grid is blank by design and it carries no dither, so `round()` takes
  low levels to 0 inside the calm zone and ~10 bright stars are left. **No
  per-piece focus floor was added** — an exemption lets any piece opt out of
  the contract and invalidates the flat calibration table. Dark verdicts rest
  on the page ruler (0.29–0.65 across all eight pieces): mask present,
  granularity limited by the smaller ink. The shader tier's `u_focus`
  multiply leaves no seam (text-free band y650..690: mean adjacent step 7.3,
  max 8.0 luma/device px), and `grain` is masked on its single static frame —
  column median 208.7 vs sidebar 178.9 against an un-inked surface of 234.7
  is 0.46, three captures 1.2 s apart are pixel-identical, and the
  1100×760 resize repaint is masked too, so it is not "one full-strength
  frame and never again". Its 31-luma page-median darkening is the piece's
  own shape, not a mask miss. Cost is one array read per cell inside the
  existing blit (23,040 cells: −0.02 ns/cell, i.e. noise) plus one
  `buildFocusCaps` rebuild per zone change (0.103 ms on a 350 ms cadence);
  measured idle is ascii 48.1% CPU / 24 fps / 0 long tasks (the cost is the
  pre-existing per-cell `drawImage`), shader 8.3% / 0.2 ms p95, and
  `bgFx:'none'` 0.3% with no rAF at all. Text contrast 14.46 → 14.32 light
  (all three strengths) and 2.29 → 2.30 dark. Off→on→off trips are
  symmetric (nodes 1842/1844/1842, `#vx-bg` 0/1/0, canvases 1/2/1,
  `setInterval` 2/3/2, listeners 31/31/31 and 36/37/36).
- The renderer is `src/client/bg-ascii.ts`, mounted as one canvas inside
  `#vx-bg`. The effect contract is
  `(t, out, cols, rows, input?, emphasis?, overlay?) => void`: pieces write ramp
  levels, never strings, into one reused `Uint8Array`. `input` is grid-space
  pointer state, `emphasis` marks cells that must stay visible inside the calm
  zone at `EFFECT_FOCUS_FLOOR`, and `overlay` carries sparse non-ramp glyphs
  (fish bodies) that the renderer draws with `fillText` after the atlas blit. Level 0 is
  blank in both themes and the ramps climb in ink density; the theme only swaps
  the ink (single colour from `inkFor`, `LIGHT_INK_DELTA −0.7` on a light
  surface and `DARK_INK_DELTA +0.15` on a dark one), never the glyph order or
  the alpha ramp. The two deltas are **independent constants**, calibrated
  2026-11-08 on a live 1280×822 dpr-1.5 host with a backdrop-only ruler (text
  ink masked out with a 3 px dilation, so nothing is sampled from a glyph or a
  text halo). The light side was re-taken on 2026-11-08 after the user rejected
  the previous 1%-Michelson target as "根本看不出来": −0.31 measured 0.15%
  mean ink mass / 2.99% peak *through a 10% transmission window*, so the
  numbers described a picture nobody could see. −0.7 puts the ink at 179 luma
  below the surface (ink luma 55 on 234.8), and **the ink step is not the
  binding constraint once it is dark**: the glyph *area* is (see
  `FLOW_LEVEL_FLOOR`). On dark the eye is also less sensitive (DeVries-Rose:
  threshold contrast ∝ 1/√L), so 234.8 vs 29.8 luma puts the equal-perception
  point at ~2.5–2.8× the *relative* modulation, not the same number: +0.15
  measures 0.34% mass / 8.17% peak, i.e. 2.1–2.7× light across all eight
  pieces, while the old +0.38 measured 6.7× (9.37% Michelson) and read as the
  loudest thing on screen. +0.10 only reaches 1.4× and reads weaker than
  light. Do not shrink the light delta or grow the dark one: those are the two
  visibility regressions, not taste adjustments. Glyphs
  are pre-baked into one per-level atlas, so a frame is one
  `fillRect` plus one `drawImage` per non-empty tile — no per-frame allocation.
  The atlas key is `charset|shape|ink|dark|dpr|tileW|tileH|fontPx|opacity`, so
  a preset switch rebakes only when the ramp, the ink string, the shape-aware
  flag or the cell geometry changes. Shape-aware presets append 5–7 directional
  tiles to the same strip (see below).
- Shape-aware rendering (2026-11-13, ported from the community): `flow` /
  `static` / `ripple` set `shapeAware: true`, and the renderer reads the raw
  level buffer's local gradient (±2 cells; direction 1 = vertical, 2 =
  horizontal, 3 = "/", 4 = "\") and swaps a ramp glyph for a directional extra
  of similar ink weight. The chart is `level × 5 + dir`; direction 0 always
  keeps the calibrated ramp, and an extra is used only when its ink mass is
  within one ramp step. Extras live in `SHAPE_EXTRAS` (blocks: `_ - = ! | / \`;
  classic scaled to its 16 levels); the `dots` pieces and `rain` stay plain.
  The idea and the MIT implementation are credited in the code —
  alexharri.com/blog/ascii-rendering and github.com/aleyan/glyph-graphics —
  and no dependency was added. Cost: four neighbour reads per cell (harness
  flow stays at 20.1 fps / 45.3% TaskDuration). Grid cell comes from measuring 50 `M` advances (`cellH = fontPx ×
  1.15`), DPR is capped at 2, `density` multiplies the cell size, and
  `MAX_COLS = 240` / `MAX_ROWS = 96` widen the cell rather than truncating the
  grid.
- The degradation ladder is fixed and only moves down: L1 fps 24→15, L2
  density ×0.75, L3 mono (already satisfied by the single-ink atlas), L4 dither
  off, L5 one static frame and `cancelAnimationFrame`, L6 surface only. A rung
  steps after two consecutive 60-frame windows whose mean interval exceeds
  `budget × 1.6`; a good window clears one bad window; `setPreset` resets to
  L0. L6 is not reachable from the automatic ladder because L5 already stops
  rAF; it exists for the explicit off path. Hidden stops rAF and freezes
  accumulated time; resume paints immediately; a theme flip rebuilds the atlas
  and repaints even in static mode. Teardown covers the canvas, rAF, resize
  timer, `visibilitychange`, the reduced-motion and resolution queries, the
  `ResizeObserver`, the atlas/probe canvases, and the levels buffer.
  `body{background-color:transparent}` applies only while the verdict mounts;
  with `bgFx:'none'` the page is pixel-identical to the pre-renderer baseline
  (live A/B diff, 2026-11-06).
- Phase 3a ships six ASCII presets, each a distinct piece rather than one field
  with different knobs (`createPresetPiece` dispatch): `flow` a drifting value
  noise field (`blocks`, dither, 0.65/24 fps); `rain` per-column falling trails
  with a bright head and a quadratic fade tail, 14% dormant columns, 16-level
  `classic` ramp and no dither (0.75/24 fps); `ocean` a living water surface
  (`dots`, 11 px, dither, 1.5/24 fps): a divergence-free current, a noise-contour
  crest field over a 20% one-step speckle, an 18-small-fish school plus two
  large multi-cell koi, and the pointer interaction below;
  `starfield` sparse depth-parallax stars, >50% blank cells, no dither at
  fontPx 14 (0.65/20 fps); `ripple` three fixed concentric-ring origins with a
  `CELL_ASPECT = 1.9` y-correction and dither off to keep the contours
  (0.65/24 fps); `static` the deterministic flow frame at zero rAF. Ink always
  derives from the surface brightness, so every preset reads on both themes
  and all palettes; nothing neon or saturated is allowed in. The 2026-11-11
  defaults are the panel values the user signed off during the Desktop
  verification pass, one step lighter after the range pass: the ASCII canvas
  `opacity` is 0.55 for flow/rain/starfield, 0.45 for `ocean` and 0.60 for
  ripple/static (was 0.60/0.65; `ocean` then went two steps further down
  because it lives inside the conversation column) — that axis is part of the
  shipped look, not a leftover override.
- Every piece carries its own `inkScale` on top of the theme's base ΔL
  (`1.0 flow/static`, `1.1 rain`, `1.25 ripple`, `1.2 ocean`, `1.6 starfield`),
  because the same ΔL on a block glyph and on a dot glyph are not the same
  picture: a `dots` cell carries ~1/6 of a `blocks` cell's ink. Per-piece
  calibration 2026-11-08 (light, standard strength, coverage / mean ink mass /
  peak): flow 9.78% / 0.15% / 2.99%, rain 4.76%/0.08%/3.08%, ocean was
  4.03%/0.12%/4.37% and was 6.25%/0.17%/4.37% at density 0.65 before the
  interactive round moved the default feel to soft + 0.6, starfield was
  0.23%/0.01%/3.94% and is 0.37%/0.03%/5.15% at fontPx 14, ripple 6.98%/0.11%
  /3.11%, static tracks flow. Rain and grain deliberately stay put: rain's peak
  already matches flow's and motion is its signal (13.3% of cells change in
  1.2 s, the highest of all six), and grain already measures the highest ink
  mass of the eight pieces (0.55% light / 1.34% dark = 2.4×, dead centre of the
  dark target) — raising either pushes dark into the competing band for a
  table that looks prettier. Starfield stays sparse on purpose (>50% blank
  cells); only its glyph size and ink step were lifted so "sparse" stops
  meaning "absent".
- Pointer interaction (2026-11-09; `ocean` first, then `flow`, `rain`,
  `ripple`, `starfield` and the shader tier's `liquid` on 2026-11-11). The
  contract, in order:
  - `src/client/bg-pointer.ts` attaches `pointermove` / `pointerdown` /
    `pointerup` / `pointercancel` / `pointerleave` / `blur` to the window with
    `{passive:true}`. It never calls `preventDefault`, never reads layout, never
    starts a frame, ignores touch moves (a touch tap is still a press) and
    removes exactly those listeners in the disposer. The renderer maps CSS px
    to grid cells once per frame; the piece only sees `AsciiInput`.
  - Feel contract (2026-11-11, the open-source interaction round): the position
    follows the raw sample with `POINTER_POS_TAU_MS = 70` (time-based, so the
    `lerp ≈ 0.15` feel is identical at 60 and 1000 Hz; every step carries at
    least 8 ms so coalesced samples still move) and the velocity with
    `POINTER_VEL_TAU_MS = 90`. Below `POINTER_DEAD_SPEED = 80` CSS px/s the
    reported velocity is exactly zero (smoothstep onset up to 2×), so a resting
    hand never stirs the fog, bends the rain or spins the eddy. Both tiers call
    `syncBgPointer` once per *existing* frame: it eases the remaining distance
    after the last event, damps the velocity after 90 ms without input and
    snaps everything to zero at `POINTER_IDLE_MS = 1500` (velocity 0, position
    on the target), so no piece can run on a stale sample. A press snaps the
    position to the click and **keeps** the incoming velocity — that is what
    lets `ripple` throw a harder ring from a flick. The four constants are
    exported and pinned by `tests/bg-pointer.spec.ts`.
  - `src/client/bg-field.ts` owns the shared primitives (`quantizeLevel`,
    `hash2`, `valueNoise`, `shade`, `AsciiInput`, `AsciiPiece`,
    `OVERLAY_GLYPHS`) so `bg-ocean.ts` does not import the renderer.
  - `src/client/bg-wake.ts` is a two-buffer wave equation (`height` +
    `velocity`, five-point Laplacian, `WAKE_C2 = 0.28`, damping 0.975, decay
    0.993). The field is signed: crests add ink and strong troughs clear it, so
    a click's dipole draws a bright ring around a small hole instead of
    saturating a disk to the top of the ramp. The one-cell border is absorbing,
    and the whole pass is O(cols × rows) with no per-frame allocation.
  - `src/client/bg-ocean.ts` keeps 18 small two-cell fish and two large koi.
    Small fish are `>#`/`<#` direction marks plus a body cell; koi are 28-cell
    silhouettes (`#` body, `%` edge, `@` head, `~` tail) through `overlay`.
    Steering is boids-lite (alignment / cohesion / separation / mill), the
    pointer pushes fish away within 6 cells, a click startles within 9 cells
    and the school regroups through the fear decay. The water is a
    noise-contour crest field whose one-step speckle is tied to the crests
    (spray on the wave) rather than spread over every cell: troughs stay empty,
    which is what keeps the sea from reading as dust and from mixing with the
    copy. A full dot grid was rejected because it reads as graph paper **and**
    defeats the calm zone (the cap can only step a glyph down, never remove
    it). The ambient swell peaks at 0.45 of the ramp, deliberately leaving the
    top levels to the pointer:
    crests add dots (`+h × 1.5`) and troughs below −0.06 clear them, so a wake
    reads as a bright ring plus a hole. A drag drops one small dipole ring per
    0.16 s and 4 cells (`DRAG_RING_TIME` / `DRAG_RING_DISTANCE`) plus a faint
    trail, so the path reads as a row of expanding rings rather than a lifted
    patch; a click widens the same four rings (width 1.8–2.6 cells).
  - Emphasis: only positive wake crests above `EMPHASIS_WAKE = 0.09` (or fish
    cells) may bypass the calm zone, and only up to
    `EFFECT_FOCUS_FLOOR = 0.65` of the ramp (`bg-ascii.ts`). The 2026-11-11
    interaction pass raised it from 0.5 so a user-caused ripple reads clearly
    under the copy; the ambient stays at the 0.15 floor. Troughs add no ink
    (they clear dots) and stay masked. The renderer
    allocates `emphasis` / `overlay` only for `interactive` presets, clears them
    per frame, draws overlay glyphs with `fillText` (≈90 cells/frame) and
    reports `stats.emphasisCells` / `stats.overlayCells`. `gridInput.active` is
    false while paused, static, reduced-motion or L5+, so a pointer move cannot
    wake a stopped loop.
  - Harness measurement 2026-11-09 (headless Edge, real DOM, 1280×822 CSS /
    DPR 1.5, 126×38 grid; renderer canvas pixels, not page screenshots): idle
    20.0 fps, TaskDuration 26.5% of wall; drag 20.0 fps / 27.8%; click 20.0;
    idle coverage column 1.53% vs sidebar 2.58%; after a click column 3.81% vs
    sidebar 7.16%; same frame with the mask off column 11.79% vs 4.11% with it
    on; `data-vx-bg-motion="static"` + a pointer move paints 0 frames. These
    are harness numbers; the live Desktop pass is recorded in CHANGELOG.md.
  - `flow` is the second interactive piece (2026-11-11) and is page-scoped, so
    it needs no column anchor. Its fog is two value-noise octaves (0.7 body,
    0.3 filament) so the field has detail instead of reading as one flat wash;
    `static` shares the exact same formula at `h = 0`, and the preset test pins
    the byte-identical t=0 frame. It keeps the same wave tank as a
    *displacement* field rather than a water surface: `h` bends the noise coordinates
    (`+h*1.4` / `+h*0.9`) and adds ink (`+h*0.18`), so a pointer trail reads as
    stirred fog instead of a bright brush stroke. A drag injects a **curl
    dipole** — two opposite lobes offset ±(1.6–3.0) cells either side of the
    path — plus a weak centre lift, so the fog is stirred rather than painted;
    the splat radius (1.8–4.0 cells) and the swirl both grow with pointer
    speed. A hand that rests (velocity under 10 cells/s) feeds a per-cell
    `bleed` field (rate 0.8/s, τ 0.8 s, ellipse 4 × 2.2 cells, floor 0.002)
    that thickens the ink by up to `bleed × 0.45`, so damp fog accumulates
    after about a second and fades in roughly two. A click reuses the same
    two-ring dipole as `ocean`; cells with `|h| > 0.14` or `bleed > 0.12` are
    marked for emphasis, so a trail or a dwell stays visible inside the calm
    zone at up to 65% while the field between them stays masked.
    `static` shares the field but is built with `createFlowPiece(..., false)`:
    one deterministic frame, no wake allocation, no interaction state.
    Harness 2026-11-11 (headless Edge, real DOM, 1280×822 CSS / DPR 1.5,
    145×44 grid, standard strength): idle column coverage 8.42% (the calm zone
    holds the base field at its floor) vs sidebar 19.42%; after a drag the
    column still reads 8.42% because the trail is clipped to that floor, while
    the sidebar keeps the full texture; after a click 9.48%; 20.0 fps with
    36.0% TaskDuration during continuous dragging;
    `data-vx-bg-motion="static"` paints 0 frames. These are renderer-canvas
    pixels, not page screenshots.
  - `rain` is the third interactive piece (2026-11-11). Its metaphor is wind
    on a curtain, not water, so it does **not** use the wake tank: each column
    carries four column-sized weights — `shift` (steady wind bend), `kick`
    (a press's decaying push), `surge` (the press's head flash) and `repel`
    (the tunnel). A drag sets the wind target from pointer speed (`vx × 0.06`,
    clamped to 5 columns) with a 20-column falloff; the bend follows at
    0.25/frame but eases back at 0.06, so the gust is still readable about a
    second after the hand stops. A press pushes columns away from the click
    across 14 columns (4.5 columns at the centre, decaying ×0.93/frame) and
    flashes only the **two leading cells** of each nearby trail (`surge ×1.0`,
    decaying ×0.94) — the trail behind keeps its own fade, so a press reads as
    a spark at the heads instead of the whole curtain brightening. A *resting*
    pointer carves a repulsion tunnel: columns within `RAIN_TUNNEL_RADIUS = 8`
    are pushed outward up to 2.4 columns (`repel`, 0.3/frame toward the target,
    0.1/frame back) and the destination cell's ink is cut by up to 90% inside
    the radius (smoothstep rim, so the parting edge is feathered), so the rain
    parts around the cursor and closes when it leaves.
    The tunnel is **not** marked for emphasis — it is an absence of ink, and the
    calm-zone floor would push it back up. The trail top bends further than its
    tail (`shear = 1 − 0.45 × row/rows`), which is what makes the drops slant
    like rain instead of sliding sideways as one rigid line. Each column also
    carries a 0.82–1.0 depth brightness on top of its own head speed, so the
    curtain reads as layers instead of one flat sheet. Only the row loop's
    write target changes; head/trail/active are still recomputed per frame and
    no per-frame allocation is added. Without input all four weights stay zero,
    so the frame is bit-identical to the pre-interaction rain; the tails snap to
    zero (`|kick| < 0.01`, `surge < 0.02`, `|shift| < 0.001`, `|repel| < 0.01`)
    so the picture really settles instead of keeping a sub-level residual
    forever. Harness 2026-11-11 (headless Edge, real DOM, 1280×822 CSS / DPR 1.5,
    193×59 grid, standard strength): idle column coverage 1.81% vs sidebar
    3.81%; after a drag column 3.02%; after a click column 2.65%; 20.1 fps with
    13.4% TaskDuration during continuous dragging;
    `data-vx-bg-motion="static"` paints 0 frames.
  - `ripple` is the fourth interactive piece (2026-11-11). The fixed three
    origins stay exactly as calibrated; the pointer may add up to six live
    sources in a fixed ring buffer (`RIPPLE_MAX_SOURCES`, no allocation per
    drop). A press drops one source at the click (`amp 0.40 + min(0.26, speed ×
    0.004)`, ring rate `2.6 + min(1.2, speed × 0.012)`), so a flick throws a
    harder and faster ring than a resting click while a visible ring is still
    ~4 cells out within 120 ms; a drag drops a weaker one (`amp 0.17`, rate 1.7)
    at most every 0.22 s and only after moving 5 cells, which reads as a
    fingertip trail. Sources live 3.2 s and fade linearly; the per-cell distance
    gate (`RIPPLE_REACH = 48`) skips `sqrt`/`sin` for most cells. Inside a
    pointer ring's wave band (`|wave| > 0.04`) the glyph gets one extra step in
    the wave's direction (`±0.085`), so the band reads as a travelling contour;
    every value is a pure function of the source's age, so a cell the ring has
    passed returns to the ambient field exactly. The first pointer sighting only
    records the position — a page that loads under a resting cursor must not
    spawn a ring. Dynamic sources mark `emphasis` where their own contribution
    exceeds 0.06, so a fresh ring stays visible inside the calm zone at the 65%
    cap while the fixed field stays masked. Without input the piece is
    bit-identical to the pre-interaction version, and the frame is bit-identical
    again once every source has expired. Harness 2026-11-11 (headless Edge, real
    DOM, 1280×822 CSS / DPR 1.5, 145×44 grid, standard strength): idle column
    coverage 4.30%; after a drag 5.76%; after a click 9.48%; 20.1 fps with
    36.9% TaskDuration during continuous dragging;
    `data-vx-bg-motion="static"` paints 0 frames.
  - `starfield` is the fifth interactive piece (2026-11-11) and the lightest.
    The field is split into **three depth layers** drifting at 0.05 / 0.10 /
    0.18 rows/s with thresholds 0.975 / 0.966 / 0.956 (far dim, mid medium,
    near bright), so the picture has parallax without a second canvas. The
    pointer column is eased at 0.12/frame and shifts each layer by up to 1.2
    cells (≈15 px) in proportion to its distance from the page centre; the
    offset is rounded onto each layer's own lattice, so the near layer hops a
    cell while the far one stays put. A sparse field cannot be made denser
    without losing its character, so direct interaction is light: a press
    scatters 24 sparks inside a 2.5-cell disc (linear radius, so the cluster is
    bright at the centre); a drag drops 3 every 0.1 s, jittered ±4 × ±3 cells;
    each spark lives 1.4 s in a fixed 28-slot ring buffer and paints a plus
    (centre + four neighbours one level weaker). Dwelling adds the slower cue:
    a per-cell `heat` field (rate 1.6/s, τ 0.408 s = ×0.96 per 60 Hz frame,
    ellipse 11 × 6 cells ≈ 150 px) brightens the stars inside it
    (`+heat × 0.65`) and lights near-miss cells (`hash > 0.84`) as a small
    cluster; both are marked for emphasis. Heat under 0.02 is ignored, so the
    baseline is bit-identical again after the pointer leaves. Harness
    2026-11-11 (headless Edge, real DOM, 1280×822 CSS / DPR 1.5, 83×25 grid,
    standard strength): idle column coverage 0.126%; after a drag 0.458%;
    after a click 0.393%; 20.1 fps (the preset's own pacing) with a low task
    share; `data-vx-bg-motion="static"` paints 0 frames.
  - `liquid` (the shader tier) is the sixth interactive surface. The uniform
    contract gained two vec4s, and they exist **only in the animated style**:
    `u_pointer = [x, y, active, speed]` (CSS px, speed normalised 0..1 from
    `bg-pointer`'s smoothed velocity) and `u_pulse = [x, y, age, active]`
    (`age` seconds on the same clock as `u_time`, so hiding the page freezes
    the ring). `grain` declares `animated:false` and never schedules a frame;
    it deliberately does not read either uniform — a static speck field that
    reacts to the mouse would contradict its own declaration. Both are built
    by `pointerUniform` / `pulseUniform`, clamped into the viewport, and an
    inactive sample is `[0, 0, 0, 0]` so the shader takes one cheap branch.
    The eddy rotates the cloud's sample coordinates around the cursor
    (`fall = 1 − smoothstep(0, 0.22, dist)`; note the non-inverted edges — the
    inverted form is undefined in GLSL and SwiftShader returned the wrong end)
    and thickens the ink under it (`f *= 1 + eddy × 0.42`, angle ×2.9) — a pure coordinate
    rotation is invisible wherever the cloud is flat, which is most of a
    low-contrast field. The position is `bg-pointer`'s already-eased sample
    (70 ms), so it is **not** smoothed a second time (the two stages stacked to
    ~250 ms and the swirl visibly dragged); only the speed uniform is eased
    (0.12/frame), which ramps a flick instead of stepping it. A press launches
    **six overlapping splats** (deterministic offsets within ±0.055 q, radii
    `age × (0.32 + 0.05i)` q/s, weights 0.55…0.30) over its 2.6 s life
    (`SHADER_PULSE_LIFE`), so the response reads as a splash instead of one
    perfect ring. The renderer attaches the same passive window listeners as
    the ASCII tier and detaches them in `destroy`; a window without
    `addEventListener` still boots (the eddy is inert). Harness measurement
    2026-11-11 (headless Edge + SwiftShader, 1280×822 CSS / DPR 1.5, 400×320
    crop at 520,260, block ratio >8 luma, calm zone off): the cloud alone
    moves 13.2% of the crop over 600 ms; moving the pointer to the crop's
    top-left moves block 0 by **0.334**, and the bottom-right position moves
    blocks 11 / 15 by **0.866 / 0.946** — the eddy follows the pointer with the
    pointer's own easing. A press moves **86.4%** of the crop at +140 ms and
    91.3% at +540 ms, because six bands of different radii are still crossing
    it; the focus mask multiplies all of it down in the reading column, which
    is the calm-zone contract rather than a missing interaction.
  - `ocean` is the first **conversation-scoped** preset (`bgLayerScope` in
    `bg-layer.ts`): the page layer and its backdrop token set are not mounted.
    `ColumnBgAnchor` is registered in `conversation.input.dock`; it walks to the
    AppFrame centre column (`pickColumnHost`, pure and unit-tested), inserts a
    fixed `z-index:-1` wrapper as the host's first child, sets
    `isolation:isolate` (and `position:relative` when static) and lets the
    normal ASCII renderer own the wrapper. That stacking context is what makes
    the canvas paint above the column background and below every message
    without touching any other surface. The calm zone applies here too: the
    same viewport rect `measureFocusRect` produces for the page layer is
    shifted by the host's `getBoundingClientRect()` and pushed through
    `setFocus`, and `ColumnBgAnchor` re-measures it on the same 350 ms cadence
    plus whenever `bgFocus` flips. With the switch on (the shipped default)
    the water under the copy sits at `FOCUS_FLOOR`; with it off the whole
    column is uniform. Pointer CSS px are shifted by the host's
    `getBoundingClientRect()` before grid mapping; without that offset a ripple
    lands outside the column canvas. The page layer stays for every other
    preset.
- `flow` / `static` additionally lift their field before quantisation:
  `FLOW_LEVEL_FLOOR = 0.45` (exported, pinned by `tests/bg-ascii.spec.ts`).
  Value noise spends most of its area near 0.5, which quantises onto `+` / `*`
  — measured at 12 px those glyphs carry only 5.5% / 4.4% of a cell's ink
  *area*, against 12% for `#`, 17% for `%` and 23% for `@`. The lift moves the
  typical cell to `#`–`%`, 2–3× the ink mass on screen, and it is the reason
  the round-1 A/B reads as texture instead of a wash. The numbers in the
  per-piece table above are pre-lift (they measure the *ink step*, not the
  area) and stay valid for the other four pieces; do not "restore" the blank
  half of the ramp to make the field subtler — that is the state the user
  rejected, and it is now the calm zone's job to keep the reading column quiet.
- Each spec carries `ranges` (`density`/`speed`/`fps`/`fontPx`/`opacity` min +
  max) next to its defaults, for the Phase 3b custom panel. Every numeric
  default is the **arithmetic midpoint** of its own range (2026-11-11, user
  request: a default slider must sit mid-track so the picture can be tuned
  lighter *and* darker — 浓度 used to start at its minimum and could only get
  darker). Only the bounds moved; the shipped default look is unchanged, and
  `tests/bg-params.spec.ts` pins the midpoint for all five ASCII knobs and the
  four shader knobs, so a range edit that re-centres away from the default
  fails. Defaults must still stay inside those bounds (pinned by
  `tests/bg-ascii.spec.ts` / `tests/bg-shader.spec.ts`). `fps` is the author's
  pacing, not a performance ceiling: ocean 24, starfield 20 and ripple 24 are
  deliberate and measured with 0 dropped frames and 0 long tasks on a
  1440×900 live host, so lowering them is not a degradation signal.
- Preset switching reuses the same canvas, grid buffer and piece factory; only
  the atlas rebuilds, and only when its key changes. Since the 2026-11-11
  defaults, `flow` and `static` differ on canvas opacity (0.55 vs 0.60), which
  is part of the atlas key, so crossing that pair rebakes once; `ripple`
  shares the ramp and cell geometry but carries its own ink step (1.25) and
  opacity, so it rebakes, and `rain` (`classic`, 1.1), `ocean` (`dots`, 11 px,
  1.2) and `starfield` (`dots`, 14 px, 1.6) differ on ramp, geometry and ink.
  `setPreset` resets the ladder to L0, then either stops the loop and
  paints one frame (paused/static/reduced/L5) or draws an immediate frame and
  restarts rAF, so no blank frame or leftover preset frame is left behind. The
  custom panel stays deferred.
- The shader tier is `src/client/bg-shader.ts`: one WebGL1 context, one
  full-screen triangle (`[-1,-1, 3,-1, -1,3]`), one inlined fragment shader per
  style, no library. The uniform contract is fixed: `u_time` (seconds, frozen
  while hidden), `u_resolution` (CSS px, never backing px), `u_dpr` (≤2),
  `u_surface` / `u_ink` (0..1 vec3 from `--vx-bg-tint` and
  `inkFor(surface, isDarkSurface(surface), spec.inkScale)`, so the ink keeps
  the same per-theme ΔL and the same strength multiplier the ASCII tier uses),
  `u_speed`, `u_density`, `u_intensity`, `u_seed`;
  `shaderUniforms` clamps every value to `SHADER_UNIFORM_RANGES` so a
  hand-edited state file cannot push the GPU outside the documented band.
  Styles self-declare motion: `liquid` is an animated 3-octave domain-warped
  ink cloud at 24 fps, `grain` is a static CSS-pixel speck field with an edge
  falloff and `animated:false` — that declaration is how the zero-rAF path is
  reached without pixel sniffing. Each style carries `ranges` next to its
  defaults (pinned by `tests/bg-shader.spec.ts`). Re-tuned 2026-11-08 in round
  1: the smoothstep window starts at 0.22 (was 0.32), so the *typical* pixel
  (field ≈ 0.4) lands near 0.35 amount instead of owning a few bright cores —
  the cloud has to cover area — and `intensity` is 0.70 with the panel range
  widened to 1.0 (was 0.56 / 0.6). With the backdrop token set that moves 77.6%
  of the page by >2 luma (p99 51) instead of 34%. (The 2026-11-11 range pass
  moved the shipped default one step lighter to 0.65; the 77.6% figure belongs
  to the 0.70 sample.) `grain` already measures the
  highest ink mass of all eight pieces and stays at 0.55 (was 0.60 before the
  2026-11-11 lightening pass) — its 1.64% light peak
  is the honest shape of a static speck field, not a calibration miss, and
  lifting it would push dark past the parity band.
- The two tiers never coexist: `swapBgRenderer` builds the replacement first
  and only then destroys the old handle, and leaving the shader tier deletes
  its program/buffer, removes the canvas and calls `WEBGL_lose_context` (an
  already-lost context is not lost twice). WebGL probing is cached for the
  page lifetime, and a failed probe, compile or live context loss sets
  `bgFxShaderBlocked` so a repaint never retries in a loop. The fallback to
  ASCII is announced once through a toast — a silent downgrade to a different
  picture is the failure mode this exists to prevent. The shader reuses
  `createLadder` / `observeFrame` unchanged; L3 (mono) and L4 (dither off) are
  deliberate no-ops because it already mixes one ink.
- The background-motion panel lives inside `AppearanceTab` (both the popover
  and the settings page) and is only mounted while that surface is open. It
  reads/writes six **flat** config fields — `bgDensity`, `bgSpeed`, `bgFps`,
  `bgFontPx`, `bgOpacity`, `bgIntensity` — where `-1` (the default) means
  "follow the active preset". `normalizeCfg` rewrites any negative or
  non-finite value to `-1`; the panel clamps every write to the active
  preset's declared `ranges` through `src/client/bg-params.ts`
  (`paramRange` / `effectiveParam` / `setParamInCfg` / `resetBgParams`), and
  the renderers clamp again in `resolveAsciiSpec` / `resolveShaderSpec`, so a
  stale hand edit can never leave the documented band. Knob lists are per tier
  (`panelParamKeys`: ASCII five, shader four — no `fontPx`/`opacity`), and
  `presetForTier` re-homes a cross-tier or unknown preset id to the tier
  default. Slider input updates the store immediately (the appearance effect
  calls `setParams` and repaints), but the host POST goes through one
  `createDebouncedSaver` (320 ms, `BG_PARAM_SAVE_MS`); tier/preset are
  discrete and call `saveCfg` directly after cancelling the pending debounce,
  and the disposer cancels it too. "恢复默认参数" clears only the six overrides
  (`resetBgParams`) — tier and preset stay put on purpose (one click must not
  swap the picture), and the button's label, title tooltip and the muted hint
  beside it say exactly that. Below the strength row sits the **avoid-the-copy**
  switch — `bgFocus` (避让正文, default on, hint "打开时内容区域会更淡、四周更浓；
  关掉则整页均匀。"). It is rendered even while the tier is 关闭, because it is a
  stored preference rather than a per-frame control — hiding it with the rest of
  the FX block read as "the default mask was removed". It is discrete like
  tier/preset (one save, pending
  debounce cancelled) and is deliberately *not* one of the six params
  `resetBgParams` clears, so "恢复默认参数" never turns the mask back on behind
  the user's back. Above the sliders sits the **ink-strength**
  choice — `bgStrength: 'soft' | 'standard' | 'strong'` (柔和 / 标准 / 强烈,
  default `'standard'`), one flat field, three buttons, `aria-pressed`, saved
  discretely like tier/preset. The top step was labelled 明显 until
  2026-11-11 and is 强烈 now; the stored field values (`soft`/`standard`/
  `strong`) never moved. On 2026-11-11 the multipliers were re-scaled down
  because the user found the old `standard` (1.0×) too dark: the ladder is
  now `BG_STRENGTH_SCALE` = 0.45 / 0.62 / 0.9, so the default 标准 is exactly
  the ink step the user had previously chosen as 柔和. It scales the ink
  step, not the density. The earlier calibration (0.62 / 1 / 1.4) measured on
  light flow as 0.10% / 0.15% / 0.20% ink mass (0.63× / 1× / 1.34×) against
  1.73% / 2.99% / 3.85% peaks; the new steps sit below that table's first
  entry. The sliders remain a separate axis on purpose — density changes how
  many cells are lit, strength changes how lit they are; shipping one linear
  "visibility" knob instead of both is what left the first round with no
  direct answer to "it still looks faint". `AppearanceTab` subscribes via
  `useSSelector(selectAppearanceSlice)` (cfg + `dark` only), so no per-turn
  write re-renders it. While a renderer is mounted the backdrop token set opens
  the content column and the sidebar at any glass state (see the layer bullet);
  glass over that live layer uses the `vx-bg-live` radial fill rather than
  staying opaque, and the panel never flips the glass toggle for the user.
  User-facing copy names the tiers
  关闭 / 字符 / 光影 and
  the fps slider is labelled 帧率 with no unit — implementation words (“WebGL”,
  DPR, atlas, shader) never appear in the panel.
- The client store fan-out stays a single listener set; per-turn hot paths
  (`TurnTailEntry`) and the FX canvas subscribe through `useSSelector` so an
  unrelated balance/toast write does not re-render every turn-tail row.
  `fetchTurns` must reuse unchanged items (`reuseTimelineItems`), skip the
  store write when nothing changed, pause while `document.hidden`, and never
  stack a second poll on an in-flight request. `HeaderBalance` also selects
  only its three fields (`balance`, today's usage row, `balanceOpen`) so a
  streaming turn cannot re-render the header or recompute the ledger; the
  always-mounted `MermaidInPlace` and `Toasts`
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
- The personalization popover is deliberately **non-modal**: placement is pure
  geometry in `src/client/panel-bounds.ts` (`pickComposerTop` picks the lowest
  plausible `[role="textbox"]` on the page, `panelFrame` clamps into the viewport
  and caps height at `composerTop − COMPOSER_CLEARANCE`), so it never covers the
  composer; at 1280×822 that yields `x774..1204, y74..692` against a composer at
  y702. It closes on `Escape` (keydown on the panel node) and on an outside
  `mousedown`, and the cleanup returns focus to
  `.vx-header-btn[title="个性化中心"]` — both synchronously and once more on the
  next task, because the browser's default mousedown focus lands on `<body>`
  after the handler runs. It is `role="dialog"` + `aria-modal="false"` with
  `tabIndex=-1`: no Tab trap, so the tab order stays in the panel only as long
  as the user keeps tabbing. Drag measures the environment once per gesture
  (never per `mousemove`) and only writes `panelPos` on mouseup.
- The plugin's modal mask must stay at the shell's own dialog dim,
  `rgba(8, 10, 16, .25)` in `src/client/styles.ts`. Measured on Desktop
  1280×822: a native confirm dims the page to 0.764 of its background luma and
  the plugin at `.25` dims to 0.762; the previous `.4` gave 0.616, which read as
  an extra layer stacked on the app. Background texture survives both dims
  (sidebar `range` 66 native vs 65.1 plugin), so parity here is a visual
  consistency constraint, not a preference.
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
