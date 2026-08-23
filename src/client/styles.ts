/**
 * Static styles for the Custom suite, injected as one owned <style> tag at
 * install time (removed by the disposer). Global class names are prefixed
 * vx- and must not be scoped by CSS Modules.
 * @module @alexpeng/dsh-custom-plugin/client/styles
 */

export const STATIC_CSS = `/* dsh-custom-plugin static styles. Every rule is global by design: the UI
 * mounts into product slots and overlays, so class names are prefixed vx-
 * and must not be scoped by CSS Modules. Dynamic rules (body background,
 * aurora gradient, global-glass blur) are managed at runtime by a style
 * element in custom.tsx and do not live here. */
.vx-root {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483000;
    font-family: ui-sans-serif, system-ui, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
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
  .vx-chip {
    pointer-events: auto;
    border: 1px solid rgba(128, 140, 160, .4);
    background: rgba(255, 255, 255, .16);
    color: inherit;
    border-radius: 8px;
    padding: 2px 8px;
    font-size: 11px;
    cursor: pointer;
    backdrop-filter: blur(6px);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .vx-chip:hover {
    background: rgba(255, 255, 255, .28);
  }
  .vx-link {
    text-decoration: none;
  }
  .vx-glass {
    border-radius: 16px;
    background: rgba(255, 255, 255, .64);
    -webkit-backdrop-filter: blur(9px) saturate(1.22);
    backdrop-filter: blur(9px) saturate(1.22);
    box-shadow: 0 0 1px 1px rgba(17, 17, 26, .07) inset, 0 1px 2px rgba(17, 17, 26, .05) inset, 0px 4px 16px rgba(17, 17, 26, .05), 0px 8px 24px rgba(17, 17, 26, .05), 0px 16px 56px rgba(17, 17, 26, .05);
  }
  @media (prefers-color-scheme: dark) {
    .vx-glass {
      background: rgba(13, 17, 25, .62);
      color: #eef1f7;
    }
  }
  .vx-liquid .vx-glass {
    background: rgba(255, 255, 255, .06);
    backdrop-filter: url(#vx-lg);
    -webkit-backdrop-filter: url(#vx-lg);
  }
  @media (prefers-color-scheme: dark) {
    .vx-liquid .vx-glass {
      background: rgba(0, 0, 0, .06);
    }
  }
  @supports not (backdrop-filter: url(#vx-lg)) {
    .vx-liquid .vx-glass {
      background: rgba(255, 255, 255, .64);
      backdrop-filter: blur(9px) saturate(1.22);
      -webkit-backdrop-filter: blur(9px) saturate(1.22);
    }
    @media (prefers-color-scheme: dark) {
      .vx-liquid .vx-glass {
        background: rgba(13, 17, 25, .62);
      }
    }
  }
  .vx-liquid .vx-pattern {
    background-image: radial-gradient(rgba(150, 150, 160, .5) 3px, transparent 3px);
    background-size: 24px 24px;
    -webkit-mask-image: radial-gradient(ellipse at top, transparent 20%, black);
    mask-image: radial-gradient(ellipse at top, transparent 20%, black);
    animation: vx-pattern-move 25000ms linear infinite;
  }
  @media (prefers-color-scheme: dark) {
    .vx-liquid .vx-pattern {
      background-image: radial-gradient(rgba(110, 110, 128, .5) 3px, transparent 3px);
    }
  }
  .vx-pattern {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: -1;
    background-image: radial-gradient(rgba(150, 150, 160, .42) 1px, transparent 1px);
    background-size: 24px 24px;
    -webkit-mask-image: radial-gradient(ellipse at center, transparent 30%, black 100%);
    mask-image: radial-gradient(ellipse at center, transparent 30%, black 100%);
    animation: vx-pattern-move 10000ms linear infinite;
  }
  @media (prefers-color-scheme: dark) {
    .vx-pattern {
      background-image: radial-gradient(rgba(100, 100, 116, .5) 1px, transparent 1px);
    }
  }
  @keyframes vx-pattern-move {
    from {
      background-position: 0 0;
    }
    to {
      background-position: 0 24px;
    }
  }
  @keyframes vx-aurora {
    0% {
      background-position: 0% 50%;
    }
    50% {
      background-position: 100% 50%;
    }
    100% {
      background-position: 0% 50%;
    }
  }
  .vx-rail {
    position: absolute;
    width: 12px;
    border-radius: 8px;
    background: rgba(120, 130, 150, .18);
    border: 1px solid rgba(120, 130, 150, .25);
    pointer-events: auto;
    touch-action: none;
    box-sizing: border-box;
  }
  .vx-rail.right {
    right: 4px;
  }
  .vx-rail.left {
    left: 56px;
  }
  /* When the rail is active it substitutes the native scrollbar: the scrollport
     carrying the vx-rail-scroller class (added by the client when it resolves
     the chat scrollport) hides its own bar so only one scroll affordance
     remains. scrollbar-gutter: stable on the shell keeps the layout width. */
  .vx-rail-scroller {
    scrollbar-width: none;
  }
  .vx-rail-scroller::-webkit-scrollbar {
    display: none;
  }
  .vx-thumb {
    position: absolute;
    left: 1px;
    right: 1px;
    border-radius: 8px;
    background: rgba(90, 105, 135, .5);
    border: 1px solid rgba(255, 255, 255, .35);
    box-sizing: border-box;
  }
  .vx-thumb:hover {
    background: rgba(90, 105, 135, .7);
  }
  .vx-dot {
    position: absolute;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: rgba(70, 85, 110, .92);
    border: 2px solid rgba(255, 255, 255, .92);
    box-shadow: 0 1px 3px rgba(0, 0, 0, .35);
    pointer-events: auto;
    cursor: pointer;
    transition: transform .12s;
    padding: 0;
  }
  .vx-dot:hover {
    transform: translate(-50%, -50%) scale(1.35);
  }
  .vx-dot.star {
    background: #c9a24b;
    border-color: #f3e3bd;
  }
  @media (prefers-color-scheme: dark) {
    .vx-dot {
      background: rgba(205, 215, 230, .95);
      border-color: rgba(28, 34, 46, .9);
    }
    .vx-thumb {
      background: rgba(165, 180, 205, .45);
    }
  }
  .vx-rail-pop {
    position: absolute;
    pointer-events: auto;
    padding: 10px 12px;
    width: 300px;
    font-size: 12px;
    line-height: 1.55;
    z-index: 5;
  }
  /* Class = which side the rail sits on; the card must open toward the page
     content. It is a child of the 12px-wide rail, so right:20px puts it left
     of the rail and left:20px puts it right (20px = rail width + 8px gap). */
  .vx-rail-pop.right {
    right: 20px;
  }
  .vx-rail-pop.left {
    left: 20px;
  }
  .vx-pop-time {
    color: #6d7689;
    font-size: 11px;
    margin-bottom: 4px;
  }
  .vx-pop-text {
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 150px;
    overflow: hidden;
    margin-bottom: 8px;
  }
  .vx-pop-row {
    display: flex;
    gap: 5px;
    flex-wrap: wrap;
    align-items: center;
  }
  .vx-balance-wrap {
    display: inline-flex;
    align-items: center;
    position: relative;
  }
  .vx-balance-text {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    border-radius: 8px;
    font-size: 12.5px;
    color: inherit;
    background: rgba(127, 164, 224, .16);
    border: 1px solid rgba(127, 164, 224, .4);
    cursor: default;
    white-space: nowrap;
  }
  .vx-balance-text:hover {
    background: rgba(127, 164, 224, .28);
  }
  .vx-balance-text.vx-balance-pinned {
    background: rgba(127, 164, 224, .36);
    border-color: rgba(127, 164, 224, .8);
  }
  .vx-balance-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 8px;
  }
  .vx-balance-today {
    opacity: .75;
    font-size: 11.5px;
  }
  .vx-balance-hover {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 70;
    width: 360px;
    max-height: 480px;
    overflow: auto;
    padding: 12px;
    color: #20242e;
    font-size: 12px;
    pointer-events: auto;
  }
  @media (prefers-color-scheme: dark) {
    .vx-balance-hover {
      color: #e8ebf2;
    }
  }
  .vx-balance-lines {
    font-size: 13px;
    margin: 6px 0;
  }
  .vx-header-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    border-radius: 8px;
    font-size: 12.5px;
    color: inherit;
    background: rgba(127, 164, 224, .16);
    border: 1px solid rgba(127, 164, 224, .4);
    cursor: pointer;
    white-space: nowrap;
  }
  .vx-header-btn:hover {
    background: rgba(127, 164, 224, .3);
  }
  .vx-quote-btn {
    position: absolute;
    transform: translate(-50%, -100%);
    pointer-events: auto;
    background: rgba(40, 48, 64, .96);
    color: #eef1f7;
    border: 1px solid rgba(255, 255, 255, .25);
    padding: 5px 12px;
    border-radius: 9px;
    font-size: 12px;
    cursor: pointer;
    box-shadow: 0 6px 18px rgba(0, 0, 0, .28);
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .vx-panel {
    position: absolute;
    width: 430px;
    max-width: calc(100vw - 40px);
    height: min(660px, calc(100vh - 110px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    pointer-events: auto;
    color: #20242e;
  }
  @media (prefers-color-scheme: dark) {
    .vx-panel, .vx-modal, .vx-folders {
      color: #e8ebf2;
    }
  }
  .vx-panel-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    cursor: move;
    user-select: none;
    border-bottom: 1px solid rgba(150, 160, 180, .25);
    position: relative;
    z-index: 1;
  }
  .vx-panel-title {
    font-weight: 600;
    font-size: 13px;
  }
  .vx-panel-sub {
    font-size: 11px;
    opacity: .62;
    white-space: nowrap;
  }
  .vx-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    padding: 8px 10px 4px;
    border-bottom: 1px solid rgba(150, 160, 180, .2);
    position: relative;
    z-index: 1;
  }
  .vx-tab {
    border: none;
    background: transparent;
    color: inherit;
    opacity: .75;
    font-size: 12px;
    padding: 5px 9px;
    border-radius: 8px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .vx-tab.on {
    opacity: 1;
    background: rgba(255, 255, 255, .28);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, .35);
  }
  .vx-panel-body {
    flex: 1;
    overflow: auto;
    padding: 12px 14px;
    position: relative;
    z-index: 1;
  }
  .vx-col {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .vx-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .vx-row.wrap {
    flex-wrap: wrap;
  }
  .vx-flex1 {
    flex: 1;
  }
  .vx-section-title {
    font-weight: 600;
    font-size: 12.5px;
    margin-top: 4px;
    opacity: .9;
  }
  .vx-swatches {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
  }
  .vx-swatch {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    padding: 0;
  }
  .vx-swatch-box {
    width: 34px;
    height: 26px;
    border-radius: 8px;
    border: 2px solid rgba(120, 130, 150, .4);
    box-sizing: border-box;
  }
  .vx-swatch.on .vx-swatch-box {
    border-color: #7fa4e0;
    box-shadow: 0 0 0 2px rgba(127, 164, 224, .35);
  }
  .vx-swatch:disabled {
    opacity: .35;
    cursor: not-allowed;
  }
  .vx-swatch-label {
    font-size: 10px;
    opacity: .85;
  }
  .vx-btn {
    pointer-events: auto;
    border: 1px solid rgba(128, 140, 160, .4);
    background: rgba(255, 255, 255, .16);
    color: inherit;
    border-radius: 9px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .vx-btn:hover {
    background: rgba(255, 255, 255, .28);
  }
  .vx-btn.on {
    background: rgba(127, 164, 224, .35);
    border-color: rgba(127, 164, 224, .8);
  }
  .vx-btn:disabled {
    opacity: .5;
    cursor: default;
  }
  .vx-btn-sm {
    padding: 2px 8px;
    font-size: 11px;
  }
  .vx-btn-danger {
    background: rgba(214, 88, 88, .22);
    border-color: rgba(214, 88, 88, .55);
  }
  .vx-btn.big {
    padding: 10px 16px;
    font-size: 13px;
  }
  .vx-input {
    flex: 1;
    min-width: 0;
    border: 1px solid rgba(128, 140, 160, .4);
    background: rgba(255, 255, 255, .16);
    color: inherit;
    border-radius: 9px;
    padding: 6px 10px;
    font-size: 12px;
  }
  .vx-textarea {
    border: 1px solid rgba(128, 140, 160, .4);
    background: rgba(255, 255, 255, .16);
    color: inherit;
    border-radius: 9px;
    padding: 6px 10px;
    font-size: 12px;
    resize: vertical;
    font-family: inherit;
  }
  .vx-toggle-row {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 12.5px;
  }
  .vx-muted {
    color: rgba(120, 128, 148, .95);
    font-size: 11.5px;
  }
  .vx-error {
    color: #d85858;
    font-size: 12px;
  }
  .vx-pad {
    padding: 12px;
  }
  .vx-pad-sm {
    padding: 6px 2px;
  }
  .vx-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 300px;
    overflow: auto;
  }
  .vx-list-item {
    text-align: left;
    border: none;
    background: rgba(255, 255, 255, .1);
    color: inherit;
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .vx-list-item:hover {
    background: rgba(255, 255, 255, .22);
  }
  .vx-check-row {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 12.5px;
    padding: 4px 2px;
  }
  .vx-check-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .vx-badge {
    background: rgba(127, 164, 224, .3);
    border-radius: 8px;
    padding: 0 6px;
    font-size: 10px;
  }
  .vx-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11.5px;
  }
  .vx-table th, .vx-table td {
    border: 1px solid rgba(128, 140, 160, .3);
    padding: 4px 6px;
    text-align: right;
  }
  .vx-table th:first-child, .vx-table td:first-child {
    text-align: left;
  }
  .vx-folder {
    display: flex;
    flex-direction: column;
  }
  .vx-folder-head {
    display: flex;
    gap: 5px;
    align-items: center;
    padding: 5px 4px;
    border-radius: 9px;
    cursor: grab;
  }
  .vx-folder-head:hover {
    background: rgba(255, 255, 255, .14);
  }
  .vx-folder-head.drop-inside {
    background: rgba(127, 164, 224, .3);
    outline: 1px dashed rgba(127, 164, 224, .8);
  }
  .vx-folder-head.drop-before {
    box-shadow: 0 -2px 0 0 rgba(127, 164, 224, .9);
  }
  .vx-folder-head.drop-after {
    box-shadow: 0 2px 0 0 rgba(127, 164, 224, .9);
  }
  .vx-folder-name {
    font-size: 12.5px;
    font-weight: 600;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .vx-folder-body {
    border-left: 1px dashed rgba(128, 140, 160, .35);
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
    border-radius: 8px;
  }
  .vx-item-row:hover {
    background: rgba(255, 255, 255, .12);
  }
  .vx-item-name {
    flex: 1;
    text-align: left;
    border: none;
    background: transparent;
    color: inherit;
    font-size: 12px;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0;
  }
  .vx-mini {
    border: none;
    background: transparent;
    color: inherit;
    opacity: .75;
    cursor: pointer;
    padding: 2px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
  }
  .vx-mini:hover {
    opacity: 1;
    background: rgba(255, 255, 255, .2);
  }
  .vx-form {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border: 1px dashed rgba(128, 140, 160, .4);
    border-radius: 10px;
    padding: 8px;
  }
  .vx-prompt-card {
    border: 1px solid rgba(128, 140, 160, .3);
    background: rgba(255, 255, 255, .1);
    border-radius: 10px;
    padding: 8px 10px;
  }
  .vx-prompt-title {
    font-weight: 600;
    font-size: 12.5px;
  }
  .vx-prompt-body {
    margin-top: 4px;
    font-size: 11.5px;
    opacity: .85;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 72px;
    overflow: hidden;
  }
  .vx-modal-mask {
    position: absolute;
    inset: 0;
    pointer-events: auto;
    background: rgba(8, 10, 16, .4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 60;
  }
  .vx-modal {
    position: relative;
    width: min(760px, 92vw);
    max-height: 82vh;
    overflow: auto;
    padding: 16px;
    color: #20242e;
    pointer-events: auto;
  }
  .vx-pop-head {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-bottom: 8px;
    font-weight: 600;
    font-size: 13px;
  }
  .vx-svgbox {
    overflow: auto;
    background: rgba(12, 14, 20, .6);
    border-radius: 12px;
    padding: 14px;
  }
  .vx-svgbox svg {
    max-width: 100%;
    height: auto;
  }
  .vx-pre {
    white-space: pre-wrap;
    word-break: break-all;
    font-size: 10.5px;
    opacity: .85;
  }
  .vx-toasts {
    position: absolute;
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
    color: #f2f4f8;
    background: rgba(26, 32, 44, .92);
    border: 1px solid rgba(255, 255, 255, .12);
    padding: 8px 14px;
    border-radius: 12px;
    font-size: 12.5px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, .3);
    max-width: 560px;
    backdrop-filter: blur(9px);
    -webkit-backdrop-filter: blur(9px);
  }
  @media (prefers-color-scheme: dark) {
    .vx-toast {
      background: rgba(18, 22, 30, .94);
    }
  }
  .vx-foot-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid rgba(127, 164, 224, .4);
    background: rgba(127, 164, 224, .14);
    color: inherit;
    cursor: pointer;
    padding: 4px 10px;
    border-radius: 10px;
    margin: 2px;
  }
  .vx-foot-btn:hover {
    background: rgba(127, 164, 224, .3);
  }
  .vx-foot-label {
    font-size: 12px;
  }
  .vx-folders {
    position: fixed;
    left: 12px;
    bottom: 60px;
    width: 272px;
    max-height: min(560px, calc(100vh - 220px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    pointer-events: auto;
    color: #20242e;
    z-index: 55;
  }
  /* 头部行（图标 + 标题 + 按钮）下移并拉开与容器边缘的间距 */
  .vx-folders .vx-pop-head {
    padding: 14px 14px 0;
  }
  .vx-folders-body {
    flex: 1;
    overflow: auto;
    padding: 4px 14px 12px;
    position: relative;
    z-index: 1;
  }
  .vx-prompt-pop {
    position: fixed;
    width: 320px;
    max-height: 420px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    pointer-events: auto;
    color: #20242e;
    z-index: 65;
    padding: 10px 12px;
  }
  .vx-settings-page {
    display: flex;
    flex-direction: column;
    gap: 14px;
    max-width: 720px;
  }
  .vx-mmd-wrap {
    position: relative;
    margin: 6px 0;
    border: 1px solid rgba(127, 164, 224, .35);
    border-radius: 12px;
    overflow: hidden;
    background: rgba(127, 164, 224, .05);
  }
  .vx-mmd-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    border-bottom: 1px solid rgba(127, 164, 224, .25);
    background: rgba(127, 164, 224, .08);
  }
  .vx-mmd-btn {
    border: none;
    background: transparent;
    color: inherit;
    opacity: .65;
    font-size: 12px;
    padding: 3px 10px;
    border-radius: 8px;
    cursor: pointer;
  }
  .vx-mmd-btn:hover {
    opacity: 1;
    background: rgba(127, 164, 224, .18);
  }
  .vx-mmd-btn.active {
    opacity: 1;
    background: rgba(127, 164, 224, .28);
    font-weight: 600;
  }
  .vx-mmd-live {
    margin-left: auto;
    font-size: 11px;
    opacity: .6;
    color: inherit;
    text-decoration: none;
    padding: 3px 8px;
  }
  .vx-mmd-live:hover {
    opacity: 1;
  }
  .vx-mmd-stage {
    padding: 16px 12px;
    overflow-x: auto;
    text-align: center;
  }
  .vx-mmd-stage svg {
    max-width: 100%;
    height: auto;
  }`
