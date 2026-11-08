# dsh-custom-plugin

Standalone convenience suite for the DeepSeek Harness (DSH) Web GUI:
personalization (appearance, weather FX, glass), project folders, prompts,
conversation export, Mermaid rendering, quote reply, and DeepSeek balance /
daily token usage.

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
- Background palettes and their dark-mode derivation live in
  `src/client/palette.ts` (`toDarkRamp`: keep hue, compress saturation ×0.55,
  drop lightness onto the dark ramp). Palettes are selectable in both themes —
  there is no dark-mode forcing back to default, and theme flips re-run the
  appearance painter (`s.dark` is in its effect deps).
- The Host state file is `$DSH_HOME/custom-plugin-state.json`. It is shared by
  every dsh host under that home — including dsh Desktop's separate profile —
  so an atomic replace there must name its temp file after the writing process
  (`tempPathFor`); a fixed temp name is a cross-process race, not just an
  in-process one.
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
- The page-background layer (`div#vx-bg`) is appended to `<body>`, never
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
  is the reading column — the **transcript viewport's content box** horizontally
  (`scrollLeft + clientWidth`), from that viewport's top down to the composer
  top — measured live every 350 ms (`measureFocusRect` in `custom.tsx`, poll
  owned by the disposer) plus once per appearance repaint, so resize, sidebar
  collapse/expand, panel open/close and full-screen all move the mask with
  the text. The horizontal span must come from the viewport, **not** the
  composer: at 1280×822 the transcript runs `x 280..1273` (993 px) while the
  composer is `420..1129` (708 px), so a composer-shaped mask leaves the first
  and last characters of every line on full-strength ink (measured
  2026-11-08; the ellipse A/B below makes that visible as `@`/`#` behind the
  corner glyphs). The composer is still the *anchor* — the lowest wide
  `[role="textbox"]` is what locates the transcript and supplies the bottom
  edge; with no scroll ancestor (hero layout) the zone falls back to the
  composer's own span.
  `focusWeight` uses the *diagonal* distance outside the rect (`hypot` of
  per-axis overflow, not `min`), normalises by `FOCUS_FEATHER_PX = 150` and
  smoothsteps from `FOCUS_FLOOR = 0.45` to 1, so the edge is a feathered band
  and the centre keeps a faint texture rather than going blank.
  Both numbers are measured, not taste: floor 0.3 read as a clean page at 1:1
  (`+`/`*` only, 4.2% of canvas pixels touched), floor 0.6 made the glyphs
  compete with body copy, 0.45 is the pick; feather 116 left the ink stepping
  `@`→`%`→`*` inside ~40 device px and readable as a seam, 200 pushed the
  full-strength rim out of the 1280-wide margins, 150 spreads the ramp over
  ~225 device px and still leaves a strong rim. A **shallow ellipse** was
  A/B'd and rejected: at the same floor it put 25.9% ink coverage in the
  column's top-left 120 px corner against 11.1% for the soft rectangle
  (16.0% vs 8.4% bottom-right), i.e. full-strength `@` behind the first
  lines. A rectangle with diagonal corners keeps the fade band parallel to
  the text edges, which is the property that matters — the zone is a
  rectangle because the text is a rectangle. ASCII caps every cell's level
  with `buildFocusCaps` (`cap = round(lastLevel × weight + dither)`, one
  reused `Uint8Array`, rebuilt only on grid/zone change, read once per cell
  in the blit); shader passes `u_focus` (vec4 CSS px) with `u_focusFeather` /
  `u_focusFloor` and multiplies the ink by the same `focusWeight()` in GLSL,
  `u_focus.z <= 0` disabling it. `tests/bg-focus.spec.ts` pins the shipped
  floor into 0.40–0.50 and the feather into 120–180 so a drive-by retune
  fails while a deliberate one still passes.
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
- The renderer is `src/client/bg-ascii.ts`, mounted as one canvas inside
  `#vx-bg`. The effect contract is `(t, out: Uint8Array, cols, rows) => void`:
  pieces write ramp levels, never strings, into one reused buffer. Level 0 is
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
  The atlas key is `charset|ink|dark|dpr|tileW|tileH|fontPx|opacity`, so a
  preset switch rebakes only when the ramp, the ink string or the cell geometry
  changes. Grid cell comes from measuring 50 `M` advances (`cellH = fontPx ×
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
  noise field (`blocks`, dither, 0.75/24 fps); `rain` per-column falling trails
  with a bright head and a quadratic fade tail, 14% dormant columns, 16-level
  `classic` ramp and no dither (1/24 fps); `ocean` low-frequency horizontal
  swells plus fixed foam at hash hotspots (`dots`, dither, 0.65/20 fps);
  `starfield` sparse depth-parallax stars, >50% blank cells, no dither at
  fontPx 14 (0.5/15 fps); `ripple` three fixed concentric-ring origins with a
  `CELL_ASPECT = 1.9` y-correction and dither off to keep the contours
  (0.75/20 fps); `static` the deterministic flow frame at zero rAF. Ink always
  derives from the surface brightness, so every preset reads on both themes
  and all palettes; nothing neon or saturated is allowed in.
- Every piece carries its own `inkScale` on top of the theme's base ΔL
  (`1.0 flow/static`, `1.1 rain`, `1.25 ripple`, `1.4 ocean`, `1.6 starfield`),
  because the same ΔL on a block glyph and on a dot glyph are not the same
  picture: a `dots` cell carries ~1/6 of a `blocks` cell's ink. Per-piece
  calibration 2026-11-08 (light, standard strength, coverage / mean ink mass /
  peak): flow 9.78% / 0.15% / 2.99%, rain 4.76%/0.08%/3.08%, ocean was
  4.03%/0.12%/4.37% and is 6.25%/0.17%/4.37% at density 0.65, starfield was
  0.23%/0.01%/3.94% and is 0.37%/0.03%/5.15% at fontPx 14, ripple 6.98%/0.11%
  /3.11%, static tracks flow. Rain and grain deliberately stay put: rain's peak
  already matches flow's and motion is its signal (13.3% of cells change in
  1.2 s, the highest of all six), and grain already measures the highest ink
  mass of the eight pieces (0.55% light / 1.34% dark = 2.4×, dead centre of the
  dark target) — raising either pushes dark into the competing band for a
  table that looks prettier. Starfield stays sparse on purpose (>50% blank
  cells); only its glyph size and ink step were lifted so "sparse" stops
  meaning "absent".
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
  max) next to its defaults, for the Phase 3b custom panel; defaults must stay
  inside those bounds (pinned by `tests/bg-ascii.spec.ts`). `fps` is the
  author's pacing, not a performance ceiling: ocean 20, starfield 15 and ripple
  20 are deliberate and measured with 0 dropped frames and 0 long tasks on a
  1440×900 live host, so lowering them is not a degradation signal.
- Preset switching reuses the same canvas, grid buffer and piece factory; only
  the atlas rebuilds, and only when its key changes. Only `flow` ↔ `static`
  now share a key (`blocks`/dither/12 px/ink 1.0); `ripple` shares the ramp
  and cell geometry but carries its own ink step (1.25), so it rebakes, and
  `rain` (`classic`, 1.1), `ocean` (`dots`, 0.65/20, 1.4) and `starfield`
  (`dots`, 14 px, 1.6) differ on ramp, geometry and ink. `setPreset` resets the ladder to L0, then either stops the loop and
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
  of the page by >2 luma (p99 51) instead of 34%. `grain` already measures the
  highest ink mass of all eight pieces and stays at 0.6 — its 1.64% light peak
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
  beside it say exactly that. Above the sliders sits the **ink-strength**
  choice — `bgStrength: 'soft' | 'standard' | 'strong'` (柔和 / 标准 / 明显,
  default `'standard'`), one flat field, three buttons, `aria-pressed`, saved
  discretely like tier/preset. It scales the ink step, not the density:
  `BG_STRENGTH_SCALE` = 0.62 / 1 / 1.4, measured on light flow as 0.10% /
  0.15% / 0.20% ink mass (0.63× / 1× / 1.34×) against 1.73% / 2.99% / 3.85%
  peaks. The sliders remain a separate axis on purpose — density changes how
  many cells are lit, strength changes how lit they are; shipping one linear
  "visibility" knob instead of both is what left the first round with no
  direct answer to "it still looks faint". `AppearanceTab` subscribes via
  `useSSelector(selectAppearanceSlice)` (cfg + `dark` only), so no per-turn
  write re-renders it. While a renderer is mounted the backdrop token set opens
  the content column and the sidebar at any glass state (see the layer bullet),
  and the panel shows a note saying exactly that — "卡片和弹窗保持不透明" — and
  never flips the glass toggle for the user. User-facing copy names the tiers
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
  always-mounted `MermaidInPlace`, `QuoteDock`, `QuoteButton` and `Toasts`
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
