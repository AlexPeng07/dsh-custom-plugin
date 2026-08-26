/**
 * Browser half of dsh-custom-plugin: the Custom convenience suite UI.
 *
 * A single mutable store (`S`) drives every surface through a lightweight
 * listener set; components re-render on `setS`. The file ports the earlier
 * dynamic-plugin implementation: React is a platform import, static styles
 * are injected through one owned style element (styles.ts), dynamic body
 * styles (background / aurora / global glass) extend it, and host calls go
 * over `/api/custom-plugin` fetch routes.
 * @module @alexpeng/dsh-custom-plugin/client/custom
 */

import * as React from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionListState, TurnLocation, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialStorage, CustomPluginConfig, FolderNode, PromptItem, TimelineItem, UsageRow } from '../protocol.ts'
import { dayKey } from '../usage.ts'
import { DEEPSEEK_PRICING_CHECKED_ON, DEEPSEEK_PRICING_SOURCE_URL, usageCostBreakdown } from '../pricing.ts'
import {
  apiBalanceGet,
  apiDebugInfo,
  apiDiagReport,
  apiExportRun,
  apiMermaidFetch,
  apiStateGet,
  apiStateSave,
  apiTimelineGet,
  apiUsageScan,
} from './api.ts'
import { MERMAID_SCRIPT_PATH } from '../protocol.ts'
import { isGenericInfostring, isMermaidCode, normalizeMermaidText } from './mermaid-code.ts'
import { mermaidLiveUrl } from './mermaid-url.ts'
import { STATIC_CSS } from './styles.ts'

/** Minimal input-state face the input dock owner provides. */
interface InputStateLike {
  draft?: string
}

/** Minimal input-actions face the framework injects into input-region slots. */
interface InputActionsLike {
  setDraft(text: string, editRange?: unknown): void
}

/** Minimal workspace row face (official WorkspaceView carries workspaceId). */
interface WorkspaceRowLike {
  workspaceId: string
  title?: string
  path?: string
}

function fmtClock(time: number): string {
  const d = new Date(time)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatTokenCount(value: number): string {
  return Math.round(value).toLocaleString('zh-CN')
}

/** Shared mutable store. */
interface Store {
  cfg: CustomPluginConfig
  folders: FolderNode[]
  prompts: PromptItem[]
  stars: Record<string, Record<string, boolean>>
  apiKey: string
  apiKeyDirty: boolean
  apiKeyConfigured: boolean
  credentialStorage: CredentialStorage
  usage: Record<string, Record<string, UsageRow>>
  sessionId: string | null
  turns: { sessionId: string; items: TimelineItem[] } | null
  anchors: Map<number, { el: HTMLElement; turn: TurnLocation | null }>
  seqAnchor: Map<number, HTMLElement>
  railPositions: Array<{ seq: number; y: number; st: boolean }>
  railSig: string
  railHover: { seq: number; y: number } | null
  railHoverTimer: ReturnType<typeof setTimeout> | null
  railBox: { top: number; height: number }
  railRight: number
  railLeft: number
  thumbTop: number
  thumbH: number
  scrollerEl: HTMLElement | null
  panelOpen: boolean
  panelTab: string
  panelPos: { x: number; y: number } | null
  foldersOpen: boolean
  folderAdd: string | null
  folderWsPick: string | null
  dragFolder: string | null
  dropHint: { id: string; zone: string } | null
  promptOpen: { x: number; y: number } | null
  promptQuery: string
  batchModal: boolean
  mermaidModal: { title: string; codes: string[]; index: number } | null
  quoteSel: { text: string; x: number; y: number } | null
  ask: { title: string; value: string; cb: (text: string) => void } | null
  confirmAsk: { message: string; cb: (ok: boolean) => void } | null
  toasts: Array<{ id: number; text: string; kind: string; action: { label: string; run: () => void } | null }>
  booted: boolean
  dark: boolean
  balance: Record<string, unknown> | null
  exporting: boolean
  insertDraft: ((text: string, replace: boolean) => boolean) | null
  greeted: boolean
}

/** Palette of 20 muted low-saturation backgrounds (with matching tab colors).
 * 天青灰 leads the list: it is the install default and renders first among
 * the palette swatches, right after 无颜色 / 极光. */
export const PALETTE: Array<[string, string, string]> = [
  ['天青灰', '#E9EBEE', '#D6DADF'],
  ['暖象牙', '#F5F0E8', '#E8E0D4'],
  ['雾灰绿', '#E9EDE6', '#D7DED3'],
  ['烟熏玫瑰', '#F2EAEC', '#E5D6DA'],
  ['雾蓝', '#E8EDF2', '#D4DDE6'],
  ['薰衣草灰', '#EFEDF4', '#E0DCEB'],
  ['燕麦米', '#F3EEE6', '#E5DED3'],
  ['薄荷雾', '#EAF0ED', '#D7E3DC'],
  ['裸桃', '#F5EDE8', '#E8DCD4'],
  ['石板蓝', '#E6EDF1', '#D2DBE3'],
  ['紫藤灰', '#EEEBF2', '#E1DAE8'],
  ['奶油黄', '#F4F0E6', '#E6E1D5'],
  ['鼠尾草', '#EAEDE5', '#D7DED1'],
  ['腮红粉', '#F3EAEC', '#E6D6DA'],
  ['香草白', '#F3F0E6', '#E5E0D4'],
  ['青灰', '#E7F0F0', '#D3E1E1'],
  ['杏仁白', '#F0ECE8', '#E2DAD3'],
  ['尤加利', '#EAF0ED', '#D7E3DB'],
  ['珍珠灰', '#EDEDEE', '#DCDCDD'],
  ['淡金', '#F4F1E4', '#E6E1D0'],
]

/** Neutral glass tokens used when no palette color is active. */
const NEUTRAL_TOKENS: Record<string, { light: string; dark: string }> = {
  '--dsw-alias-bg-base': { light: 'rgba(248,249,251,.5)', dark: 'rgba(15,17,23,.5)' },
  '--dsw-alias-bg-layer-1': { light: 'rgba(255,255,255,.58)', dark: 'rgba(22,25,32,.58)' },
  '--dsw-alias-bg-layer-2': { light: 'rgba(242,244,247,.66)', dark: 'rgba(28,31,40,.66)' },
  '--dsw-alias-bg-overlay': { light: 'rgba(255,255,255,.78)', dark: 'rgba(18,21,28,.78)' },
  '--dsw-specific-sidebar-fill': { light: 'rgba(245,247,250,.56)', dark: 'rgba(13,15,21,.56)' },
}

/** SVG displacement map + filter for the liquid glass (single-channel, no color dispersion). */
const LG_MAP =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
  + '<defs><linearGradient id="r" x1="100%" y1="0%" x2="0%" y2="0%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="red"/></linearGradient>'
  + '<linearGradient id="b" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="blue"/></linearGradient></defs>'
  + '<rect width="100" height="100" fill="black"/>'
  + '<rect width="100" height="100" rx="16" fill="url(#r)"/>'
  + '<rect width="100" height="100" rx="16" fill="url(#b)" style="mix-blend-mode: difference"/>'
  + '<rect x="3.5" y="3.5" width="93" height="93" rx="16" fill="hsl(0 0% 50% / 0.93)" style="filter: blur(11px)"/></svg>'
const LG_URI = 'data:image/svg+xml,' + encodeURIComponent(LG_MAP)
const LG_FILTER =
  '<filter id="vx-lg" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">'
  + '<feImage href="' + LG_URI + '" result="map" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none"/>'
  + '<feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="B" scale="-180" result="d"/>'
  + '<feGaussianBlur in="d" stdDeviation="4"/></filter>'

function ensureLiquidGlass(): void {
  const d = typeof document !== 'undefined' ? document : null
  if (d === null || d.getElementById('vx-lg-filter') !== null) return
  try {
    const svg = d.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('id', 'vx-lg-filter')
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden')
    svg.innerHTML = LG_FILTER
    d.documentElement.appendChild(svg)
  } catch (error) {
    apiDiagReport('ensureLiquidGlass: ' + String((error as Error)?.message ?? error))
  }
}

/** One owned style element carrying the static rules plus the dynamic body rules. */
let dynStyle: HTMLStyleElement | null = null
function setDynCss(css: string): void {
  const d = typeof document !== 'undefined' ? document : null
  if (d === null) return
  if (dynStyle === null || !dynStyle.isConnected) {
    dynStyle = d.createElement('style')
    dynStyle.setAttribute('data-custom-plugin-css', '')
    d.head.appendChild(dynStyle)
  }
  dynStyle.textContent = STATIC_CSS + '\n' + css
}
function removeDynCss(): void {
  if (dynStyle !== null && dynStyle.isConnected) {
    try { dynStyle.remove() } catch { /* style already gone */ }
  }
  dynStyle = null
}

/** Public component props (the product slot system injects these). */
export interface OverlayProps {
  useSessions: SnapshotSelectorHook<SessionListState>
  useWorkspaces: SnapshotSelectorHook<WorkspaceListState>
}
export interface QuoteDockProps {
  input: InputStateLike
  inputActions: InputActionsLike
}
export interface TurnTailProps {
  turn: TurnLocation
  seq: number
  openFile: (path: string) => void
  matched?: number | null
}

/** Install the whole Custom UI into the client context. Returns a disposer that unregisters every slot entry. */
export function installCustomPlugin(ctx: Context, reportDiag: (message: string) => void): () => void {
  const C = ctx

  const S: Store = {
    cfg: { bg: '天青灰', weather: 'none', glass: true, glassMode: 'frost', globalGlass: true, timeline: true, timelineLeft: false, starsOnly: false, quote: true, antiScroll: false, mermaid: true, formula: true },
    folders: [],
    prompts: [],
    stars: {},
    apiKey: '',
    apiKeyDirty: false,
    apiKeyConfigured: false,
    credentialStorage: 'none',
    usage: {},
    sessionId: null,
    turns: null,
    anchors: new Map(),
    seqAnchor: new Map(),
    railPositions: [],
    railSig: '',
    railHover: null,
    railHoverTimer: null,
    railBox: { top: 64, height: 600 },
    railRight: 4,
    railLeft: 56,
    thumbTop: 0,
    thumbH: 26,
    scrollerEl: null,
    panelOpen: false,
    panelTab: 'look',
    panelPos: null,
    foldersOpen: false,
    folderAdd: null,
    folderWsPick: null,
    dragFolder: null,
    dropHint: null,
    promptOpen: null,
    promptQuery: '',
    batchModal: false,
    mermaidModal: null,
    quoteSel: null,
    ask: null,
    confirmAsk: null,
    toasts: [],
    booted: false,
    dark: false,
    balance: null,
    exporting: false,
    insertDraft: null,
    greeted: false,
  }

  let listeners: Array<() => void> = []
  function setS(patch: Partial<Store>): void {
    Object.assign(S, patch)
    for (const listener of listeners) {
      try { listener() } catch { /* listener errors never take the GUI down */ }
    }
  }
  function useS(): Store {
    const [, force] = React.useReducer((x: number) => x + 1, 0)
    React.useEffect(() => {
      listeners.push(force)
      return () => { listeners = listeners.filter((l) => l !== force) }
    }, [])
    return S
  }
  function useSessionsSafe(props: { useSessions: OverlayProps['useSessions'] }): SessionListState | null {
    try { return props.useSessions(st => st) } catch { return null }
  }
  function useWorkspacesSafe(props: { useWorkspaces: OverlayProps['useWorkspaces'] }): WorkspaceListState | null {
    try { return props.useWorkspaces(st => st) } catch { return null }
  }

  const ICONS: Record<string, Array<[string, Record<string, unknown>]>> = {
    sliders: [['line', { x1: 21, y1: 4, x2: 14, y2: 4 }], ['line', { x1: 10, y1: 4, x2: 3, y2: 4 }], ['line', { x1: 21, y1: 12, x2: 12, y2: 12 }], ['line', { x1: 8, y1: 12, x2: 3, y2: 12 }], ['line', { x1: 21, y1: 20, x2: 16, y2: 20 }], ['line', { x1: 12, y1: 20, x2: 3, y2: 20 }], ['line', { x1: 14, y1: 2, x2: 14, y2: 6 }], ['line', { x1: 8, y1: 10, x2: 8, y2: 14 }], ['line', { x1: 16, y1: 18, x2: 16, y2: 22 }]],
    folder: [['path', { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' }]],
    folderPlus: [['path', { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' }], ['line', { x1: 12, y1: 10, x2: 12, y2: 16 }], ['line', { x1: 9, y1: 13, x2: 15, y2: 13 }]],
    zap: [['path', { d: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z' }]],
    clock: [['circle', { cx: 12, cy: 12, r: 10 }], ['polyline', { points: '12 6 12 12 16 14' }]],
    download: [['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }], ['polyline', { points: '7 10 12 15 17 10' }], ['line', { x1: 12, y1: 15, x2: 12, y2: 3 }]],
    gitBranch: [['line', { x1: 6, y1: 3, x2: 6, y2: 15 }], ['circle', { cx: 18, cy: 6, r: 3 }], ['circle', { cx: 6, cy: 18, r: 3 }], ['path', { d: 'M18 9a9 9 0 0 1-9 9' }]],
    wrench: [['path', { d: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' }]],
    wallet: [['path', { d: 'M21 12V7H5a2 2 0 0 1 0-4h14v4' }], ['path', { d: 'M3 5v14a2 2 0 0 0 2 2h16v-5' }], ['path', { d: 'M18 12a2 2 0 0 0 0 4h4v-4Z' }]],
    info: [['circle', { cx: 12, cy: 12, r: 10 }], ['line', { x1: 12, y1: 16, x2: 12, y2: 12 }], ['line', { x1: 12, y1: 8, x2: 12.01, y2: 8 }]],
    x: [['line', { x1: 18, y1: 6, x2: 6, y2: 18 }], ['line', { x1: 6, y1: 6, x2: 18, y2: 18 }]],
    star: [['path', { d: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' }]],
    fork: [['line', { x1: 6, y1: 3, x2: 6, y2: 15 }], ['circle', { cx: 18, cy: 6, r: 3 }], ['circle', { cx: 6, cy: 18, r: 3 }], ['path', { d: 'M18 9a9 9 0 0 1-9 9' }]],
    copy: [['rect', { x: 9, y: 9, width: 13, height: 13, rx: 2 }], ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }]],
    check: [['polyline', { points: '20 6 9 17 4 12' }]],
    quote: [['path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }]],
    search: [['circle', { cx: 11, cy: 11, r: 8 }], ['line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 }]],
    trash: [['polyline', { points: '3 6 5 6 21 6' }], ['path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' }], ['line', { x1: 10, y1: 11, x2: 10, y2: 17 }], ['line', { x1: 14, y1: 11, x2: 14, y2: 17 }]],
    plus: [['line', { x1: 12, y1: 5, x2: 12, y2: 19 }], ['line', { x1: 5, y1: 12, x2: 19, y2: 12 }]],
    chevronDown: [['polyline', { points: '6 9 12 15 18 9' }]],
    chevronRight: [['polyline', { points: '9 18 15 12 9 6' }]],
    refresh: [['polyline', { points: '23 4 23 10 17 10' }], ['polyline', { points: '1 20 1 14 7 14' }], ['path', { d: 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15' }]],
    briefcase: [['rect', { x: 2, y: 7, width: 20, height: 14, rx: 2 }], ['path', { d: 'M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16' }]],
    message: [['path', { d: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z' }]],
    snowflake: [['line', { x1: 2, y1: 12, x2: 22, y2: 12 }], ['line', { x1: 12, y1: 2, x2: 12, y2: 22 }], ['path', { d: 'm20 16-4-4 4-4' }], ['path', { d: 'm4 8 4 4-4 4' }], ['path', { d: 'm16 4-4 4-4-4' }], ['path', { d: 'm8 20 4-4 4 4' }]],
    cloudRain: [['path', { d: 'M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242' }], ['line', { x1: 16, y1: 14, x2: 16, y2: 20 }], ['line', { x1: 8, y1: 14, x2: 8, y2: 20 }], ['line', { x1: 12, y1: 16, x2: 12, y2: 22 }]],
    flower: [['circle', { cx: 12, cy: 12, r: 3 }], ['circle', { cx: 12, cy: 4.5, r: 2.1 }], ['circle', { cx: 18.5, cy: 8.3, r: 2.1 }], ['circle', { cx: 16, cy: 15.7, r: 2.1 }], ['circle', { cx: 8, cy: 15.7, r: 2.1 }], ['circle', { cx: 5.5, cy: 8.3, r: 2.1 }]],
    arrowUp: [['polyline', { points: '18 15 12 9 6 15' }]],
    arrowDown: [['polyline', { points: '6 9 12 15 18 9' }]],
    minimize: [['polyline', { points: '4 14 10 14 10 20' }], ['polyline', { points: '20 10 14 10 14 4' }], ['line', { x1: 14, y1: 10, x2: 21, y2: 3 }], ['line', { x1: 3, y1: 21, x2: 10, y2: 14 }]],
    moon: [['path', { d: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z' }]],
    sun: [['circle', { cx: 12, cy: 12, r: 4 }], ['line', { x1: 12, y1: 2, x2: 12, y2: 5 }], ['line', { x1: 12, y1: 19, x2: 12, y2: 22 }], ['line', { x1: 2, y1: 12, x2: 5, y2: 12 }], ['line', { x1: 19, y1: 12, x2: 22, y2: 12 }], ['line', { x1: 4.93, y1: 4.93, x2: 7.07, y2: 7.07 }], ['line', { x1: 16.93, y1: 16.93, x2: 19.07, y2: 19.07 }], ['line', { x1: 4.93, y1: 19.07, x2: 7.07, y2: 16.93 }], ['line', { x1: 16.93, y1: 7.07, x2: 19.07, y2: 4.93 }]],
    list: [['line', { x1: 8, y1: 6, x2: 21, y2: 6 }], ['line', { x1: 8, y1: 12, x2: 21, y2: 12 }], ['line', { x1: 8, y1: 18, x2: 21, y2: 18 }], ['line', { x1: 3, y1: 6, x2: 3.01, y2: 6 }], ['line', { x1: 3, y1: 12, x2: 3.01, y2: 12 }], ['line', { x1: 3, y1: 18, x2: 3.01, y2: 18 }]],
  }

  function Icon(props: { n: string; size?: number; filled?: boolean; sw?: number; cls?: string; style?: React.CSSProperties }): React.ReactElement {
    const defs = ICONS[props.n] ?? ICONS.info
    const size = props.size ?? 14
    return React.createElement('svg', {
      viewBox: '0 0 24 24',
      width: size,
      height: size,
      fill: props.filled === true ? 'currentColor' : 'none',
      stroke: props.filled === true ? 'none' : 'currentColor',
      strokeWidth: props.sw ?? 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      className: props.cls ?? '',
      style: props.style ?? null,
    }, defs.map((def, index) => {
      const tag = def[0]
      const attrs = def[1]
      if (tag === 'circle') return React.createElement('circle', { key: index, ...attrs })
      if (tag === 'line') return React.createElement('line', { key: index, ...attrs })
      if (tag === 'rect') return React.createElement('rect', { key: index, ...attrs })
      if (tag === 'polyline') return React.createElement('polyline', { key: index, ...attrs })
      return React.createElement('path', { key: index, ...attrs })
    }))
  }

  function toast(text: string, kind?: string, action?: { label: string; run: () => void } | null): void {
    const id = Date.now() + Math.floor(Math.random() * 9999)
    const item = { id, text, kind: kind ?? 'info', action: action ?? null }
    S.toasts = S.toasts.concat(item).slice(-4)
    setS({ toasts: S.toasts })
    void new Promise<void>((resolve) => setTimeout(resolve, kind === 'error' ? 6000 : 3800)).then(() => {
      S.toasts = S.toasts.filter((t) => t.id !== id)
      setS({ toasts: S.toasts })
    }).catch(() => {})
  }

  function askText(title: string, value: string, cb: (text: string) => void): void {
    setS({ ask: { title, value: value ?? '', cb } })
  }
  function askConfirm(message: string, cb: (ok: boolean) => void): void {
    setS({ confirmAsk: { message, cb } })
  }

  function hexToRgb(hex: string): [number, number, number] {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim())
    if (match === null) return [235, 238, 242]
    const value = parseInt(match[1], 16)
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
  }
  function rgbaOf(hex: string, alpha: number): string {
    const c = hexToRgb(hex)
    return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`
  }
  function shade(hex: string, factor: number): string {
    const c = hexToRgb(hex)
    const mix = (v: number): number => Math.max(0, Math.min(255, Math.round(v * factor)))
    return '#' + [mix(c[0]), mix(c[1]), mix(c[2])].map((v) => v.toString(16).padStart(2, '0')).join('')
  }

  let tokenDisposer: (() => void) | null = null
  function applyAppearance(): void {
    const cfg = S.cfg
    const dEl = typeof document !== 'undefined' ? document.documentElement : null
    if (dEl !== null) {
      try { dEl.classList.toggle('vx-liquid', cfg.glass === true && cfg.glassMode === 'liquid') } catch { /* classList unavailable */ }
    }
    const theme = C.get('theme') as ThemeRuntime | undefined
    if (tokenDisposer !== null) {
      try { tokenDisposer() } catch { /* best effort */ }
      tokenDisposer = null
    }
    if (theme !== undefined && typeof theme.overrideTokens === 'function') {
      if (cfg.bg !== undefined && cfg.bg !== 'default' && cfg.bg !== 'aurora') {
        const entry = PALETTE.find((p) => p[0] === cfg.bg) ?? PALETTE[0]
        const base = entry[1]
        const tab = entry[2] ?? shade(base, 0.94)
        const glassOn = cfg.glass === true
        const mk = (c: string, a: number): string => (glassOn ? rgbaOf(c, a) : c)
        const darkBase = shade(base, 0.78)
        const darkTab = shade(tab, 0.78)
        tokenDisposer = theme.overrideTokens('custom-plugin-appearance', {
          '--dsw-alias-bg-base': { light: mk(base, 0.5), dark: mk(darkBase, 0.5) },
          '--dsw-alias-bg-layer-1': { light: mk(tab, 0.6), dark: mk(darkTab, 0.6) },
          '--dsw-alias-bg-layer-2': { light: mk(shade(base, 0.96), 0.7), dark: mk(shade(darkBase, 0.94), 0.7) },
          '--dsw-alias-bg-overlay': { light: mk(shade(base, 1.04), 0.8), dark: mk(shade(darkBase, 0.86), 0.8) },
          '--dsw-specific-sidebar-fill': { light: mk(tab, 0.62), dark: mk(darkTab, 0.62) },
        })
      } else if (cfg.glass === true || cfg.bg === 'aurora') {
        tokenDisposer = theme.overrideTokens('custom-plugin-appearance', NEUTRAL_TOKENS)
      }
    }
    let dyn = ''
    if (cfg.bg === 'aurora') {
      dyn += '@keyframes vx-aurora { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }'
      dyn += ' body { background: linear-gradient(120deg, #8fa8d8, #b59fd8, #8fc4b4, #d8a8c0) !important; background-size: 320% 320% !important; animation: vx-aurora 26s ease infinite !important; }'
      // The composer seat fades from transparent into a translucent-dark
      // bg-base over 36px (GUI rule on the scrollport's sticky composer
      // child); over the bright aurora in dark mode that fade reads as a
      // smudged band at the page bottom — drop it and let the aurora flow
      // through. Light mode keeps the stock fade.
      dyn += ' body[data-ds-dark-theme] [data-conversation-scroll] > :has([data-conversation-composer-overlay]) { background: transparent !important; }'
    } else if (cfg.bg !== undefined && cfg.bg !== 'default') {
      const base = (PALETTE.find((p) => p[0] === cfg.bg) ?? PALETTE[0])[1]
      dyn += ` body { background-color: ${base} !important; }`
    }
    if (cfg.globalGlass === true) {
      dyn += " [role='dialog'], [role='menu'], [role='tooltip'], [role='listbox'], [data-radix-popper-content-wrapper] { backdrop-filter: blur(8px) saturate(1.2) !important; -webkit-backdrop-filter: blur(8px) saturate(1.2) !important; }"
    }
    setDynCss(dyn)
  }

  function syncAntiScroll(on: boolean): void {
    const d = typeof document !== 'undefined' ? document : null
    const w = typeof window !== 'undefined' ? window : null
    if (d === null) return
    const scrollables = d.querySelectorAll('*')
    for (const el of scrollables) {
      try {
        const cs = w !== null && w.getComputedStyle !== undefined ? w.getComputedStyle(el) : null
        if (cs === null) continue
        if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') {
          if (on) {
            (el as HTMLElement).setAttribute('data-vx-anti', (el as HTMLElement).style.scrollBehavior ?? '')
            ;(el as HTMLElement).style.scrollBehavior = 'auto'
          } else if (el.hasAttribute('data-vx-anti')) {
            ;(el as HTMLElement).style.scrollBehavior = el.getAttribute('data-vx-anti') === 'smooth' ? 'smooth' : ''
            el.removeAttribute('data-vx-anti')
          }
        }
      } catch { /* individual element failure is harmless */ }
    }
  }

  async function loadCfg(): Promise<void> {
    try {
      const result = await apiStateGet()
      if (result.ok === true && result.data !== undefined) {
        const data = result.data
        if (data.cfg !== undefined && data.cfg !== null) {
          const cfg = { ...S.cfg, ...data.cfg }
          delete (cfg as Record<string, unknown>).clouds
          delete (cfg as Record<string, unknown>).wind
          S.cfg = cfg
        }
        if (Array.isArray(data.folders)) S.folders = data.folders
        if (Array.isArray(data.prompts)) S.prompts = data.prompts
        if (data.stars !== undefined && data.stars !== null && typeof data.stars === 'object') S.stars = data.stars
        if (typeof data.apiKeyConfigured === 'boolean') S.apiKeyConfigured = data.apiKeyConfigured
        if (data.credentialStorage === 'system' || data.credentialStorage === 'legacy-state' || data.credentialStorage === 'environment' || data.credentialStorage === 'dsh' || data.credentialStorage === 'none') S.credentialStorage = data.credentialStorage
        if (data.usage !== undefined && data.usage !== null && typeof data.usage === 'object') S.usage = data.usage
      }
    } catch { /* first load may race the host */ }
    S.booted = true
    setS({})
    if (!S.greeted) {
      S.greeted = true
      void new Promise<void>((resolve) => setTimeout(resolve, 1200)).then(() => toast('Custom 便利套件已就绪', 'info')).catch(() => {})
    }
  }

  function saveCfg(): void {
    const cfg = { ...S.cfg }
    delete (cfg as Record<string, unknown>).clouds
    delete (cfg as Record<string, unknown>).wind
    const keyDirty = S.apiKeyDirty
    const edit = { cfg, folders: S.folders, prompts: S.prompts, stars: S.stars, ...(keyDirty ? { apiKey: S.apiKey } : {}) }
    void apiStateSave(edit).then((result) => {
      if (result.ok !== true) {
        if (keyDirty) toast(result.error ?? 'Key 保存失败', 'error')
        return
      }
      if (keyDirty && S.apiKeyDirty && S.apiKey === (edit.apiKey ?? '')) {
        setS({
          apiKeyDirty: false,
          apiKeyConfigured: result.apiKeyConfigured ?? S.apiKey.trim() !== '',
          credentialStorage: result.credentialStorage ?? S.credentialStorage,
        })
      }
    }).catch(() => { if (keyDirty) toast('Key 保存失败', 'error') })
  }

  // ================= weather FX =================
  interface FxParticle {
    x: number
    y: number
    radius: number
    opacity: number
    speedY: number
    drift: number
    driftFreq: number
    phase: number
    length: number
    speed: number
    lineWidth: number
    canSplash: boolean
    size: number
    swayFreq: number
    spin: number
    wobble: number
    spriteIndex: number
  }
  const FX: { snow: FxParticle[]; rain: FxParticle[]; sakura: FxParticle[]; splashes: Array<{ x: number; y: number; vx: number; vy: number; life: number; decay: number; w: number; h: number }>; rainWind?: { dx: number; dy: number } } = { snow: [], rain: [], sakura: [], splashes: [] }
  const SAKURA_PALETTE = [
    'hsla(340, 45%, 90%, 0.8)', 'hsla(342, 50%, 91%, 0.8)', 'hsla(344, 55%, 92%, 0.8)', 'hsla(346, 60%, 93%, 0.8)',
    'hsla(348, 65%, 94%, 0.8)', 'hsla(350, 60%, 95%, 0.8)', 'hsla(352, 55%, 93%, 0.8)', 'hsla(348, 40%, 88%, 0.8)',
  ]
  const SAKURA_SPRITES: Array<string | null> = []
  const SAKURA_IMAGES: HTMLImageElement[] = []

  function rand(a: number, b: number): number {
    return a + Math.random() * (b - a)
  }
  function tracePetal(g: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number): void {
    g.save()
    g.translate(x, y)
    g.rotate(rot ?? 0)
    g.scale(s, s)
    g.beginPath()
    g.moveTo(0, -1)
    g.bezierCurveTo(0.85, -0.9, 0.8, 0.4, 0, 0.8)
    g.bezierCurveTo(-0.8, 0.4, -0.85, -0.9, 0, -1)
    g.closePath()
    g.restore()
  }
  function buildSakuraSprites(): void {
    if (SAKURA_SPRITES.length > 0) return
    const d = typeof document !== 'undefined' ? document : null
    const cvs = d?.createElement('canvas')
    if (cvs === undefined || cvs === null) return
    cvs.width = 48
    cvs.height = 48
    const g = cvs.getContext('2d')
    if (g === null) return
    for (let i = 0; i < SAKURA_PALETTE.length; i++) {
      g.clearRect(0, 0, 48, 48)
      g.fillStyle = SAKURA_PALETTE[i]
      tracePetal(g, 24, 24, 10, 0)
      g.fill()
      try { SAKURA_SPRITES.push(cvs.toDataURL()) } catch { SAKURA_SPRITES.push(null) }
    }
    for (const sprite of SAKURA_SPRITES) {
      if (sprite === null) continue
      const image = new Image()
      image.src = sprite
      SAKURA_IMAGES.push(image)
    }
  }
  function initFx(weather: string, w: number, h: number): void {
    FX.snow = []
    FX.rain = []
    FX.sakura = []
    FX.splashes = []
    if (weather === 'snow') {
      const LAYERS = [
        { count: 100, radius: [0.15, 0.45], speed: [0.15, 0.4], opacity: [0.15, 0.35], drift: [0.05, 0.2] },
        { count: 80, radius: [0.5, 1.0], speed: [0.4, 1.0], opacity: [0.3, 0.6], drift: [0.15, 0.45] },
        { count: 60, radius: [1.2, 2.5], speed: [0.8, 1.6], opacity: [0.5, 0.8], drift: [0.25, 0.6] },
      ]
      for (const layer of LAYERS) {
        for (let i = 0; i < layer.count; i++) {
          FX.snow.push({ x: Math.random() * w, y: Math.random() * h, radius: rand(layer.radius[0], layer.radius[1]), opacity: rand(layer.opacity[0], layer.opacity[1]), speedY: rand(layer.speed[0], layer.speed[1]), drift: rand(layer.drift[0], layer.drift[1]), driftFreq: rand(0.0003, 0.0012), phase: Math.random() * Math.PI * 2 } as FxParticle)
        }
      }
      FX.snow.sort((a, b) => a.opacity - b.opacity)
    }
    if (weather === 'rain') {
      FX.rainWind = { dx: Math.sin(0.14), dy: Math.cos(0.14) }
      const LAYERS = [
        { count: 80, length: [6, 14], speed: [3, 6], opacity: [0.06, 0.14], width: [0.3, 0.6] },
        { count: 60, length: [14, 28], speed: [7, 13], opacity: [0.12, 0.25], width: [0.5, 1.0] },
        { count: 30, length: [26, 48], speed: [12, 20], opacity: [0.2, 0.38], width: [0.8, 1.5] },
      ]
      for (let li = 0; li < LAYERS.length; li++) {
        const layer = LAYERS[li]
        const canSplash = li >= 1
        for (let i = 0; i < layer.count; i++) {
          FX.rain.push({ x: Math.random() * (w + 100) - 50, y: Math.random() * h, length: rand(layer.length[0], layer.length[1]), speed: rand(layer.speed[0], layer.speed[1]), opacity: rand(layer.opacity[0], layer.opacity[1]), lineWidth: rand(layer.width[0], layer.width[1]), canSplash } as FxParticle)
        }
      }
    }
    if (weather === 'sakura') {
      buildSakuraSprites()
      const LAYERS = [
        { count: 40, size: [2.5, 4.5], speed: [0.1, 0.3], opacity: [0.1, 0.25], drift: [0.15, 0.4] },
        { count: 32, size: [4.5, 7.5], speed: [0.25, 0.55], opacity: [0.25, 0.5], drift: [0.35, 0.8] },
        { count: 16, size: [7.5, 11], speed: [0.4, 0.75], opacity: [0.4, 0.65], drift: [0.5, 1.0] },
      ]
      for (const layer of LAYERS) {
        for (let i = 0; i < layer.count; i++) {
          FX.sakura.push({
            x: Math.random() * w, y: Math.random() * h, size: rand(layer.size[0], layer.size[1]), opacity: rand(layer.opacity[0], layer.opacity[1]), speedY: rand(layer.speed[0], layer.speed[1]), drift: rand(layer.drift[0], layer.drift[1]), driftFreq: rand(0.0003, 0.001), swayFreq: rand(0.0004, 0.0014), phase: Math.random() * Math.PI * 2, spin: rand(-0.004, 0.004), wobble: rand(0.8, 1.2), spriteIndex: SAKURA_IMAGES.length > 0 ? Math.floor(Math.random() * SAKURA_IMAGES.length) : -1,
          } as FxParticle)
        }
      }
    }
  }
  function spawnSplash(x: number, y: number): void {
    if (FX.splashes.length >= 24) return
    const n = 2 + Math.floor(Math.random() * 4)
    for (let i = 0; i < n; i++) {
      FX.splashes.push({ x: x + rand(-5, 5), y: y - rand(0, 3), vx: rand(-0.9, 0.9), vy: rand(-1.6, -0.4), life: 1, decay: rand(0.02, 0.05), w: rand(0.6, 1.6), h: rand(0.4, 1.1) })
    }
  }
  function fxFrame(g: CanvasRenderingContext2D, cvs: HTMLCanvasElement, weather: string, time: number): void {
    const w = cvs.clientWidth || 0
    const h = cvs.clientHeight || 0
    if (w === 0 || h === 0) return
    if (cvs.width !== Math.round(w) || cvs.height !== Math.round(h)) {
      cvs.width = Math.round(w)
      cvs.height = Math.round(h)
      initFx(weather, w, h)
    }
    g.clearRect(0, 0, w, h)
    if (weather === 'snow') {
      let currentOpacity = -1
      for (const f of FX.snow) {
        f.y += f.speedY
        f.x += Math.sin(f.phase + time * f.driftFreq) * f.drift
        if (f.y > h + f.radius) { f.y = -f.radius; f.x = Math.random() * w }
        if (f.x > w + f.radius) f.x = -f.radius
        else if (f.x < -f.radius) f.x = w + f.radius
        const q = Math.round(f.opacity * 50) / 50
        if (q !== currentOpacity) { currentOpacity = q; g.fillStyle = `rgba(255,255,255,${q})` }
        g.beginPath(); g.arc(f.x, f.y, f.radius, 0, Math.PI * 2); g.fill()
      }
    } else if (weather === 'rain') {
      const WIND = FX.rainWind ?? { dx: 0.14, dy: 0.99 }
      g.lineCap = 'round'
      let currentOpacity = -1
      let currentWidth = -1
      for (const d of FX.rain) {
        d.x += d.speed * WIND.dx
        d.y += d.speed * WIND.dy
        if (d.y > h + d.length) {
          if (d.canSplash && Math.random() < 0.35) spawnSplash(d.x, h - 1)
          d.y = -(d.length + Math.random() * h * 0.2)
          d.x = Math.random() * (w + 100) - 50
        }
        if (d.x > w + 50) d.x = -50
        const qo = Math.round(d.opacity * 30) / 30
        if (qo !== currentOpacity) { currentOpacity = qo; g.strokeStyle = `rgba(180,200,220,${qo})` }
        const qw = Math.round(d.lineWidth * 4) / 4
        if (qw !== currentWidth) { currentWidth = qw; g.lineWidth = qw }
        g.beginPath(); g.moveTo(d.x, d.y); g.lineTo(d.x - d.length * WIND.dx, d.y - d.length * WIND.dy); g.stroke()
      }
      for (let i = FX.splashes.length - 1; i >= 0; i--) {
        const sp = FX.splashes[i]
        sp.x += sp.vx
        sp.y += sp.vy
        sp.vy += 0.06
        sp.life -= sp.decay
        if (sp.life <= 0) { FX.splashes.splice(i, 1); continue }
        g.save()
        g.globalAlpha = Math.max(0, sp.life)
        g.strokeStyle = 'rgba(180,200,220,0.8)'
        g.lineWidth = 0.8
        g.beginPath(); g.ellipse(sp.x, sp.y, sp.w, sp.h, 0, 0, Math.PI * 2); g.stroke()
        g.restore()
      }
    } else if (weather === 'sakura') {
      for (const f of FX.sakura) {
        f.y += f.speedY
        f.x += Math.sin(f.phase + time * f.swayFreq) * f.drift
        if (f.y > h + f.size) { f.y = -f.size; f.x = Math.random() * w }
        if (f.x > w + f.size) f.x = -f.size
        else if (f.x < -f.size) f.x = w + f.size
        const rot = Math.sin(f.phase + time * f.swayFreq * 1.7) * 0.9 + time * f.spin
        const wob = 1 + 0.12 * Math.sin(f.phase * 2 + time * f.swayFreq * 2.3)
        if (f.spriteIndex >= 0 && SAKURA_IMAGES[f.spriteIndex] !== undefined) {
          g.save()
          g.globalAlpha = f.opacity
          g.translate(f.x, f.y)
          g.rotate(rot)
          g.scale((f.size * f.wobble * wob) / 18, (f.size * f.wobble) / 18)
          g.drawImage(SAKURA_IMAGES[f.spriteIndex], -18, -18, 36, 36)
          g.restore()
        } else {
          g.save()
          g.globalAlpha = f.opacity
          g.translate(f.x, f.y)
          g.rotate(rot)
          g.scale((f.size * f.wobble * wob) / 10, (f.size * f.wobble) / 10)
          g.fillStyle = SAKURA_PALETTE[0]
          tracePetal(g, 0, 0, 1, 0)
          g.fill()
          g.restore()
        }
      }
    }
  }
  function FxCanvas(): React.ReactElement {
    const s = useS()
    const ref = React.useRef<HTMLCanvasElement | null>(null)
    React.useEffect(() => {
      const cvs = ref.current
      if (cvs === null) return
      const g = cvs.getContext('2d')
      if (g === null) return
      const w = cvs.clientWidth || 0
      const h = cvs.clientHeight || 0
      initFx(s.cfg.weather ?? 'none', w, h)
      let raf = 0
      const t0 = Date.now()
      const loop = (): void => {
        const weather = s.cfg.weather ?? 'none'
        if (weather === 'none') {
          // Baseline behaviour: switching to "off" wipes the last painted frame
          // instead of leaving it frozen on the canvas.
          try { g.clearRect(0, 0, cvs.width, cvs.height) } catch { /* context lost */ }
          return // no particles scheduled: stay idle
        }
        raf = requestAnimationFrame(loop)
        fxFrame(g, cvs, weather, Date.now() - t0)
      }
      loop()
      return () => { try { cancelAnimationFrame(raf) } catch { /* already cancelled */ } }
    }, [s.cfg.weather])
    return React.createElement('canvas', { ref, className: 'vx-fx' })
  }

  // ================= timeline =================
  let lastRefetchAt = 0
  // Rows already counted when the last rows>items refetch went out; one
  // attempt per rendered-row growth stops the every-2s re-read loop when the
  // host's own tail cap is what leaves the oldest loaded rows uncovered.
  let railRefetchRows = -1
  let lastDiagAt = 0
  function diagThrottled(message: string): void {
    const now = Date.now()
    if (now - lastDiagAt < 5000) return
    lastDiagAt = now
    reportDiag(message)
  }
  function scheduleTurnsRefetch(): void {
    const now = Date.now()
    if (now - lastRefetchAt < 2000) return
    lastRefetchAt = now
    void fetchTurns(S.sessionId as string)
  }
  async function fetchTurns(sessionId: string): Promise<void> {
    try {
      const result = await apiTimelineGet(sessionId)
      // A slower fetch for a previously open session must not paint its turns
      // onto the newly opened one's rows.
      if (sessionId !== S.sessionId) return
      if (result.ok === true) {
        S.turns = { sessionId, items: result.items ?? [] }
        setS({ turns: S.turns })
        updateRailPositions()
        diagThrottled('timeline ' + (result.items?.length ?? 0) + ' items ' + sessionId.slice(0, 24))
      } else {
        diagThrottled('timeline failed: ' + String(result.error ?? 'unknown'))
      }
    } catch (error) {
      diagThrottled('timeline fetch error: ' + String((error as Error)?.message ?? error))
    }
  }
  function findScrollerFrom(el: HTMLElement): HTMLElement | null {
    const w = typeof window !== 'undefined' ? window : null
    if (w === null) return null
    let node = el.parentElement
    while (node !== null) {
      try {
        const cs = w.getComputedStyle(node)
        if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') return node
      } catch { /* style read failed */ }
      node = node.parentElement
    }
    return null
  }
  /** Resolve the real chat scrollport: query the shell's
   * semantic attribute directly instead of walking up from turnTail anchors
   * (the turnTail chain seat may be taken by another plugin, leaving no
   * anchors at all). ChatView itself resolves the same attribute, so this is
   * the shell's stable contract; the anchor walk stays only as a fallback. */
  function resolveScroller(): HTMLElement | null {
    const d = typeof document !== 'undefined' ? document : null
    if (d === null) return null
    try {
      const host = d.querySelector('[data-conversation-scroll]')
      if (host instanceof HTMLElement && host.isConnected) return host
    } catch { /* selector unsupported */ }
    for (const anchor of S.anchors.values()) {
      if (anchor === undefined || anchor.el === undefined) continue
      try {
        const host = anchor.el.closest('[data-conversation-scroll]') as HTMLElement | null
        if (host !== null) return host
      } catch { /* selector unsupported */ }
      const found = findScrollerFrom(anchor.el)
      if (found !== null) return found
    }
    return null
  }
  /** All rendered user-message rows inside the scrollport, in document order
   * (steering messages render through the same UserMessageNodeView). */
  function queryUserRows(scroller: HTMLElement): HTMLElement[] {
    try {
      return Array.from(scroller.querySelectorAll<HTMLElement>('[data-chat-flow-kind="user"], [data-chat-flow-kind="steering"]'))
    } catch {
      return []
    }
  }
  /** Keep the rail-scroller class on exactly the current scrollport so the
   * native scrollbar hides only for the column the rail substitutes. */
  function syncRailScrollerClass(scroller: HTMLElement | null): void {
    const previous = S.scrollerEl
    if (previous !== null && previous !== scroller) {
      try { previous.classList.remove('vx-rail-scroller') } catch { /* detached */ }
    }
    if (scroller !== null && scroller !== previous) {
      try { scroller.classList.add('vx-rail-scroller') } catch { /* detached */ }
    }
  }
  function updateRailPositions(): void {
    if (S.cfg.timeline !== true || S.sessionId === null) {
      syncRailScrollerClass(null)
      if (S.railPositions.length > 0 || S.thumbTop !== 0 || S.thumbH !== 26) {
        setS({ railPositions: [], railSig: '', railBox: { top: 64, height: 600 }, railRight: 4, railLeft: 56, thumbTop: 0, thumbH: 26, scrollerEl: null })
      }
      return
    }
    const w = typeof window !== 'undefined' ? window : null
    if (w === null) return
    // Turns data missing or stale (session switched, history loaded before the
    // first fetch): pull it back throttled instead of staying empty forever.
    if (S.turns === null || S.turns.sessionId !== S.sessionId) {
      railRefetchRows = -1
      scheduleTurnsRefetch()
    }
    const items = S.turns !== null && Array.isArray(S.turns.items) ? S.turns.items : []
    let scroller = S.scrollerEl
    if (scroller === null || !scroller.isConnected) {
      scroller = resolveScroller()
    }
    syncRailScrollerClass(scroller)
    const vh = w.innerHeight || 800
    let top = 64
    let height = vh - 64 - 120
    let scrollH = Math.max(1, height)
    let scrollTop = 0
    let viewH = height
    let railRight = 4
    let railLeft = 56
    if (scroller !== null) {
      try {
        const r = scroller.getBoundingClientRect()
        top = Math.max(0, r.top)
        height = Math.max(60, r.height)
        viewH = Math.max(1, scroller.clientHeight || r.height)
        scrollH = Math.max(viewH, scroller.scrollHeight || viewH)
        scrollTop = Math.max(0, scroller.scrollTop || 0)
        // Rail hugs the scrollport's inner edge (right or left per config),
        // replacing the native scrollbar slot instead of stacking beside it.
        railRight = Math.max(2, Math.round(w.innerWidth - r.right + 4))
        railLeft = Math.max(2, Math.round(r.left + 4))
      } catch { /* rect read failed */ }
    }
    const trackH = height
    const pos: Array<{ seq: number; y: number; st: boolean }> = []
    const seqAnchor = new Map<number, HTMLElement>()
    // DOM sourcing: the dots come from the rendered user-message
    // rows themselves (`[data-chat-flow-kind="user"]`, plus steering rows that
    // render through the same view), not from turnTail slot anchors — the
    // turnTail chain seat can be held by another plugin, which would leave the
    // rail without any node. Rows are tail-aligned with the host's turns data
    // (the newest rendered row is the last item): loading older history
    // prepends rows and keeps the alignment correct without a refetch.
    if (scroller !== null) {
      const rows = queryUserRows(scroller)
      const offset = items.length - rows.length
      // More rendered rows than the turns data covers (older history loaded
      // past what the host returned, or the fetch predates the load): pull the
      // turns again so every dot keeps its preview text and actions.
      if (rows.length > items.length && railRefetchRows < rows.length) {
        railRefetchRows = rows.length
        scheduleTurnsRefetch()
      }
      for (let i = 0; i < rows.length; i++) {
        const item = offset + i >= 0 ? items[offset + i] : undefined
        if (item === undefined) continue
        try {
          const r = rows[i].getBoundingClientRect()
          const sr = scroller.getBoundingClientRect()
          const pct = Math.max(0, Math.min(1, (r.top + r.height / 2 - sr.top + scrollTop) / Math.max(1, scroller.scrollHeight || 1)))
          const starred = S.stars[S.sessionId as string]?.[item.seq] === true
          seqAnchor.set(item.seq, rows[i])
          pos.push({ seq: item.seq, y: Math.round(pct * trackH), st: starred })
        } catch { /* row rect read failed */ }
      }
    }
    const thumbH = Math.max(26, Math.round(trackH * (viewH / scrollH)))
    const thumbTop = (scrollTop / Math.max(1, scrollH - viewH)) * (trackH - thumbH)
    const sig = JSON.stringify(pos) + '|' + thumbTop + '|' + thumbH + '|' + top + '|' + height + '|' + railRight + '|' + railLeft
    S.seqAnchor = seqAnchor
    if (sig !== S.railSig) {
      setS({ railPositions: pos, railSig: sig, railBox: { top, height }, railRight, railLeft, thumbTop: Math.round(thumbTop), thumbH, scrollerEl: scroller })
      diagThrottled('rail ' + pos.length + ' dots / anchors ' + S.anchors.size + ' / turns ' + items.length + ' / scroller ' + (scroller === null ? 'none' : scroller.tagName.toLowerCase() + '.' + String(scroller.className ?? '').slice(0, 60)))
    }
  }
  function scrollToSeq(seq: number): void {
    const el = S.seqAnchor.get(seq) ?? (S.anchors.get(seq)?.el ?? null)
    if (el === undefined || el === null) {
      toast('该消息尚未渲染，请稍后重试', 'error')
      return
    }
    // Drive the scrollport's scrollTop directly so the jump
    // lands the row at the viewport center even when the row sits inside a
    // nested scroller; scrollIntoView stays as the fallback.
    const scroller = S.scrollerEl
    let done = false
    if (scroller !== null && scroller.isConnected) {
      try {
        const er = el.getBoundingClientRect()
        const sr = scroller.getBoundingClientRect()
        const floor = Math.max(0, (scroller.scrollHeight ?? 0) - (scroller.clientHeight ?? 0))
        const target = (scroller.scrollTop ?? 0) + (er.top + er.height / 2) - (sr.top + sr.height / 2)
        scroller.scrollTop = Math.max(0, Math.min(floor, target))
        done = true
      } catch { /* rect read failed */ }
    }
    if (!done) {
      try { el.scrollIntoView({ behavior: 'auto', block: 'center' }) } catch { try { el.scrollIntoView(true) } catch { /* scroll unavailable */ } }
    }
    setS({ railHover: null })
  }
  function toggleStar(seq: number): void {
    const sid = S.sessionId
    if (sid === null) return
    const current = S.stars[sid] ?? {}
    const next = { ...current }
    if (next[seq] === true) delete next[seq]
    else next[seq] = true
    const stars = { ...S.stars }
    stars[sid] = next
    setS({ stars })
    saveCfg()
    updateRailPositions()
  }
  async function forkAt(seq: number): Promise<void> {
    const sessions = C.get('sessions') as { fork(opts: { sessionId: string; atSeq: number }): Promise<string>; open(id: string): void } | undefined
    if (sessions === undefined) return
    try {
      const childId = await sessions.fork({ sessionId: S.sessionId as string, atSeq: seq })
      toast('分支会话已创建', 'info', { label: '打开分支', run: () => { try { sessions.open(childId) } catch { /* open failed */ } } })
    } catch (error) {
      toast('创建分支失败: ' + String((error as Error)?.message ?? error), 'error')
    }
  }
  function extractLatex(text: string): string[] {
    const out: string[] = []
    let i = 0
    const n = text.length
    while (i < n) {
      const a = text.indexOf('\\[', i)
      const b = text.indexOf('\\(', i)
      const c = text.indexOf('$$', i)
      let start = -1
      let endTok = ''
      if (a >= 0 && (b < 0 || a < b) && (c < 0 || a < c)) { start = a; endTok = '\\]' }
      else if (b >= 0 && (c < 0 || b < c)) { start = b; endTok = '\\)' }
      else if (c >= 0) { start = c; endTok = '$$' }
      if (start < 0) break
      const end = text.indexOf(endTok, start + 2)
      if (end < 0) { i = start + 2; continue }
      out.push(text.slice(start + 2, end).trim())
      i = end + endTok.length
    }
    const re2 = /\$([^$\n]{1,600}?)\$/g
    let m: RegExpExecArray | null
    while ((m = re2.exec(text)) !== null) out.push(m[1].trim())
    return out
  }
  function extractMathml(text: string): string[] {
    const out: string[] = []
    const lower = text.toLowerCase()
    let i = 0
    while (true) {
      const s = lower.indexOf('<math', i)
      if (s < 0) break
      const e = lower.indexOf('</math>', s)
      if (e < 0) break
      out.push(text.slice(s, e + 7))
      i = e + 7
    }
    return out
  }
  async function copyText(text: string): Promise<boolean> {
    try {
      const d = typeof document !== 'undefined' ? document : null
      if (d !== null && navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text)
        return true
      }
      if (d === null) return false
      const ta = d.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      d.body.appendChild(ta)
      ta.select()
      const ok = d.execCommand('copy')
      ta.remove()
      return ok
    } catch { return false }
  }
  async function copyLatexOf(item: TimelineItem): Promise<void> {
    const codes = extractLatex(item.text)
    if (codes.length === 0) { toast('未找到 LaTeX 公式', 'error'); return }
    const ok = await copyText(codes.join('\n\n'))
    toast(ok ? `已复制 ${codes.length} 个 LaTeX 公式` : '复制失败', ok ? 'info' : 'error')
  }
  async function copyMathmlOf(item: TimelineItem): Promise<void> {
    const codes = extractMathml(item.text)
    if (codes.length === 0) { toast('未找到 MathML', 'error'); return }
    const ok = await copyText(codes.join('\n\n'))
    toast(ok ? `已复制 ${codes.length} 个 MathML（可粘贴到 Word）` : '复制失败', ok ? 'info' : 'error')
  }
  let mermaidState: { status: 'idle' | 'loading' | 'ready' | 'failed'; error?: string } = { status: 'idle' }
  async function ensureMermaid(): Promise<boolean> {
    if (mermaidState.status === 'ready') return true
    if (mermaidState.status === 'loading') {
      while (mermaidState.status === 'loading') await new Promise((resolve) => setTimeout(resolve, 120))
      return mermaidState.status === 'ready'
    }
    mermaidState = { status: 'loading' }
    try {
      const result = await apiMermaidFetch()
      if (result.ok === true) {
        await new Promise<void>((resolve, reject) => {
          const d = typeof document !== 'undefined' ? document : null
          if (d === null) { reject(new Error('no document')); return }
          const script = d.createElement('script')
          script.src = MERMAID_SCRIPT_PATH
          script.onload = () => resolve()
          script.onerror = () => reject(new Error('script load failed'))
          d.head.appendChild(script)
        })
        mermaidState = { status: 'ready' }
        return true
      }
      mermaidState = { status: 'failed', error: result.error ?? 'unknown' }
      return false
    } catch (error) {
      mermaidState = { status: 'failed', error: String((error as Error)?.message ?? error) }
      return false
    }
  }
  async function renderMermaid(code: string, dark = false): Promise<{ ok: true; svg: string } | { ok: false; error: string }> {
    try {
      const w = typeof window !== 'undefined' ? window : null
      const mermaid = (w as unknown as { mermaid?: { initialize(opts: Record<string, unknown>): void; render(id: string, code: string): Promise<string | { svg: string }> } }).mermaid
      if (mermaid === undefined) return { ok: false, error: '引擎未就绪' }
      mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict' })
      const id = 'vx-mmd-' + Date.now() + Math.floor(Math.random() * 9999)
      const out = await mermaid.render(id, code)
      const svg = typeof out === 'string' ? out : (out?.svg ?? '')
      if (svg === '') return { ok: false, error: '引擎未返回 SVG' }
      return { ok: true, svg }
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message ?? error) }
    }
  }
  function extractMermaid(text: string): string[] {
    const out: string[] = []
    const re = /```mermaid\s*\n([\s\S]*?)```/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) out.push(m[1].trim())
    return out
  }
  function openMermaidOf(item: TimelineItem): void {
    const codes = extractMermaid(item.text)
    if (codes.length === 0) { toast('未找到 Mermaid 代码块', 'error'); return }
    setS({ mermaidModal: { title: item.text.slice(0, 40), codes, index: 0 } })
  }

  // ================= mermaid in-place (chat DOM) =================
  /** Blocks with a render already in flight (WeakSet: dead blocks drop out). */
  const mmdInflight = new WeakSet<HTMLElement>()
  /** Previous scan theme; a flip invalidates rendered-SVG memoization. */
  let mmdLastDark: boolean | null = null

  /** The banner's language label: `.md-code-block > bannerWrap > banner >
   * infostring` is the GUI CodeBlock's stable shape (its CSS classes are
   * hashed, the structure is not). */
  function blockInfostring(block: HTMLElement): string | null {
    const info = block.querySelector(':scope > div:first-child > div:first-child > div:first-child')
    return info !== null ? info.textContent ?? '' : null
  }

  /** Raw fence text: the GUI keeps unknown languages (mermaid among them) on
   * the plain `<pre><code>` path, so `pre` always carries the source. */
  function blockCodeText(block: HTMLElement): string | null {
    const pre = block.querySelector('pre')
    return pre !== null ? pre.textContent ?? '' : null
  }

  /** Insert/refresh the diagram wrapper before one code block. Never moves
   * GUI-owned nodes — React keeps reconciling its tree; the block is only
   * visually swapped with the diagram stage via display. */
  async function renderInPlace(block: HTMLElement, code: string, dark: boolean): Promise<void> {
    if (block.dataset.vxMmd === code) return
    const ready = await ensureMermaid()
    if (!ready) {
      // Engine unreachable: keep the code visible; retry only when the code
      // itself changes (a later scan after engine recovery re-renders).
      block.dataset.vxMmdFail = code
      return
    }
    const r = await renderMermaid(code, dark)
    if (!r.ok) { block.dataset.vxMmdFail = code; return }
    delete block.dataset.vxMmdFail
    block.dataset.vxMmd = code
    const d = typeof document !== 'undefined' ? document : null
    if (d === null) return
    let wrap = block.previousElementSibling as HTMLElement | null
    if (wrap === null || !wrap.classList.contains('vx-mmd-wrap')) {
      wrap = d.createElement('div')
      wrap.className = 'vx-mmd-wrap'
      block.parentElement?.insertBefore(wrap, block)
      const bar = d.createElement('div')
      bar.className = 'vx-mmd-bar'
      const diagramBtn = d.createElement('button')
      diagramBtn.type = 'button'
      diagramBtn.className = 'vx-mmd-btn active'
      diagramBtn.textContent = '图表'
      const codeBtn = d.createElement('button')
      codeBtn.type = 'button'
      codeBtn.className = 'vx-mmd-btn'
      codeBtn.textContent = '代码'
      const live = d.createElement('a')
      live.className = 'vx-mmd-live'
      live.target = '_blank'
      live.rel = 'noopener noreferrer'
      live.textContent = 'mermaid.live'
      void mermaidLiveUrl(code).then((url) => { live.href = url }).catch(() => {})
      bar.append(diagramBtn, codeBtn, live)
      const stage = d.createElement('div')
      stage.className = 'vx-mmd-stage'
      wrap.append(bar, stage)
      const showDiagram = (): void => {
        stage.style.display = ''
        block.style.display = 'none'
        diagramBtn.classList.add('active')
        codeBtn.classList.remove('active')
      }
      const showCode = (): void => {
        stage.style.display = 'none'
        block.style.display = ''
        diagramBtn.classList.remove('active')
        codeBtn.classList.add('active')
      }
      diagramBtn.addEventListener('click', showDiagram)
      codeBtn.addEventListener('click', showCode)
      showDiagram()
    }
    const stage = wrap.querySelector('.vx-mmd-stage')
    if (stage !== null) stage.innerHTML = r.svg
  }

  /** Scan every chat code block and render the mermaid ones in place. */
  async function scanMermaidBlocks(dark: boolean): Promise<void> {
    const d = typeof document !== 'undefined' ? document : null
    if (d === null) return
    // Drop wrappers whose code block left the DOM (history switch / unmount).
    for (const wrap of Array.from(d.querySelectorAll<HTMLElement>('.vx-mmd-wrap'))) {
      const next = wrap.nextElementSibling
      if (next === null || !next.classList.contains('md-code-block')) wrap.remove()
    }
    for (const block of Array.from(d.querySelectorAll<HTMLElement>('.md-code-block'))) {
      if (mmdInflight.has(block)) continue
      const codeRaw = blockCodeText(block)
      if (codeRaw === null) continue
      const code = normalizeMermaidText(codeRaw).trim()
      if (code === '') continue
      const info = blockInfostring(block)
      const definite = info !== null && info.trim().toLowerCase() === 'mermaid'
      if (definite) {
        // Settled ```mermaid fence: only guard against a lone keyword line.
        if (code.split('\n').filter((l) => l.trim() !== '').length < 2) continue
      } else {
        // Blank (streaming) or generic banner: content heuristics decide, so a
        // streaming mindmap previews as soon as it is complete enough and a
        // named foreign language (python etc.) is never touched.
        if (!isGenericInfostring(info)) continue
        if (!isMermaidCode(codeRaw)) continue
      }
      if (block.dataset.vxMmd === code || block.dataset.vxMmdFail === code) continue
      mmdInflight.add(block)
      try {
        await renderInPlace(block, code, dark)
      } finally {
        mmdInflight.delete(block)
      }
    }
  }

  /** Undo in-place rendering (feature toggled off): remove wrappers, unhide
   * code blocks. Diagram DOM is plugin-owned, so removal is safe. */
  function restoreMermaidBlocks(): void {
    const d = typeof document !== 'undefined' ? document : null
    if (d === null) return
    for (const wrap of Array.from(d.querySelectorAll<HTMLElement>('.vx-mmd-wrap'))) {
      const next = wrap.nextElementSibling as HTMLElement | null
      if (next !== null && next.classList.contains('md-code-block')) next.style.display = ''
      wrap.remove()
    }
    for (const block of Array.from(d.querySelectorAll<HTMLElement>('.md-code-block'))) {
      delete block.dataset.vxMmd
      delete block.dataset.vxMmdFail
    }
  }

  async function refreshBalance(): Promise<void> {
    try {
      const result = await apiBalanceGet()
      S.balance = result as unknown as Record<string, unknown>
      S.apiKeyConfigured = result.keyConfigured === true
      // The route also carries the host's live usage ledger; fold today's row
      // in so the 「今日 N 次」 badge refreshes together with the figure.
      const usageToday = result.usageToday
      if (usageToday !== undefined && usageToday !== null && typeof usageToday === 'object') {
        S.usage = { ...S.usage }
        S.usage[dayKey()] = usageToday as Store['usage'][string]
        setS({ balance: S.balance, usage: S.usage, apiKeyConfigured: S.apiKeyConfigured })
      } else {
        setS({ balance: S.balance, apiKeyConfigured: S.apiKeyConfigured })
      }
    } catch (error) {
      S.balance = { ok: false, error: String((error as Error)?.message ?? error) }
      setS({ balance: S.balance })
    }
  }
  async function refreshUsageScan(): Promise<void> {
    try {
      const result = await apiUsageScan()
      if (result.ok === true) {
        S.usage = { ...S.usage }
        S.usage[dayKey()] = result.usageToday as Store['usage'][string]
        setS({ usage: S.usage })
        toast(`已扫描今日会话日志（${String(result.scannedSessions)} 个今日活跃会话）`, 'info')
      } else {
        toast(result.error ?? '扫描失败', 'error')
      }
    } catch (error) {
      toast('扫描失败: ' + String((error as Error)?.message ?? error), 'error')
    }
  }
  function runExport(format: string): void {
    if (S.sessionId === null) { toast('当前没有打开的会话', 'error'); return }
    setS({ exporting: true })
    void apiExportRun(S.sessionId, format).then((result) => {
      if (result.ok !== true) {
        toast(result.error ?? '导出失败', 'error')
        return
      }
      try {
        const d = typeof document !== 'undefined' ? document : null
        if (d === null) throw new Error('no document')
        const blob = new Blob([result.content], { type: result.mime })
        const url = URL.createObjectURL(blob)
        const a = d.createElement('a')
        a.href = url
        a.download = result.fileName
        d.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => { try { URL.revokeObjectURL(url) } catch { /* revoked already */ } }, 30000)
        toast('已导出 ' + result.fileName, 'info')
      } catch (error) {
        toast('导出失败: ' + String((error as Error)?.message ?? error), 'error')
      }
    }).catch((error) => toast('导出失败: ' + String((error as Error)?.message ?? error), 'error')).finally(() => setS({ exporting: false }))
  }
  function findFolder(arr: FolderNode[], id: string): FolderNode | null {
    for (const f of arr) {
      if (f.id === id) return f
      const child = findFolder(f.children ?? [], id)
      if (child !== null) return child
    }
    return null
  }
  function folderCount(node: FolderNode): number {
    let n = (node.sessionIds ?? []).length + (node.workspaceIds ?? []).length
    for (const child of node.children ?? []) n += folderCount(child)
    return n
  }
  async function openWorkspaceItem(id: string): Promise<void> {
    const workspaces = C.get('workspaces') as { connectWorkspace(id: string): Promise<string> } | undefined
    const sessions = C.get('sessions') as { open(id: string): void } | undefined
    if (workspaces === undefined || sessions === undefined) { toast('工作区服务不可用', 'error'); return }
    try {
      const sid = await workspaces.connectWorkspace(id)
      sessions.open(sid)
      toast('已打开项目', 'info')
    } catch (error) {
      toast('打开项目失败: ' + String((error as Error)?.message ?? error), 'error')
    }
  }
  function openSessionItem(id: string): void {
    const sessions = C.get('sessions') as { open(id: string): void } | undefined
    if (sessions === undefined) { toast('会话服务不可用', 'error'); return }
    try { sessions.open(id) } catch (error) { toast('打开会话失败: ' + String((error as Error)?.message ?? error), 'error') }
  }

  // ================= components =================
  function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }): React.ReactElement {
    return React.createElement('label', { className: 'vx-toggle-row' },
      React.createElement('span', null, props.label),
      React.createElement('input', { type: 'checkbox', checked: props.checked === true, onChange: (e: React.ChangeEvent<HTMLInputElement>) => { props.onChange(e.target.checked); saveCfg() } }),
      props.hint !== undefined ? React.createElement('span', { className: 'vx-muted' }, props.hint) : null,
    )
  }

  function FolderSidebarButton(): React.ReactElement {
    return React.createElement('button', {
      className: 'vx-foot-btn',
      title: '项目文件夹',
      onClick: () => setS({ foldersOpen: !S.foldersOpen, panelOpen: false }),
    }, React.createElement(Icon, { n: 'folder', size: 15 }), React.createElement('span', { className: 'vx-foot-label' }, '项目'))
  }

  function HeaderPanelButton(): React.ReactElement {
    return React.createElement('button', {
      className: 'vx-header-btn',
      title: '个性化中心',
      onClick: () => setS({ panelOpen: !S.panelOpen, foldersOpen: false }),
    }, React.createElement(Icon, { n: 'sliders', size: 13 }), React.createElement('span', null, '个性化'))
  }

  function PromptQuickButton(): React.ReactElement {
    return React.createElement('button', {
      className: 'vx-header-btn',
      title: '快速调用提示词',
      onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
        const r = e.currentTarget.getBoundingClientRect()
        setS({ promptOpen: { x: Math.max(8, r.left), y: r.bottom + 6 }, promptQuery: '' })
      },
    }, React.createElement(Icon, { n: 'zap', size: 13 }), React.createElement('span', null, '提示词'))
  }

  function PromptPopover(): React.ReactElement | null {
    const s = useS()
    if (s.promptOpen === null) return null
    const p = s.promptOpen
    const q = (s.promptQuery ?? '').toLowerCase()
    const list = s.prompts.filter((x) => q === '' || String(x.name ?? '').toLowerCase().includes(q) || String(x.text ?? '').toLowerCase().includes(q))
    return React.createElement('div', { className: 'vx-glass vx-prompt-pop', style: { left: p.x, top: p.y } },
      React.createElement('div', { className: 'vx-pattern' }),
      React.createElement('div', { className: 'vx-pop-head' },
        React.createElement('span', null, '提示词库'),
        React.createElement('button', { className: 'vx-chip', title: '关闭', onClick: () => setS({ promptOpen: null }) }, React.createElement(Icon, { n: 'x', size: 12 })),
      ),
      React.createElement('div', { className: 'vx-row vx-pad-sm' },
        React.createElement(Icon, { n: 'search', size: 13 }),
        React.createElement('input', { className: 'vx-input', placeholder: '搜索提示词…', value: s.promptQuery, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setS({ promptQuery: e.target.value }) }),
      ),
      React.createElement('div', { className: 'vx-list' },
        list.length > 0
          ? list.map((x) => React.createElement('button', {
            key: x.id,
            className: 'vx-list-item',
            title: x.text,
            onClick: () => {
              const ok = S.insertDraft !== null ? S.insertDraft(x.text, false) : false
              setS({ promptOpen: null })
              if (ok) toast('已插入提示词: ' + x.name, 'info')
              else toast('请在会话输入框中重试', 'error')
            },
          },
          React.createElement('div', { className: 'vx-prompt-title' }, x.name),
          React.createElement('div', { className: 'vx-prompt-body' }, x.text)))
          : React.createElement('div', { className: 'vx-muted vx-pad-sm' }, '暂无匹配提示词'),
      ),
    )
  }

  function HeaderBalance(): React.ReactElement {
    const s = useS()
    const b = s.balance
    const [hover, setHover] = React.useState(false)
    const [pinned, setPinned] = React.useState(false)
    // Initial fetch plus a refresh every minute, so the balance figure and the
    // today-usage badge stay current without pressing 刷新.
    React.useEffect(() => {
      if (S.balance === null) void refreshBalance()
      const timer = setInterval(() => { void refreshBalance() }, 60_000)
      return () => { clearInterval(timer) }
    }, [])
    const usageToday = s.usage[dayKey()] ?? {}
    const calls = Object.keys(usageToday).reduce((n, k) => n + (usageToday[k].calls ?? 0), 0)
    const bal = (b?.ok === true && b.balance !== null && b.balance !== undefined)
      ? b.balance as { currency?: string, total?: string }
      : null
    const balance = bal !== null
      ? ((bal.currency ?? 'CNY') === 'CNY' ? '¥' + (bal.total ?? '') : `${bal.total ?? ''} ${bal.currency ?? ''}`)
      : (b?.ok === false ? ((b as { keyConfigured?: boolean }).keyConfigured === true ? '额度?' : '未配置密钥') : '额度…')
    const open = hover || pinned
    return React.createElement('span', { className: 'vx-balance-wrap' },
      React.createElement('span', {
        className: 'vx-balance-text' + (pinned ? ' vx-balance-pinned' : ''),
        title: pinned ? '再次点击取消固定' : '点击固定密钥面板',
        onClick: () => setPinned(!pinned),
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
      },
        React.createElement(Icon, { n: 'wallet', size: 13 }),
        React.createElement('span', null, balance),
        calls > 0 ? React.createElement('span', { className: 'vx-balance-today' }, `今日 ${calls} 次`) : null,
      ),
      open
        ? React.createElement('div', { className: 'vx-glass vx-balance-hover', onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) },
          React.createElement('div', { className: 'vx-pattern' }),
          pinned
            ? React.createElement('div', { className: 'vx-balance-head' },
              React.createElement('span', { className: 'vx-muted' }, '已固定 · 再次点击「额度」或下方按钮取消'),
              React.createElement('button', { className: 'vx-btn vx-btn-sm', onClick: () => setPinned(false) }, React.createElement(Icon, { n: 'x', size: 12 }), ' 取消固定'),
            )
            : null,
          React.createElement(BalancePanelContent, { onInteract: () => setPinned(true) }),
        )
        : null,
    )
  }

  function UsageTable(): React.ReactElement {
    const s = useS()
    const day = s.usage[dayKey()] ?? {}
    const models = Object.keys(day)
    if (models.length === 0) return React.createElement('div', { className: 'vx-muted' }, '今日暂无 token 用量记录')
    const rows = models.map((model) => ({ model, row: day[model], breakdown: usageCostBreakdown(day[model], model) }))
    const totalPeakTokens = rows.reduce((sum, item) => sum + item.breakdown.peakTokens, 0)
    const totalOffPeakTokens = rows.reduce((sum, item) => sum + item.breakdown.offPeakTokens, 0)
    const totalPeakCost = rows.reduce((sum, item) => sum + item.breakdown.peakCostCny, 0)
    const totalOffPeakCost = rows.reduce((sum, item) => sum + item.breakdown.offPeakCostCny, 0)
    return React.createElement('div', null,
      React.createElement('table', { className: 'vx-table' },
        React.createElement('thead', null, React.createElement('tr', null,
          React.createElement('th', null, '模型'), React.createElement('th', null, '输入'), React.createElement('th', null, '缓存'), React.createElement('th', null, '输出'), React.createElement('th', null, '调用'), React.createElement('th', null, '费用 ¥'),
        )),
        React.createElement('tbody', null, rows.map(({ model, row, breakdown }) => {
          return React.createElement('tr', { key: model },
            React.createElement('td', null, model),
            React.createElement('td', null, row.in ?? 0),
            React.createElement('td', null, row.cacheIn ?? 0),
            React.createElement('td', null, row.out ?? 0),
            React.createElement('td', null, row.calls ?? 0),
            React.createElement('td', { title: `峰 ¥${breakdown.peakCostCny.toFixed(4)} · 闲 ¥${breakdown.offPeakCostCny.toFixed(4)}` }, breakdown.totalCostCny.toFixed(4)),
          )
        })),
      ),
      React.createElement('div', { className: 'vx-muted' }, `峰 token ${formatTokenCount(totalPeakTokens)} · 闲 token ${formatTokenCount(totalOffPeakTokens)} · 峰费用 ¥${totalPeakCost.toFixed(4)} · 闲费用 ¥${totalOffPeakCost.toFixed(4)}`),
      React.createElement('div', { className: 'vx-muted' }, `规则核对于 ${DEEPSEEK_PRICING_CHECKED_ON} · `,
        React.createElement('a', { href: DEEPSEEK_PRICING_SOURCE_URL, target: '_blank', rel: 'noreferrer' }, 'DeepSeek 官方价目'),
        ' · 费用仅供参考',
      ),
    )
  }

  function BalancePanelContent(props: { onInteract?: () => void }): React.ReactElement {
    const s = useS()
    const b = s.balance
    return React.createElement('div', { className: 'vx-col' },
      React.createElement('div', { className: 'vx-row' },
        React.createElement('input', {
          className: 'vx-input',
          type: 'password',
          placeholder: s.apiKeyConfigured ? '已配置 Key；输入新 Key 覆盖' : 'DeepSeek API Key (sk-…)',
          value: s.apiKey,
          onFocus: () => { props.onInteract?.() },
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => { setS({ apiKey: e.target.value, apiKeyDirty: true }) },
          onBlur: () => { if (S.apiKeyDirty) saveCfg() },
        }),
        React.createElement('button', { className: 'vx-btn', onClick: () => { if (S.apiKeyDirty) saveCfg() } }, '保存'),
        React.createElement('button', { className: 'vx-btn', onClick: () => { void refreshBalance() } }, React.createElement(Icon, { n: 'refresh', size: 13 }), ' 刷新'),
      ),
      React.createElement('div', { className: 'vx-muted' }, `Key 不回传浏览器；当前来源：${s.credentialStorage === 'system' ? '系统凭据' : s.credentialStorage === 'legacy-state' ? '旧状态文件（待迁移）' : s.credentialStorage === 'environment' ? '环境变量' : s.credentialStorage === 'dsh' ? 'DSH 凭据' : '未配置'}。留空后保存可清除插件自定义 Key。`),
      b !== null && b.ok === true && b.balance !== null && b.balance !== undefined
        ? (() => {
          const info = b.balance as { currency?: string, total?: string, granted?: string, toppedUp?: string }
          const sym = (info.currency ?? 'CNY') === 'CNY' ? '¥' : `${info.currency ?? ''} `
          return React.createElement('div', { className: 'vx-balance-lines' },
            React.createElement('div', null, `可用额度: ${sym}${info.total ?? ''}`),
            React.createElement('div', { className: 'vx-muted' }, `赠送 ${sym}${info.granted ?? ''} · 充值 ${sym}${info.toppedUp ?? ''}${(b as { available?: boolean }).available === false ? ' · 余额不足不可用' : ''}`),
          )
        })()
        : null,
      b !== null && b.ok === false ? React.createElement('div', { className: 'vx-error' }, String((b as { error?: unknown }).error ?? '未知错误')) : null,
      React.createElement('div', { className: 'vx-section-title' }, '今日消费与 Token'),
      React.createElement(UsageTable, null),
      React.createElement('button', { className: 'vx-btn', onClick: () => { void refreshUsageScan() } }, React.createElement(Icon, { n: 'list', size: 13 }), ' 扫描今日会话日志更新用量'),
    )
  }

  function QuoteDock(props: QuoteDockProps): React.ReactElement | null {
    const s = useS()
    const inputRef = React.useRef(props.input)
    inputRef.current = props.input
    const actionsRef = React.useRef(props.inputActions)
    actionsRef.current = props.inputActions
    React.useEffect(() => {
      S.insertDraft = (text: string, replace: boolean): boolean => {
        const actions = actionsRef.current
        if (actions === undefined || typeof actions.setDraft !== 'function') return false
        try {
          const current = (inputRef.current?.draft ?? '') as string
          actions.setDraft(replace ? text : (current !== '' ? current + '\n\n' + text : text))
          return true
        } catch (error) {
          console.error('[custom-plugin] insertDraft', error)
          return false
        }
      }
      return () => { S.insertDraft = null }
    }, [])
    React.useEffect(() => {
      if (s.cfg.quote !== true) {
        if (S.quoteSel !== null) setS({ quoteSel: null })
        return
      }
      const d = typeof document !== 'undefined' ? document : null
      if (d === null) return
      const inVxRoot = (node: Node | null): boolean => {
        let n: Node | null = node
        while (n !== null && n.nodeType === 1) {
          if ((n as HTMLElement).classList !== undefined && (n as HTMLElement).classList.contains('vx-root')) return true
          n = n.parentNode
        }
        return false
      }
      const onSel = (): void => {
        try {
          const sel = d.getSelection?.() ?? null
          if (sel === null || sel.isCollapsed) {
            if (S.quoteSel !== null) setS({ quoteSel: null })
            return
          }
          const text = String(sel.toString() ?? '').trim()
          if (text === '') {
            if (S.quoteSel !== null) setS({ quoteSel: null })
            return
          }
          if (sel.rangeCount === 0) return
          const range = sel.getRangeAt(0)
          if (inVxRoot(range.commonAncestorContainer)) return
          const node = sel.anchorNode
          if (node !== null && node.nodeType === 1 && /TEXTAREA|INPUT/.test((node as HTMLElement).nodeName)) return
          const r = range.getBoundingClientRect()
          setS({ quoteSel: { text: text.slice(0, 8000), x: r.left + r.width / 2, y: r.top - 6 } })
        } catch { /* selection read failed */ }
      }
      d.addEventListener('selectionchange', onSel)
      return () => d.removeEventListener('selectionchange', onSel)
    }, [s.cfg.quote])
    return null
  }

  function QuoteButton(): React.ReactElement | null {
    const s = useS()
    if (s.quoteSel === null) return null
    const q = s.quoteSel
    const fmt = q.text.split('\n').map((l) => '> ' + l).join('\n')
    return React.createElement('button', {
      className: 'vx-quote-btn',
      style: { left: q.x, top: q.y },
      onClick: () => {
        const text = fmt + '\n\n'
        const ok = S.insertDraft !== null ? S.insertDraft(text, false) : false
        if (!ok) toast('输入框不可用（当前不在会话中）', 'error')
        try {
          const d = typeof document !== 'undefined' ? document : null
          d?.getSelection()?.removeAllRanges()
        } catch { /* selection clear failed */ }
        setS({ quoteSel: null })
        if (ok) toast('已引用到输入框', 'info')
      },
    }, React.createElement(Icon, { n: 'quote', size: 12 }), React.createElement('span', null, '引用回复'))
  }

  function TurnTailEntry(props: TurnTailProps): React.ReactElement {
    const seq = props.matched !== undefined && props.matched !== null ? props.matched : (typeof props.seq === 'number' ? props.seq : null)
    const turn = props.turn
    const s = useS()
    const item = (seq !== null && s.turns !== null && s.turns.sessionId === S.sessionId) ? s.turns.items.find((t) => t.seq === seq) ?? null : null
    const btns: React.ReactElement[] = []
    if (item !== null && s.cfg.formula === true) {
      if (item.hasLatex === true) btns.push(React.createElement('button', { key: 'lx', className: 'vx-chip', title: '复制 LaTeX 公式', onClick: () => void copyLatexOf(item) }, React.createElement(Icon, { n: 'copy', size: 11 }), ' LaTeX'))
      if (item.hasMathml === true) btns.push(React.createElement('button', { key: 'mm', className: 'vx-chip', title: '复制 MathML（可粘贴到 Word）', onClick: () => void copyMathmlOf(item) }, React.createElement(Icon, { n: 'copy', size: 11 }), ' MathML'))
    }
    if (item !== null && s.cfg.mermaid === true && item.hasMermaid === true) {
      btns.push(React.createElement('button', { key: 'md', className: 'vx-chip', title: '渲染 Mermaid 图表', onClick: () => openMermaidOf(item) }, React.createElement(Icon, { n: 'gitBranch', size: 11 }), ' Mermaid'))
    }
    return React.createElement('span', {
      className: 'vx-anchor',
      'data-vx-seq': seq === null ? '' : String(seq),
      ref: (el: HTMLSpanElement | null): void => {
        if (el !== null && seq !== null) S.anchors.set(seq, { el, turn: turn ?? null })
        else if (el === null && seq !== null) S.anchors.delete(seq)
      },
    }, btns.length > 0 ? React.createElement('span', { className: 'vx-turn-actions' }, btns) : null)
  }

  function RailPopover(): React.ReactElement | null {
    const s = useS()
    const h = s.railHover
    const popRef = React.useRef<HTMLDivElement | null>(null)
    // Keep the card inside the rail's height: dots near the bottom would push
    // the action row past the viewport bottom otherwise. Direct DOM writes
    // avoid the measure → setState → re-measure loop a state clamp causes.
    React.useLayoutEffect(() => {
      const el = popRef.current
      if (el === null || h === null) return
      const rail = el.parentElement
      if (rail === null) return
      const base = Math.max(8, h.y - 90)
      el.style.top = base + 'px'
      const over = el.offsetTop + el.offsetHeight - rail.clientHeight
      if (over > 0) el.style.top = Math.max(8, base - over) + 'px'
    }, [h?.seq, h?.y])
    if (h === null) return null
    const item = s.turns !== null && Array.isArray(s.turns.items) ? s.turns.items.find((x) => x.seq === h.seq) ?? null : null
    if (item === null) return null
    const starred = S.sessionId !== null && s.stars[S.sessionId]?.[h.seq] === true
    const side = s.cfg.timelineLeft === true ? 'left' : 'right'
    return React.createElement('div', {
      ref: (el: HTMLDivElement | null): void => { popRef.current = el },
      className: `vx-glass vx-rail-pop ${side}`,
      style: { top: Math.max(8, h.y - 90) },
      // Entering the card cancels the dot's hide timer so the actions (star,
      // fork, copy) are reachable; leaving re-arms it like a dot leave does.
      onMouseEnter: () => { if (S.railHoverTimer !== null) { clearTimeout(S.railHoverTimer); S.railHoverTimer = null } },
      onMouseLeave: () => { S.railHoverTimer = setTimeout(() => setS({ railHover: null }), 350) },
    },
      React.createElement('div', { className: 'vx-pattern' }),
      React.createElement('div', { className: 'vx-pop-time' }, `${fmtClock(item.time)} · 第 ${item.turn ?? '?'} 轮${item.imageCount > 0 ? ` · ${item.imageCount} 张图片` : ''}`),
      React.createElement('div', { className: 'vx-pop-text' }, item.text.slice(0, 220) + (item.text.length > 220 ? '…' : '')),
      React.createElement('div', { className: 'vx-pop-row' },
        React.createElement('button', { className: 'vx-chip', onClick: () => scrollToSeq(h.seq) }, React.createElement(Icon, { n: 'arrowDown', size: 11 }), ' 跳转'),
        React.createElement('button', { className: 'vx-chip', onClick: () => toggleStar(h.seq) }, React.createElement(Icon, { n: 'star', size: 11, filled: starred }), starred ? ' 已星标' : ' 星标'),
        React.createElement('button', { className: 'vx-chip', onClick: () => void forkAt(h.seq) }, React.createElement(Icon, { n: 'fork', size: 11 }), ' 分支'),
        React.createElement('button', { className: 'vx-chip', onClick: () => void copyText(item.text).then((ok) => toast(ok ? '已复制全文' : '复制失败', ok ? 'info' : 'error')) }, React.createElement(Icon, { n: 'copy', size: 11 }), ' 全文'),
      ),
      (item.hasLatex === true || item.hasMathml === true || item.hasMermaid === true)
        ? React.createElement('div', { className: 'vx-pop-row' },
          item.hasLatex === true ? React.createElement('button', { className: 'vx-chip', onClick: () => void copyLatexOf(item) }, 'LaTeX') : null,
          item.hasMathml === true ? React.createElement('button', { className: 'vx-chip', onClick: () => void copyMathmlOf(item) }, 'MathML') : null,
          item.hasMermaid === true ? React.createElement('button', { className: 'vx-chip', onClick: () => openMermaidOf(item) }, 'Mermaid') : null,
        )
        : null,
    )
  }

  function TimelineRail(props: OverlayProps): React.ReactElement | null {
    const s = useS()
    const sessions = useSessionsSafe(props)
    const current = sessions !== null ? (sessions.current ?? null) : null
    const summary = current !== null ? sessions!.byId[current] : null
    const trackRef = React.useRef<HTMLDivElement | null>(null)
    React.useEffect(() => {
      if (current !== null && current !== S.sessionId) {
        setS({ sessionId: current, turns: null, railPositions: [], railSig: '', railHover: null })
        void fetchTurns(String(current))
      } else if (current === null && S.sessionId !== null) {
        setS({ sessionId: null, turns: null, railPositions: [], railSig: '', railHover: null })
      }
    }, [current])
    React.useEffect(() => {
      if (s.cfg.timeline !== true || S.sessionId === null) return
      const handle = setInterval(() => { if (summary !== null && summary.running === true) void fetchTurns(S.sessionId as string) }, 3000)
      return () => clearInterval(handle)
    }, [s.cfg.timeline, current])
    React.useEffect(() => {
      if (s.cfg.timeline !== true || S.sessionId === null) return
      const el = trackRef.current
      if (el === null) return
      // The hover card lives inside the 12px rail but must behave like a
      // normal panel: button presses there are clicks (not thumb drags) and
      // wheel events should not scroll the chat out from under the reader.
      const fromPopover = (e: Event): boolean => e.target instanceof Element && e.target.closest('.vx-rail-pop') !== null
      const down = (e: PointerEvent): void => {
        const scroller = S.scrollerEl
        if (scroller === null || !scroller.isConnected) return
        if (fromPopover(e)) return
        e.preventDefault()
        const rect = el.getBoundingClientRect()
        const startY = e.clientY
        const startScroll = scroller.scrollTop ?? 0
        const scrollH = Math.max(1, (scroller.scrollHeight ?? 1) - (scroller.clientHeight ?? rect.height))
        const onMove = (ev: PointerEvent): void => {
          const dy = ev.clientY - startY
          const delta = (dy / Math.max(1, rect.height)) * scrollH
          scroller.scrollTop = Math.max(0, Math.min(scrollH, startScroll + delta))
        }
        const onUp = (): void => {
          const w = typeof window !== 'undefined' ? window : null
          if (w !== null) { w.removeEventListener('pointermove', onMove); w.removeEventListener('pointerup', onUp) }
        }
        const w = typeof window !== 'undefined' ? window : null
        if (w !== null) { w.addEventListener('pointermove', onMove); w.addEventListener('pointerup', onUp) }
      }
      el.addEventListener('pointerdown', down)
      // Wheel scrolling: wheeling over the rail scrolls the
      // chat scrollport directly (the rail replaces the native scrollbar).
      const onWheel = (e: WheelEvent): void => {
        const scroller = S.scrollerEl
        if (scroller === null || !scroller.isConnected) return
        if (fromPopover(e)) return
        e.preventDefault()
        const floor = Math.max(0, (scroller.scrollHeight ?? 1) - (scroller.clientHeight ?? 0))
        scroller.scrollTop = Math.max(0, Math.min(floor, (scroller.scrollTop ?? 0) + (e.deltaY || 0)))
      }
      el.addEventListener('wheel', onWheel, { passive: false })
      return () => {
        el.removeEventListener('pointerdown', down)
        el.removeEventListener('wheel', onWheel)
      }
    }, [s.cfg.timeline, s.sessionId, s.scrollerEl])
    if (s.cfg.timeline !== true || S.sessionId === null) return null
    const right = s.cfg.timelineLeft !== true
    const dots = s.railPositions.filter((p) => s.cfg.starsOnly !== true || p.st)
    return React.createElement('div', {
      ref: trackRef,
      className: `vx-rail ${right ? 'right' : 'left'}`,
      style: { top: s.railBox.top, height: s.railBox.height, ...(right ? { right: s.railRight } : { left: s.railLeft }) },
    },
      React.createElement('div', { className: 'vx-thumb', style: { top: s.thumbTop, height: s.thumbH } }),
      dots.map((p) => React.createElement('button', {
        key: p.seq,
        className: 'vx-dot' + (p.st ? ' star' : ''),
        style: { top: p.y },
        onMouseEnter: () => { if (S.railHoverTimer !== null) clearTimeout(S.railHoverTimer); setS({ railHover: { seq: p.seq, y: p.y } }) },
        onMouseLeave: () => { S.railHoverTimer = setTimeout(() => setS({ railHover: null }), 350) },
        onClick: () => scrollToSeq(p.seq),
      })),
      React.createElement(RailPopover, null),
    )
  }

  function AppearanceTab(): React.ReactElement {
    const s = useS()
    const dark = s.dark === true
    const set = (k: keyof CustomPluginConfig, v: string | boolean): void => {
      setS({ cfg: { ...s.cfg, [k]: v } })
      saveCfg()
    }
    return React.createElement('div', { className: 'vx-col' },
      React.createElement('div', { className: 'vx-muted' }, '主题背景、天气特效与玻璃质感，选择后即时生效。'),
      React.createElement('div', { className: 'vx-section-title' }, '背景颜色'),
      React.createElement('div', { className: 'vx-muted' }, '20 组低饱和色板；深色模式下仅可用「无颜色」与「极光」。'),
      React.createElement('div', { className: 'vx-swatches' },
        React.createElement('button', { key: 'default', className: 'vx-swatch' + (s.cfg.bg === 'default' ? ' on' : ''), onClick: () => set('bg', 'default'), title: '无颜色（默认主题）' },
          React.createElement('span', { className: 'vx-swatch-box', style: { background: 'repeating-conic-gradient(#ccc 0 25%, #eee 0 50%) 0 0/10px 10px' } }),
          React.createElement('span', { className: 'vx-swatch-label' }, '无颜色')),
        React.createElement('button', { key: 'aurora', className: 'vx-swatch' + (s.cfg.bg === 'aurora' ? ' on' : ''), onClick: () => set('bg', 'aurora'), title: '极光渐变（保留高饱和）' },
          React.createElement('span', { className: 'vx-swatch-box', style: { background: 'linear-gradient(135deg,#8fa8d8,#b59fd8,#8fc4b4,#d8a8c0)' } }),
          React.createElement('span', { className: 'vx-swatch-label' }, '极光')),
        PALETTE.map((p) => React.createElement('button', { key: p[0], disabled: dark, className: 'vx-swatch' + (s.cfg.bg === p[0] ? ' on' : ''), onClick: () => set('bg', p[0]), title: p[0] + ' ' + p[1] + (dark ? '（深色模式禁用）' : '') },
          React.createElement('span', { className: 'vx-swatch-box', style: { background: p[1] } }),
          React.createElement('span', { className: 'vx-swatch-label' }, p[0]))),
      ),
      React.createElement('div', { className: 'vx-section-title' }, '天气特效'),
      React.createElement('div', { className: 'vx-row wrap' },
        (['none', 'snow', 'rain', 'sakura'] as const).map((w) => {
          const iconNames: Record<string, string> = { none: 'minimize', snow: 'snowflake', rain: 'cloudRain', sakura: 'flower' }
          const weatherNames: Record<string, string> = { none: '无', snow: '飘雪', rain: '电影感雨滴', sakura: '樱花飘落' }
          return React.createElement('button', {
            key: w,
            className: 'vx-btn' + (s.cfg.weather === w ? ' on' : ''),
            onClick: () => set('weather', w),
          },
          React.createElement(Icon, { n: iconNames[w], size: 12 }),
          ' ' + weatherNames[w])
        }),
      ),
      React.createElement('div', { className: 'vx-section-title' }, '玻璃效果'),
      React.createElement(Toggle, { label: '启用玻璃', checked: s.cfg.glass === true, onChange: (v) => set('glass', v) }),
      React.createElement('div', { className: 'vx-row wrap' },
        React.createElement('button', { className: 'vx-btn' + (s.cfg.glassMode !== 'liquid' ? ' on' : ''), onClick: () => set('glassMode', 'frost') }, '毛玻璃'),
        React.createElement('button', { className: 'vx-btn' + (s.cfg.glassMode === 'liquid' ? ' on' : ''), onClick: () => set('glassMode', 'liquid') }, '液态玻璃'),
      ),
      React.createElement('div', { className: 'vx-muted' }, '在 Chromium 启用液态玻璃，Safari/Firefox 自动回退毛玻璃。'),
      React.createElement(Toggle, { label: '全局浮层玻璃', checked: s.cfg.globalGlass === true, onChange: (v) => set('globalGlass', v), hint: '对弹窗/菜单等浮层应用模糊，不改变圆角与边框' }),
    )
  }

  function FolderNode(props: { node: FolderNode; useSessions: OverlayProps['useSessions']; useWorkspaces: OverlayProps['useWorkspaces'] }): React.ReactElement {
    const s = useS()
    const node = props.node
    const [open, setOpen] = React.useState(true)
    const sessions = useSessionsSafe(props)
    const byId = sessions !== null ? (sessions.byId as unknown as Record<string, { displayTitle?: string; title?: string; running?: boolean }>) : {}
    const workspaces = useWorkspacesSafe(props)
    const wsItems = workspaces !== null && workspaces.items !== undefined ? (workspaces.items as unknown as WorkspaceRowLike[]) : []
    const wsTitle = (w: WorkspaceRowLike): string => w.title || w.path || w.workspaceId
    const addChildFolder = (): void => {
      askText('文件夹名称：', '', (name) => {
        const folders = JSON.parse(JSON.stringify(S.folders)) as FolderNode[]
        const target = findFolder(folders, node.id)
        if (target === null) return
        target.children = target.children ?? []
        target.children.push({ id: 'f' + Date.now() + Math.floor(Math.random() * 9999), name, children: [], sessionIds: [], workspaceIds: [], prompts: [] })
        setS({ folders })
        saveCfg()
      })
    }
    const renameFolder = (): void => {
      askText('重命名文件夹：', node.name, (name) => {
        const folders = JSON.parse(JSON.stringify(S.folders)) as FolderNode[]
        const target = findFolder(folders, node.id)
        if (target !== null) target.name = name
        setS({ folders })
        saveCfg()
      })
    }
    const delFolder = (): void => {
      askConfirm(`删除文件夹「${node.name}」及其子文件夹？（会话与提示词不会被删除）`, (ok) => {
        if (!ok) return
        const folders = JSON.parse(JSON.stringify(S.folders)) as FolderNode[]
        const cut = (arr: FolderNode[]): boolean => {
          for (let i = 0; i < arr.length; i++) {
            if (arr[i].id === node.id) { arr.splice(i, 1); return true }
            if (cut(arr[i].children ?? [])) return true
          }
          return false
        }
        cut(folders)
        setS({ folders })
        saveCfg()
      })
    }
    const removeRef = (kind: 'session' | 'workspace', id: string): void => {
      const folders = JSON.parse(JSON.stringify(S.folders)) as FolderNode[]
      const target = findFolder(folders, node.id)
      if (target === null) return
      if (kind === 'session') target.sessionIds = (target.sessionIds ?? []).filter((x) => x !== id)
      else target.workspaceIds = (target.workspaceIds ?? []).filter((x) => x !== id)
      setS({ folders })
      saveCfg()
    }
    const moveNode = (srcId: string, targetId: string, mode: string): void => {
      if (srcId === '' || srcId === targetId) return
      const folders = JSON.parse(JSON.stringify(S.folders)) as FolderNode[]
      let src: FolderNode | null = null
      const take = (arr: FolderNode[]): boolean => {
        for (let i = 0; i < arr.length; i++) {
          if (arr[i].id === srcId) { src = arr.splice(i, 1)[0]; return true }
          if (take(arr[i].children ?? [])) return true
        }
        return false
      }
      const place = (arr: FolderNode[]): boolean => {
        for (const f of arr) {
          if (f.id === targetId) {
            if (mode === 'inside') (f.children = f.children ?? []).push(src as FolderNode)
            else if (mode === 'before') arr.splice(arr.indexOf(f), 0, src as FolderNode)
            else arr.splice(arr.indexOf(f) + 1, 0, src as FolderNode)
            return true
          }
          if (place(f.children ?? [])) return true
        }
        return false
      }
      if (src !== null && take(folders) && place(folders)) { setS({ folders }); saveCfg() }
    }
    const rowDrop = (e: React.DragEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      const srcId = S.dragFolder
      const hint = S.dropHint
      setS({ dragFolder: null, dropHint: null })
      if (srcId !== null) moveNode(srcId, node.id, hint !== null && hint.zone !== null ? hint.zone : 'inside')
    }
    const rowOver = (e: React.DragEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      const r = e.currentTarget.getBoundingClientRect()
      const y = e.clientY - r.top
      const zone = y < r.height * 0.28 ? 'before' : (y > r.height * 0.72 ? 'after' : 'inside')
      if (S.dropHint === null || S.dropHint.id !== node.id || S.dropHint.zone !== zone) setS({ dropHint: { id: node.id, zone } })
    }
    const rowLeave = (): void => { if (S.dropHint !== null && S.dropHint.id === node.id) setS({ dropHint: null }) }
    const adding = s.folderAdd === node.id
    const pickingWs = s.folderWsPick === node.id
    const hintZone = s.dropHint !== null && s.dropHint.id === node.id ? s.dropHint.zone : null
    const children = node.children ?? []
    const sessIds = node.sessionIds ?? []
    const wsIds = node.workspaceIds ?? []
    return React.createElement('div', { className: 'vx-folder' },
      React.createElement('div', {
        className: 'vx-folder-head' + (hintZone === 'inside' ? ' drop-inside' : (hintZone === 'before' ? ' drop-before' : (hintZone === 'after' ? ' drop-after' : ''))),
        draggable: true,
        onDragStart: (e: React.DragEvent) => { setS({ dragFolder: node.id }); try { e.dataTransfer.setData('text/plain', node.id) } catch { /* dataTransfer unavailable */ } },
        onDragEnd: () => setS({ dragFolder: null, dropHint: null }),
        onDragOver: rowOver,
        onDragLeave: rowLeave,
        onDrop: rowDrop,
      },
        React.createElement('button', { className: 'vx-mini', title: open ? '折叠' : '展开', onClick: (e: React.MouseEvent) => { e.stopPropagation(); setOpen(!open) } },
          React.createElement(Icon, { n: open ? 'chevronDown' : 'chevronRight', size: 12 })),
        React.createElement(Icon, { n: 'folder', size: 14 }),
        React.createElement('span', { className: 'vx-folder-name', title: node.name }, node.name),
        React.createElement('span', { className: 'vx-badge' }, folderCount(node)),
        React.createElement('button', { className: 'vx-mini', title: '重命名', onClick: (e: React.MouseEvent) => { e.stopPropagation(); renameFolder() } }, React.createElement(Icon, { n: 'sliders', size: 11 })),
        React.createElement('button', { className: 'vx-mini', title: '删除', onClick: (e: React.MouseEvent) => { e.stopPropagation(); delFolder() } }, React.createElement(Icon, { n: 'trash', size: 11 })),
      ),
      open
        ? React.createElement('div', { className: 'vx-folder-body' },
          children.map((c) => React.createElement(FolderNode, { key: c.id, node: c, useSessions: props.useSessions, useWorkspaces: props.useWorkspaces })),
          wsIds.map((wid) => {
            const w = wsItems.find((x) => x.workspaceId === wid)
            if (w === undefined) return null
            return React.createElement('div', { key: 'w' + wid, className: 'vx-item-row' },
              React.createElement(Icon, { n: 'briefcase', size: 12 }),
              React.createElement('button', { className: 'vx-item-name', title: wsTitle(w), onClick: () => void openWorkspaceItem(wid) }, wsTitle(w)),
              React.createElement('button', { className: 'vx-mini', title: '移出', onClick: () => removeRef('workspace', wid) }, React.createElement(Icon, { n: 'x', size: 10 })),
            )
          }),
          sessIds.map((sid) => {
            const sum = byId[sid]
            const name = sum !== undefined ? (sum.displayTitle || sum.title || sid) : sid
            return React.createElement('div', { key: 's' + sid, className: 'vx-item-row' },
              React.createElement(Icon, { n: 'message', size: 12 }),
              React.createElement('button', { className: 'vx-item-name', title: name, onClick: () => openSessionItem(sid) }, name),
              React.createElement('button', { className: 'vx-mini', title: '移出', onClick: () => removeRef('session', sid) }, React.createElement(Icon, { n: 'x', size: 10 })),
            )
          }),
          React.createElement('div', { className: 'vx-row vx-pad-sm' },
            React.createElement('button', { className: 'vx-btn vx-btn-sm', onClick: () => setS({ folderAdd: adding ? null : node.id, folderWsPick: null }) },
              React.createElement(Icon, { n: 'plus', size: 11 }), ' 添加'),
            adding ? React.createElement('button', { className: 'vx-btn vx-btn-sm', onClick: () => setS({ folderWsPick: pickingWs ? null : node.id }) },
              React.createElement(Icon, { n: 'briefcase', size: 11 }), ' 工作区') : null,
          ),
          adding
            ? React.createElement('div', { className: 'vx-form' },
              React.createElement('button', { className: 'vx-btn vx-btn-sm', onClick: addChildFolder }, React.createElement(Icon, { n: 'folderPlus', size: 11 }), ' 新建子文件夹'),
              S.sessionId !== null
                ? React.createElement('button', { className: 'vx-btn vx-btn-sm', onClick: () => {
                  const folders = JSON.parse(JSON.stringify(S.folders)) as FolderNode[]
                  const target = findFolder(folders, node.id)
                  if (target !== null) {
                    target.sessionIds = target.sessionIds ?? []
                    if (target.sessionIds.indexOf(S.sessionId as string) < 0) target.sessionIds.push(S.sessionId as string)
                  }
                  setS({ folders, folderAdd: null })
                  saveCfg()
                } }, React.createElement(Icon, { n: 'message', size: 11 }), ' 添加当前会话')
                : null,
              pickingWs
                ? React.createElement('div', { className: 'vx-list' },
                  wsItems.filter((w) => wsIds.indexOf(w.workspaceId) < 0).map((w) => React.createElement('button', {
                    key: w.workspaceId,
                    className: 'vx-list-item',
                    onClick: () => {
                      const folders = JSON.parse(JSON.stringify(S.folders)) as FolderNode[]
                      const target = findFolder(folders, node.id)
                      if (target !== null) {
                        target.workspaceIds = target.workspaceIds ?? []
                        if (target.workspaceIds.indexOf(w.workspaceId) < 0) target.workspaceIds.push(w.workspaceId)
                      }
                      setS({ folders, folderAdd: null, folderWsPick: null })
                      saveCfg()
                    },
                  }, wsTitle(w))))
                : null,
            )
            : null,
        )
        : null,
    )
  }

  function FoldersTab(props: { useSessions: OverlayProps['useSessions']; useWorkspaces: OverlayProps['useWorkspaces'] }): React.ReactElement {
    const addRoot = (): void => {
      askText('文件夹名称：', '', (name) => {
        const folders = JSON.parse(JSON.stringify(S.folders)) as FolderNode[]
        folders.push({ id: 'f' + Date.now() + Math.floor(Math.random() * 9999), name, children: [], sessionIds: [], workspaceIds: [], prompts: [] })
        setS({ folders })
        saveCfg()
      })
    }
    return React.createElement('div', { className: 'vx-col' },
      React.createElement('div', { className: 'vx-muted' }, '跨工作区共享的会话与工作区收藏夹，支持多级嵌套与拖拽排序；数据保存在本机状态文件。'),
      S.folders.length === 0 ? React.createElement('div', { className: 'vx-muted vx-pad-sm' }, '暂无文件夹，点击下方按钮创建。') : null,
      S.folders.map((f) => React.createElement(FolderNode, { key: f.id, node: f, useSessions: props.useSessions, useWorkspaces: props.useWorkspaces })),
      React.createElement('div', { className: 'vx-row vx-pad-sm' },
        React.createElement('button', { className: 'vx-btn', onClick: addRoot }, React.createElement(Icon, { n: 'folderPlus', size: 13 }), ' 新建文件夹'),
      ),
    )
  }

  function PromptsTab(): React.ReactElement {
    const addPrompt = (): void => {
      askText('提示词名称：', '', (name) => {
        askText('提示词内容：', '', (text) => {
          if (text.trim() === '') { toast('内容不能为空', 'error'); return }
          S.prompts = S.prompts.concat({ id: 'p' + Date.now() + Math.floor(Math.random() * 9999), name: name || '未命名', text })
          setS({ prompts: S.prompts })
          saveCfg()
        })
      })
    }
    const delPrompt = (id: string): void => {
      S.prompts = S.prompts.filter((x) => x.id !== id)
      setS({ prompts: S.prompts })
      saveCfg()
    }
    return React.createElement('div', { className: 'vx-col' },
      React.createElement('div', { className: 'vx-muted' }, '常用提示词收藏；点击会话顶部的「提示词」按钮搜索插入，也可直接复制。'),
      S.prompts.map((p) => React.createElement('div', { key: p.id, className: 'vx-prompt-card' },
        React.createElement('div', { className: 'vx-row' },
          React.createElement('span', { className: 'vx-prompt-title' }, p.name),
          React.createElement('span', { className: 'vx-flex1' }),
          React.createElement('button', { className: 'vx-mini', title: '复制', onClick: () => void copyText(p.text).then((ok) => toast(ok ? '已复制提示词' : '复制失败', ok ? 'info' : 'error')) }, React.createElement(Icon, { n: 'copy', size: 11 })),
          React.createElement('button', { className: 'vx-mini', title: '删除', onClick: () => delPrompt(p.id) }, React.createElement(Icon, { n: 'trash', size: 11 })),
        ),
        React.createElement('div', { className: 'vx-prompt-body' }, p.text),
      )),
      React.createElement('div', { className: 'vx-row vx-pad-sm' },
        React.createElement('button', { className: 'vx-btn', onClick: addPrompt }, React.createElement(Icon, { n: 'plus', size: 13 }), ' 新增提示词'),
      ),
    )
  }

  function TimelineTab(): React.ReactElement {
    const s = useS()
    const set = (k: keyof CustomPluginConfig, v: boolean): void => {
      setS({ cfg: { ...s.cfg, [k]: v } })
      saveCfg()
    }
    return React.createElement('div', { className: 'vx-col' },
      React.createElement('div', { className: 'vx-muted' }, '为每条用户消息生成导航节点：悬停预览、点击跳转，支持星标与分支。'),
      React.createElement(Toggle, { label: '显示时间线', checked: s.cfg.timeline === true, onChange: (v) => set('timeline', v) }),
      React.createElement(Toggle, { label: '时间线在左侧', checked: s.cfg.timelineLeft === true, onChange: (v) => set('timelineLeft', v) }),
      React.createElement(Toggle, { label: '仅显示星标', checked: s.cfg.starsOnly === true, onChange: (v) => set('starsOnly', v) }),
    )
  }

  function ExportTab(): React.ReactElement {
    const s = useS()
    return React.createElement('div', { className: 'vx-col' },
      React.createElement('div', { className: 'vx-muted' }, '将当前会话导出为文件：JSON 可导入其他工具，Markdown 便于阅读分享，PDF 内嵌图片（打印时另存为 PDF）。'),
      React.createElement('div', { className: 'vx-row wrap' },
        React.createElement('button', { className: 'vx-btn big', disabled: s.exporting === true, onClick: () => runExport('json') }, React.createElement(Icon, { n: 'download', size: 14 }), ' JSON'),
        React.createElement('button', { className: 'vx-btn big', disabled: s.exporting === true, onClick: () => runExport('markdown') }, React.createElement(Icon, { n: 'download', size: 14 }), ' Markdown'),
        React.createElement('button', { className: 'vx-btn big', disabled: s.exporting === true, onClick: () => runExport('pdf') }, React.createElement(Icon, { n: 'download', size: 14 }), ' PDF（含图片）'),
      ),
      s.exporting === true ? React.createElement('div', { className: 'vx-muted vx-pad-sm' }, '导出中…') : null,
    )
  }

  function MermaidTab(): React.ReactElement {
    const [engine, setEngine] = React.useState(mermaidState.status)
    const aliveRef = React.useRef(true)
    React.useEffect(() => {
      const t = new Promise<void>((resolve) => setTimeout(resolve, 300)).then(() => { if (aliveRef.current) setEngine(mermaidState.status) }).catch(() => {})
      return () => { aliveRef.current = false; try { void t.catch(() => {}) } catch { /* timer disposed */ } }
    }, [])
    const load = async (): Promise<void> => {
      setEngine('loading')
      const ok = await ensureMermaid()
      if (!aliveRef.current) return
      setEngine(ok ? 'ready' : 'failed')
      toast(ok ? 'Mermaid 引擎已就绪' : '加载失败：可改用 mermaid.live 按钮', ok ? 'info' : 'error')
    }
    return React.createElement('div', { className: 'vx-col' },
      React.createElement('div', { className: 'vx-muted vx-pad-sm' }, '助手回复与用户消息中的 Mermaid 代码块会自动就地渲染为图表（支持思维导图、流程图等），可随时切回代码视图；渲染引擎优先取本地依赖，失败时回退 CDN，也可一键跳转 mermaid.live 在线编辑。'),
      React.createElement(Toggle, { label: '自动渲染 Mermaid 图表', checked: S.cfg.mermaid === true, onChange: (v) => { setS({ cfg: { ...S.cfg, mermaid: v } }); saveCfg() } }),
      React.createElement('div', { className: 'vx-row' },
        React.createElement('button', { className: 'vx-btn', onClick: () => void load() },
          React.createElement(Icon, { n: 'gitBranch', size: 12 }),
          engine === 'ready' ? ' 引擎已就绪' : (engine === 'loading' ? ' 加载中…' : ' 预加载渲染引擎')),
        React.createElement('span', { className: 'vx-muted' }, engine === 'failed' ? '加载失败（本地依赖缺失且网络不可达）' : ''),
      ),
    )
  }

  function ToolsTab(): React.ReactElement {
    const s = useS()
    const set = (k: keyof CustomPluginConfig, v: boolean): void => {
      setS({ cfg: { ...s.cfg, [k]: v } })
      saveCfg()
    }
    return React.createElement('div', { className: 'vx-col' },
      React.createElement('div', { className: 'vx-section-title' }, '效率工具'),
      React.createElement(Toggle, { label: '引用回复', checked: s.cfg.quote === true, onChange: (v) => set('quote', v), hint: '选中对话文本后出现引用按钮（个性化面板内不触发）' }),
      React.createElement(Toggle, { label: '防自动跳转', checked: s.cfg.antiScroll === true, onChange: (v) => set('antiScroll', v), hint: '拦截发送后强制滚动到底部' }),
      React.createElement(Toggle, { label: '公式复制', checked: s.cfg.formula === true, onChange: (v) => set('formula', v), hint: '消息下方显示 LaTeX/MathML 复制按钮' }),
      React.createElement('div', { className: 'vx-row vx-pad-sm' },
        React.createElement('button', { className: 'vx-btn vx-btn-danger', onClick: () => setS({ batchModal: true }) },
          React.createElement(Icon, { n: 'trash', size: 13 }), ' 批量归档会话'),
      ),
    )
  }

  function AboutTab(): React.ReactElement {
    const [info, setInfo] = React.useState<Record<string, unknown> | null>(null)
    const loadInfo = async (): Promise<void> => {
      try { setInfo(await apiDebugInfo()) } catch { setInfo({ ok: false }) }
    }
    React.useEffect(() => { void loadInfo() }, [])
    return React.createElement('div', { className: 'vx-col vx-pad' },
      React.createElement('div', null, 'Custom 便利套件'),
      React.createElement('div', { className: 'vx-muted' }, '外观与天气特效 · 时间线导航 · 项目文件夹 · 提示词 · 会话导出 · Mermaid 渲染 · 额度面板'),
      info !== null && info.ok === true
        ? React.createElement('pre', { className: 'vx-pre' },
          `状态文件: ${String(info.statePath ?? '')}\n今日: ${String(info.today ?? '')}\nMermaid: ${String(info.mermaidBytes ?? 0)} bytes\n今日用量: ${JSON.stringify(info.usageToday ?? {})}\n客户端诊断: ${Array.isArray(info.diagReports) ? `${String(info.diagReports.length)} 条` : '0 条'}`)
        : null,
      React.createElement('button', { className: 'vx-btn', onClick: () => void loadInfo() }, React.createElement(Icon, { n: 'refresh', size: 12 }), ' 刷新调试信息'),
    )
  }

  function AskModal(): React.ReactElement | null {
    const s = useS()
    const [val, setVal] = React.useState('')
    React.useEffect(() => { if (s.ask !== null) setVal(s.ask.value ?? '') }, [s.ask?.title])
    const ask = s.ask
    if (ask === null) return null
    const submit = (): void => {
      const cb = ask.cb
      setS({ ask: null })
      if (val.trim() !== '') cb(val.trim())
    }
    return React.createElement('div', { className: 'vx-modal-mask', onClick: () => setS({ ask: null }) },
      React.createElement('div', { className: 'vx-glass vx-modal', style: { width: 'min(360px, 92vw)' }, onClick: (e: React.MouseEvent) => e.stopPropagation() },
        React.createElement('div', { className: 'vx-pattern' }),
        React.createElement('div', { className: 'vx-pop-head' }, React.createElement('span', null, ask.title)),
        React.createElement('input', { className: 'vx-input', value: val, autoFocus: true, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setVal(e.target.value), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter') submit() } }),
        React.createElement('div', { className: 'vx-row vx-pad-sm' },
          React.createElement('button', { className: 'vx-btn', onClick: submit }, '确定'),
          React.createElement('button', { className: 'vx-btn', onClick: () => setS({ ask: null }) }, '取消'),
        ),
      ),
    )
  }

  function ConfirmModal(): React.ReactElement | null {
    const s = useS()
    if (s.confirmAsk === null) return null
    const c = s.confirmAsk
    const answer = (ok: boolean): void => {
      const cb = c.cb
      setS({ confirmAsk: null })
      cb(ok)
    }
    return React.createElement('div', { className: 'vx-modal-mask', onClick: () => answer(false) },
      React.createElement('div', { className: 'vx-glass vx-modal', style: { width: 'min(380px, 92vw)' }, onClick: (e: React.MouseEvent) => e.stopPropagation() },
        React.createElement('div', { className: 'vx-pattern' }),
        React.createElement('div', { className: 'vx-pad' }, c.message),
        React.createElement('div', { className: 'vx-row vx-pad-sm' },
          React.createElement('button', { className: 'vx-btn vx-btn-danger', onClick: () => answer(true) }, '确定'),
          React.createElement('button', { className: 'vx-btn', onClick: () => answer(false) }, '取消'),
        ),
      ),
    )
  }

  function MermaidInPlace(): React.ReactElement | null {
    const s = useS()
    const enabled = s.cfg.mermaid === true
    const dark = s.dark
    React.useEffect(() => {
      if (!enabled) {
        restoreMermaidBlocks()
        return
      }
      const d = typeof document !== 'undefined' ? document : null
      const w = typeof window !== 'undefined' ? window : null
      if (d === null || d.body === null || w === null || w.MutationObserver === undefined) return
      let timer: ReturnType<typeof setTimeout> | null = null
      let stopped = false
      const scan = (): void => { if (!stopped) void scanMermaidBlocks(dark) }
      const schedule = (): void => {
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(scan, 400)
      }
      if (mmdLastDark !== null && mmdLastDark !== dark) {
        // Theme flipped: drop the memo so existing diagrams re-render.
        for (const block of Array.from(d.querySelectorAll<HTMLElement>('.md-code-block'))) delete block.dataset.vxMmd
      }
      mmdLastDark = dark
      scan()
      // Chat history loads, streaming fences and re-renders all mutate the
      // conversation subtree; one debounced body-wide observer covers them.
      const observer = new MutationObserver(schedule)
      observer.observe(d.body, { childList: true, subtree: true, characterData: true })
      return () => {
        stopped = true
        observer.disconnect()
        if (timer !== null) { clearTimeout(timer); timer = null }
      }
      // dark re-runs the effect: diagrams re-render under the flipped theme.
    }, [enabled, dark])
    return null
  }

  function MermaidModal(): React.ReactElement | null {
    const s = useS()
    const mm = s.mermaidModal
    const [svg, setSvg] = React.useState<string | null>(null)
    const [err, setErr] = React.useState<string | null>(null)
    const [loading, setLoading] = React.useState(false)
    const [liveUrl, setLiveUrl] = React.useState('#')
    React.useEffect(() => {
      if (mm === null) return
      let alive = true
      setSvg(null)
      setErr(null)
      setLoading(true)
      void (async () => {
        const url = await mermaidLiveUrl(mm.codes[mm.index])
        if (!alive) return
        setLiveUrl(url)
        const ready = await ensureMermaid()
        if (!alive) return
        if (!ready) { setErr('Mermaid 引擎加载失败（网络不可达？）。可点击下方按钮在 mermaid.live 打开'); setLoading(false); return }
        const r = await renderMermaid(mm.codes[mm.index], S.dark)
        if (!alive) return
        if (r.ok === true) setSvg(r.svg)
        else setErr(r.error)
        setLoading(false)
      })()
      return () => { alive = false }
    }, [mm?.index])
    if (mm === null) return null
    return React.createElement('div', { className: 'vx-modal-mask', onClick: () => setS({ mermaidModal: null }) },
      React.createElement('div', { className: 'vx-glass vx-modal', onClick: (e: React.MouseEvent) => e.stopPropagation() },
        React.createElement('div', { className: 'vx-pattern' }),
        React.createElement('div', { className: 'vx-pop-head' },
          React.createElement('span', null, `${mm.title} (${mm.index + 1}/${mm.codes.length})`),
          React.createElement('span', { className: 'vx-row' },
            mm.codes.length > 1 ? React.createElement('button', { className: 'vx-chip', title: '上一个', onClick: () => setS({ mermaidModal: { ...mm, index: (mm.index + mm.codes.length - 1) % mm.codes.length } }) }, React.createElement(Icon, { n: 'chevronRight', size: 12, style: { transform: 'rotate(180deg)' } })) : null,
            mm.codes.length > 1 ? React.createElement('button', { className: 'vx-chip', title: '下一个', onClick: () => setS({ mermaidModal: { ...mm, index: (mm.index + 1) % mm.codes.length } }) }, React.createElement(Icon, { n: 'chevronRight', size: 12 })) : null,
            React.createElement('a', { className: 'vx-chip vx-link', href: liveUrl, target: '_blank', rel: 'noopener noreferrer' }, '在 mermaid.live 打开'),
            React.createElement('button', { className: 'vx-chip', title: '关闭', onClick: () => setS({ mermaidModal: null }) }, React.createElement(Icon, { n: 'x', size: 12 })),
          ),
        ),
        loading ? React.createElement('div', { className: 'vx-muted vx-pad' }, '渲染中…') : null,
        err !== null ? React.createElement('div', { className: 'vx-error vx-pad' }, err) : null,
        svg !== null ? React.createElement('div', { className: 'vx-svgbox', dangerouslySetInnerHTML: { __html: svg } }) : null,
      ),
    )
  }

  function BatchModal(props: { useSessions: OverlayProps['useSessions'] }): React.ReactElement | null {
    const s = useS()
    const [sel, setSel] = React.useState<Record<string, boolean>>({})
    const [q, setQ] = React.useState('')
    const sessions = useSessionsSafe(props)
    const ids = sessions !== null ? (sessions.ids ?? []) : []
    const byId = sessions !== null ? (sessions.byId as unknown as Record<string, { displayTitle?: string; title?: string; running?: boolean }>) : {}
    const filtered = ids.filter((id) => {
      const sum = byId[id]
      if (sum === undefined) return false
      if (q !== '') {
        const t = String(sum.displayTitle || sum.title || id).toLowerCase()
        if (!t.includes(q.toLowerCase())) return false
      }
      return true
    })
    const selCount = Object.keys(sel).length
    const batchArchive = (targetIds: string[]): void => {
      const workspaces = C.get('workspaces') as { archiveSession(id: string): Promise<void> } | undefined
      if (workspaces === undefined || typeof workspaces.archiveSession !== 'function') { toast('归档服务不可用', 'error'); return }
      let done = 0
      const run = (): void => {
        if (done >= targetIds.length) { toast(`已归档 ${targetIds.length} 个会话`, 'info'); setS({ batchModal: false }); return }
        const id = targetIds[done++]
        void workspaces.archiveSession(id).then(run).catch(() => run())
      }
      run()
    }
    return React.createElement('div', { className: 'vx-modal-mask', onClick: () => setS({ batchModal: false }) },
      React.createElement('div', { className: 'vx-glass vx-modal', style: { width: 'min(560px, 92vw)' }, onClick: (e: React.MouseEvent) => e.stopPropagation() },
        React.createElement('div', { className: 'vx-pattern' }),
        React.createElement('div', { className: 'vx-pop-head' },
          React.createElement('span', null, '批量归档会话'),
          React.createElement('button', { className: 'vx-chip', title: '关闭', onClick: () => setS({ batchModal: false }) }, React.createElement(Icon, { n: 'x', size: 12 })),
        ),
        React.createElement('div', { className: 'vx-muted vx-pad-sm' }, '将选中的会话归档（从会话列表移除，日志仍保留，可在存储中找回）'),
        React.createElement('div', { className: 'vx-row vx-pad-sm' },
          React.createElement(Icon, { n: 'search', size: 13 }),
          React.createElement('input', { className: 'vx-input', placeholder: '搜索会话…', value: q, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value) }),
          React.createElement('button', { className: 'vx-btn', onClick: () => { const all: Record<string, boolean> = {}; for (const id of filtered) all[id] = true; setSel(all) } }, '全选'),
          React.createElement('button', { className: 'vx-btn', onClick: () => setSel({}) }, '清空'),
        ),
        React.createElement('div', { className: 'vx-list' },
          filtered.map((id) => {
            const sum = byId[id]
            return React.createElement('label', { key: id, className: 'vx-check-row' },
              React.createElement('input', { type: 'checkbox', checked: sel[id] === true, onChange: (e: React.ChangeEvent<HTMLInputElement>) => { const next = { ...sel }; if (e.target.checked) next[id] = true; else delete next[id]; setSel(next) } }),
              React.createElement('span', { className: 'vx-check-title' }, sum !== undefined ? (sum.displayTitle || sum.title || id) : id),
              sum !== undefined && sum.running === true ? React.createElement('span', { className: 'vx-badge' }, '运行中') : null,
            )
          }),
        ),
        React.createElement('div', { className: 'vx-row vx-pad-sm' },
          React.createElement('button', { className: 'vx-btn vx-btn-danger', disabled: selCount === 0, onClick: () => askConfirm(`确认归档选中的 ${selCount} 个会话？`, (ok) => { if (ok) batchArchive(Object.keys(sel)) }) },
            React.createElement(Icon, { n: 'trash', size: 12 }), ` 归档选中 (${selCount})`),
          React.createElement('button', { className: 'vx-btn', onClick: () => setS({ batchModal: false }) }, '取消'),
        ),
      ),
    )
  }

  function PanelBody(props: { useSessions: OverlayProps['useSessions']; useWorkspaces: OverlayProps['useWorkspaces'] }): React.ReactElement {
    const s = useS()
    if (s.panelTab === 'look') return React.createElement(AppearanceTab, null)
    if (s.panelTab === 'folder') return React.createElement(FoldersTab, { useSessions: props.useSessions, useWorkspaces: props.useWorkspaces })
    if (s.panelTab === 'prompt') return React.createElement(PromptsTab, null)
    if (s.panelTab === 'timeline') return React.createElement(TimelineTab, null)
    if (s.panelTab === 'export') return React.createElement(ExportTab, null)
    if (s.panelTab === 'mermaid') return React.createElement(MermaidTab, null)
    if (s.panelTab === 'tools') return React.createElement(ToolsTab, null)
    if (s.panelTab === 'balance') return React.createElement(BalancePanelContent, null)
    return React.createElement(AboutTab, null)
  }

  function PersonalizePanel(props: { useSessions: OverlayProps['useSessions']; useWorkspaces: OverlayProps['useWorkspaces'] }): React.ReactElement {
    const s = useS()
    const ref = React.useRef<HTMLDivElement | null>(null)
    const TABS: Array<[string, string, string]> = [['look', 'sliders', '外观'], ['folder', 'folder', '项目'], ['prompt', 'zap', '提示词'], ['timeline', 'clock', '时间线'], ['export', 'download', '导出'], ['mermaid', 'gitBranch', 'Mermaid'], ['tools', 'wrench', '效率'], ['balance', 'wallet', '额度'], ['about', 'info', '关于']]
    const onHeadDown = (e: React.MouseEvent): void => {
      const target = e.target as HTMLElement
      if (target.tagName === 'BUTTON' || target.tagName === 'A' || target.tagName === 'INPUT') return
      const el = ref.current
      if (el === null) return
      const rect = el.getBoundingClientRect()
      const start = { mx: e.clientX, my: e.clientY, x: rect.left, y: rect.top }
      const d = typeof document !== 'undefined' ? document : null
      if (d === null) return
      const move = (ev: MouseEvent): void => setS({ panelPos: { x: start.x + ev.clientX - start.mx, y: start.y + ev.clientY - start.my } })
      const up = (): void => { d.removeEventListener('mousemove', move); d.removeEventListener('mouseup', up) }
      d.addEventListener('mousemove', move)
      d.addEventListener('mouseup', up)
    }
    const style: React.CSSProperties = { top: 74, left: undefined, right: undefined }
    if (s.panelPos !== null) { style.top = s.panelPos.y; style.left = s.panelPos.x; style.right = undefined }
    else style.right = 76
    return React.createElement('div', { ref, className: 'vx-glass vx-panel', style },
      React.createElement('div', { className: 'vx-pattern' }),
      React.createElement('div', { className: 'vx-panel-head', onMouseDown: onHeadDown },
        React.createElement(Icon, { n: 'sliders', size: 14 }),
        React.createElement('span', { className: 'vx-panel-title' }, '个性化中心'),
        React.createElement('span', { className: 'vx-panel-sub' }, '外观 · 效率 · 额度'),
        React.createElement('span', { className: 'vx-flex1' }),
        React.createElement('button', { className: 'vx-chip', title: '关闭', onClick: () => setS({ panelOpen: false }) }, React.createElement(Icon, { n: 'x', size: 12 })),
      ),
      React.createElement('div', { className: 'vx-tabs' },
        TABS.map((t) => React.createElement('button', { key: t[0], className: 'vx-tab' + (s.panelTab === t[0] ? ' on' : ''), onClick: () => setS({ panelTab: t[0] }) },
          React.createElement(Icon, { n: t[1], size: 12 }), ' ' + t[2])),
      ),
      React.createElement('div', { className: 'vx-panel-body' },
        React.createElement(PanelBody, { useSessions: props.useSessions, useWorkspaces: props.useWorkspaces }),
      ),
    )
  }

  function SidebarFoldersPanel(props: { useSessions: OverlayProps['useSessions']; useWorkspaces: OverlayProps['useWorkspaces'] }): React.ReactElement | null {
    const s = useS()
    if (s.foldersOpen !== true) return null
    return React.createElement('div', { className: 'vx-glass vx-folders' },
      React.createElement('div', { className: 'vx-pattern' }),
      React.createElement('div', { className: 'vx-pop-head' },
        React.createElement(Icon, { n: 'folder', size: 14 }),
        React.createElement('span', null, '项目文件夹'),
        React.createElement('span', { className: 'vx-flex1' }),
        React.createElement('button', { className: 'vx-chip', title: '新建文件夹', onClick: () => askText('文件夹名称：', '', (name) => {
          if (name.trim() === '') return
          S.folders = S.folders.concat({ id: 'f' + Date.now() + Math.floor(Math.random() * 9999), name, children: [], sessionIds: [], workspaceIds: [], prompts: [] })
          setS({ folders: S.folders })
          saveCfg()
        }) }, React.createElement(Icon, { n: 'folderPlus', size: 12 })),
        React.createElement('button', { className: 'vx-chip', title: '关闭', onClick: () => setS({ foldersOpen: false }) }, React.createElement(Icon, { n: 'x', size: 12 })),
      ),
      React.createElement('div', { className: 'vx-folders-body' },
        S.folders.length === 0 ? React.createElement('div', { className: 'vx-muted vx-pad-sm' }, '暂无文件夹。在个性化中心可管理，或点击右上角新建。') : null,
        S.folders.map((f) => React.createElement(FolderNode, { key: f.id, node: f, useSessions: props.useSessions, useWorkspaces: props.useWorkspaces })),
      ),
    )
  }

  function SettingsPage(): React.ReactElement {
    return React.createElement('div', { className: 'vx-settings-page' },
      React.createElement(AppearanceTab, null),
      React.createElement('div', { className: 'vx-section-title' }, '功能开关'),
      React.createElement(TimelineTab, null),
      React.createElement(ToolsTab, null),
      React.createElement(MermaidTab, null),
    )
  }

  function Toasts(): React.ReactElement {
    const s = useS()
    return React.createElement('div', { className: 'vx-toasts' },
      s.toasts.map((t) => React.createElement('div', { key: t.id, className: 'vx-toast' + (t.kind === 'error' ? ' err' : '') },
        React.createElement(Icon, { n: t.kind === 'error' ? 'x' : (t.kind === 'success' ? 'check' : 'info'), size: 13 }),
        React.createElement('span', null, t.text),
        t.action !== null ? React.createElement('button', { className: 'vx-chip', onClick: () => { try { t.action?.run() } catch { /* action failed */ } } }, t.action.label) : null,
      )),
    )
  }

  function OverlayRoot(props: OverlayProps): React.ReactElement {
    const s = useS()
    /** 当前 GUI 实际配色。主题服务已解析的快照最权威（覆盖 GUI 内全局深色
     * 切换，与 OS 偏好无关）；其次 body 上呈现器维护的 data-ds-dark-theme；
     * 最后兜底操作系统 prefers-color-scheme。 */
    const readDark = (): boolean => {
      try {
        const theme = C.get('theme')
        if (theme !== undefined) {
          const scheme = theme.getTheme()?.active?.colorScheme
          if (scheme === 'dark') return true
          if (scheme === 'light') return false
        }
      } catch { /* theme service not ready yet */ }
      const d = typeof document !== 'undefined' ? document : null
      if (d !== null && d.body !== null && d.body.hasAttribute('data-ds-dark-theme')) return true
      const w = typeof window !== 'undefined' ? window : null
      if (w !== null && w.matchMedia !== undefined && w.matchMedia('(prefers-color-scheme: dark)').matches) return true
      return false
    }
    React.useEffect(() => { void loadCfg() }, [])
    React.useEffect(() => { if (s.booted) applyAppearance() }, [s.booted, s.cfg.bg, s.cfg.glass, s.cfg.glassMode, s.cfg.globalGlass])
    React.useEffect(() => { syncAntiScroll(s.cfg.antiScroll === true) }, [s.cfg.antiScroll])
    React.useEffect(() => {
      const w = typeof window !== 'undefined' ? window : null
      const d = typeof document !== 'undefined' ? document : null
      const applyDark = (dark: boolean): void => {
        S.dark = dark
        if (dark && S.booted && S.cfg.bg !== 'default' && S.cfg.bg !== 'aurora') {
          S.cfg = { ...S.cfg, bg: 'default' }
          saveCfg()
        }
        setS({ dark })
      }
      applyDark(readDark())
      // GUI 全局主题切换（权威：主题服务事件，覆盖浅/深/system 偏好）
      let offTheme: (() => boolean) | undefined
      try {
        offTheme = C.on('theme/change', (snap) => applyDark(snap.active?.colorScheme === 'dark'))
      } catch { /* theme event unavailable */ }
      // OS 配色变化（system 偏好时主题服务也会重发 theme/change，此处幂等兜底）
      let mq: MediaQueryList | undefined
      let onMq: ((e: MediaQueryListEvent) => void) | undefined
      if (w !== null && w.matchMedia !== undefined) {
        mq = w.matchMedia('(prefers-color-scheme: dark)')
        onMq = (): void => applyDark(readDark())
        if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onMq)
        else if (typeof mq.addListener === 'function') mq.addListener(onMq as () => void)
      }
      // DOM 兜底：body[data-ds-dark-theme] 由主题呈现器按快照维护
      let observer: MutationObserver | null = null
      if (d !== null && d.body !== null && typeof MutationObserver === 'function') {
        observer = new MutationObserver(() => applyDark(readDark()))
        observer.observe(d.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
      }
      return () => {
        if (offTheme !== undefined) { try { offTheme() } catch { /* already removed */ } }
        if (mq !== undefined && onMq !== undefined) {
          if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onMq)
          else if (typeof mq.removeListener === 'function') mq.removeListener(onMq as () => void)
        }
        if (observer !== null) observer.disconnect()
      }
    }, [])
    React.useEffect(() => {
      // boot 时再对一次表：此刻主题服务必然就绪，避免启动窗口期的误判
      const dark = readDark()
      S.dark = dark
      if (dark && S.booted && S.cfg.bg !== 'default' && S.cfg.bg !== 'aurora') {
        S.cfg = { ...S.cfg, bg: 'default' }
        setS({ cfg: S.cfg })
        saveCfg()
      } else {
        setS({ dark })
      }
    }, [s.booted])
    React.useEffect(() => {
      const tick = (): void => {
        const d = typeof document !== 'undefined' ? document : null
        if (d !== null && d.visibilityState === 'hidden') return
        updateRailPositions()
      }
      const stop = setInterval(tick, 450)
      const d = typeof document !== 'undefined' ? document : null
      const w = typeof window !== 'undefined' ? window : null
      const h = (): void => tick()
      if (d !== null) {
        d.addEventListener('scroll', h, true)
        d.addEventListener('visibilitychange', h)
      }
      if (w !== null) w.addEventListener('resize', h)
      return () => {
        clearInterval(stop)
        if (d !== null) {
          d.removeEventListener('scroll', h, true)
          d.removeEventListener('visibilitychange', h)
        }
        if (w !== null) w.removeEventListener('resize', h)
      }
    }, [])
    React.useEffect(() => {
      // History loads and message appends change the scrollport's subtree
      // without a scroll/resize signal; observe the resolved scrollport so the
      // rail refreshes (and the stale-turns check runs) right after new turns
      // render, instead of waiting for the 450ms tick.
      const w = typeof window !== 'undefined' ? window : null
      if (w === null || w.MutationObserver === undefined) return
      const scroller = s.scrollerEl
      if (scroller === null || !scroller.isConnected) return
      let timer: ReturnType<typeof setTimeout> | null = null
      const observer = new MutationObserver(() => {
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => { updateRailPositions() }, 120)
      })
      observer.observe(scroller, { childList: true, subtree: true })
      return () => {
        observer.disconnect()
        if (timer !== null) clearTimeout(timer)
      }
    }, [s.scrollerEl])
    const children: React.ReactElement[] = [React.createElement(FxCanvas, { key: 'fx' })]
    children.push(React.createElement(MermaidInPlace, { key: 'mmd' }))
    children.push(React.createElement(TimelineRail, { key: 'rail', useSessions: props.useSessions, useWorkspaces: props.useWorkspaces }))
    if (s.panelOpen === true) children.push(React.createElement(PersonalizePanel, { key: 'panel', useSessions: props.useSessions, useWorkspaces: props.useWorkspaces }))
    if (s.foldersOpen === true) children.push(React.createElement(SidebarFoldersPanel, { key: 'folders', useSessions: props.useSessions, useWorkspaces: props.useWorkspaces }))
    if (s.promptOpen !== null) children.push(React.createElement(PromptPopover, { key: 'prompt' }))
    if (s.mermaidModal !== null) children.push(React.createElement(MermaidModal, { key: 'mermaid' }))
    if (s.batchModal === true) children.push(React.createElement(BatchModal, { key: 'batch', useSessions: props.useSessions }))
    if (s.quoteSel !== null && s.cfg.quote === true) children.push(React.createElement(QuoteButton, { key: 'quote' }))
    if (s.ask !== null) children.push(React.createElement(AskModal, { key: 'ask' }))
    if (s.confirmAsk !== null) children.push(React.createElement(ConfirmModal, { key: 'confirm' }))
    children.push(React.createElement(Toasts, { key: 'toasts' }))
    return React.createElement('div', { className: 'vx-root' }, children)
  }

  // ================= install =================
  setDynCss('')
  try { ensureLiquidGlass() } catch (error) { reportDiag('ensureLiquidGlass: ' + String((error as Error)?.message ?? error)) }
  const slots = C.get('slots') as { inject(key: string, fn: () => unknown): void; register(options: Record<string, unknown>, component: unknown): () => void } | undefined
  if (slots === undefined) {
    console.error('[custom-plugin] slots service unavailable')
    reportDiag('slots service unavailable; surfaces skipped')
    return () => {}
  }
  const unregisterAll: Array<() => void> = []
  const injectOne = (key: string, id: string, options: Record<string, unknown>, comp: unknown): boolean => {
    try {
      slots.inject(key, () => {
        const unregister = slots.register({ name: key, ...options }, comp)
        unregisterAll.push(unregister)
        return unregister
      })
      reportDiag('ok ' + key + ' (' + id + ')')
      return true
    } catch (error) {
      const message = 'inject ' + key + ' (' + id + '): ' + String((error as Error)?.message ?? error)
      console.error('[custom-plugin] ' + message)
      reportDiag(message)
      return false
    }
  }
  injectOne('sidebar.footer.action', 'custom-plugin-folders', { id: 'custom-plugin-folders', order: -100, label: '项目' }, FolderSidebarButton)
  injectOne('shell.overlay', 'custom-plugin-overlay', { id: 'custom-plugin-overlay', order: 10, label: 'Custom 便利套件' }, OverlayRoot)
  injectOne('conversation.input.dock', 'custom-plugin-quote', { id: 'custom-plugin-quote', order: 30, label: '引用回复' }, QuoteDock)
  injectOne('conversation.chat.turnTail', 'custom-plugin-turn-tail', { select: (o: { seq?: unknown }) => (o !== null && typeof o.seq === 'number' ? o.seq : null) }, TurnTailEntry)
  injectOne('settings.section', 'custom-plugin-appearance', { id: 'custom-plugin-appearance', order: 30, label: '个性化' }, SettingsPage)
  injectOne('conversation.session.header.actions', 'custom-plugin-panel-open', { id: 'custom-plugin-panel-open', order: 5, label: '个性化' }, HeaderPanelButton)
  injectOne('conversation.session.header.actions', 'custom-plugin-prompts', { id: 'custom-plugin-prompts', order: 6, label: '提示词' }, PromptQuickButton)
  injectOne('conversation.session.header.utilities', 'custom-plugin-balance', { id: 'custom-plugin-balance', order: -5, label: '额度' }, HeaderBalance)
  reportDiag('client registered: 8 injections / 7 slots')
  return () => {
    for (const unregister of unregisterAll.splice(0)) {
      try { unregister() } catch { /* already unregistered */ }
    }
    removeDynCss()
  }
}
