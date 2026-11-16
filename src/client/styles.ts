/**
 * Static styles for the Custom suite, aligned with the host's design tokens.
 *
 * Injected as one owned <style> tag at install time (removed by the disposer).
 * Every colour, radius, shadow, font and motion value resolves from the host's
 * `--dsw-*` / `--ds-*` tokens, with the shipped fallbacks kept only so the
 * first paint before the theme sheet loads still reads. Class names are global
 * and prefixed `vx-`; they mount into product slots and overlays and must not
 * be CSS-Module scoped.
 * @module @alexpeng/dsh-custom-plugin/client/styles
 */

export const STATIC_CSS = `/* dsh-custom-plugin static styles: host-token design system. */
/* Motion tokens live on the document root, not on .vx-root: the settings page
   and the dialogs/toasts it owns render outside our overlay layer, and an
   undefined custom property invalidates the whole animation shorthand there. */
:root {
  --vx-ease: var(--ds-ease-in-out, cubic-bezier(.4, 0, .2, 1));
  --vx-ease-out: cubic-bezier(.16, 1, .3, 1);
  --vx-ease-in: cubic-bezier(.4, 0, 1, 1);
  --vx-dur-open: var(--ds-transition-duration, .2s);
  --vx-dur-pop: .18s;
  --vx-dur-close: .15s;
  --vx-dur-dialog: .22s;
}
.vx-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483000;
  font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif);
  font-size: var(--dsw-font-xs-13-font-size, 13px);
  line-height: var(--dsw-font-xs-13-line-height, 20px);
  color: var(--dsw-alias-label-primary, #1b1b1c);
  -webkit-font-smoothing: antialiased;
}

@keyframes vx-pop-in {
  from { opacity: 0; transform: translateY(var(--vx-pop-shift, 6px)) scale(.97); }
  to { opacity: 1; transform: none; }
}
@keyframes vx-pop-out {
  from { opacity: 1; transform: none; }
  to { opacity: 0; transform: translateY(calc(var(--vx-pop-shift, 6px) * .45)) scale(.985); }
}
@keyframes vx-pop-in-liquid {
  from { opacity: 0; transform: translateY(var(--vx-pop-shift, 6px)); }
  to { opacity: 1; transform: none; }
}
@keyframes vx-pop-out-liquid {
  from { opacity: 1; transform: none; }
  to { opacity: 0; transform: translateY(calc(var(--vx-pop-shift, 6px) * .45)); }
}
@keyframes vx-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes vx-fade-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes vx-dialog-in {
  from { opacity: 0; transform: translateY(10px) scale(.975); }
  to { opacity: 1; transform: none; }
}
@keyframes vx-dialog-out {
  from { opacity: 1; transform: none; }
  to { opacity: 0; transform: translateY(4px) scale(.985); }
}
@keyframes vx-toast-in {
  from { opacity: 0; transform: translateY(10px) scale(.97); }
  to { opacity: 1; transform: none; }
}
@keyframes vx-toast-out {
  from { opacity: 1; transform: none; }
  to { opacity: 0; transform: translateY(6px) scale(.98); }
}
@keyframes vx-section-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}
@keyframes vx-rotate { to { transform: rotate(360deg); } }

/* Page background layer. Appended to <body>, never inside .vx-root: the
   overlay slot is nested in the shell's z-index:20 layer, where a negative
   z-index would still sit above the content it must stay behind. */
.vx-bg {
  position: fixed;
  inset: 0;
  pointer-events: none;
  background: transparent;
  z-index: -1;
}
.vx-bg > canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.vx-fx {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.vx-anchor {
  display: inline-block;
  width: 0;
  height: 1px;
  vertical-align: bottom;
}
.vx-turn-actions {
  display: inline-flex;
  gap: 4px;
  margin-left: 10px;
  vertical-align: middle;
  align-items: center;
}

/* ---------- material system ---------- */
/* Frost: an evenly diffused milk pane. It is deliberately opaque — no clear
   body and no edge lensing — so it can never be mistaken for liquid glass. */
.vx-glass,
.vx-popover {
  background: linear-gradient(180deg, rgba(250, 251, 253, .9), rgba(244, 246, 250, .84));
  -webkit-backdrop-filter: blur(30px) saturate(1.3);
  backdrop-filter: blur(30px) saturate(1.3);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, .7),
    0 0 0 .5px rgba(0, 0, 0, .1),
    0 16px 40px rgba(15, 23, 42, .1);
  border-radius: var(--dsw-radius-lg, 16px);
  color: var(--dsw-alias-label-primary, #1b1b1c);
}
:root.vx-dark .vx-glass,
:root.vx-dark .vx-popover {
  background: linear-gradient(180deg, rgba(31, 33, 39, .92), rgba(24, 26, 31, .86));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, .14),
    0 0 0 .5px rgba(255, 255, 255, .1),
    0 16px 40px rgba(0, 0, 0, .36);
}
:root.vx-glass-off .vx-glass,
:root.vx-glass-off .vx-popover {
  background: var(--dsw-alias-bg-layer-3, #fff);
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
/* Liquid: Apple-style clear glass. The body is colourless and clearly lighter
   than frost (82% -> 74% light, 70% -> 62% dark), so the app behind the floating
   window still reads through it. That window is its own compositor surface, so a
   real backdrop refraction is unavailable; the lens is carried by edge optics
   instead: a bright 1px specular rim, a soft top bevel, a darker bottom inner
   shade and a faint cyan/magenta dispersion in the rim. */
.vx-liquid .vx-glass,
.vx-liquid .vx-popover {
  background:
    radial-gradient(130% 90% at 12% -14%, rgba(255, 255, 255, .5), rgba(255, 255, 255, 0) 58%),
    linear-gradient(180deg, rgba(249, 251, 254, .86) 0%, rgba(242, 246, 250, .78) 100%);
  -webkit-backdrop-filter: url(#vx-lg) blur(2px) saturate(1.5) brightness(1.04);
  backdrop-filter: url(#vx-lg) blur(2px) saturate(1.5) brightness(1.04);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, .95),
    inset 0 8px 14px -12px rgba(255, 255, 255, .9),
    inset 0 -10px 18px -14px rgba(22, 32, 52, .24),
    inset 0 0 0 1px rgba(255, 255, 255, .4),
    0 0 0 .5px rgba(18, 28, 45, .18),
    0 24px 56px rgba(15, 25, 45, .18);
}
:root.vx-dark .vx-liquid .vx-glass,
:root.vx-dark .vx-liquid .vx-popover {
  background:
    radial-gradient(130% 90% at 12% -14%, rgba(255, 255, 255, .22), rgba(255, 255, 255, 0) 58%),
    linear-gradient(180deg, rgba(28, 30, 36, .7) 0%, rgba(20, 22, 27, .62) 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, .28),
    inset 0 8px 14px -12px rgba(255, 255, 255, .16),
    inset 0 -10px 18px -14px rgba(0, 0, 0, .55),
    inset 0 0 0 1px rgba(255, 255, 255, .12),
    0 0 0 .5px rgba(0, 0, 0, .4),
    0 24px 56px rgba(0, 0, 0, .45);
}
/* The 1px rim carries most of the glass read in the floating window: a bright
   specular arc plus a barely-there dispersion fringe. */
.vx-liquid .vx-popover::after {
  content: '';
  position: absolute;
  inset: 0;
  padding: 1px;
  border-radius: inherit;
  pointer-events: none;
  background: linear-gradient(140deg,
    rgba(180, 240, 255, .7) 0%,
    rgba(255, 255, 255, .92) 14%,
    rgba(255, 255, 255, .16) 34%,
    rgba(255, 255, 255, .55) 50%,
    rgba(255, 255, 255, .1) 68%,
    rgba(210, 255, 245, .3) 84%,
    rgba(255, 190, 235, .55) 100%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
}
:root.vx-dark .vx-liquid .vx-popover::after {
  background: linear-gradient(140deg,
    rgba(150, 220, 255, .3) 0%,
    rgba(255, 255, 255, .34) 16%,
    rgba(255, 255, 255, .06) 36%,
    rgba(255, 255, 255, .22) 52%,
    rgba(255, 255, 255, .04) 70%,
    rgba(255, 190, 235, .22) 100%);
}
/* A live background needs no special material: the clear body already transmits
   it. Only a two-point fill reduction keeps the texture from competing with the
   copy, and the edge optics stay untouched in every background mode. */
:root.vx-bg-live:not(.vx-glass-off) .vx-glass,
:root.vx-bg-live:not(.vx-glass-off) .vx-popover {
  background: linear-gradient(180deg, rgba(250, 251, 253, .88), rgba(244, 246, 250, .82));
  -webkit-backdrop-filter: blur(24px) saturate(1.3);
  backdrop-filter: blur(24px) saturate(1.3);
}
:root.vx-bg-live.vx-liquid:not(.vx-glass-off) .vx-glass,
:root.vx-bg-live.vx-liquid:not(.vx-glass-off) .vx-popover {
  background:
    radial-gradient(130% 90% at 12% -14%, rgba(255, 255, 255, .46), rgba(255, 255, 255, 0) 58%),
    linear-gradient(180deg, rgba(249, 251, 254, .84) 0%, rgba(242, 246, 250, .76) 100%);
}
@supports not (backdrop-filter: url(#vx-lg)) {
  .vx-liquid .vx-glass,
  .vx-liquid .vx-popover {
    background: rgba(251, 252, 255, .62);
    -webkit-backdrop-filter: blur(30px) saturate(1.3);
    backdrop-filter: blur(30px) saturate(1.3);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, .9),
      0 0 0 .5px rgba(0, 0, 0, .12),
      0 18px 44px rgba(15, 25, 45, .16);
  }
}
@media (prefers-reduced-transparency: reduce) {
  .vx-liquid .vx-glass,
  .vx-liquid .vx-popover {
    background: var(--dsw-alias-bg-layer-3, #fff);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}

/* ---------- chips, header and rail buttons ---------- */
.vx-chip {
  pointer-events: auto;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .1));
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06));
  color: var(--dsw-alias-label-secondary, #61666b);
  border-radius: var(--dsw-radius-sm, 8px);
  padding: 2px 8px;
  font-size: var(--dsw-font-xxxs-11-font-size, 11px);
  line-height: var(--dsw-font-xxxs-11-line-height, 14px);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  transition: background-color var(--ds-transition-duration-fast, .1s) var(--vx-ease);
}
.vx-chip:hover {
  background: var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, .1));
  color: var(--dsw-alias-label-primary, #1b1b1c);
}
.vx-link { text-decoration: none; }
.vx-header-btn,
.vx-foot-btn,
.vx-balance-text {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  min-height: 28px;
  border-radius: var(--dsw-radius-sm, 8px);
  font-size: var(--dsw-font-xs-13-font-size, 13px);
  color: var(--dsw-alias-label-secondary, #61666b);
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color var(--ds-transition-duration-fast, .1s) var(--vx-ease), color var(--ds-transition-duration-fast, .1s) var(--vx-ease);
}
.vx-header-btn:hover,
.vx-foot-btn:hover,
.vx-balance-text:hover {
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06));
  color: var(--dsw-alias-label-primary, #1b1b1c);
}
/* The session header row places the native agent-preset chip and our injected
 * buttons in one 10px-gap flex row. The chip right-insets its label by 2px
 * (padding: 0 2px 0 0), so the 10px padding above left a wider gap between
 * our two buttons than between the chip and the first of them. Match the
 * native inset so both gaps read as one rhythm. */
.vx-header-btn { padding: 3px 2px; }
.vx-header-btn[aria-expanded='true'],
.vx-balance-text.vx-balance-open {
  background: var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, .1));
  color: var(--dsw-alias-label-primary, #1b1b1c);
}
.vx-balance-wrap { display: inline-flex; align-items: center; position: relative; }
.vx-balance-today {
  color: var(--dsw-alias-label-tertiary, #979da6);
  font-size: var(--dsw-font-xxs-12-font-size, 12px);
}
.vx-balance-lines { font-size: var(--dsw-font-xs-13-font-size, 13px); margin: 6px 0; }

/* ---------- buttons ---------- */
.vx-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 30px;
  padding: 0 12px;
  border-radius: var(--dsw-radius-sm, 8px);
  border: 1px solid transparent;
  font-family: inherit;
  font-size: var(--dsw-font-xs-13-font-size, 13px);
  line-height: 18px;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color var(--ds-transition-duration-fast, .1s) var(--vx-ease), color var(--ds-transition-duration-fast, .1s) var(--vx-ease), border-color var(--ds-transition-duration-fast, .1s) var(--vx-ease);
}
.vx-button:disabled { opacity: .5; cursor: default; }
.vx-button-sm { min-height: 26px; padding: 0 9px; font-size: var(--dsw-font-xxs-12-font-size, 12px); }
.vx-button-block { width: 100%; }
.vx-button-primary {
  background: var(--dsw-alias-button-primary-fill, #1b1b1c);
  color: var(--dsw-alias-label-primary-foreground, #fff);
}
.vx-button-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, #2c2c2e); }
.vx-button-secondary {
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06));
  border-color: var(--dsw-alias-border-l2, rgba(0, 0, 0, .1));
  color: var(--dsw-alias-label-primary, #1b1b1c);
}
.vx-button-secondary:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, .1));
}
.vx-button-ghost {
  background: transparent;
  color: var(--dsw-alias-label-secondary, #61666b);
}
.vx-button-ghost:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06));
  color: var(--dsw-alias-label-primary, #1b1b1c);
}
.vx-button-danger {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 12%, transparent);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 45%, transparent);
  color: var(--dsw-alias-state-error-primary, #ec1313);
}
.vx-button-danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 20%, transparent);
}
.vx-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-sm, 8px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, #61666b);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  transition: background-color var(--ds-transition-duration-fast, .1s) var(--vx-ease);
}
.vx-icon-button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06)); color: var(--dsw-alias-label-primary, #1b1b1c); }
.vx-icon-button-sm { width: 24px; height: 24px; font-size: 14px; }

/* Legacy text buttons kept for surfaces not yet migrated. */
.vx-btn {
  pointer-events: auto;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .1));
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06));
  color: var(--dsw-alias-label-primary, #1b1b1c);
  border-radius: var(--dsw-radius-sm, 8px);
  padding: 5px 11px;
  font-family: inherit;
  font-size: var(--dsw-font-xxs-12-font-size, 12px);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: background-color var(--ds-transition-duration-fast, .1s) var(--vx-ease);
}
.vx-btn:hover { background: var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, .1)); }
.vx-btn.on,
.vx-btn[aria-pressed='true'] {
  background: var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, .1));
  border-color: var(--dsw-alias-border-l3, rgba(0, 0, 0, .12));
  color: var(--dsw-alias-label-primary, #1b1b1c);
}
.vx-btn:disabled { opacity: .5; cursor: default; }
.vx-btn-sm { padding: 2px 8px; font-size: var(--dsw-font-xxxs-11-font-size, 11px); }
.vx-btn-danger {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 12%, transparent);
  border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 45%, transparent);
  color: var(--dsw-alias-state-error-primary, #ec1313);
}
.vx-btn.big { padding: 9px 15px; font-size: var(--dsw-font-xs-13-font-size, 13px); }

/* ---------- inputs, fields, switches, segmented controls ---------- */
.vx-input {
  flex: 1;
  min-width: 0;
  min-height: 30px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .1));
  background: var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-3, #fff));
  color: var(--dsw-alias-label-primary, #1b1b1c);
  border-radius: var(--dsw-radius-sm, 8px);
  padding: 5px 10px;
  font-family: inherit;
  font-size: var(--dsw-font-xs-13-font-size, 13px);
}
.vx-input::placeholder { color: var(--dsw-alias-label-caption, #adb2b8); }
.vx-input:focus-visible { outline-color: var(--dsw-alias-state-business-primary, #4176e6); outline-width: var(--dsw-focus-ring-width, 2px); }
.vx-field { display: flex; flex-direction: column; gap: 6px; }
.vx-field-label { font-size: var(--dsw-font-xxs-strong-12-font-size, 12px); font-weight: 500; color: var(--dsw-alias-label-secondary, #61666b); }
.vx-field-hint { font-size: var(--dsw-font-xxs-12-font-size, 12px); color: var(--dsw-alias-label-tertiary, #979da6); line-height: 18px; }
.vx-field-error { font-size: var(--dsw-font-xxs-12-font-size, 12px); color: var(--dsw-alias-state-error-primary, #ec1313); }
.vx-switch-row { display: flex; align-items: center; gap: 12px; padding: 6px 0; }
.vx-switch-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.vx-switch-label { font-size: var(--dsw-font-xs-13-font-size, 13px); color: var(--dsw-alias-label-primary, #1b1b1c); cursor: pointer; }
.vx-switch-hint { font-size: var(--dsw-font-xxs-12-font-size, 12px); color: var(--dsw-alias-label-tertiary, #979da6); line-height: 18px; }
.vx-switch {
  position: relative;
  width: 36px;
  height: 20px;
  flex: 0 0 auto;
  border: none;
  border-radius: 999px;
  background: var(--dsw-alias-state-idle-primary, #d4d4d4);
  cursor: pointer;
  padding: 0;
  transition: background-color var(--ds-transition-duration, .2s) var(--vx-ease);
}
.vx-switch.on { background: var(--dsw-alias-state-business-primary, #4176e6); }
.vx-switch-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: var(--dsw-alias-switch-thumb, #fff);
  transition: transform var(--ds-transition-duration, .2s) var(--vx-ease);
}
.vx-switch.on .vx-switch-thumb { transform: translateX(16px); }
.vx-switch-row.is-disabled { opacity: .5; }
.vx-segmented { display: flex; flex-direction: column; gap: 6px; }
.vx-segmented-track {
  display: inline-flex;
  align-self: flex-start;
  gap: 2px;
  padding: 2px;
  border-radius: var(--dsw-radius-sm, 8px);
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06));
}
.vx-segmented-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 26px;
  padding: 0 10px;
  border: none;
  border-radius: calc(var(--dsw-radius-sm, 8px) - 2px);
  background: transparent;
  color: var(--dsw-alias-label-secondary, #61666b);
  font-family: inherit;
  font-size: var(--dsw-font-xxs-12-font-size, 12px);
  cursor: pointer;
  transition: background-color var(--ds-transition-duration-fast, .1s) var(--vx-ease);
}
.vx-segmented-item.on {
  background: var(--dsw-alias-bg-layer-3, #fff);
  color: var(--dsw-alias-label-primary, #1b1b1c);
  box-shadow: var(--dsw-shadow-lv1, 0 2px 4px rgba(0, 0, 0, .05));
}
.vx-toggle-row {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: var(--dsw-font-xs-13-font-size, 13px);
}

/* ---------- layout ---------- */
.vx-col { display: flex; flex-direction: column; gap: 10px; }
.vx-row { display: flex; gap: 8px; align-items: center; }
.vx-row.wrap { flex-wrap: wrap; }
.vx-flex1 { flex: 1; }
.vx-ellipsis {
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vx-section-title {
  font-size: var(--dsw-font-s-strong-14-font-size, 14px);
  font-weight: 500;
  line-height: var(--dsw-font-s-strong-14-line-height, 22px);
  margin-top: 4px;
  color: var(--dsw-alias-label-primary, #1b1b1c);
}
.vx-muted {
  color: var(--dsw-alias-label-tertiary, #979da6);
  font-size: var(--dsw-font-xxs-12-font-size, 12px);
  line-height: 18px;
}
.vx-note {
  border-left: 2px solid var(--dsw-alias-border-l3, rgba(0, 0, 0, .12));
  padding: 4px 0 4px 9px;
  font-size: var(--dsw-font-xxs-12-font-size, 12px);
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary, #979da6);
}
.vx-error { color: var(--dsw-alias-state-error-primary, #ec1313); font-size: var(--dsw-font-xxs-12-font-size, 12px); }
.vx-pad { padding: 12px; }
.vx-pad-sm { padding: 6px 2px; }
.vx-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0 7px;
  min-height: 18px;
  font-size: var(--dsw-font-xxxs-11-font-size, 11px);
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06));
  color: var(--dsw-alias-label-tertiary, #979da6);
}
.vx-badge-accent { background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 14%, transparent); color: var(--dsw-alias-state-business-primary, #4176e6); }
.vx-badge-danger { background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ec1313) 12%, transparent); color: var(--dsw-alias-state-error-primary, #ec1313); }
.vx-badge-success { background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #22c55e) 14%, transparent); color: var(--dsw-alias-state-success-primary, #22c55e); }
.vx-kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: var(--dsw-radius-xs, 4px);
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06));
  color: var(--dsw-alias-label-tertiary, #979da6);
  font-family: var(--ds-font-family-code, monospace);
  font-size: 10px;
}

/* ---------- cards ---------- */
.vx-card {
  background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-settings-card-fill, #fff));
  border-radius: var(--dsw-radius-lg, 16px);
  box-shadow: 0 0 0 .5px var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l3, rgba(0, 0, 0, .12)));
  padding: 16px;
}
/* Settings sheet: one self-contained material plane, painted from neutral
   colours instead of the host's per-mode tokens, so switching 背景动效 between
   关闭/字符/光影 cannot turn it into flat white. Frost is a milky 94% sheet;
   liquid is the same clear Apple-style pane as the popovers (88% -> 80%) with
   the identical edge optics. Cards inside are transparent groups, not a second
   material layer. */
.vx-settings-page.vx-glass-on {
  position: relative;
  width: 100%;
  max-width: 980px;
  box-sizing: border-box;
  padding: 16px;
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(250, 251, 253, .94), rgba(244, 246, 250, .88));
  -webkit-backdrop-filter: blur(28px) saturate(1.3);
  backdrop-filter: blur(28px) saturate(1.3);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, .7),
    0 0 0 .5px rgba(0, 0, 0, .1),
    0 18px 44px rgba(15, 23, 42, .08);
}
:root.vx-dark .vx-settings-page.vx-glass-on {
  background: linear-gradient(180deg, rgba(31, 33, 39, .94), rgba(24, 26, 31, .88));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, .14),
    0 0 0 .5px rgba(255, 255, 255, .1),
    0 18px 44px rgba(0, 0, 0, .34);
}
.vx-settings-page.vx-glass-on.vx-liquid {
  background:
    radial-gradient(120% 70% at 10% -14%, rgba(255, 255, 255, .66), rgba(255, 255, 255, 0) 56%),
    linear-gradient(180deg, rgba(249, 251, 254, .9) 0%, rgba(242, 246, 250, .82) 100%);
  -webkit-backdrop-filter: url(#vx-lg) blur(3px) saturate(1.5) brightness(1.04);
  backdrop-filter: url(#vx-lg) blur(3px) saturate(1.5) brightness(1.04);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, .97),
    inset 0 10px 18px -14px rgba(255, 255, 255, .85),
    inset 0 -14px 24px -18px rgba(22, 32, 52, .25),
    inset 0 0 0 1px rgba(255, 255, 255, .42),
    0 0 0 .5px rgba(18, 28, 45, .18),
    0 26px 60px rgba(15, 25, 45, .2);
}
:root.vx-dark .vx-settings-page.vx-glass-on.vx-liquid {
  background:
    radial-gradient(120% 70% at 10% -14%, rgba(255, 255, 255, .22), rgba(255, 255, 255, 0) 56%),
    linear-gradient(180deg, rgba(28, 30, 36, .76) 0%, rgba(20, 22, 27, .68) 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, .3),
    inset 0 10px 18px -14px rgba(255, 255, 255, .16),
    inset 0 -14px 24px -18px rgba(0, 0, 0, .55),
    inset 0 0 0 1px rgba(255, 255, 255, .14),
    0 0 0 .5px rgba(0, 0, 0, .42),
    0 26px 60px rgba(0, 0, 0, .46);
}
/* Same specular rim as the popovers and dialogs. */
.vx-settings-page.vx-glass-on.vx-liquid::after {
  content: '';
  position: absolute;
  inset: 0;
  padding: 1px;
  border-radius: inherit;
  pointer-events: none;
  background: linear-gradient(140deg,
    rgba(180, 240, 255, .6) 0%,
    rgba(255, 255, 255, .92) 16%,
    rgba(255, 255, 255, .14) 36%,
    rgba(255, 255, 255, .5) 52%,
    rgba(255, 255, 255, .08) 70%,
    rgba(255, 190, 235, .45) 100%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
}
:root.vx-dark .vx-settings-page.vx-glass-on.vx-liquid::after {
  background: linear-gradient(140deg,
    rgba(150, 220, 255, .24) 0%,
    rgba(255, 255, 255, .34) 16%,
    rgba(255, 255, 255, .06) 36%,
    rgba(255, 255, 255, .22) 52%,
    rgba(255, 255, 255, .04) 70%,
    rgba(255, 190, 235, .2) 100%);
}
/* A live background may only nudge the transmission; the optics never move, so
   the sheet reads as the same material in all three background modes. */
.vx-settings-page.vx-glass-on.vx-bg-live {
  background: linear-gradient(180deg, rgba(250, 251, 253, .92), rgba(244, 246, 250, .86));
}
.vx-settings-page.vx-glass-on.vx-liquid.vx-bg-live {
  background:
    radial-gradient(120% 70% at 10% -14%, rgba(255, 255, 255, .62), rgba(255, 255, 255, 0) 56%),
    linear-gradient(180deg, rgba(249, 251, 254, .88) 0%, rgba(242, 246, 250, .8) 100%);
}
:root.vx-dark .vx-settings-page.vx-glass-on.vx-bg-live {
  background: linear-gradient(180deg, rgba(31, 33, 39, .92), rgba(24, 26, 31, .86));
}
:root.vx-dark .vx-settings-page.vx-glass-on.vx-liquid.vx-bg-live {
  background:
    radial-gradient(120% 70% at 10% -14%, rgba(255, 255, 255, .2), rgba(255, 255, 255, 0) 56%),
    linear-gradient(180deg, rgba(28, 30, 36, .74) 0%, rgba(20, 22, 27, .66) 100%);
}
.vx-settings-page.vx-glass-off {
  background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-settings-card-fill, #fff));
  box-shadow: 0 0 0 .5px var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l3, rgba(0, 0, 0, .12)));
}
/* Grouped content inside the sheet: transparent, separated by a hairline. */
.vx-settings-page.vx-glass-on .vx-card {
  background: rgba(255, 255, 255, .24);
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, .55),
    inset 0 0 0 .5px rgba(255, 255, 255, .35);
}
.vx-settings-page.vx-glass-on.vx-liquid .vx-card {
  background: rgba(255, 255, 255, .18);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, .6),
    inset 0 0 0 .5px rgba(255, 255, 255, .3);
}
:root.vx-dark .vx-settings-page.vx-glass-on .vx-card {
  background: rgba(255, 255, 255, .06);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, .12),
    inset 0 0 0 .5px rgba(255, 255, 255, .1);
}
:root.vx-dark .vx-settings-page.vx-glass-on.vx-liquid .vx-card {
  background: rgba(255, 255, 255, .05);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, .14),
    inset 0 0 0 .5px rgba(255, 255, 255, .1);
}
.vx-settings-page.vx-glass-off .vx-card {
  background: transparent;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  box-shadow: inset 0 0 0 .5px var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l3, rgba(0, 0, 0, .12)));
}
.vx-card-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 12px;
}
.vx-card-titles { flex: 1; min-width: 0; }
.vx-card-title {
  margin: 0;
  font-size: var(--dsw-font-s-strong-14-font-size, 14px);
  font-weight: 500;
  line-height: var(--dsw-font-s-strong-14-line-height, 22px);
  color: var(--dsw-alias-label-primary, #1b1b1c);
}
.vx-card-desc {
  margin: 2px 0 0;
  font-size: var(--dsw-font-xxs-12-font-size, 12px);
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary, #979da6);
}
.vx-card-actions { display: flex; align-items: center; gap: 6px; }
.vx-card-body { display: flex; flex-direction: column; gap: 10px; }

/* ---------- empty / loading ---------- */
.vx-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 28px 16px;
  text-align: center;
  color: var(--dsw-alias-label-tertiary, #979da6);
}
.vx-empty-icon { opacity: .6; }
.vx-empty-title { font-size: var(--dsw-font-xs-13-font-size, 13px); color: var(--dsw-alias-label-secondary, #61666b); }
.vx-empty-hint { font-size: var(--dsw-font-xxs-12-font-size, 12px); line-height: 18px; }
.vx-empty-action { margin-top: 4px; }
.vx-spinner { display: inline-flex; align-items: center; gap: 3px; }
.vx-spinner-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary, #979da6);
  animation: vx-spin 1s infinite ease-in-out;
}
.vx-spinner-dot:nth-child(2) { animation-delay: .15s; }
.vx-spinner-dot:nth-child(3) { animation-delay: .3s; }
@keyframes vx-spin {
  0%, 80%, 100% { opacity: .3; transform: scale(.8); }
  40% { opacity: 1; transform: scale(1); }
}

/* ---------- anchors / swatches / parameters ---------- */
.vx-swatches { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
.vx-swatch {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 2px;
  border-radius: var(--dsw-radius-sm, 8px);
}
.vx-swatch:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06)); }
.vx-swatch-box {
  width: 100%;
  height: 26px;
  border-radius: var(--dsw-radius-sm, 8px);
  box-shadow: 0 0 0 1px var(--dsw-alias-border-l2, rgba(0, 0, 0, .1));
  box-sizing: border-box;
  transition: box-shadow var(--ds-transition-duration-fast, .1s) var(--vx-ease);
}
.vx-swatch.on .vx-swatch-box {
  box-shadow: 0 0 0 2px var(--dsw-alias-state-business-primary, #4176e6);
}
.vx-swatch-label {
  font-size: var(--dsw-font-xxxs-11-font-size, 11px);
  color: var(--dsw-alias-label-tertiary, #979da6);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vx-param-list { display: flex; flex-direction: column; gap: 6px; margin-top: 2px; }
.vx-param-row { display: grid; grid-template-columns: 52px 1fr 54px; gap: 8px; align-items: center; }
.vx-param-label { font-size: var(--dsw-font-xxs-12-font-size, 12px); color: var(--dsw-alias-label-secondary, #61666b); }
.vx-param-val {
  font-size: var(--dsw-font-xxxs-11-font-size, 11px);
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-tertiary, #979da6);
}
.vx-range { width: 100%; height: 18px; margin: 0; accent-color: var(--dsw-alias-state-business-primary, #4176e6); }

/* ---------- export ---------- */
.vx-format-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.vx-format-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: left;
  padding: 10px 12px;
  border-radius: var(--dsw-radius-md, 12px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .1));
  background: transparent;
  color: inherit;
  font-family: inherit;
  cursor: pointer;
  transition: background-color var(--ds-transition-duration-fast, .1s) var(--vx-ease), border-color var(--ds-transition-duration-fast, .1s) var(--vx-ease);
}
.vx-format-card:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06)); }
.vx-format-card.on { border-color: var(--dsw-alias-state-business-primary, #4176e6); background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 8%, transparent); }
.vx-format-title { font-size: var(--dsw-font-xs-13-font-size, 13px); font-weight: 500; }
.vx-format-hint { font-size: var(--dsw-font-xxxs-11-font-size, 11px); color: var(--dsw-alias-label-tertiary, #979da6); }
.vx-export-progress { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border-radius: var(--dsw-radius-sm, 8px); background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06)); }
.vx-export-result {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--dsw-radius-md, 12px);
  background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #22c55e) 10%, transparent);
  color: var(--dsw-alias-label-primary, #1b1b1c);
}
.vx-export-result-copy { min-width: 0; }
.vx-budget-track {
  height: 6px;
  border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06));
  overflow: hidden;
}
.vx-budget-fill {
  height: 100%;
  border-radius: 999px;
  background: var(--dsw-alias-state-business-primary, #4176e6);
  transition: width var(--ds-transition-duration, .2s) var(--vx-ease);
}
.vx-budget-fill.over { background: var(--dsw-alias-state-warn-primary, #f59e0b); }
/* Daily usage bars: one track per row, so the percentage is measured inside
   the space left by the date column instead of overflowing the card. */
.vx-bar-track {
  flex: 1 1 auto;
  min-width: 0;
  height: 6px;
  border-radius: 999px;
  overflow: hidden;
  background: transparent;
}
.vx-bar-fill {
  display: block;
  height: 100%;
  min-width: 2px;
  border-radius: 999px;
  background: var(--dsw-alias-state-business-primary, #4176e6);
  transition: width var(--ds-transition-duration, .2s) var(--vx-ease);
}
.vx-count-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.vx-count-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 6px;
  border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06));
}
.vx-count-value { font-size: var(--dsw-font-l-20-font-size, 20px); font-weight: 500; line-height: 1.2; }
.vx-count-label { font-size: var(--dsw-font-xxxs-11-font-size, 11px); color: var(--dsw-alias-label-tertiary, #979da6); }
.vx-command-dialog { max-width: 620px; }
.vx-command-input { margin-bottom: 4px; }
.vx-command-list { max-height: min(420px, 56vh); }
.vx-command-item { display: flex; align-items: center; gap: 10px; }
.vx-command-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vx-command-foot {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  font-size: var(--dsw-font-xxxs-11-font-size, 11px);
  color: var(--dsw-alias-label-tertiary, #979da6);
}
.vx-command-foot .vx-kbd { margin: 0 2px; }

/* ---------- lists ---------- */
.vx-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 300px;
  overflow: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--dsh-scrollbar-thumb, rgba(0, 0, 0, .2)) transparent;
}
.vx-list-item {
  text-align: left;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-primary, #1b1b1c);
  border-radius: var(--dsw-radius-sm, 8px);
  padding: 6px 8px;
  font-family: inherit;
  font-size: var(--dsw-font-xs-13-font-size, 13px);
  cursor: pointer;
  transition: background-color var(--ds-transition-duration-fast, .1s) var(--vx-ease);
}
.vx-list-item:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06)); }
.vx-list-item.on,
.vx-list-item[aria-selected='true'] {
  background: var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, .1));
}
.vx-list-item:disabled { opacity: .5; cursor: default; }
.vx-check-row { display: flex; gap: 8px; align-items: center; font-size: var(--dsw-font-xs-13-font-size, 13px); padding: 5px 4px; }
.vx-check-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---------- tables ---------- */
.vx-table { width: 100%; border-collapse: collapse; font-size: var(--dsw-font-xxs-12-font-size, 12px); }
.vx-table th,
.vx-table td {
  border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .1));
  padding: 5px 6px;
  text-align: right;
  color: var(--dsw-alias-label-secondary, #61666b);
}
.vx-table th {
  font-weight: 500;
  color: var(--dsw-alias-label-tertiary, #979da6);
}
.vx-table th:first-child,
.vx-table td:first-child { text-align: left; }

/* ---------- folders ---------- */
.vx-folder-list { display: flex; flex-direction: column; gap: 2px; }
.vx-rename-input { flex: 1; min-width: 0; min-height: 24px; padding: 2px 6px; font-size: var(--dsw-font-xxs-12-font-size, 12px); }
.vx-folder { display: flex; flex-direction: column; }
.vx-folder-head {
  display: flex;
  gap: 5px;
  align-items: center;
  padding: 4px 4px;
  border-radius: var(--dsw-radius-sm, 8px);
  cursor: grab;
  transition: background-color var(--ds-transition-duration-fast, .1s) var(--vx-ease);
}
.vx-folder-head:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06)); }
.vx-folder-head.drop-inside {
  background: var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, .1));
  outline: 1px dashed var(--dsw-alias-state-business-primary, #4176e6);
}
.vx-folder-head.drop-before { box-shadow: 0 -2px 0 0 var(--dsw-alias-state-business-primary, #4176e6); }
.vx-folder-head.drop-after { box-shadow: 0 2px 0 0 var(--dsw-alias-state-business-primary, #4176e6); }
.vx-folder-name {
  font-size: var(--dsw-font-xs-13-font-size, 13px);
  font-weight: 500;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-primary, #1b1b1c);
}
.vx-folder-body {
  border-left: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .1));
  margin-left: 14px;
  padding-left: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.vx-item-row {
  display: flex;
  gap: 5px;
  align-items: center;
  padding: 3px 4px;
  border-radius: var(--dsw-radius-sm, 8px);
}
.vx-item-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06)); }
.vx-item-name {
  flex: 1;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #61666b);
  font-family: inherit;
  font-size: var(--dsw-font-xs-13-font-size, 13px);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 0;
}
.vx-item-name:hover { color: var(--dsw-alias-label-primary, #1b1b1c); }
.vx-mini {
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-tertiary, #979da6);
  cursor: pointer;
  padding: 3px;
  border-radius: var(--dsw-radius-xs, 4px);
  display: inline-flex;
  align-items: center;
  transition: background-color var(--ds-transition-duration-fast, .1s) var(--vx-ease), color var(--ds-transition-duration-fast, .1s) var(--vx-ease);
}
.vx-mini:hover { color: var(--dsw-alias-label-primary, #1b1b1c); background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06)); }
.vx-form {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .1));
  border-radius: var(--dsw-radius-md, 12px);
  padding: 8px;
}

/* ---------- prompts ---------- */
.vx-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.vx-toolbar .vx-input { flex: 1 1 160px; }
.vx-select { flex: 0 0 auto !important; width: auto; min-width: 96px; }
.vx-textarea { resize: vertical; min-height: 140px; line-height: 20px; padding: 8px 10px; }
.vx-prompt-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.vx-prompt-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.vx-prompt-card {
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .1));
  background: var(--dsw-alias-bg-layer-3, transparent);
  border-radius: var(--dsw-radius-md, 12px);
  padding: 8px 10px;
}
.vx-prompt-title {
  font-weight: 500;
  font-size: var(--dsw-font-xs-13-font-size, 13px);
  color: var(--dsw-alias-label-primary, #1b1b1c);
}
.vx-prompt-body {
  margin-top: 4px;
  font-size: var(--dsw-font-xxs-12-font-size, 12px);
  line-height: 18px;
  color: var(--dsw-alias-label-secondary, #61666b);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 54px;
  overflow: hidden;
}

/* ---------- dialogs ---------- */
.vx-dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  pointer-events: auto;
  background: var(--dsw-alias-bg-mask-1, rgba(8, 10, 16, .25));
  animation: vx-fade-in .18s var(--vx-ease-out);
}
.vx-dialog-mask[data-state='closed'] { animation: vx-fade-out .16s var(--vx-ease-in) forwards; }
.vx-dialog {
  position: relative;
  display: flex;
  flex-direction: column;
  max-height: 82vh;
  width: min(520px, 100%);
  pointer-events: auto;
  border: none;
  border-radius: var(--dsw-radius-xl, 20px);
  background: var(--dsw-alias-bg-layer-3, #fff);
  color: var(--dsw-alias-label-primary, #1b1b1c);
  box-shadow: var(--dsw-elevation-prominent, 0 0 0 .5px rgba(0, 0, 0, .12), 0 12px 32px rgba(0, 0, 0, .12));
  animation: vx-dialog-in var(--vx-dur-dialog) var(--vx-ease-out);
}
/* Dialogs follow the same two materials. They render inside the main document,
   so the backdrop chain really does frost / refract the page behind. */
:root:not(.vx-glass-off) .vx-dialog {
  background: linear-gradient(180deg, rgba(250, 251, 253, .94), rgba(244, 246, 250, .88));
  -webkit-backdrop-filter: blur(30px) saturate(1.3);
  backdrop-filter: blur(30px) saturate(1.3);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, .7),
    0 0 0 .5px rgba(0, 0, 0, .1),
    0 18px 44px rgba(15, 23, 42, .12);
}
:root.vx-dark:not(.vx-glass-off) .vx-dialog {
  background: linear-gradient(180deg, rgba(31, 33, 39, .94), rgba(24, 26, 31, .88));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, .14),
    0 0 0 .5px rgba(255, 255, 255, .1),
    0 18px 44px rgba(0, 0, 0, .4);
}
:root:not(.vx-glass-off).vx-liquid .vx-dialog {
  background:
    radial-gradient(130% 80% at 10% -14%, rgba(255, 255, 255, .55), rgba(255, 255, 255, 0) 58%),
    linear-gradient(180deg, rgba(252, 253, 255, .62) 0%, rgba(248, 250, 253, .54) 100%);
  -webkit-backdrop-filter: url(#vx-lg) blur(3px) saturate(1.5) brightness(1.04);
  backdrop-filter: url(#vx-lg) blur(3px) saturate(1.5) brightness(1.04);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, .95),
    inset 0 10px 18px -14px rgba(255, 255, 255, .85),
    inset 0 -14px 24px -18px rgba(22, 32, 52, .25),
    inset 0 0 0 1px rgba(255, 255, 255, .42),
    0 0 0 .5px rgba(18, 28, 45, .18),
    0 26px 64px rgba(15, 25, 45, .22);
}
:root.vx-dark:not(.vx-glass-off).vx-liquid .vx-dialog {
  background:
    radial-gradient(130% 80% at 10% -14%, rgba(255, 255, 255, .2), rgba(255, 255, 255, 0) 58%),
    linear-gradient(180deg, rgba(28, 30, 36, .66) 0%, rgba(20, 22, 27, .58) 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, .3),
    inset 0 10px 18px -14px rgba(255, 255, 255, .16),
    inset 0 -14px 24px -18px rgba(0, 0, 0, .55),
    inset 0 0 0 1px rgba(255, 255, 255, .14),
    0 0 0 .5px rgba(0, 0, 0, .42),
    0 26px 64px rgba(0, 0, 0, .5);
}
:root:not(.vx-glass-off).vx-liquid .vx-dialog::after {
  content: '';
  position: absolute;
  inset: 0;
  padding: 1px;
  border-radius: inherit;
  pointer-events: none;
  background: linear-gradient(140deg,
    rgba(180, 240, 255, .6) 0%,
    rgba(255, 255, 255, .9) 16%,
    rgba(255, 255, 255, .14) 36%,
    rgba(255, 255, 255, .5) 52%,
    rgba(255, 255, 255, .08) 70%,
    rgba(255, 190, 235, .45) 100%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask: linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0);
}
:root.vx-dark.vx-liquid:not(.vx-glass-off) .vx-dialog::after {
  background: linear-gradient(140deg,
    rgba(150, 220, 255, .24) 0%,
    rgba(255, 255, 255, .34) 16%,
    rgba(255, 255, 255, .06) 36%,
    rgba(255, 255, 255, .22) 52%,
    rgba(255, 255, 255, .04) 70%,
    rgba(255, 190, 235, .2) 100%);
}
.vx-dialog[data-state='closed'] { animation: vx-dialog-out .16s var(--vx-ease-in) forwards; }
.vx-dialog-sm { max-width: 360px; }
.vx-dialog-md { max-width: 520px; }
.vx-dialog-lg { max-width: 720px; }
.vx-dialog-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px 18px 8px;
}
.vx-dialog-titles { flex: 1; min-width: 0; }
.vx-dialog-title {
  margin: 0;
  font-size: var(--dsw-font-m-18-font-size, 16px);
  font-weight: 500;
  line-height: var(--dsw-font-m-18-line-height, 28px);
  color: var(--dsw-alias-label-primary, #1b1b1c);
}
.vx-dialog-desc {
  margin: 2px 0 0;
  font-size: var(--dsw-font-xxs-12-font-size, 12px);
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary, #979da6);
}
.vx-dialog-body {
  padding: 4px 18px 8px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scrollbar-width: thin;
  scrollbar-color: var(--dsh-scrollbar-thumb, rgba(0, 0, 0, .2)) transparent;
}
.vx-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 18px 16px;
}
.vx-discard-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: var(--dsw-radius-sm, 8px);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f59e0b) 14%, transparent);
  color: var(--dsw-alias-label-primary, #1b1b1c);
  font-size: var(--dsw-font-xxs-12-font-size, 12px);
}
.vx-dialog-text { font-size: var(--dsw-font-xs-13-font-size, 13px); line-height: 20px; }
/* One shell for every anchored card: a fixed head, exactly one scrolling body
   and a fixed foot. The cards used to set their own paddings, which is how the
   balance card ended up looking like a different surface from the prompt card. */
.vx-pop-head {
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
  align-items: center;
  padding: 12px 14px 6px;
  font-weight: 500;
  font-size: var(--dsw-font-xs-13-font-size, 13px);
  line-height: var(--dsw-font-xs-13-line-height, 20px);
}
.vx-pop-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 4px 14px 10px;
  scrollbar-width: thin;
  scrollbar-color: var(--dsh-scrollbar-thumb, rgba(0, 0, 0, .2)) transparent;
}
.vx-svgbox {
  overflow: auto;
  background: var(--dsw-alias-markdown-code-block, var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, .04)));
  border-radius: var(--dsw-radius-md, 12px);
  padding: 14px;
}
.vx-svgbox svg { max-width: 100%; height: auto; }

/* ---------- popovers / panels ---------- */
.vx-popover {
  position: fixed;
  box-sizing: border-box;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  scrollbar-width: thin;
  scrollbar-color: var(--dsh-scrollbar-thumb, rgba(0, 0, 0, .2)) transparent;
}
.vx-popover[data-state='open'] { animation: vx-pop-in var(--vx-dur-pop) var(--vx-ease-out); }
.vx-popover[data-state='closed'] { animation: vx-pop-out var(--vx-dur-close) var(--vx-ease-in) forwards; }
/* A scale animation distorts an SVG backdrop filter's coordinate space. Liquid
   cards slide/fade instead of scaling so the refraction stays aligned while
   the card enters. */
.vx-liquid .vx-popover[data-state='open'] { animation-name: vx-pop-in-liquid; }
.vx-liquid .vx-popover[data-state='closed'] { animation-name: vx-pop-out-liquid; }
/* Card widths stay content-driven; head/body/foot come from the shared shell. */
.vx-prompt-list { max-height: none; overflow: visible; }
.vx-pop-search {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  padding: 0 14px 6px;
  color: var(--dsw-alias-label-tertiary, #979da6);
}
.vx-pop-group {
  padding: 6px 2px 2px;
  font-size: var(--dsw-font-xxxs-11-font-size, 11px);
  color: var(--dsw-alias-label-tertiary, #979da6);
}
.vx-prompt-row {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-primary, #1b1b1c);
  font-family: inherit;
  padding: 6px 8px;
  border-radius: var(--dsw-radius-sm, 8px);
  cursor: pointer;
  transition: background-color var(--ds-transition-duration-fast, .1s) var(--vx-ease);
}
.vx-prompt-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06)); }
.vx-prompt-row-name { font-size: var(--dsw-font-xs-13-font-size, 13px); font-weight: 500; }
.vx-prompt-row-text {
  font-size: var(--dsw-font-xxs-12-font-size, 12px);
  color: var(--dsw-alias-label-secondary, #61666b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vx-prompt-row-tags { font-size: var(--dsw-font-xxxs-11-font-size, 11px); color: var(--dsw-alias-label-tertiary, #979da6); }
.vx-pop-foot {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 6px 14px 12px;
  border-top: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .04));
}
/* The usage tables sit in a 380px card; fixed layout keeps six columns from
   pushing the panel into horizontal scroll. */
.vx-balance-pop .vx-table { table-layout: fixed; }
.vx-balance-pop .vx-table th,
.vx-balance-pop .vx-table td {
  padding: 4px 3px;
  font-size: var(--dsw-font-xxxs-11-font-size, 11px);
  white-space: nowrap;
}
.vx-balance-pop .vx-table th:first-child,
.vx-balance-pop .vx-table td:first-child {
  width: 34%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vx-balance-pop .vx-table th:not(:first-child),
.vx-balance-pop .vx-table td:not(:first-child) { text-align: right; }
.vx-balance-totals {
  font-size: var(--dsw-font-xs-13-font-size, 13px);
  font-weight: 500;
  line-height: var(--dsw-font-xs-13-line-height, 20px);
}
.vx-balance-hint { margin-top: 6px; }
.vx-settings-page { display: flex; flex-direction: column; gap: 16px; max-width: 980px; }
/* The host settings surface is a side panel, not a full page: a stacked nav
   strip keeps the card at full panel width instead of squeezing it beside a
   rail. */
.vx-settings-shell { display: flex; flex-direction: column; gap: 12px; align-items: stretch; }
.vx-settings-nav {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 4px;
  padding-bottom: 2px;
}
.vx-settings-nav-item {
  text-align: left;
  white-space: nowrap;
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #61666b);
  font-family: inherit;
  font-size: var(--dsw-font-xs-13-font-size, 13px);
  border-radius: var(--dsw-radius-sm, 8px);
  padding: 6px 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  transition: background-color var(--ds-transition-duration-fast, .1s) var(--vx-ease);
}
.vx-settings-nav-item:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06)); }
.vx-settings-nav-item.on {
  background: var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, .1));
  color: var(--dsw-alias-label-primary, #1b1b1c);
  font-weight: 500;
}
.vx-settings-content { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
@media (max-width: 760px) {
  .vx-settings-nav { gap: 2px; }
}

/* ---------- toasts ---------- */
.vx-toast-stack {
  position: fixed;
  left: 50%;
  bottom: 26px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
  pointer-events: auto;
  z-index: 80;
}
.vx-toast {
  display: flex;
  gap: 10px;
  align-items: center;
  max-width: min(560px, calc(100vw - 32px));
  padding: 8px 10px 8px 14px;
  border-radius: var(--dsw-radius-md, 12px);
  background: var(--dsw-alias-toast-bg, #353638);
  color: var(--dsw-alias-toast-label, #fff);
  font-size: var(--dsw-font-xxs-12-font-size, 12px);
  box-shadow: var(--dsw-shadow-lv2, 0 4px 12px rgba(0, 0, 0, .12));
}
.vx-toast[data-state='open'] { animation: vx-toast-in .22s var(--vx-ease-out); }
.vx-toast[data-state='closed'] { animation: vx-toast-out .16s var(--vx-ease-in) forwards; }
.vx-toast-error { background: var(--dsw-alias-state-error-primary, #ec1313); color: var(--dsw-static-neutral-00, #fff); }
.vx-toast-text { flex: 1; min-width: 0; }
.vx-toast-action,
.vx-toast-close {
  border: none;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
  border-radius: var(--dsw-radius-xs, 4px);
  padding: 2px 6px;
  opacity: .8;
}
.vx-toast-action { font-weight: 500; text-decoration: underline; text-underline-offset: 2px; }
.vx-toast-close { font-size: 14px; line-height: 1; padding: 2px 5px; }
.vx-toast-action:hover,
.vx-toast-close:hover { opacity: 1; background: rgba(255, 255, 255, .14); }

/* ---------- mermaid ---------- */
.vx-mmd-wrap {
  position: relative;
  margin: 6px 0;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .1));
  border-radius: var(--dsw-radius-md, 12px);
  overflow: hidden;
  background: var(--dsw-alias-markdown-code-block, transparent);
}
.vx-mmd-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, .04));
  background: var(--dsw-alias-markdown-code-block-banner, transparent);
}
.vx-mmd-btn {
  border: none;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #61666b);
  font-family: inherit;
  font-size: var(--dsw-font-xxs-12-font-size, 12px);
  padding: 3px 10px;
  border-radius: var(--dsw-radius-sm, 8px);
  cursor: pointer;
}
.vx-mmd-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, .06)); }
.vx-mmd-btn.active {
  background: var(--dsw-alias-markdown-code-segment-selected, var(--dsw-alias-interactive-bg-active, rgba(38, 49, 72, .1)));
  color: var(--dsw-alias-label-primary, #1b1b1c);
  font-weight: 500;
}
.vx-mmd-live {
  margin-left: auto;
  font-size: var(--dsw-font-xxxs-11-font-size, 11px);
  color: var(--dsw-alias-label-tertiary, #979da6);
  text-decoration: none;
  padding: 3px 8px;
}
.vx-mmd-live:hover { color: var(--dsw-alias-label-secondary, #61666b); }
.vx-mmd-stage { padding: 16px 12px; overflow-x: auto; text-align: center; }
.vx-mmd-stage svg { max-width: 100%; height: auto; }

/* ---------- motion / focus polish ---------- */
.vx-section-in {
  display: flex;
  flex-direction: column;
  gap: 14px;
  animation: vx-section-in .22s var(--vx-ease-out);
}
.vx-icon-spin { animation: vx-rotate .9s linear infinite; transform-origin: center; }
.vx-button,
.vx-icon-button,
.vx-header-btn,
.vx-settings-nav-item,
.vx-prompt-row,
.vx-list-item {
  outline: none;
  transition-property: background-color, color, border-color, transform, opacity;
  transition-duration: var(--ds-transition-duration-fast, .1s);
  transition-timing-function: var(--vx-ease);
}
.vx-button:focus-visible,
.vx-icon-button:focus-visible,
.vx-header-btn:focus-visible,
.vx-settings-nav-item:focus-visible,
.vx-prompt-row:focus-visible,
.vx-list-item:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4d6bfe);
  outline-offset: 2px;
}
.vx-button:active:not(:disabled),
.vx-icon-button:active:not(:disabled),
.vx-header-btn:active,
.vx-settings-nav-item:active,
.vx-prompt-row:active,
.vx-list-item:active { transform: scale(.97); }

/* ---------- reduced motion ---------- */
@media (prefers-reduced-motion: reduce) {
  .vx-root *,
  .vx-settings-page,
  .vx-settings-page *,
  .vx-popover,
  .vx-dialog,
  .vx-dialog-mask,
  .vx-toast,
  .vx-toast-stack {
    animation: none !important;
    transition: none !important;
    transform: none !important;
  }
}
`
