/**
 * Browser half of dsh-custom-plugin: the Custom convenience suite UI.
 *
 * A single mutable store (`S`) drives every surface through a lightweight
 * listener set; components re-render on `setS`. The file ports the earlier
 * dynamic-plugin implementation: React is a platform import, static styles
 * are injected through one owned style element (styles.ts), dynamic body
 * styles (background / global glass) extend it, and host calls go
 * over `/api/custom-plugin` fetch routes.
 * @module @alexpeng/dsh-custom-plugin/client/custom
 */

import * as React from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { ThemeRuntime } from '@deepseek-ai/dsh-client-ui-theme/client'
import type { Context } from '@deepseek-ai/cordis'
import { DEFAULT_CONFIG, type BackupImportMode, type BackupImportPreview, type BgFxPreset, type BgStrength, type ConversationSearchItem, type ConversationSearchKind, type CustomPluginConfig, type FolderNode, type PromptItem, type TimelineItem, type UsageRow } from '../protocol.ts'
import { createUsageRow, dayKey, mergeUsageRow } from '../usage.ts'
import { DEEPSEEK_PRICING_CHECKED_ON, DEEPSEEK_PRICING_NOTE, DEEPSEEK_PRICING_SOURCE_URL, estimateUsageCostCny, usageCostBreakdown } from '../pricing.ts'
import { appearanceTokenKey, BACKDROP_ALPHA_BASE, BACKDROP_ALPHA_LAYER1, BACKDROP_ALPHA_SIDEBAR, DARK_CANVAS_LIGHTNESS, hexToRgb, PALETTE, toDarkRamp } from './palette.ts'
import { BG_LAYER_ID, bgLayerScope, bgLayerTint, decideBgFxLayer, mountBgLayer, pickColumnHost, swapBgRenderer, unmountBgLayer, type BgFxCaps, type BgFxVerdict, type BgLayerDocLike, type ColumnHostCandidate } from './bg-layer.ts'
import { focusRectFor, type BgFocusRect } from './bg-focus.ts'
import { createAsciiBackdrop, resolveAsciiPreset, type AsciiBackdrop, type AsciiDocLike, type AsciiHostLike, type AsciiWinLike } from './bg-ascii.ts'
import { createShaderBackdrop, resolveShaderStyle, type ShaderBackdrop, type ShaderDocLike, type ShaderHostLike, type ShaderWinLike } from './bg-shader.ts'
import {
  BG_PARAM_SAVE_MS,
  asciiParamsFromCfg,
  createDebouncedSaver,
  presetForTier,
  resetBgParams,
  selectAppearanceSlice,
  setParamInCfg,
  setStrengthInCfg,
  shaderParamsFromCfg,
  strengthFromCfg,
  tierFromCfg,
  type BgParamKey,
  type BgTier,
} from './bg-params.ts'
import {
  apiBalanceGet,
  apiBackupExport,
  apiBackupImport,
  apiConversationSearch,
  apiDebugInfo,
  apiDiagReport,
  apiExportRun,
  apiMermaidFetch,
  apiStateGet,
  apiStateSave,
  apiTimelineGet,
  apiUsageScan,
} from './api.ts'
import { archiveBatch, budgetState, fillPromptTemplate, isCommandPaletteShortcut, normalizePromptItem, parsePromptsMarkdown, promptsMarkdown, promptVariables, summarizeUsage, usageCsv } from '../productivity.ts'
import { MERMAID_SCRIPT_PATH } from '../protocol.ts'
import { isGenericInfostring, isMermaidCode, normalizeMermaidText } from './mermaid-code.ts'
import { mermaidLiveUrl } from './mermaid-url.ts'
import { mermaidCodeKey, reuseTimelineItems } from './timeline-diff.ts'
import { renderMermaid } from './mermaid-render.ts'
import { createMermaidScanner } from './mermaid-scan.ts'
import { STATIC_CSS } from './styles.ts'
import { Dialog, Popover, ToastStack } from './ui/overlays.tsx'
import { AppearanceControls } from './ui/appearance-controls.tsx'
import { Badge, Button, Card, EmptyState, Field, IconButton, Kbd, Segmented, Spinner, Switch } from './ui/primitives.tsx'
import { filterCommands, groupCommands, loadRecent, recentCommands, recordRecent, saveRecent, type CommandGroup, type PaletteCommand } from './ui/command-model.ts'
import { uniqueIds } from './ui/index-bridge.ts'
import { allTags, filterPrompts, mergePromptImport, normalizeTags, sortPrompts, validatePromptDraft, type PromptImportMode, type PromptSort } from './ui/prompt-model.ts'
import { addFolder as addFolderNode, cloneFolders, deleteFolder as deleteFolderNode, filterFolders, findFolder, folderCount, moveFolder as moveFolderNode, moveFolderOrder, renameFolder as renameFolderNode } from './ui/folders-model.ts'

/** Minimal input-state face the input dock owner provides. */
interface InputStateLike {
  draft?: string
}

/** Minimal input-actions face the framework injects into input-region slots. */
interface InputActionsLike {
  setDraft(text: string): void
}

/** Minimal workspace row face (official WorkspaceView carries workspaceId). */
interface WorkspaceRowLike {
  workspaceId: string
  title?: string
  path?: string
}

/**
 * The slot-prop data shapes below are declared locally on purpose: the harness
 * controller packages that own them rename and re-shape them across releases,
 * and importing their types would couple this bundle to modules it never loads
 * at runtime. Only the fields actually read are declared.
 */
/** One Session row of the `useSessions()` list snapshot. */
interface SessionRowLike {
  readonly id: string
  readonly displayTitle?: string
  readonly title?: string
  readonly running?: boolean
}

/** The `useSessions()` snapshot. `phase` is monotone: `ready` never steps back. */
interface SessionListLike {
  readonly ids: readonly string[]
  readonly byId: Readonly<Record<string, SessionRowLike>>
  readonly phase: 'pending' | 'ready'
}

/** The `useWorkspaces()` snapshot. */
interface WorkspaceListLike {
  readonly items?: readonly WorkspaceRowLike[]
  readonly state: 'idle' | 'loading' | 'error'
}

/** Turn placement the Chat turnTail slot hands to its entries. */
interface TurnLocationLike {
  readonly turn: number
  readonly status?: 'open' | 'closed' | 'unknown'
}

/** Standard prop every `scope: 'session'` slot entry receives. */
interface SessionScopedProps {
  readonly sessionId?: string | null
}

/** The `ctx.remote.session` methods this plugin calls. */
interface SessionRemoteLike {
  fork(request: { sessionId: string; atSeq?: number }): Promise<{ ok: true; value: { sessionId: string } } | { ok: false; error?: unknown }>
  search(request: { query: string }, signal?: AbortSignal): Promise<{ ok: true; value: { items: Array<{ sessionId: string; snippet: string }> } } | { ok: false; error?: unknown }>
}

/** The `ctx.uiWorkspace` navigation methods this plugin calls. */
interface WorkspaceNavLike {
  openSession(id: string): void
  connectWorkspace(id: string): Promise<string>
}

/**
 * dsh's shipped web profile configures the session index with `openAt: never`,
 * so cross-session full-text search can legitimately be unavailable. Say what
 * still works instead of leaving a bare error that reads as a broken palette.
 */
const CROSS_SEARCH_UNAVAILABLE = '跨会话全文搜索不可用；下方结果仍按标题匹配会话与工作区。'

function formatTokenCount(value: number): string {
  return Math.round(value).toLocaleString('zh-CN')
}

/** Shared mutable store. */
interface Store {
  cfg: CustomPluginConfig
  folders: FolderNode[]
  prompts: PromptItem[]
  stars: Record<string, Record<string, boolean>>
  usage: Record<string, Record<string, UsageRow>>
  sessionId: string | null
  turns: { sessionId: string; items: TimelineItem[] } | null
  /** seq → item index over `turns.items`, built once per fetch: one
   * TurnTailEntry per rendered turn reads it on every store change, and a
   * linear `find` per entry made each store event cost O(turns × entries). */
  turnsBySeq: Map<number, TimelineItem> | null
  anchors: Map<number, { el: HTMLElement; turn: TurnLocationLike | null }>
  panelOpen: boolean
  /** Section shown by the settings-page hub (appearance/folders/prompts/…). */
  settingsSection: string
  /** Host session/workspace snapshots mirrored by the always-mounted overlay,
   *  so the settings page works even when its slot receives no hooks. */
  sessionIndex: SessionListLike | null
  workspaceIndex: WorkspaceListLike | null
  /** True while the host settings page (which hosts our hub) is mounted. */
  settingsSurfaceOpen: boolean
  foldersOpen: boolean
  folderAdd: string | null
  folderWsPick: string | null
  dragFolder: string | null
  dropHint: { id: string; zone: string } | null
  promptOpen: boolean
  promptQuery: string
  balanceOpen: boolean
  batchModal: boolean
  mermaidModal: { title: string; codes: string[]; index: number } | null
  ask: { title: string; value: string; cb: (text: string) => void; allowEmpty?: boolean } | null
  confirmAsk: { message: string; cb: (ok: boolean) => void } | null
  toasts: Array<{ id: number; text: string; kind: string; action: { label: string; run: () => void } | null }>
  booted: boolean
  dark: boolean
  balance: Record<string, unknown> | null
  balanceUpdatedAt: number | null
  exporting: boolean
  usageRange: 7 | 30 | 90
  templatePrompt: PromptItem | null
  templateValues: Record<string, string>
  commandOpen: boolean
  insertDraft: ((text: string, replace: boolean) => boolean) | null
  greeted: boolean
}

/** Neutral glass tokens used when no palette color is active. */
const NEUTRAL_TOKENS: Record<string, { light: string; dark: string }> = {
  '--dsw-alias-bg-base': { light: 'rgba(248,249,251,.5)', dark: 'rgba(15,17,23,.5)' },
  '--dsw-alias-bg-layer-1': { light: 'rgba(255,255,255,.58)', dark: 'rgba(22,25,32,.58)' },
  // The shell's settings dialog paints itself with layer-2; keeping it opaque
  // is what stops the conversation text showing through the settings page
  // whenever no page background installed the backdrop token set.
  '--dsw-alias-bg-layer-2': { light: '#f2f4f7', dark: '#1c1f28' },
  '--dsw-alias-bg-overlay': { light: 'rgba(255,255,255,.78)', dark: 'rgba(18,21,28,.78)' },
  '--dsw-specific-sidebar-fill': { light: 'rgba(245,247,250,.56)', dark: 'rgba(13,15,21,.56)' },
}

/**
 * The backdrop token set: every shell fill token at a low alpha of its *own*
 * RGB while a renderer is mounted. The layer sits behind all of them, so what
 * survives is the product of the complements (see `BACKDROP_ALPHA_*`): the
 * shell's glass values multiply out to 10% in the reading column and 24% in the
 * sidebar, which is why the ink never became visible no matter how dark it was
 * made. Cards, dialogs, menus and the composer keep their own untouched
 * (opaque) layer tokens, so text-heavy surfaces never get texture behind them.
 *
 * The RGB values mirror the shell's own fills, so the page hue does not move at
 * any alpha: only the ink becomes reachable. The neutral variant is the
 * no-palette fallback and matches `bgLayerTint(undefined, …)`.
 */
const NEUTRAL_BACKDROP_TOKENS: Record<string, { light: string; dark: string }> = {
  '--dsw-alias-bg-base': { light: `rgba(248,249,251,${BACKDROP_ALPHA_BASE})`, dark: `rgba(15,17,23,${BACKDROP_ALPHA_BASE})` },
  '--dsw-alias-bg-layer-1': { light: `rgba(255,255,255,${BACKDROP_ALPHA_LAYER1})`, dark: `rgba(22,25,32,${BACKDROP_ALPHA_LAYER1})` },
  '--dsw-specific-sidebar-fill': { light: `rgba(245,247,250,${BACKDROP_ALPHA_SIDEBAR})`, dark: `rgba(13,15,21,${BACKDROP_ALPHA_SIDEBAR})` },
}

/** SVG displacement map + filter for the liquid glass (single-channel, no color dispersion). */
/** Coarse SVG map used only when a canvas cannot be created. */
const LG_MAP_FALLBACK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
  + '<defs><linearGradient id="r" x1="100%" y1="0%" x2="0%" y2="0%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="red"/></linearGradient>'
  + '<linearGradient id="g" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#0000"/><stop offset="100%" stop-color="lime"/></linearGradient></defs>'
  + '<rect width="100" height="100" fill="black"/>'
  + '<rect width="100" height="100" rx="16" fill="url(#r)"/>'
  + '<rect width="100" height="100" rx="16" fill="url(#g)" style="mix-blend-mode: difference"/>'
  + '<rect x="4.5" y="4.5" width="91" height="91" rx="5" fill="hsl(0 0% 50%)" style="filter: blur(4px)"/></svg>'

/**
 * Build the displacement map from the rounded-rect signed distance field:
 * neutral grey in the middle, an outward normal in the bevel band, alpha 255
 * (Chromium premultiplies transparent PNGs and turns the map into zeros).
 * The map is square and stretched by feImage; objectBoundingBox units keep
 * the bevel aligned on every card size.
 */
function liquidGlassMap(): string {
  const d = typeof document !== 'undefined' ? document : null
  const fallback = 'data:image/svg+xml,' + encodeURIComponent(LG_MAP_FALLBACK)
  if (d === null) return fallback
  try {
    const size = 384
    const canvas = d.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (ctx === null) return fallback
    const image = ctx.createImageData(size, size)
    const half = size / 2
    const radius = size * 0.045
    const bevel = size * 0.06
    const sdf = (x: number, y: number): number => {
      const qx = Math.abs(x) - (half - radius)
      const qy = Math.abs(y) - (half - radius)
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius
    }
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const x = px + 0.5 - half
        const y = py + 0.5 - half
        // sd is negative inside; t runs 0 in the flat centre to 1 at the edge.
        const t = Math.max(0, Math.min(1, 1 + sdf(x, y) / bevel))
        let r = 128
        let g = 128
        if (t > 0) {
          const dx = sdf(x + 0.75, y) - sdf(x - 0.75, y)
          const dy = sdf(x, y + 0.75) - sdf(x, y - 0.75)
          const length = Math.hypot(dx, dy) || 1
          const amount = 0.5 * Math.pow(t, 1.6)
          r = Math.round(128 + (dx / length) * amount * 127)
          g = Math.round(128 + (dy / length) * amount * 127)
        }
        const i = (py * size + px) * 4
        image.data[i] = r
        image.data[i + 1] = g
        image.data[i + 2] = 128
        image.data[i + 3] = 255
      }
    }
    ctx.putImageData(image, 0, 0)
    return canvas.toDataURL('image/png')
  } catch {
    return fallback
  }
}

function liquidGlassFilter(map: string): string {
  // objectBoundingBox units keep the map aligned on every card size; the
  // percentage form only refracted the bottom/right edge in Chromium. The
  // filter region reaches past the box so the rim can sample the mirrored
  // backdrop, and feMerge outputs only the displacement (never the map).
  return '<filter id="vx-lg" x="-0.25" y="-0.25" width="1.5" height="1.5" primitiveUnits="objectBoundingBox" color-interpolation-filters="sRGB">'
    + '<feImage href="' + map + '" result="map" x="0" y="0" width="1" height="1" preserveAspectRatio="none"/>'
    + '<feDisplacementMap in="SourceGraphic" in2="map" xChannelSelector="R" yChannelSelector="G" scale="0.18" result="disp"/>'
    + '<feMerge><feMergeNode in="disp"/></feMerge></filter>'
}

function ensureLiquidGlass(target?: Document): void {
  const d = target ?? (typeof document !== 'undefined' ? document : null)
  if (d === null || d.getElementById('vx-lg-filter') !== null) return
  try {
    const svg = d.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('id', 'vx-lg-filter')
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden')
    svg.innerHTML = liquidGlassFilter(liquidGlassMap())
    d.documentElement.appendChild(svg)
  } catch (error) {
    apiDiagReport('ensureLiquidGlass: ' + String((error as Error)?.message ?? error))
  }
}

/** One owned style element carrying the static rules plus the dynamic body rules. */
let dynStyle: HTMLStyleElement | null = null
// Rewriting a ~21 kB stylesheet re-parses it and recalculates style for the
// whole document, so a repaint that would produce byte-identical text must not
// touch `textContent` at all (the appearance painter runs on every theme/slider
// update, most of which leave these rules alone).
let dynCssText: string | null = null
function setDynCss(css: string): void {
  const d = typeof document !== 'undefined' ? document : null
  if (d === null) return
  const text = STATIC_CSS + '\n' + css
  const styleMissed = dynStyle === null || !dynStyle.isConnected
  if (!styleMissed && dynCssText === text) return
  let style = dynStyle
  if (styleMissed) {
    style = d.createElement('style')
    style.setAttribute('data-custom-plugin-css', '')
    d.head.appendChild(style)
    dynStyle = style
  }
  if (style === null) return
  style.textContent = text
  dynCssText = text
}
function removeDynCss(): void {
  if (dynStyle !== null && dynStyle.isConnected) {
    try { dynStyle.remove() } catch { /* style already gone */ }
  }
  dynStyle = null
  dynCssText = null
}

/** Public component props (the product slot system injects these). */
export interface OverlayProps {
  useSessions: SnapshotSelectorHook<SessionListLike>
  useWorkspaces: SnapshotSelectorHook<WorkspaceListLike>
}
/** Bridges the host's input actions into `insertDraft` so prompts and the
 *  command palette can write into the composer. Quote selection lives in DSH
 *  itself now, so this no longer owns a selection popup. */
export interface InputBridgeProps extends SessionScopedProps {
  input: InputStateLike
  inputActions: InputActionsLike
}
export interface TurnTailProps extends SessionScopedProps {
  turn: TurnLocationLike
  seq: number
  openFile: (path: string) => void
}

/** Install the whole Custom UI into the client context. Returns a disposer that unregisters every slot entry. */
export function installCustomPlugin(ctx: Context, reportDiag: (message: string) => void): () => void {
  const C = ctx

  const S: Store = {
    cfg: { ...DEFAULT_CONFIG },
    folders: [],
    prompts: [],
    stars: {},
    usage: {},
    sessionId: null,
    turns: null,
    turnsBySeq: null,
    anchors: new Map(),
    panelOpen: false,
    settingsSection: 'appearance',
    sessionIndex: null,
    workspaceIndex: null,
    settingsSurfaceOpen: false,
    foldersOpen: false,
    folderAdd: null,
    folderWsPick: null,
    dragFolder: null,
    dropHint: null,
    promptOpen: false,
    promptQuery: '',
    balanceOpen: false,
    batchModal: false,
    mermaidModal: null,
    ask: null,
    confirmAsk: null,
    toasts: [],
    booted: false,
    dark: false,
    balance: null,
    balanceUpdatedAt: null,
    exporting: false,
    usageRange: 7,
    templatePrompt: null,
    templateValues: {},
    commandOpen: false,
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
  /** Shallow object equality for selector results. */
  function shallowEqual<T extends object>(a: T, b: T): boolean {
    if (a === b) return true
    const aKeys = Object.keys(a)
    if (aKeys.length !== Object.keys(b).length) return false
    for (const key of aKeys) {
      if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false
    }
    return true
  }
  /**
   * Subscribe to a slice of the store. The store fan-out is intentionally
   * simple (one listener set), but per-turn entries are the hot path: a
   * balance tick or a toast must not re-render 400 turn-tail rows. The
   * selector runs on every store write; only an unequal result forces a
   * render.
   */
  function useSSelector<T>(selector: (state: Store) => T, equal: (a: T, b: T) => boolean = Object.is): T {
    const [, force] = React.useReducer((x: number) => x + 1, 0)
    const selectorRef = React.useRef(selector)
    selectorRef.current = selector
    const equalRef = React.useRef(equal)
    equalRef.current = equal
    const current = selector(S)
    const currentRef = React.useRef(current)
    currentRef.current = current
    React.useEffect(() => {
      const listener = (): void => {
        const next = selectorRef.current(S)
        if (!equalRef.current(currentRef.current, next)) {
          currentRef.current = next
          force()
        }
      }
      listeners.push(listener)
      // A store write can land between this render and effect registration;
      // compare once so that update is not lost.
      listener()
      return () => { listeners = listeners.filter((l) => l !== listener) }
    }, [])
    return current
  }
  /** Follow the OS "reduce motion" preference; weather FX is decorative. */
  function useReducedMotion(): boolean {
    const query = (): MediaQueryList | null => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
      return window.matchMedia('(prefers-reduced-motion: reduce)')
    }
    const [reduced, setReduced] = React.useState(() => query()?.matches === true)
    React.useEffect(() => {
      const mq = query()
      if (mq === null) return
      const onChange = (): void => setReduced(mq.matches)
      setReduced(mq.matches)
      mq.addEventListener?.('change', onChange)
      return () => { mq.removeEventListener?.('change', onChange) }
    }, [])
    return reduced
  }
  function useSessionsSafe(props: { useSessions: OverlayProps['useSessions'] }): SessionListLike | null {
    try { return props.useSessions(st => st) } catch { return null }
  }
  function useWorkspacesSafe(props: { useWorkspaces: OverlayProps['useWorkspaces'] }): WorkspaceListLike | null {
    try { return props.useWorkspaces(st => st) } catch { return null }
  }
  const EMPTY_SESSION_INDEX: SessionListLike = { ids: [], byId: {}, phase: 'pending' }
  const EMPTY_WORKSPACE_INDEX: WorkspaceListLike = { items: [], state: 'idle' }
  /** Snapshot hooks backed by the overlay's mirrored indexes; safe to call
   *  from settings.section, which may not receive the product slot hooks. */
  function useBridgedSessions<T>(selector: (state: SessionListLike) => T, equal?: (a: T, b: T) => boolean): T {
    return useSSelector((state) => selector(state.sessionIndex ?? EMPTY_SESSION_INDEX), equal)
  }
  function useBridgedWorkspaces<T>(selector: (state: WorkspaceListLike) => T, equal?: (a: T, b: T) => boolean): T {
    return useSSelector((state) => selector(state.workspaceIndex ?? EMPTY_WORKSPACE_INDEX), equal)
  }
  /**
   * Follow the Session the conversation is showing. The 0.1.7 session list
   * snapshot dropped its `current` field — view selection moved to the
   * Workspace browser — so the plugin reads the identity off the standard
   * `sessionId` prop that every session-scoped slot entry receives.
   *
   * Several entries carry it at once (two header actions, the utilities entry,
   * the input bridge, and one tail entry per turn), and a turn-level entry can
   * unmount while the same Session stays open. Only the LAST mounted holder may
   * clear the identity, otherwise the rail would go blank under the surviving
   * entries, whose props never change and so never re-run their effect.
   *
   * A holder that reports no session id claims nothing at all: it must not
   * count toward the holders, because one entry flipping to null while the
   * others still carry the session would otherwise wipe the identity they are
   * still rendering — and their effects never re-run to restore it.
   */
  let sessionScopeHolders = 0
  function useViewedSession(props: { sessionId?: string | null }): void {
    const id = typeof props.sessionId === 'string' && props.sessionId !== '' ? props.sessionId : null
    React.useEffect(() => {
      if (id === null) return
      sessionScopeHolders++
      if (S.sessionId !== id) {
        S.anchors.clear()
        setS({ sessionId: id, turns: null, turnsBySeq: null })
        void fetchTurns(id)
      }
      return () => {
        sessionScopeHolders--
        // Clearing the identity has to clear everything loaded under it, maps
        // included: a stale anchor element would let a search jump land on a
        // node the next session never rendered.
        if (sessionScopeHolders === 0 && S.sessionId === id) {
          S.anchors.clear()
          setS({ sessionId: null, turns: null, turnsBySeq: null })
        }
      }
    }, [id])
  }

  const ICONS: Record<string, Array<[string, Record<string, unknown>]>> = {
    sliders: [['line', { x1: 21, y1: 4, x2: 14, y2: 4 }], ['line', { x1: 10, y1: 4, x2: 3, y2: 4 }], ['line', { x1: 21, y1: 12, x2: 12, y2: 12 }], ['line', { x1: 8, y1: 12, x2: 3, y2: 12 }], ['line', { x1: 21, y1: 20, x2: 16, y2: 20 }], ['line', { x1: 12, y1: 20, x2: 3, y2: 20 }], ['line', { x1: 14, y1: 2, x2: 14, y2: 6 }], ['line', { x1: 8, y1: 10, x2: 8, y2: 14 }], ['line', { x1: 16, y1: 18, x2: 16, y2: 22 }]],
    folder: [['path', { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' }]],
    folderPlus: [['path', { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' }], ['line', { x1: 12, y1: 10, x2: 12, y2: 16 }], ['line', { x1: 9, y1: 13, x2: 15, y2: 13 }]],
    zap: [['path', { d: 'M13 2 3 14h9l-1 8 10-12h-9l1-8z' }]],
    download: [['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }], ['polyline', { points: '7 10 12 15 17 10' }], ['line', { x1: 12, y1: 15, x2: 12, y2: 3 }]],
    gitBranch: [['line', { x1: 6, y1: 3, x2: 6, y2: 15 }], ['circle', { cx: 18, cy: 6, r: 3 }], ['circle', { cx: 6, cy: 18, r: 3 }], ['path', { d: 'M18 9a9 9 0 0 1-9 9' }]],
    wrench: [['path', { d: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' }]],
    wallet: [['path', { d: 'M21 12V7H5a2 2 0 0 1 0-4h14v4' }], ['path', { d: 'M3 5v14a2 2 0 0 0 2 2h16v-5' }], ['path', { d: 'M18 12a2 2 0 0 0 0 4h4v-4Z' }]],
    info: [['circle', { cx: 12, cy: 12, r: 10 }], ['line', { x1: 12, y1: 16, x2: 12, y2: 12 }], ['line', { x1: 12, y1: 8, x2: 12.01, y2: 8 }]],
    x: [['line', { x1: 18, y1: 6, x2: 6, y2: 18 }], ['line', { x1: 6, y1: 6, x2: 18, y2: 18 }]],
    star: [['path', { d: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z' }]],
    copy: [['rect', { x: 9, y: 9, width: 13, height: 13, rx: 2 }], ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }]],
    check: [['polyline', { points: '20 6 9 17 4 12' }]],
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
    minimize: [['polyline', { points: '4 14 10 14 10 20' }], ['polyline', { points: '20 10 14 10 14 4' }], ['line', { x1: 14, y1: 10, x2: 21, y2: 3 }], ['line', { x1: 3, y1: 21, x2: 10, y2: 14 }]],
    list: [['line', { x1: 8, y1: 6, x2: 21, y2: 6 }], ['line', { x1: 8, y1: 12, x2: 21, y2: 12 }], ['line', { x1: 8, y1: 18, x2: 21, y2: 18 }], ['line', { x1: 3, y1: 6, x2: 3.01, y2: 6 }], ['line', { x1: 3, y1: 12, x2: 3.01, y2: 12 }], ['line', { x1: 3, y1: 18, x2: 3.01, y2: 18 }]],
    pencil: [['path', { d: 'M12 20h9' }], ['path', { d: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z' }]],
    arrowUp: [['line', { x1: 12, y1: 19, x2: 12, y2: 5 }], ['polyline', { points: '5 12 12 5 19 12' }]],
    arrowDown: [['line', { x1: 12, y1: 5, x2: 12, y2: 19 }], ['polyline', { points: '5 12 12 19 19 12' }]],
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
    // Auto-dismiss timing and hover-pause live in ToastStack; the store only
    // holds the visible queue.
    S.toasts = S.toasts.concat(item).slice(-3)
    setS({ toasts: S.toasts })
  }
  function dismissToast(id: number): void {
    S.toasts = S.toasts.filter((item) => item.id !== id)
    setS({ toasts: S.toasts })
  }

  function askText(title: string, value: string, cb: (text: string) => void, allowEmpty = false): void {
    setS({ ask: { title, value: value ?? '', cb, allowEmpty } })
  }
  function askConfirm(message: string, cb: (ok: boolean) => void): void {
    setS({ confirmAsk: { message, cb } })
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
  // Last token override identity actually installed (see appearanceTokenKey).
  // Left null after a dispose so the next repaint registers again.
  let lastTokenKey: string | null = null
  let lastTokenTheme: ThemeRuntime | undefined
  // A page renderer that failed to append on the first paint (the shell can
  // still be settling) is retried a few times instead of staying absent until
  // the next slider tick — that gap is what read as "the effect sometimes
  // works". The retries stop once the owned node exists.
  let bgLayerHealTimer: ReturnType<typeof setTimeout> | null = null
  let bgLayerHealAttempts = 0
  function healBackgroundLayer(): void {
    const d = typeof document !== 'undefined' ? document : null
    if (d === null) return
    if (d.getElementById(BG_LAYER_ID) !== null) { bgLayerHealAttempts = 0; return }
    if (bgLayerHealTimer !== null || bgLayerHealAttempts >= 3) return
    bgLayerHealAttempts++
    bgLayerHealTimer = setTimeout(() => {
      bgLayerHealTimer = null
      if (disposed) return
      applyAppearance()
      healBackgroundLayer()
    }, 160 * bgLayerHealAttempts)
  }
  function applyAppearance(): void {
    const cfg = S.cfg
    const dEl = typeof document !== 'undefined' ? document.documentElement : null
    if (dEl !== null) {
      try { dEl.classList.toggle('vx-liquid', cfg.glass === true && cfg.glassMode === 'liquid') } catch { /* classList unavailable */ }
      try { dEl.classList.toggle('vx-glass-off', cfg.glass !== true) } catch { /* classList unavailable */ }
    }
    const theme = C.get('theme') as ThemeRuntime | undefined
    // The layer verdict is computed before the token override: a layer behind
    // the shell's stacked translucent surfaces only transmits ~10% of its ink,
    // so the token set below is part of the renderer, not an appearance extra.
    const requestedMode = cfg.bgFx ?? 'none'
    const bgVerdict = decideBgFxLayer(requestedMode, bgFxCaps(requestedMode === 'shader'))
    // `ocean` paints inside the conversation column (ColumnBgAnchor); a
    // body-level layer would sit behind an opaque chat card and be invisible.
    // The page verdict is therefore off for that preset, and the backdrop token
    // set is not installed: the page keeps its normal opaque fills while the
    // column canvas owns the effect.
    const conversationScope = bgLayerScope(cfg.bgFx, cfg.bgFxPreset) === 'conversation'
    const pageVerdict: BgFxVerdict = conversationScope ? { mount: false, reason: 'disabled' } : bgVerdict
    // Only a page-level renderer sits behind the glass surfaces. Ocean's
    // column canvas must not switch the page material to the live variant:
    // there is no page texture behind the header/settings, and the class would
    // claim a layer that is not there.
    if (dEl !== null) {
      try { dEl.classList.toggle('vx-bg-live', pageVerdict.mount) } catch { /* classList unavailable */ }
    }
    // A mounted page renderer is behind every shell surface, and the stacked
    // translucent surfaces multiply the ink away (see BACKDROP_ALPHA_*). The
    // backdrop token set is what makes the layer visible at all — with or
    // without glass. `glass` only matters when no renderer is mounted.
    const backdrop = pageVerdict.mount
    // Slider ticks repaint the appearance dozens of times with an unchanged
    // palette + glass toggle; re-registering identical tokens would re-apply
    // the shell's variables and force a full-document recalc each time.
    const tokenKey = appearanceTokenKey(cfg.bg, cfg.glass === true, backdrop)
    const themeUsable = theme !== undefined && typeof theme.overrideTokens === 'function'
    if (themeUsable && (tokenKey !== lastTokenKey || theme !== lastTokenTheme)) {
      if (tokenDisposer !== null) {
        try { tokenDisposer() } catch { /* best effort */ }
        tokenDisposer = null
      }
      if (tokenKey === 'none') {
        lastTokenKey = 'none'
        lastTokenTheme = theme
      } else if (tokenKey === 'neutral') {
        tokenDisposer = theme.overrideTokens('custom-plugin-appearance', NEUTRAL_TOKENS)
        lastTokenKey = tokenKey
        lastTokenTheme = theme
      } else if (tokenKey === 'backdrop') {
        tokenDisposer = theme.overrideTokens('custom-plugin-appearance', NEUTRAL_BACKDROP_TOKENS)
        lastTokenKey = tokenKey
        lastTokenTheme = theme
      } else {
        const entry = PALETTE.find((p) => p[0] === cfg.bg) ?? PALETTE[0]
        const base = entry[1]
        const tab = entry[2] ?? shade(base, 0.94)
        const glassOn = cfg.glass === true
        const mk = (c: string, a: number): string => (glassOn ? rgbaOf(c, a) : c)
        // Dark variants are derived onto the same hue family's dark ramp (the
        // light pastels themselves would glare on a dark canvas).
        const darkBase = toDarkRamp(base, 0.14)
        const darkTab = toDarkRamp(tab, 0.18)
        if (backdrop) {
          // The three tokens the shell stacks over the layer, lowered to the
          // backdrop alphas but keeping the family RGB, so the page colour is
          // unchanged while the ink becomes reachable.
          tokenDisposer = theme.overrideTokens('custom-plugin-appearance', {
            '--dsw-alias-bg-base': { light: rgbaOf(base, BACKDROP_ALPHA_BASE), dark: rgbaOf(darkBase, BACKDROP_ALPHA_BASE) },
            '--dsw-alias-bg-layer-1': { light: rgbaOf(tab, BACKDROP_ALPHA_LAYER1), dark: rgbaOf(darkTab, BACKDROP_ALPHA_LAYER1) },
            '--dsw-specific-sidebar-fill': { light: rgbaOf(tab, BACKDROP_ALPHA_SIDEBAR), dark: rgbaOf(darkTab, BACKDROP_ALPHA_SIDEBAR) },
          })
        } else {
          tokenDisposer = theme.overrideTokens('custom-plugin-appearance', {
            '--dsw-alias-bg-base': { light: mk(base, 0.5), dark: mk(darkBase, 0.5) },
            '--dsw-alias-bg-layer-1': { light: mk(tab, 0.6), dark: mk(darkTab, 0.6) },
            '--dsw-alias-bg-layer-2': { light: shade(base, 0.96), dark: shade(darkBase, 0.94) },
            '--dsw-alias-bg-overlay': { light: mk(shade(base, 1.04), 0.8), dark: mk(shade(darkBase, 0.86), 0.8) },
            '--dsw-specific-sidebar-fill': { light: mk(tab, 0.62), dark: mk(darkTab, 0.62) },
          })
        }
        lastTokenKey = tokenKey
        lastTokenTheme = theme
      }
    } else if (!themeUsable && tokenDisposer !== null) {
      try { tokenDisposer() } catch { /* best effort */ }
      tokenDisposer = null
      lastTokenKey = null
      lastTokenTheme = undefined
    }
    // The background layer paints its own opaque surface while mounted, so
    // `body` must stay transparent. With the layer off the body keeps the
    // family surface exactly as before — that is the "turn it off and the page
    // fully reverts" contract. The verdict computed above is handed to the
    // layer so the CSS and the DOM can never disagree on whether it mounts.
    let dyn = ''
    if (cfg.bg !== undefined && cfg.bg !== 'default') {
      const base = (PALETTE.find((p) => p[0] === cfg.bg) ?? PALETTE[0])[1]
      // Dark mode derives the same family's dark variant; S.dark is kept in
      // step with the GUI theme (applyDark) and re-runs this painter.
      const surface = S.dark === true ? toDarkRamp(base, DARK_CANVAS_LIGHTNESS) : base
      dyn += pageVerdict.mount
        ? ' body { background-color: transparent !important; }'
        : ` body { background-color: ${surface} !important; }`
    } else if (pageVerdict.mount) {
      dyn += ' body { background-color: transparent !important; }'
    }
    if (cfg.globalGlass === true) {
      // In liquid mode the same SVG displacement chain as the plugin's own
      // surfaces extends to shell overlays (dialogs, menus, tooltips, the
      // settings window is a dialog too). Engines that cannot reference an
      // SVG filter from backdrop-filter keep the plain frost blur.
      const liquidGlobal = cfg.glass === true && cfg.glassMode === 'liquid'
        && typeof CSS !== 'undefined' && typeof CSS.supports === 'function'
        && CSS.supports('backdrop-filter', 'url(#vx-lg)')
      const bgLive = pageVerdict.mount
      const liquidFilter = bgLive
        ? 'url(#vx-lg) blur(9px) saturate(1.5) contrast(1.25) brightness(1.03)'
        : 'url(#vx-lg) blur(10px) saturate(1.45) brightness(1.03)'
      const frostFilter = bgLive ? 'blur(12px) saturate(1.3) contrast(1.25)' : 'blur(8px) saturate(1.2)'
      const filter = liquidGlobal ? liquidFilter : frostFilter
      dyn += ` [role='dialog'], [role='menu'], [role='tooltip'], [role='listbox'], [data-radix-popper-content-wrapper] { backdrop-filter: ${filter} !important; -webkit-backdrop-filter: ${filter} !important; }`
    }
    setDynCss(dyn)
    syncBackgroundLayer(pageVerdict)
    if (pageVerdict.mount && typeof document !== 'undefined' && document.getElementById(BG_LAYER_ID) === null) {
      healBackgroundLayer()
    }
  }

  // The 2D-canvas and WebGL probes create throwaway contexts; cache the
  // verdicts because probing on every appearance repaint would burn the
  // browser's live-context budget for no gain, and a failed probe is final for
  // the page lifetime.
  let bgFxCanvas2d: boolean | null = null
  let bgFxWebgl: boolean | null = null
  // A lost context or a failed program compile is final for this page: never
  // retry the shader tier on every repaint, and never re-toast the fallback.
  let bgFxShaderBlocked = false
  let bgFxFallbackNotice = false
  function bgFxWebglAvailable(): boolean {
    if (bgFxShaderBlocked) return false
    if (bgFxWebgl !== null) return bgFxWebgl
    const d = typeof document !== 'undefined' ? document : null
    try {
      const probe = d !== null ? d.createElement('canvas') : null
      const gl = probe !== null ? probe.getContext('webgl') : null
      bgFxWebgl = gl !== null
      // Release the probe immediately so it cannot consume one of the page's
      // live contexts once the real renderer creates its own.
      if (gl !== null) {
        const ext = gl.getExtension('WEBGL_lose_context')
        if (ext !== null) ext.loseContext()
      }
    } catch {
      bgFxWebgl = false
    }
    return bgFxWebgl === true
  }
  function bgFxCaps(webgl: boolean): BgFxCaps {
    const w = typeof window !== 'undefined' ? window : null
    const d = typeof document !== 'undefined' ? document : null
    if (bgFxCanvas2d === null) {
      try {
        const probe = d !== null ? d.createElement('canvas') : null
        bgFxCanvas2d = probe !== null && probe.getContext('2d') !== null
      } catch {
        bgFxCanvas2d = false
      }
    }
    const reducedMotion = w !== null && typeof w.matchMedia === 'function'
      && w.matchMedia('(prefers-reduced-motion: reduce)').matches
    return {
      canvas2d: bgFxCanvas2d === true,
      webgl: webgl && bgFxWebglAvailable(),
      reducedMotion,
      hidden: d !== null && d.hidden === true,
    }
  }
  function announceBgFallback(contextLost: boolean): void {
    if (bgFxFallbackNotice) return
    bgFxFallbackNotice = true
    toast(contextLost
      ? '光影档的背景连接已断开，已回退到字符动效。'
      : '当前环境不支持光影档背景，已回退到字符动效。', 'info')
  }

  /**
   * Keep the decorative page-background layer in step with the config, the
   * theme and the degradation gates. Off by default: an untouched install
   * never creates the node, so the feature ships inert. The layer is appended
   * to <body>, never inside `.vx-root` — the overlay slot's ancestor is the
   * shell's z-index:20 layer, so a negative z-index there would still paint
   * above the content it has to stay behind.
   */
  type LiveBgRenderer =
    | { kind: 'ascii'; handle: AsciiBackdrop }
    | { kind: 'shader'; handle: ShaderBackdrop }
  let bgRenderer: LiveBgRenderer | null = null
  function destroyBgRenderer(): void {
    if (bgRenderer === null) return
    try { bgRenderer.handle.destroy() } catch { /* canvas already detached */ }
    bgRenderer = null
  }
  function createAscii(host: Parameters<typeof createAsciiBackdrop>[0]['host']): AsciiBackdrop {
    const preset = resolveAsciiPreset(S.cfg.bgFxPreset)
    return createAsciiBackdrop({
      doc: (typeof document !== 'undefined' ? document : null) as unknown as AsciiDocLike,
      win: (typeof window !== 'undefined' ? window : null) as unknown as AsciiWinLike,
      host,
      preset,
      params: asciiParamsFromCfg(S.cfg, preset),
    })
  }
  // The context-loss callback runs after this renderer is dead; repaint from
  // the gate (now that `bgFxShaderBlocked` is set) on the next task so the
  // canvas node list is not mutated while the browser is dispatching.
  const onShaderFallback = (): void => {
    bgFxShaderBlocked = true
    announceBgFallback(true)
    setTimeout(() => {
      if (!disposed) applyAppearance()
    }, 0)
  }

  /** How often the reading-column zone is re-measured, ms. A resize, a sidebar
   * collapse or an open panel all land inside one poll, and the renderers only
   * receive a new rect when the geometry actually changed. */
  const BG_FOCUS_POLL_MS = 350
  let bgFocusTimer: ReturnType<typeof setInterval> | null = null

  /**
   * The calm zone is the reading column: the composer's span horizontally,
   * from the transcript viewport's top down to the composer's top edge.
   *
   * Round 4 corrected the horizontal rule: it used to take the transcript
   * viewport's content box (993 px at 1280×822), which covers the *gutters*
   * too. Measured live 2026-11-08, the body copy (`xMeOpW_body` blocks) spans
   * x 437..1112 (675 px) while the viewport is 280..1273 — the visible gutter
   * belongs to the content surface but carries no text. With the viewport-wide
   * rect the whole content area sat at the floor and the full-strength band
   * lived under the header and the sidebar, so the mask was numerically
   * present (canvas 3.96× ratio) and visually absent. The composer span
   * (421..1129) matches the text measure within 16 px on each side, so no
   * glyph ever lands outside the calm zone, and the gutter keeps the texture.
   *
   * Every edge comes from live layout, so a window resize, a sidebar collapse
   * or an open panel moves the mask with the text instead of leaving a
   * boot-time rect on screen.
   */
  function measureFocusRect(): BgFocusRect | null {
    const d = typeof document !== 'undefined' ? document : null
    const w = typeof window !== 'undefined' ? window : null
    if (d === null) return null
    const vh = w !== null ? w.innerHeight : 0
    let anchor: HTMLElement | null = null
    let box: { left: number; top: number; bottom: number; width: number } | null = null
    const boxes = d.querySelectorAll('[role="textbox"]')
    for (let k = 0; k < boxes.length; k++) {
      const el = boxes[k] as HTMLElement
      const r = el.getBoundingClientRect()
      // The composer is the lowest wide editable box; a dialog field and the
      // command palette's search input are narrower and/or higher.
      if (r.width < 300 || r.height < 16) continue
      if (r.top < 0 || r.bottom > vh + 1) continue
      if (box === null || r.bottom > box.bottom) {
        anchor = el
        box = { left: r.left, top: r.top, bottom: r.bottom, width: r.width }
      }
    }
    if (anchor === null || box === null) return null
    // The transcript's scroll viewport supplies the top edge; its *content box*
    // does not supply the horizontal span (see above). When the page shows no
    // transcript (hero layout) the zone still falls back to the composer span,
    // with the viewport top at 0.
    let top = 0
    let node: HTMLElement | null = anchor.parentElement
    while (node !== null && node !== d.body) {
      const cs = w !== null && w.getComputedStyle !== undefined ? w.getComputedStyle(node) : null
      if (cs !== null && (cs.overflowY === 'auto' || cs.overflowY === 'scroll')
        && node.clientHeight > 200 && node.clientWidth > 300) {
        top = node.getBoundingClientRect().top
        break
      }
      node = node.parentElement
    }
    const height = box.top - top
    if (height <= 0 || height > vh) return null
    return { x: box.left, y: top, w: box.width, h: height }
  }

  /** Hand the current zone to whichever renderer is live. `setFocus` is cheap:
   * it short-circuits on the same rect and rebuilds the caps only when the
   * geometry moved. With the "避让正文" toggle off we pass `null`, which is the
   * renderers' "no zone" path: no `buildFocusCaps` allocation, no `u_focus`
   * uniform — the page is uniform instead of every cell being weighted 1. */
  function pushBgFocus(): void {
    if (bgRenderer === null) return
    const rect = focusRectFor(S.cfg.bgFocus, measureFocusRect())
    try { bgRenderer.handle.setFocus(rect) } catch { /* renderer torn down */ }
  }

  function ensureBgFocusTracking(): void {
    pushBgFocus()
    // The mask is off: nothing to re-measure, so no poll is started (and a
    // previous one stops here, since this runs on every appearance repaint).
    if (S.cfg.bgFocus === false) {
      stopBgFocusTracking()
      return
    }
    if (bgFocusTimer !== null) return
    bgFocusTimer = setInterval(() => {
      if (disposed) return
      pushBgFocus()
    }, BG_FOCUS_POLL_MS)
  }

  function stopBgFocusTracking(): void {
    if (bgFocusTimer === null) return
    clearInterval(bgFocusTimer)
    bgFocusTimer = null
  }

  function syncBackgroundLayer(verdict: BgFxVerdict): void {
    applyBackgroundLayer(verdict)
    // A live renderer keeps a calm zone; without one there is nothing to mask.
    if (verdict.mount) ensureBgFocusTracking()
    else stopBgFocusTracking()
  }

  function applyBackgroundLayer(verdict: BgFxVerdict): void {
    const d = typeof document !== 'undefined' ? document : null
    if (d === null) return
    if (!verdict.mount) {
      // Tear the renderer down before the host node: it owns the canvas,
      // rAF handle, listeners, observer, atlas and level buffer.
      destroyBgRenderer()
      unmountBgLayer(d as unknown as BgLayerDocLike)
      return
    }
    const w = typeof window !== 'undefined' ? window : null
    if (w === null) return
    const host = mountBgLayer(d as unknown as BgLayerDocLike, verdict, bgLayerTint(S.cfg.bg, S.dark === true))
    // The host already normalized the id against the closed tier list; these
    // second lookups only guard a stale in-memory cfg from a newer host.
    const preset = resolveAsciiPreset(S.cfg.bgFxPreset)
    const style = resolveShaderStyle(S.cfg.bgFxPreset)
    if (verdict.tier === 'shader') {
      if (bgRenderer !== null && bgRenderer.kind === 'shader') {
        if (bgRenderer.handle.setStyle(style)) {
          bgRenderer.handle.setParams(shaderParamsFromCfg(S.cfg, style))
          bgRenderer.handle.sync()
          return
        }
        // Compile failure on a style switch: keep the old frame alive and fall
        // through to the ASCII build. `bgFxShaderBlocked` stops a retry loop.
        bgFxShaderBlocked = true
        announceBgFallback(false)
      } else {
        const previous = bgRenderer?.handle ?? null
        const handle = swapBgRenderer<AsciiBackdrop | ShaderBackdrop>(previous, () =>
          createShaderBackdrop({
            doc: d as unknown as ShaderDocLike,
            win: w as unknown as ShaderWinLike,
            host: host as unknown as ShaderHostLike,
            style,
            params: shaderParamsFromCfg(S.cfg, style),
            onFallback: onShaderFallback,
          }))
        if (handle !== null && handle !== previous) {
          bgRenderer = { kind: 'shader', handle: handle as ShaderBackdrop }
          ;(handle as ShaderBackdrop).sync()
          return
        }
        if (handle === null && previous === null) {
          // Probe said WebGL was available but context creation still failed.
          // Recompute the verdict with the tier blocked: this either mounts the
          // ASCII fallback or restores the body fill, so the transparent body
          // never survives without a renderer.
          bgFxShaderBlocked = true
          announceBgFallback(false)
          destroyBgRenderer()
          if (!disposed) applyAppearance()
          return
        }
        // Build failed but a renderer is still live (the ASCII tier): keep it.
        bgFxShaderBlocked = true
        announceBgFallback(false)
      }
    } else if (S.cfg.bgFx === 'shader') {
      // The WebGL probe failed before any context was created; the verdict
      // already chose ASCII, so make the fallback explicit to the user.
      announceBgFallback(false)
    }

    if (bgRenderer !== null && bgRenderer.kind === 'ascii') {
      bgRenderer.handle.setPreset(preset)
      bgRenderer.handle.setParams(asciiParamsFromCfg(S.cfg, preset))
      bgRenderer.handle.sync()
      return
    }
    const previous = bgRenderer?.handle ?? null
    const handle = swapBgRenderer<AsciiBackdrop | ShaderBackdrop>(previous, () => createAscii(host))
    bgRenderer = { kind: 'ascii', handle: handle as AsciiBackdrop }
    ;(handle as AsciiBackdrop).sync()
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

  // A desktop shell page can load (and this client can boot) before the host
  // has finished registering the plugin routes: the first state read then
  // fails and, without a retry, the client would run — and any later saveCfg
  // would PERSIST — factory defaults over the user's stored configuration.
  const LOAD_RETRY_DELAYS = [1500, 3000, 6000]
  let loadCfgAttempt = 0
  let loadRetryTimer: ReturnType<typeof setTimeout> | null = null
  let greetTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  // Whether a state read has ever succeeded. A save built on unloaded
  // defaults would replace stored folders/prompts/stars with factory
  // empties, so saveCfg refuses to POST until this is true.
  let cfgLoaded = false
  // Cross-window appearance sync: the host settings page can be rendered in a
  // separate webview with its own plugin instance and store. Without this, a
  // glass/background change made there never reaches the main window, and the
  // main instance's quit-save reverts it on the next launch.
  const stateChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('vx-custom-plugin-state')
  stateChannel?.addEventListener('message', (event) => {
    if (disposed) return
    const data = event.data as { type?: unknown; cfg?: unknown } | null
    if (data === null || typeof data !== 'object' || data.type !== 'cfg') return
    if (data.cfg === null || typeof data.cfg !== 'object') return
    S.cfg = { ...S.cfg, ...(data.cfg as Partial<CustomPluginConfig>) }
    setS({})
  })
  async function loadCfg(): Promise<void> {
    if (disposed) return
    if (loadRetryTimer !== null) {
      clearTimeout(loadRetryTimer)
      loadRetryTimer = null
    }
    let failure: string | null = null
    try {
      const result = await apiStateGet()
      if (result.ok === true && result.data !== undefined) {
        const data = result.data
        if (data.cfg !== undefined && data.cfg !== null) {
          const cfg = { ...S.cfg, ...data.cfg }
          delete (cfg as Record<string, unknown>).clouds
          delete (cfg as Record<string, unknown>).wind
          // Keys removed from the config surface: an old state file may still
          // carry them, and a merge would re-persist them forever.
          delete (cfg as Record<string, unknown>).timeline
          delete (cfg as Record<string, unknown>).timelineLeft
          delete (cfg as Record<string, unknown>).starsOnly
          // The aurora preset was removed; treat a stored value as "no color".
          if (cfg.bg === 'aurora') cfg.bg = 'default'
          S.cfg = cfg
        }
        if (Array.isArray(data.folders)) S.folders = data.folders
        if (Array.isArray(data.prompts)) S.prompts = data.prompts
        if (data.stars !== undefined && data.stars !== null && typeof data.stars === 'object') S.stars = data.stars
        if (data.usage !== undefined && data.usage !== null && typeof data.usage === 'object') S.usage = data.usage
        loadCfgAttempt = 0
        cfgLoaded = true
      } else if (result.ok !== true) {
        // A rejected state read used to be swallowed, which let a broken host
        // path read as "settings silently reset". Surface it.
        failure = result.error ?? '状态读取失败'
      }
    } catch (error) {
      failure = String((error as Error)?.message ?? error)
    }
    if (failure !== null) {
      apiDiagReport('loadCfg: ' + failure)
      if (loadCfgAttempt < LOAD_RETRY_DELAYS.length) {
        const delay = LOAD_RETRY_DELAYS[loadCfgAttempt]
        loadCfgAttempt++
        if (loadRetryTimer !== null) clearTimeout(loadRetryTimer)
        loadRetryTimer = setTimeout(() => {
          loadRetryTimer = null
          void loadCfg()
        }, delay)
      } else if (S.booted) {
        // Retries exhausted: now it is a real, user-visible failure.
        toast('配置读取失败：' + failure, 'error')
      }
    }
    if (disposed) return
    S.booted = true
    setS({})
    if (!S.greeted) {
      S.greeted = true
      if (greetTimer !== null) clearTimeout(greetTimer)
      greetTimer = setTimeout(() => {
        greetTimer = null
        if (disposed) return
        toast(failure !== null ? 'Custom 便利套件加载失败：' + failure : 'Custom 便利套件已就绪', failure !== null ? 'error' : 'info')
      }, 1200)
    }
  }

  function saveCfg(): void {
    if (disposed) return
    if (!cfgLoaded) {
      // The host can come up after the retry ladder has exhausted; saving
      // the factory snapshot then would wipe everything stored. Reload
      // instead of saving.
      toast('配置尚未读取完成，已重新加载，请重试', 'error')
      loadCfgAttempt = 0
      void loadCfg()
      return
    }
    const cfg = { ...S.cfg }
    delete (cfg as Record<string, unknown>).clouds
    delete (cfg as Record<string, unknown>).wind
    const edit = { cfg, folders: S.folders, prompts: S.prompts, stars: S.stars }
    void apiStateSave(edit).then((result) => {
      if (result.ok !== true) {
        // Saving used to stay quiet, so a rejected write looked like a toggle
        // that "worked". Make it loud.
        const message = result.error ?? '设置保存失败'
        apiDiagReport('saveCfg: ' + message)
        toast(message, 'error')
        return
      }
      try { stateChannel?.postMessage({ type: 'cfg', cfg: { ...S.cfg } }) } catch { /* channel closed */ }
    }).catch((error) => {
      const message = String((error as Error)?.message ?? error)
      apiDiagReport('saveCfg: ' + message)
      toast('设置保存失败：' + message, 'error')
    })
  }

  /** Slider writes land in the store immediately (the painter reads it) but
   * reach the host once, after the drag pauses. Discrete picks call `saveCfg`
   * directly, so a tier/preset switch is never left pending. */
  const bgSaveDebounced = createDebouncedSaver(() => { saveCfg() }, BG_PARAM_SAVE_MS)

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
  /** 浅色背景变体：90% 亮度的淡粉在近白的调色板背景上会消失，
   * 换成更深的玫瑰粉保持可辨识度。 */
  const SAKURA_PALETTE_LIGHT = [
    'hsla(340, 60%, 72%, 0.9)', 'hsla(342, 64%, 70%, 0.9)', 'hsla(344, 66%, 68%, 0.9)', 'hsla(346, 68%, 66%, 0.9)',
    'hsla(348, 70%, 64%, 0.9)', 'hsla(350, 66%, 66%, 0.9)', 'hsla(352, 60%, 68%, 0.9)', 'hsla(348, 52%, 70%, 0.9)',
  ]
  const SAKURA_IMAGES: HTMLImageElement[] = []
  const SAKURA_IMAGES_LIGHT: HTMLImageElement[] = []

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
  function buildSakuraSpriteSet(palette: string[], target: HTMLImageElement[]): void {
    if (target.length > 0) return
    const d = typeof document !== 'undefined' ? document : null
    const cvs = d?.createElement('canvas')
    if (cvs === undefined || cvs === null) return
    cvs.width = 48
    cvs.height = 48
    const g = cvs.getContext('2d')
    if (g === null) return
    for (const color of palette) {
      g.clearRect(0, 0, 48, 48)
      g.fillStyle = color
      tracePetal(g, 24, 24, 10, 0)
      g.fill()
      try {
        const image = new Image()
        image.src = cvs.toDataURL()
        target.push(image)
      } catch { /* toDataURL 不可用；向量路径兜底 */ }
    }
  }
  function buildSakuraSprites(): void {
    buildSakuraSpriteSet(SAKURA_PALETTE, SAKURA_IMAGES)
    buildSakuraSpriteSet(SAKURA_PALETTE_LIGHT, SAKURA_IMAGES_LIGHT)
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
  function fxFrame(g: CanvasRenderingContext2D, cvs: HTMLCanvasElement, weather: string, time: number, light: boolean): void {
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
        // 浅色背景：纯白雪花换成冷调石板灰并抬高透明度下限——近白背景上
        // 15% 透明度的白色基本不可见。
        const q = Math.round((light ? Math.min(0.9, f.opacity + 0.15) : f.opacity) * 50) / 50
        if (q !== currentOpacity) { currentOpacity = q; g.fillStyle = light ? `rgba(125,146,170,${q})` : `rgba(255,255,255,${q})` }
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
        const qo = Math.round((light ? Math.min(0.5, d.opacity + 0.08) : d.opacity) * 30) / 30
        if (qo !== currentOpacity) { currentOpacity = qo; g.strokeStyle = light ? `rgba(104,130,156,${qo})` : `rgba(180,200,220,${qo})` }
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
        g.strokeStyle = light ? 'rgba(104,130,156,0.8)' : 'rgba(180,200,220,0.8)'
        g.lineWidth = 0.8
        g.beginPath(); g.ellipse(sp.x, sp.y, sp.w, sp.h, 0, 0, Math.PI * 2); g.stroke()
        g.restore()
      }
    } else if (weather === 'sakura') {
      const imgs = light ? SAKURA_IMAGES_LIGHT : SAKURA_IMAGES
      const alpha = (f: FxParticle): number => (light ? Math.min(1, f.opacity + 0.2) : f.opacity)
      for (const f of FX.sakura) {
        f.y += f.speedY
        f.x += Math.sin(f.phase + time * f.swayFreq) * f.drift
        if (f.y > h + f.size) { f.y = -f.size; f.x = Math.random() * w }
        if (f.x > w + f.size) f.x = -f.size
        else if (f.x < -f.size) f.x = w + f.size
        const rot = Math.sin(f.phase + time * f.swayFreq * 1.7) * 0.9 + time * f.spin
        const wob = 1 + 0.12 * Math.sin(f.phase * 2 + time * f.swayFreq * 2.3)
        const img = f.spriteIndex >= 0 ? imgs[f.spriteIndex] : undefined
        if (img !== undefined) {
          g.save()
          g.globalAlpha = alpha(f)
          g.translate(f.x, f.y)
          g.rotate(rot)
          g.scale((f.size * f.wobble * wob) / 18, (f.size * f.wobble) / 18)
          g.drawImage(img, -18, -18, 36, 36)
          g.restore()
        } else {
          g.save()
          g.globalAlpha = alpha(f)
          g.translate(f.x, f.y)
          g.rotate(rot)
          g.scale((f.size * f.wobble * wob) / 10, (f.size * f.wobble) / 10)
          g.fillStyle = light ? SAKURA_PALETTE_LIGHT[0] : SAKURA_PALETTE[0]
          tracePetal(g, 0, 0, 1, 0)
          g.fill()
          g.restore()
        }
      }
    }
  }
  function FxCanvas(): React.ReactElement {
    const { weather, dark } = useSSelector(
      (state) => ({ weather: state.cfg.weather ?? 'none', dark: state.dark === true }),
      shallowEqual,
    )
    const reduced = useReducedMotion()
    const ref = React.useRef<HTMLCanvasElement | null>(null)
    /** 粒子配色跟随背景亮度：浅色主题需要更深的粒子颜色才可辨识。
     * ref 让 RAF 循环每帧读到最新值，主题/背景切换时无需重建粒子场。 */
    const lightRef = React.useRef(!dark)
    React.useEffect(() => { lightRef.current = !dark }, [dark])
    React.useEffect(() => {
      const cvs = ref.current
      if (cvs === null) return
      const g = cvs.getContext('2d')
      if (g === null) return
      const w = cvs.clientWidth || 0
      const h = cvs.clientHeight || 0
      if (!reduced) initFx(weather, w, h)
      let raf = 0
      const t0 = Date.now()
      const loop = (): void => {
        if (weather === 'none' || reduced) {
          // Off and reduce-motion both wipe the last painted frame instead of
          // leaving it frozen; neither schedules another frame.
          try { g.clearRect(0, 0, cvs.width, cvs.height) } catch { /* context lost */ }
          return
        }
        raf = requestAnimationFrame(loop)
        fxFrame(g, cvs, weather, Date.now() - t0, lightRef.current)
      }
      loop()
      return () => { try { cancelAnimationFrame(raf) } catch { /* already cancelled */ } }
    }, [weather, reduced])
    return React.createElement('canvas', { ref, className: 'vx-fx', 'aria-hidden': true })
  }

  // ================= timeline data (turn chips + search reveal) =================
  let turnsRequestSerial = 0
  const diagAtByKey = new Map<string, number>()
  function diagThrottled(message: string): void {
    // Throttle per diagnostic kind — but a kind is not a reading. Keying on the
    // first word let an unchanged reading swallow a changed one five seconds
    // later, which once read as "broken" when it was a transition nobody could
    // see. Twenty-four characters carry the counts of every throttled line we
    // emit, so identical repeats dedup while a change of reading gets through.
    const key = message.slice(0, 24)
    const now = Date.now()
    const at = diagAtByKey.get(key)
    if (at !== undefined && now - at < 5000) return
    // Session-scoped keys make this map grow with every session viewed; a
    // bounded ring is enough for a throttle table.
    if (diagAtByKey.size > 200) diagAtByKey.clear()
    diagAtByKey.set(key, now)
    reportDiag(message)
  }
  async function fetchTurns(sessionId: string): Promise<void> {
    const requestSerial = ++turnsRequestSerial
    try {
      const result = await apiTimelineGet(sessionId)
      // A slower fetch for a previously open session must not paint its turns
      // onto the newly opened one's rows.
      // The serial also protects the same session from an older polling result
      // arriving after a newer one.
      if (sessionId !== S.sessionId || requestSerial !== turnsRequestSerial || disposed) return
      if (result.ok === true) {
        const items = result.items ?? []
        const previous = S.turns !== null && S.turns.sessionId === sessionId ? S.turns : null
        // Reuse unchanged item objects: every turn-tail row subscribes to its
        // own item, so a poll that only appends one turn must not re-render
        // the other 399.
        const diff = reuseTimelineItems(previous?.items ?? null, previous !== null ? S.turnsBySeq : null, items)
        if (!diff.changed) return
        S.turns = { sessionId, items: diff.items }
        S.turnsBySeq = diff.bySeq
        setS({ turns: S.turns, turnsBySeq: diff.bySeq })
        diagThrottled('timeline ' + items.length + ' items ' + sessionId.slice(0, 24))
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
  /** Scroll the rendered message row for `seq` to the viewport center. The
   * element comes from the turnTail anchor map (our own chips register it);
   * the scrollport is resolved at call time from the shell's semantic
   * attribute, with scrollIntoView as the fallback. */
  function scrollToSeq(seq: number): void {
    const el = S.anchors.get(seq)?.el ?? null
    if (el === null) {
      toast('该消息尚未渲染，请稍后重试', 'error')
      return
    }
    const scroller = resolveScroller()
    let done = false
    if (scroller !== null) {
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
    // A stalled script load (a network black hole where neither onload nor
    // onerror ever fires) would park every later caller in the poll loop
    // forever — each new block during streaming adds another 120 ms waiter.
    // The watchdog fails the load after 30 s and drops the script tag so a
    // retry can re-add it.
    const d0 = typeof document !== 'undefined' ? document : null
    const watchdog = setTimeout(() => {
      if (mermaidState.status !== 'loading') return
      mermaidState = { status: 'failed', error: '脚本加载超时' }
      try {
        if (d0 !== null) for (const el of d0.querySelectorAll(`script[src="${MERMAID_SCRIPT_PATH}"]`)) el.remove()
      } catch { /* selector/query failed; the tag is inert without the state */ }
    }, 30000)
    try {
      const result = await apiMermaidFetch()
      if (result.ok === true) {
        await new Promise<void>((resolve, reject) => {
          const d = typeof document !== 'undefined' ? document : null
          if (d === null) { reject(new Error('no document')); return }
          const script = d.createElement('script')
          script.src = MERMAID_SCRIPT_PATH
          script.onload = () => resolve()
          script.onerror = () => {
            // Drop the failed tag so a retry does not accumulate dead scripts.
            script.remove()
            reject(new Error('script load failed'))
          }
          d.head.appendChild(script)
        })
        mermaidState = { status: 'ready' }
        // Blocks that failed while the engine was unavailable carry a fail
        // marker; now that it is ready, let them render on the next scan.
        if (d0 !== null) {
          for (const el of Array.from(d0.querySelectorAll<HTMLElement>('[data-vx-mmd-fail]'))) delete el.dataset.vxMmdFail
          if (S.cfg.mermaid === true) void mermaidScanner.scan(S.dark)
        }
        return true
      }
      mermaidState = { status: 'failed', error: result.error ?? 'unknown' }
      return false
    } catch (error) {
      mermaidState = { status: 'failed', error: String((error as Error)?.message ?? error) }
      return false
    } finally {
      clearTimeout(watchdog)
    }
  }
  const mermaidScanner = createMermaidScanner({ ensureMermaid, renderMermaid })
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

  // The host's outbound balance call shares the machine's network path with
  // TLS-intercepting proxies and security suites, so a failure is often
  // transient — retry on a short backoff before the pill settles on the last
  // error (the 60s poll in HeaderBalance keeps healing after that).
  let balanceRetryTimer: ReturnType<typeof setTimeout> | null = null
  let balanceRetries = 0
  async function refreshBalance(): Promise<void> {
    if (balanceRetryTimer !== null) { clearTimeout(balanceRetryTimer); balanceRetryTimer = null }
    try {
      const result = await apiBalanceGet()
      S.balance = result as unknown as Record<string, unknown>
      balanceRetries = 0
      // The route also carries the host's live usage ledger; fold today's row
      // in so the 「今日 N 次」 badge refreshes together with the figure.
      const usageToday = result.usageToday
      if (usageToday !== undefined && usageToday !== null && typeof usageToday === 'object') {
        S.usage = { ...S.usage }
        S.usage[dayKey()] = usageToday as Store['usage'][string]
        setS({ balance: S.balance, usage: S.usage, balanceUpdatedAt: Date.now() })
      } else {
        setS({ balance: S.balance, balanceUpdatedAt: Date.now() })
      }
    } catch (error) {
      S.balance = { ok: false, error: String((error as Error)?.message ?? error) }
      setS({ balance: S.balance })
    }
    const failed = (S.balance as { ok?: boolean }).ok === false
    const accountPending = (S.balance as { accountPending?: boolean }).accountPending === true
    const retryableError = typeof (S.balance as { accountError?: unknown }).accountError === 'string'
      && (S.balance as { accountError: string }).accountError !== ''
    if (failed && (accountPending || retryableError) && balanceRetries < 3) {
      balanceRetries++
      balanceRetryTimer = setTimeout(() => { balanceRetryTimer = null; void refreshBalance() }, balanceRetries === 1 ? 8000 : 30000)
    }
  }
  async function refreshUsageScan(silent = false): Promise<void> {
    try {
      const result = await apiUsageScan()
      if (result.ok === true) {
        S.usage = { ...S.usage }
        const scanDay = result.day || dayKey()
        S.usage[scanDay] = result.usageToday as Store['usage'][string]
        setS({ usage: S.usage })
        if (!silent) toast(`已扫描 ${scanDay} 会话日志（${String(result.scannedSessions)} 个活跃会话）`, 'info')
      } else {
        toast(result.error ?? '扫描失败', 'error')
      }
    } catch (error) {
      toast('扫描失败: ' + String((error as Error)?.message ?? error), 'error')
    }
  }
  function downloadText(content: string, fileName: string, mime: string): void {
    const d = typeof document !== 'undefined' ? document : null
    if (d === null) throw new Error('no document')
    const url = URL.createObjectURL(new Blob([content], { type: mime }))
    const a = d.createElement('a')
    a.href = url
    a.download = fileName
    d.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => { try { URL.revokeObjectURL(url) } catch { /* revoked already */ } }, 30000)
  }

  function insertPrompt(prompt: PromptItem): void {
    const vars = promptVariables(prompt.text)
    if (vars.length > 0) {
      const values: Record<string, string> = {}
      for (const name of vars) values[name] = ''
      setS({ templatePrompt: prompt, templateValues: values, promptOpen: false })
      return
    }
    const ok = S.insertDraft !== null ? S.insertDraft(prompt.text, false) : false
    if (!ok) { toast('请在会话输入框中重试', 'error'); return }
    S.prompts = S.prompts.map((item) => item.id === prompt.id ? { ...item, useCount: (item.useCount ?? 0) + 1, lastUsedAt: Date.now() } : item)
    setS({ prompts: S.prompts, promptOpen: false })
    saveCfg()
    toast('已插入提示词: ' + prompt.name, 'info')
  }

  function runExport(format: string, signal?: AbortSignal): Promise<{ ok: boolean; fileName?: string; bytes?: number }> {
    if (S.sessionId === null) { toast('当前没有打开的会话', 'error'); return Promise.resolve({ ok: false }) }
    setS({ exporting: true })
    return apiExportRun(S.sessionId, format, signal).then((result) => {
      if (result.ok !== true) {
        if (signal?.aborted !== true) toast(result.error ?? '导出失败', 'error')
        return { ok: false }
      }
      try {
        downloadText(result.content, result.fileName, result.mime)
        toast('已导出 ' + result.fileName, 'info')
        const bytes = typeof TextEncoder !== 'undefined'
          ? new TextEncoder().encode(result.content).length
          : result.content.length
        return { ok: true, fileName: result.fileName, bytes }
      } catch (error) {
        toast('导出失败: ' + String((error as Error)?.message ?? error), 'error')
        return { ok: false }
      }
    }).catch((error) => {
      if (signal?.aborted !== true) toast('导出失败: ' + String((error as Error)?.message ?? error), 'error')
      return { ok: false }
    }).finally(() => setS({ exporting: false }))
  }
  /**
   * The `ctx.remote` namespaces this plugin calls, read fail-soft so a profile
   * without the Session Remote degrades to a toast instead of throwing.
   */
  function sessionRemote(): SessionRemoteLike | undefined {
    const session = (C.get('remote') as { session?: Record<string, unknown> } | undefined)?.session
    if (session === undefined) return undefined
    if (typeof session.fork !== 'function' || typeof session.search !== 'function') return undefined
    return session as unknown as SessionRemoteLike
  }

  /** Render a Remote failure envelope as one readable line. */
  function remoteErrorMessage(error: unknown, fallback: string): string {
    if (typeof error === 'string') return error
    if (error !== null && typeof error === 'object') {
      const code = String((error as { code?: unknown }).code ?? '')
      const message = String((error as { message?: unknown }).message ?? '')
      const joined = [code, message].filter((part) => part !== '').join(': ')
      if (joined !== '') return joined
    }
    return fallback
  }

  /**
   * Navigation moved to the Workspace browser's `uiWorkspace` service: the
   * Session Controller no longer opens or selects a Session for a caller.
   */
  function workspaceNav(): WorkspaceNavLike | undefined {
    const nav = C.get('uiWorkspace') as { openSession?: unknown; connectWorkspace?: unknown } | undefined
    if (nav === undefined || typeof nav.openSession !== 'function' || typeof nav.connectWorkspace !== 'function') return undefined
    return nav as WorkspaceNavLike
  }
  async function openWorkspaceItem(id: string): Promise<void> {
    const nav = workspaceNav()
    if (nav === undefined) { toast('工作区导航服务不可用', 'error'); return }
    try {
      const sid = await nav.connectWorkspace(id)
      nav.openSession(sid)
      toast('已打开项目', 'info')
    } catch (error) {
      toast('打开项目失败: ' + String((error as Error)?.message ?? error), 'error')
    }
  }
  function openSessionItem(id: string): void {
    const nav = workspaceNav()
    if (nav === undefined) { toast('会话导航服务不可用', 'error'); return }
    try { nav.openSession(id) } catch (error) { toast('打开会话失败: ' + String((error as Error)?.message ?? error), 'error') }
  }

  // ================= components =================
  function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }): React.ReactElement {
    return React.createElement('label', { className: 'vx-toggle-row' },
      React.createElement('span', null, props.label),
      React.createElement('input', { type: 'checkbox', checked: props.checked === true, onChange: (e: React.ChangeEvent<HTMLInputElement>) => { props.onChange(e.target.checked); saveCfg() } }),
      props.hint !== undefined ? React.createElement('span', { className: 'vx-muted' }, props.hint) : null,
    )
  }

  /** `sidebar.footer.action` hands the column state down. In the 56px rail the
   * two-character label wrapped into a vertical stack beside the icon, so the
   * text renders only while the sidebar is wide; a host that passes no `wide`
   * keeps the label. */
  const foldersAnchorRef: { current: HTMLElement | null } = { current: null }

  function FolderSidebarButton(props: { wide?: boolean }): React.ReactElement {
    const open = useSSelector((state) => state.foldersOpen === true)
    return React.createElement('button', {
      className: 'vx-foot-btn',
      title: '项目文件夹',
      'aria-haspopup': 'dialog',
      'aria-expanded': open,
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
        foldersAnchorRef.current = event.currentTarget
        setS({ foldersOpen: !S.foldersOpen, panelOpen: false, promptOpen: false, balanceOpen: false })
      },
    }, React.createElement(Icon, { n: 'folder', size: 15 }), props.wide === false ? null : React.createElement('span', { className: 'vx-foot-label' }, '项目'))
  }

  function HeaderPanelButton(props: SessionScopedProps): React.ReactElement {
    useViewedSession(props)
    const open = useSSelector((state) => state.panelOpen === true)
    return React.createElement('button', {
      className: 'vx-header-btn',
      title: '个性化',
      'aria-haspopup': 'dialog',
      'aria-expanded': open,
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
        panelAnchorRef.current = event.currentTarget
        setS({ panelOpen: !S.panelOpen, foldersOpen: false, promptOpen: false, balanceOpen: false })
      },
    }, React.createElement(Icon, { n: 'sliders', size: 13 }), React.createElement('span', null, '个性化'))
  }

  /** Walk from the hidden slot anchor to the node that owns the conversation
   * column's background. The picker is pure and unit-tested; this adapter only
   * reads geometry and computed backgrounds. */
  function findColumnHost(anchor: HTMLElement): HTMLElement | null {
    const d = anchor.ownerDocument
    const w = d.defaultView
    if (w === null) return null
    const chain: HTMLElement[] = []
    let el: HTMLElement | null = anchor.parentElement
    while (el !== null && el !== d.body) {
      chain.push(el)
      el = el.parentElement
    }
    if (chain.length === 0) return null
    const candidates: ColumnHostCandidate[] = chain.map((node) => {
      const rect = node.getBoundingClientRect()
      const bg = w.getComputedStyle(node).backgroundColor
      return {
        className: typeof node.className === 'string' ? node.className : '',
        height: rect.height,
        opaque: bg !== '' && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)',
      }
    })
    const index = pickColumnHost(candidates)
    return index >= 0 ? chain[index] : null
  }

  /**
   * `ocean` paints inside the conversation column, not behind the opaque chat
   * card. The slot drops a hidden anchor into the input dock; on mount we walk
   * to the column root, insert a fixed negative-index wrapper as its first
   * child, and let the normal ASCII renderer own it. The host's
   * `isolation:isolate` is what makes a negative-index child paint above the
   * column background and below every message, without touching any other
   * surface of the app.
   *
   * There is deliberately no calm-zone mask here: the whole point of the
   * column scope is that the water is visible behind the copy. The calm zone
   * still applies to page-scoped presets.
   */
  function ColumnBgAnchor(): React.ReactElement {
    const { cfg, dark } = useSSelector(selectAppearanceSlice, shallowEqual)
    const active = bgLayerScope(cfg.bgFx, cfg.bgFxPreset) === 'conversation'
    const anchorRef = React.useRef<HTMLSpanElement | null>(null)
    const handleRef = React.useRef<AsciiBackdrop | null>(null)
    const wrapperRef = React.useRef<HTMLDivElement | null>(null)
    const tint = bgLayerTint(cfg.bg, dark === true)
    const tintRef = React.useRef(tint)
    tintRef.current = tint
    const preset = resolveAsciiPreset(cfg.bgFxPreset)
    const params = asciiParamsFromCfg(cfg, preset)
    // The renderer effect runs once per activation, so it reads the live config
    // through a ref; the focus switch has its own effect below.
    const cfgRef = React.useRef(cfg)
    cfgRef.current = cfg

    React.useEffect(() => {
      if (!active) return
      const anchor = anchorRef.current
      if (anchor === null) return
      const host = findColumnHost(anchor)
      if (host === null) {
        reportDiag('conversation column host not found; ocean column layer skipped')
        return
      }
      const wrapper = document.createElement('div')
      wrapper.setAttribute('data-vx-column-bg', '')
      wrapper.setAttribute('aria-hidden', 'true')
      wrapper.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:-1;pointer-events:none;'
      wrapper.style.setProperty('--vx-bg-tint', tintRef.current)
      wrapper.setAttribute('data-vx-bg-motion', 'animated')
      const prevPosition = host.style.position
      const prevIsolation = host.style.isolation
      if (window.getComputedStyle(host).position === 'static') host.style.position = 'relative'
      host.style.isolation = 'isolate'
      host.insertBefore(wrapper, host.firstChild)
      const syncRect = (): void => {
        const rect = host.getBoundingClientRect()
        wrapper.style.left = `${Math.round(rect.left)}px`
        wrapper.style.top = `${Math.round(rect.top)}px`
        wrapper.style.width = `${Math.round(rect.width)}px`
        wrapper.style.height = `${Math.round(rect.height)}px`
      }
      syncRect()
      const handle = createAsciiBackdrop({
        doc: document as unknown as AsciiDocLike,
        win: window as unknown as AsciiWinLike,
        host: wrapper as unknown as AsciiHostLike,
        preset: 'ocean',
        params,
      })
      // The calm zone is measured in viewport CSS px; this canvas starts at the
      // column's top-left, so the rect is shifted into host-local coordinates
      // once per measure (the same rect the page layer receives).
      const applyFocus = (): void => {
        if (cfgRef.current.bgFocus === false) {
          handle.setFocus(null)
          return
        }
        const rect = measureFocusRect()
        if (rect === null) {
          handle.setFocus(null)
          return
        }
        const hostRect = host.getBoundingClientRect()
        handle.setFocus({
          x: rect.x - hostRect.left,
          y: rect.y - hostRect.top,
          w: rect.w,
          h: rect.h,
        })
      }
      handle.sync()
      applyFocus()
      handleRef.current = handle
      wrapperRef.current = wrapper
      const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(syncRect) : null
      observer?.observe(host)
      window.addEventListener('resize', syncRect)
      // Same cadence as the page layer's poll: the composer opens, collapses
      // or the column resizes, and the mask has to move with the text.
      const focusTimer = window.setInterval(applyFocus, 350)
      return () => {
        observer?.disconnect()
        window.removeEventListener('resize', syncRect)
        window.clearInterval(focusTimer)
        handleRef.current = null
        wrapperRef.current = null
        handle.destroy()
        wrapper.remove()
        host.style.isolation = prevIsolation
        host.style.position = prevPosition
      }
      // The renderer is created once per activation; params and tint have their
      // own effects so a slider tick does not rebuild the fish or the wake.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active])

    React.useEffect(() => {
      const handle = handleRef.current
      if (handle === null) return
      if (cfg.bgFocus === false) {
        handle.setFocus(null)
        return
      }
      const rect = measureFocusRect()
      const wrapper = wrapperRef.current
      if (rect === null || wrapper === null) {
        handle.setFocus(null)
        return
      }
      const hostRect = wrapper.getBoundingClientRect()
      handle.setFocus({
        x: rect.x - hostRect.left,
        y: rect.y - hostRect.top,
        w: rect.w,
        h: rect.h,
      })
    }, [active, cfg.bgFocus])

    React.useEffect(() => {
      const handle = handleRef.current
      if (handle === null) return
      handle.setParams(asciiParamsFromCfg(cfg, resolveAsciiPreset(cfg.bgFxPreset)))
      handle.sync()
    }, [active, cfg.bgDensity, cfg.bgSpeed, cfg.bgFps, cfg.bgFontPx, cfg.bgOpacity, cfg.bgIntensity, cfg.bgStrength, cfg.bgFxPreset])

    React.useEffect(() => {
      const wrapper = wrapperRef.current
      if (wrapper === null) return
      wrapper.style.setProperty('--vx-bg-tint', tint)
      handleRef.current?.sync()
    }, [tint])

    return React.createElement('span', { ref: anchorRef, 'data-vx-column-bg-anchor': '', style: { display: 'none' } })
  }

  const promptAnchorRef: { current: HTMLElement | null } = { current: null }
  const balanceAnchorRef: { current: HTMLElement | null } = { current: null }

  function PromptQuickButton(props: SessionScopedProps): React.ReactElement {
    useViewedSession(props)
    const open = useSSelector((state) => state.promptOpen === true)
    return React.createElement('button', {
      className: 'vx-header-btn',
      title: '快速调用提示词',
      'aria-haspopup': 'dialog',
      'aria-expanded': open,
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
        promptAnchorRef.current = event.currentTarget
        setS({ promptOpen: !S.promptOpen, promptQuery: '', panelOpen: false, foldersOpen: false, balanceOpen: false })
      },
    }, React.createElement(Icon, { n: 'zap', size: 13 }), React.createElement('span', null, '提示词'))
  }

  function PromptPopover(): React.ReactElement {
    const s = useS()
    const q = (s.promptQuery ?? '').toLowerCase()
    const list = s.prompts.filter((x) => q === '' || String(x.name ?? '').toLowerCase().includes(q) || String(x.text ?? '').toLowerCase().includes(q) || (x.tags ?? []).some((tag) => tag.toLowerCase().includes(q)))
      .sort((a, b) => Number(b.favorite === true) - Number(a.favorite === true) || (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
    const favorites = list.filter((item) => item.favorite === true)
    const others = list.filter((item) => item.favorite !== true)
    const row = (x: PromptItem): React.ReactElement => React.createElement('button', {
      key: x.id,
      type: 'button',
      className: 'vx-prompt-row',
      title: x.text,
      onClick: () => insertPrompt(x),
    },
      React.createElement('span', { className: 'vx-prompt-row-name' }, x.name),
      React.createElement('span', { className: 'vx-prompt-row-text' }, x.text),
      (x.tags ?? []).length > 0
        ? React.createElement('span', { className: 'vx-prompt-row-tags' }, (x.tags ?? []).map((tag) => `#${tag}`).join(' '))
        : null,
    )
    const group = (label: string, items: PromptItem[]): React.ReactElement => React.createElement(React.Fragment, { key: label },
      React.createElement('div', { className: 'vx-pop-group' }, label),
      items.map(row),
    )
    return React.createElement(Popover, {
      open: s.promptOpen === true,
      anchor: promptAnchorRef,
      onClose: () => setS({ promptOpen: false }),
      ariaLabel: '提示词库',
      width: 340,
      maxHeight: 460,
      align: 'start',
      className: 'vx-prompt-pop',
      initialFocus: 'none',
    },
      React.createElement('div', { className: 'vx-pop-head' },
        React.createElement(Icon, { n: 'zap', size: 13 }),
        React.createElement('span', null, '提示词库'),
        React.createElement('span', { className: 'vx-badge' }, String(list.length)),
        React.createElement('span', { className: 'vx-flex1' }),
        React.createElement(IconButton, {
          label: '关闭提示词面板',
          size: 'sm',
          icon: React.createElement(Icon, { n: 'x', size: 12 }),
          onClick: () => setS({ promptOpen: false }),
        }),
      ),
      React.createElement('div', { className: 'vx-pop-search' },
        React.createElement(Icon, { n: 'search', size: 13 }),
        React.createElement('input', {
          className: 'vx-input',
          placeholder: '搜索名称、内容或标签…',
          value: s.promptQuery,
          autoFocus: true,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => setS({ promptQuery: event.target.value }),
        }),
      ),
      React.createElement('div', { className: 'vx-pop-body' },
        React.createElement('div', { className: 'vx-list vx-prompt-list' },
          list.length === 0
            ? React.createElement(EmptyState, { title: '暂无匹配提示词', hint: '在设置 → 提示词中新增，或换个关键词。' })
            : React.createElement(React.Fragment, null,
              favorites.length > 0 ? group('收藏', favorites) : null,
              others.length > 0 ? group(favorites.length > 0 ? '最近使用' : '全部', others) : null,
            ),
        ),
      ),
      React.createElement('div', { className: 'vx-pop-foot' },
        React.createElement(Button, { variant: 'ghost', size: 'sm', onClick: () => { setS({ promptOpen: false, settingsSection: 'prompts' }); openHostSettings('提示词') } }, '管理提示词'),
      ),
    )
  }

  function HeaderBalance(props: SessionScopedProps): React.ReactElement {
    useViewedSession(props)
    // Only the balance pill's own fields: a streaming turn writes turns/toasts
    // continuously and must not re-render this header or recompute the ledger.
    const { balance: b, usageRow, balanceOpen: open } = useSSelector(
      (state) => ({
        balance: state.balance,
        usageRow: state.usage[dayKey()] ?? null,
        balanceOpen: state.balanceOpen === true,
      }),
      shallowEqual,
    )
    // Initial fetch plus a refresh every minute while visible, so the balance
    // figure and the today-usage badge stay current without pressing 刷新.
    React.useEffect(() => {
      if (S.balance === null) void refreshBalance()
      const tick = (): void => {
        if (typeof document !== 'undefined' && document.hidden) return
        void refreshBalance()
      }
      const timer = setInterval(tick, 60_000)
      const onVisibility = (): void => {
        if (typeof document === 'undefined' || document.hidden) return
        void refreshBalance()
      }
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
      return () => {
        clearInterval(timer)
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
      }
    }, [])
    const usageToday: Record<string, UsageRow> = usageRow ?? {}
    const calls = React.useMemo(() => Object.keys(usageToday).reduce((n, k) => n + (usageToday[k].calls ?? 0), 0), [usageToday])
    const estimate = React.useMemo(() => Object.entries(usageToday).reduce((sum, [model, row]) => sum + estimateUsageCostCny(row, model), 0), [usageToday])
    const bal = (b?.ok === true && b.balance !== null && b.balance !== undefined)
      ? b.balance as { currency?: string, total?: string }
      : null
    const accountPending = (b as { accountPending?: unknown } | null)?.accountPending === true
    const accountSignedOut = (b as { accountSignedOut?: unknown } | null)?.accountSignedOut === true
    const accountUnavailable = (b as { accountUnavailable?: unknown } | null)?.accountUnavailable === true
    const accountError = typeof (b as { accountError?: unknown } | null)?.accountError === 'string'
      ? (b as { accountError: string }).accountError
      : null
    // The official wallet balance comes from the DSH account; local usage is
    // the fallback when signed out or while the account query settles.
    const balance = bal !== null
      ? ((bal.currency ?? 'CNY') === 'CNY' ? '¥' + (bal.total ?? '') : `${bal.total ?? ''} ${bal.currency ?? ''}`)
      : (accountPending || b === null ? '额度…' : `≈¥${estimate.toFixed(2)}`)
    const estimateTitle = `按本机 token 用量与官方价目表折算的估算值（${DEEPSEEK_PRICING_CHECKED_ON} 核对），非账号账单；登录 DSH 账号后显示官方余额`
    const pillTitle = bal !== null ? undefined
      : accountPending ? '账号余额加载中，稍后自动重试'
      : accountSignedOut ? 'DSH 账号未登录；登录后显示官方余额，当前为本机费用估算'
      : accountUnavailable ? '当前环境没有 DSH 账号余额服务，当前为本机费用估算'
      : accountError !== null ? `账号余额读取失败：${accountError}（当前为本机费用估算）`
      : b === null ? undefined
      : estimateTitle
    // Same contract as the other header surfaces: click toggles, hover does
    // nothing, and opening this closes the others. The panel itself renders
    // from OverlayRoot (`.vx-root`); rendering it inside the header put it
    // below the conversation content, where chat text painted over the card.
    const togglePanel = (): void => setS({ balanceOpen: !open, panelOpen: false, promptOpen: false, foldersOpen: false })
    return React.createElement('span', { className: 'vx-balance-wrap' },
      React.createElement('button', {
        type: 'button',
        className: 'vx-header-btn vx-balance-text' + (open ? ' vx-balance-open' : ''),
        'aria-expanded': open,
        'aria-haspopup': 'dialog',
        title: open ? '再次点击收起面板' : '点击打开面板',
        onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
          balanceAnchorRef.current = event.currentTarget
          togglePanel()
        },
      },
        React.createElement(Icon, { n: 'wallet', size: 13 }),
        React.createElement('span', { title: pillTitle }, balance),
        calls > 0 ? React.createElement('span', { className: 'vx-balance-today' }, `今日 ${calls} 次`) : null,
      ),
    )
  }

  /** Balance card at overlay level so it shares the prompt popover's surface
   *  material and stacking, instead of sitting under the chat content. */
  function BalancePopover(): React.ReactElement {
    const open = useSSelector((state) => state.balanceOpen === true)
    // Leave the composer visible: the old 600px cap reached over the input
    // dock at 1280×822. Cap against the viewport instead of a fixed number.
    const [maxHeight, setMaxHeight] = React.useState(500)
    const [scanning, setScanning] = React.useState(false)
    React.useEffect(() => {
      if (!open || typeof window === 'undefined') return
      const compute = (): void => setMaxHeight(Math.max(360, Math.min(600, window.innerHeight - 320)))
      compute()
      window.addEventListener('resize', compute)
      return () => { window.removeEventListener('resize', compute) }
    }, [open])
    const scan = async (): Promise<void> => {
      setScanning(true)
      try { await refreshUsageScan() } finally { setScanning(false) }
    }
    // The live ledger only sees events while this host runs, and a title
    // generation can land before its own request/context. The first time the
    // card is opened, replay today's logs when the ledger is empty or still
    // carries an unknown-model row, so the numbers are not silently partial.
    const autoScanned = React.useRef(false)
    React.useEffect(() => {
      if (!open || autoScanned.current) return
      autoScanned.current = true
      const today = Object.keys(S.usage[dayKey()] ?? {})
      if (today.length === 0 || today.includes('unknown')) void refreshUsageScan(true)
    }, [open])
    return React.createElement(Popover, {
      open,
      anchor: balanceAnchorRef,
      onClose: () => setS({ balanceOpen: false }),
      ariaLabel: '额度与用量',
      width: 380,
      maxHeight,
      align: 'end',
      className: 'vx-balance-pop',
    },
      React.createElement('div', { className: 'vx-pop-head' },
        React.createElement(Icon, { n: 'wallet', size: 13 }),
        React.createElement('span', null, '额度与用量'),
        React.createElement('span', { className: 'vx-flex1' }),
        React.createElement(IconButton, {
          label: '关闭额度面板',
          size: 'sm',
          icon: React.createElement(Icon, { n: 'x', size: 12 }),
          onClick: () => setS({ balanceOpen: false }),
        }),
      ),
      React.createElement('div', { className: 'vx-pop-body' },
        React.createElement(BalanceSummary, null),
      ),
      React.createElement('div', { className: 'vx-pop-foot' },
        React.createElement(Button, {
          variant: 'ghost',
          size: 'sm',
          icon: React.createElement(Icon, { n: 'refresh', size: 12 }),
          onClick: () => { void refreshBalance() },
        }, '刷新'),
        React.createElement(Button, {
          variant: 'ghost',
          size: 'sm',
          icon: React.createElement(Icon, { n: 'refresh', size: 12, cls: scanning ? 'vx-icon-spin' : '' }),
          onClick: () => { void scan() },
          disabled: scanning,
        }, scanning ? '扫描中…' : '扫描日志'),
        React.createElement('span', { className: 'vx-flex1' }),
        React.createElement(Button, {
          variant: 'ghost',
          size: 'sm',
          onClick: () => {
            setS({ balanceOpen: false, settingsSection: 'usage' })
            openHostSettings('用量与额度')
          },
        }, '完整用量'),
      ),
    )
  }

  /** One-screen summary: today's totals, the per-model table and the monthly
   *  budget. Ranges, CSV, balance details and the API key stay in the settings
   *  hub, where the same card has room for them. */
  function BalanceSummary(): React.ReactElement {
    const s = useS()
    const day = s.usage[dayKey()] ?? {}
    const models = Object.keys(day)
    const calls = models.reduce((n, model) => n + (day[model].calls ?? 0), 0)
    const tokens = models.reduce((n, model) => n + (day[model].in ?? 0) + (day[model].out ?? 0) + (day[model].cacheIn ?? 0) + (day[model].cacheW ?? 0), 0)
    const cost = models.reduce((n, model) => n + estimateUsageCostCny(day[model], model), 0)
    const b = s.balance
    const accountPending = (b as { accountPending?: unknown } | null)?.accountPending === true
    const accountSignedOut = (b as { accountSignedOut?: unknown } | null)?.accountSignedOut === true
    const accountUnavailable = (b as { accountUnavailable?: unknown } | null)?.accountUnavailable === true
    const accountError = typeof (b as { accountError?: unknown } | null)?.accountError === 'string'
      ? (b as { accountError: string }).accountError
      : null
    const balanceOk = b?.ok === true && b.balance !== null && b.balance !== undefined
    const info = balanceOk ? b.balance as { currency?: string, total?: string, granted?: string, toppedUp?: string } : null
    const sym = info === null ? '' : (info.currency ?? 'CNY') === 'CNY' ? '¥' : `${info.currency ?? ''} `
    const links = (b as { links?: { usageUrl?: string, topUpUrl?: string } } | null)?.links
    const empty = info !== null && Number(info.total ?? '0') <= 0
    return React.createElement('div', { className: 'vx-col' },
      info !== null
        ? React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'vx-pop-group' }, '可用额度'),
          React.createElement('div', { className: 'vx-balance-totals' }, `${sym}${info.total ?? '0.00'}`),
          React.createElement('div', { className: 'vx-muted' }, `赠送 ${sym}${info.granted ?? '0'} · 充值 ${sym}${info.toppedUp ?? '0'} · 来源：DSH 账号`),
          empty
            ? React.createElement('div', { className: 'vx-muted' }, '余额不足，充值后即可继续使用。')
            : null,
          links !== undefined && (links.usageUrl !== undefined || links.topUpUrl !== undefined)
            ? React.createElement('div', { className: 'vx-row wrap' },
              links.usageUrl !== undefined
                ? React.createElement('a', { className: 'vx-link', href: links.usageUrl, target: '_blank', rel: 'noreferrer' }, '用量明细')
                : null,
              links.topUpUrl !== undefined
                ? React.createElement('a', { className: 'vx-link', href: links.topUpUrl, target: '_blank', rel: 'noreferrer' }, '充值')
                : null,
            )
            : null,
        )
        : null,
      accountPending
        ? React.createElement('div', { className: 'vx-muted' }, '账号余额加载中，稍后自动重试；当前显示本机费用估算。')
        : null,
      accountSignedOut
        ? React.createElement('div', { className: 'vx-muted' }, 'DSH 账号未登录；请到 设置 → 账号与余额 登录，登录后自动显示官方余额。当前显示本机费用估算。')
        : null,
      accountUnavailable
        ? React.createElement('div', { className: 'vx-muted' }, '当前环境没有 DSH 账号余额服务；当前显示本机费用估算。')
        : null,
      accountError !== null && accountError !== ''
        ? React.createElement('div', { className: 'vx-error' }, `账号余额读取失败：${accountError}`)
        : null,
      models.length === 0
        ? React.createElement('div', { className: 'vx-muted' }, '今日暂无 token 用量记录；会话产生用量后会自动累计，也可点「扫描日志」从本机会话补算。')
        : React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'vx-pop-group' }, '今日用量'),
          React.createElement('div', { className: 'vx-balance-totals' }, `${formatTokenCount(tokens)} token · ${calls} 次调用 · 估算 ¥${cost.toFixed(4)}`),
          React.createElement(UsageTable, { compact: true }),
        ),
      React.createElement('div', { className: 'vx-pop-group' }, '本月预算'),
      React.createElement(BudgetMeter, {
        usage: s.usage,
        budget: Math.max(0, Number(s.cfg.monthlyBudgetCny ?? 0)),
        warning: Math.max(1, Math.min(100, Number(s.cfg.budgetWarningPercent ?? 80))),
      }),
      React.createElement('div', { className: 'vx-muted vx-balance-hint' }, '用量来自本机会话记录，费用为按官方价目折算的估算值，非账号账单。'),
    )
  }

  /** Monthly budget line + ratio bar. Shared by the settings history and the
   *  header balance card so both surfaces report the same month and the same
   *  progress track. */
  function BudgetMeter(props: { usage: Store['usage']; budget: number; warning: number }): React.ReactElement {
    const { ratio, state } = React.useMemo(() => {
      const prefix = dayKey().slice(0, 7) + '-'
      const days = new Set(Object.keys(props.usage).filter((day) => day.startsWith(prefix)))
      const month = summarizeUsage(props.usage, days)
      const ratio = props.budget > 0 && month.exact ? month.costCny / props.budget * 100 : 0
      return { ratio, state: budgetState(month, props.budget, props.warning) }
    }, [props.usage, props.budget, props.warning])
    const text = state === 'disabled'
      ? '预算提醒已关闭'
      : state === 'unknown'
        ? '历史峰闲数据不完整，无法判断预算'
        : state === 'over'
          ? `已超出月预算（${ratio.toFixed(0)}%）`
          : state === 'warning'
            ? `已达到月预算 ${ratio.toFixed(0)}%`
            : `本月预算使用 ${ratio.toFixed(0)}%`
    return React.createElement(React.Fragment, null,
      React.createElement('div', { className: state === 'over' ? 'vx-error' : 'vx-muted' }, text),
      state === 'disabled' || state === 'unknown'
        ? null
        : React.createElement('div', {
          className: 'vx-budget-track',
          role: 'progressbar',
          'aria-label': '本月预算使用比例',
          'aria-valuemin': 0,
          'aria-valuemax': 100,
          'aria-valuenow': Math.min(100, Math.round(ratio)),
        }, React.createElement('div', { className: 'vx-budget-fill' + (state === 'over' || state === 'warning' ? ' over' : ''), style: { width: `${Math.min(100, Math.max(0, ratio))}%` } })),
    )
  }

  function UsageTable(props: { compact?: boolean }): React.ReactElement {
    const s = useS()
    const day = s.usage[dayKey()] ?? {}
    const models = Object.keys(day)
    if (models.length === 0) return React.createElement('div', { className: 'vx-muted' }, '今日暂无 token 用量记录')
    const rows = models.map((model) => ({ model, row: day[model], breakdown: usageCostBreakdown(day[model], model) }))
    const allSplitsKnown = rows.every((item) => item.breakdown.exact)
    const totalPeakTokens = rows.reduce((sum, item) => sum + item.breakdown.peakTokens, 0)
    const totalOffPeakTokens = rows.reduce((sum, item) => sum + item.breakdown.offPeakTokens, 0)
    const totalPeakCost = rows.reduce((sum, item) => sum + item.breakdown.peakCostCny, 0)
    const totalOffPeakCost = rows.reduce((sum, item) => sum + item.breakdown.offPeakCostCny, 0)
    return React.createElement('div', null,
      React.createElement('table', { className: 'vx-table' },
        React.createElement('thead', null, React.createElement('tr', null,
          React.createElement('th', null, '模型'),
          React.createElement('th', { title: '未命中缓存的输入 tokens' }, '输入'),
          React.createElement('th', { title: '缓存命中输入 tokens' }, '缓存'),
          React.createElement('th', null, '输出'),
          React.createElement('th', null, '调用'),
          React.createElement('th', null, '费用 ¥'),
        )),
        React.createElement('tbody', null, rows.map(({ model, row, breakdown }) => {
          return React.createElement('tr', { key: model },
            React.createElement('td', { title: model }, model),
            React.createElement('td', null, formatTokenCount(row.in ?? 0)),
            React.createElement('td', null, formatTokenCount(row.cacheIn ?? 0)),
            React.createElement('td', null, formatTokenCount(row.out ?? 0)),
            React.createElement('td', null, row.calls ?? 0),
            React.createElement('td', { title: breakdown.exact ? `峰时 ¥${breakdown.peakCostCny.toFixed(6)} · 空闲 ¥${breakdown.offPeakCostCny.toFixed(6)}` : '旧用量缺少峰闲时拆分，请先扫描今日会话日志' }, breakdown.exact ? breakdown.totalCostCny.toFixed(4) : '—'),
          )
        })),
      ),
      props.compact === true
        ? null
        : React.createElement(React.Fragment, null,
          allSplitsKnown
            ? React.createElement('div', { className: 'vx-muted' }, `峰时 token ${formatTokenCount(totalPeakTokens)} · 空闲 token ${formatTokenCount(totalOffPeakTokens)} · 峰时费用 ¥${totalPeakCost.toFixed(4)} · 空闲费用 ¥${totalOffPeakCost.toFixed(4)}`)
            : React.createElement('div', { className: 'vx-muted' }, '部分旧用量缺少峰闲时拆分，费用暂不估算；请先扫描今日会话日志。'),
          React.createElement('div', { className: 'vx-muted' }, `${DEEPSEEK_PRICING_NOTE}（${DEEPSEEK_PRICING_CHECKED_ON} 核对）· `,
            React.createElement('a', { href: DEEPSEEK_PRICING_SOURCE_URL, target: '_blank', rel: 'noreferrer' }, 'DeepSeek 官方价目'),
            ' · 费用仅供参考',
          ),
        ),
    )
  }

  function recentDayKeys(count: number): string[] {
    const keys: string[] = []
    for (let i = count - 1; i >= 0; i--) keys.push(dayKey(Date.now() - i * 86_400_000))
    return keys
  }

  function UsageHistory(): React.ReactElement {
    const s = useS()
    // summarizeUsage walks every day/model row once per call; with the 90-day
    // range that is dozens of passes, and the budget inputs re-render this
    // component on every keystroke. The memo keys cover both inputs that
    // change the result; budget keystrokes change neither.
    const { summary, daily, maxTokens, byModel } = React.useMemo(() => {
      const keys = recentDayKeys(s.usageRange)
      const selected = new Set(keys)
      const summary = summarizeUsage(s.usage, selected)
      const daily = keys.map((day) => ({ day, ...summarizeUsage(s.usage, new Set([day])) }))
      const maxTokens = Math.max(1, ...daily.map((row) => row.tokens))
      const byModel: Record<string, UsageRow> = Object.create(null) as Record<string, UsageRow>
      for (const day of keys) {
        for (const [model, row] of Object.entries(s.usage[day] ?? {})) {
          const target = byModel[model] ?? (byModel[model] = createUsageRow())
          mergeUsageRow(target, row)
        }
      }
      return { summary, daily, maxTokens, byModel }
    }, [s.usage, s.usageRange])
    const budget = Math.max(0, Number(s.cfg.monthlyBudgetCny ?? 0))
    const warning = Math.max(1, Math.min(100, Number(s.cfg.budgetWarningPercent ?? 80)))
    return React.createElement('div', { className: 'vx-col' },
      React.createElement('div', { className: 'vx-row wrap' },
        React.createElement(Segmented, {
          value: String(s.usageRange),
          options: [{ value: '7', label: '7 天' }, { value: '30', label: '30 天' }, { value: '90', label: '90 天' }],
          onChange: (value) => setS({ usageRange: Number(value) as 7 | 30 | 90 }),
          ariaLabel: '用量统计范围',
        }),
        React.createElement('span', { className: 'vx-flex1' }),
        React.createElement('button', { className: 'vx-btn', onClick: () => { try { downloadText(usageCsv(s.usage), `custom-usage-${dayKey()}.csv`, 'text/csv;charset=utf-8') } catch { toast('CSV 导出失败', 'error') } } }, React.createElement(Icon, { n: 'download', size: 12 }), ' CSV'),
      ),
      React.createElement('div', { className: 'vx-balance-lines' },
        React.createElement('div', null, `${formatTokenCount(summary.tokens)} token · ${summary.calls} 次调用 · ${summary.exact ? `¥${summary.costCny.toFixed(4)}` : '费用不精确'}`),
      ),
      React.createElement('div', { className: 'vx-col', style: { gap: 3 } }, daily.map((row) => React.createElement('div', { key: row.day, className: 'vx-row', title: `${row.day} · ${formatTokenCount(row.tokens)} token · ${row.calls} 次` },
        React.createElement('span', { className: 'vx-muted', style: { width: 46 } }, row.day.slice(5)),
        React.createElement('span', { className: 'vx-bar-track' },
          React.createElement('span', { className: 'vx-bar-fill', style: { width: `${Math.max(1, row.tokens / maxTokens * 100)}%` } }),
        ),
      ))),
      Object.keys(byModel).length > 0 ? React.createElement('table', { className: 'vx-table' },
        React.createElement('thead', null, React.createElement('tr', null, React.createElement('th', null, '模型'), React.createElement('th', null, 'Token'), React.createElement('th', null, '调用'), React.createElement('th', null, '费用 ¥'))),
        React.createElement('tbody', null, Object.entries(byModel).map(([model, row]) => { const cost = usageCostBreakdown(row, model); return React.createElement('tr', { key: model }, React.createElement('td', null, model), React.createElement('td', null, formatTokenCount(row.in + row.out + row.cacheIn + row.cacheW)), React.createElement('td', null, row.calls), React.createElement('td', null, cost.exact ? cost.totalCostCny.toFixed(4) : '—')) })),
      ) : null,
      React.createElement(BudgetMeter, { usage: s.usage, budget, warning }),
      React.createElement('div', { className: 'vx-row wrap' },
        React.createElement('label', { className: 'vx-muted' }, '月预算 ¥ ', React.createElement('input', { className: 'vx-input', style: { width: 100 }, type: 'number', min: 0, step: 1, value: budget, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setS({ cfg: { ...S.cfg, monthlyBudgetCny: Math.max(0, Number(e.target.value) || 0) } }), onBlur: saveCfg })),
        React.createElement('label', { className: 'vx-muted' }, '预警 ', React.createElement('input', { className: 'vx-input', style: { width: 72 }, type: 'number', min: 1, max: 100, value: warning, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setS({ cfg: { ...S.cfg, budgetWarningPercent: Math.max(1, Math.min(100, Number(e.target.value) || 80)) } }), onBlur: saveCfg }), ' %'),
      ),
    )
  }

  function BalancePanelContent(): React.ReactElement {
    const s = useS()
    const b = s.balance
    const [scanning, setScanning] = React.useState(false)
    const accountPending = (b as { accountPending?: unknown } | null)?.accountPending === true
    const accountSignedOut = (b as { accountSignedOut?: unknown } | null)?.accountSignedOut === true
    const accountUnavailable = (b as { accountUnavailable?: unknown } | null)?.accountUnavailable === true
    const accountError = typeof (b as { accountError?: unknown } | null)?.accountError === 'string'
      ? (b as { accountError: string }).accountError
      : null
    const balanceOk = b?.ok === true && b.balance !== null && b.balance !== undefined
    const info = balanceOk ? b.balance as { currency?: string, total?: string, granted?: string, toppedUp?: string } : null
    const sym = info === null ? '' : (info.currency ?? 'CNY') === 'CNY' ? '¥' : `${info.currency ?? ''} `
    const links = (b as { links?: { usageUrl?: string, topUpUrl?: string } } | null)?.links
    const empty = info !== null && Number(info.total ?? '0') <= 0
    const badge = accountPending
      ? React.createElement(Badge, null, '账号余额加载中')
      : accountSignedOut
        ? React.createElement(Badge, null, '账号未登录')
        : accountError !== null && accountError !== ''
          ? React.createElement(Badge, { tone: 'danger' }, '余额读取失败')
          : null
    const scan = async (): Promise<void> => {
      setScanning(true)
      try { await refreshUsageScan() } finally { setScanning(false) }
    }
    return React.createElement('div', { className: 'vx-col' },
      React.createElement('div', { className: 'vx-row wrap' },
        React.createElement(Button, { variant: 'secondary', size: 'sm', onClick: () => { void refreshBalance() } }, '刷新余额'),
        React.createElement(Button, { variant: 'ghost', size: 'sm', onClick: () => { void scan() }, disabled: scanning },
          scanning ? React.createElement(Spinner, { label: '扫描中' }) : null, scanning ? ' 扫描中…' : '扫描今日日志'),
        React.createElement('span', { className: 'vx-flex1' }),
        React.createElement('span', { className: 'vx-muted' }, s.balanceUpdatedAt === null
          ? '尚未读取账号余额'
          : `更新于 ${new Date(s.balanceUpdatedAt).toLocaleTimeString('zh-CN')}`),
        badge,
      ),
      React.createElement('div', { className: 'vx-section-title' }, '账号余额'),
      info !== null
        ? React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'vx-balance-totals' }, `可用额度 ${sym}${info.total ?? '0.00'}`),
          React.createElement('div', { className: 'vx-muted' }, `赠送 ${sym}${info.granted ?? '0'} · 充值 ${sym}${info.toppedUp ?? '0'}`),
          React.createElement('div', { className: 'vx-muted' }, '余额来源：DSH 账号余额（与「设置 → 账号与余额」一致）'),
          empty ? React.createElement('div', { className: 'vx-muted' }, '余额不足，充值后即可继续使用。') : null,
          links !== undefined && (links.usageUrl !== undefined || links.topUpUrl !== undefined)
            ? React.createElement('div', { className: 'vx-row wrap' },
              links.usageUrl !== undefined
                ? React.createElement('a', { className: 'vx-link', href: links.usageUrl, target: '_blank', rel: 'noreferrer' }, '用量明细')
                : null,
              links.topUpUrl !== undefined
                ? React.createElement('a', { className: 'vx-link', href: links.topUpUrl, target: '_blank', rel: 'noreferrer' }, '充值')
                : null,
            )
            : null,
        )
        : b === null
          ? React.createElement('div', { className: 'vx-muted' }, '点「刷新余额」读取 DSH 账号余额。')
          : null,
      accountPending
        ? React.createElement('div', { className: 'vx-muted' }, '账号余额加载中，稍后自动重试。')
        : null,
      accountSignedOut
        ? React.createElement('div', { className: 'vx-muted' }, 'DSH 账号未登录；请到「设置 → 账号与余额」登录，登录后这里会自动显示官方余额。')
        : null,
      accountUnavailable
        ? React.createElement('div', { className: 'vx-muted' }, '当前环境没有 DSH 账号余额服务。')
        : null,
      accountError !== null && accountError !== ''
        ? React.createElement('div', { className: 'vx-error' }, `账号余额读取失败：${accountError}，请点「刷新余额」重试。`)
        : null,
      React.createElement('div', { className: 'vx-section-title' }, '用量趋势与预算'),
      React.createElement(UsageHistory, null),
      React.createElement('div', { className: 'vx-section-title' }, '今日模型明细'),
      React.createElement(UsageTable, null),
    )
  }

  function InputBridge(props: InputBridgeProps): React.ReactElement | null {
    useViewedSession(props)
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
    return null
  }

  function TurnTailEntry(props: TurnTailProps): React.ReactElement {
    useViewedSession(props)
    const seq = typeof props.seq === 'number' ? props.seq : null
    const turn = props.turn
    const { item, formula, mermaid } = useSSelector((state) => ({
      item: seq !== null && state.turns !== null && state.turns.sessionId === state.sessionId
        ? state.turnsBySeq?.get(seq) ?? null
        : null,
      formula: state.cfg.formula === true,
      mermaid: state.cfg.mermaid === true,
    }), shallowEqual)
    let registered: HTMLElement | null = null
    const btns: React.ReactElement[] = []
    if (item !== null && formula) {
      if (item.hasLatex === true) btns.push(React.createElement('button', { key: 'lx', className: 'vx-chip', title: '复制 LaTeX 公式', onClick: () => void copyLatexOf(item) }, React.createElement(Icon, { n: 'copy', size: 11 }), ' LaTeX'))
      if (item.hasMathml === true) btns.push(React.createElement('button', { key: 'mm', className: 'vx-chip', title: '复制 MathML（可粘贴到 Word）', onClick: () => void copyMathmlOf(item) }, React.createElement(Icon, { n: 'copy', size: 11 }), ' MathML'))
    }
    if (item !== null && mermaid && item.hasMermaid === true) {
      btns.push(React.createElement('button', { key: 'md', className: 'vx-chip', title: '渲染 Mermaid 图表', onClick: () => openMermaidOf(item) }, React.createElement(Icon, { n: 'gitBranch', size: 11 }), ' Mermaid'))
    }
    return React.createElement('span', {
      className: 'vx-anchor',
      'data-vx-seq': seq === null ? '' : String(seq),
      ref: (el: HTMLSpanElement | null): void => {
        if (el !== null && seq !== null) {
          registered = el
          S.anchors.set(seq, { el, turn: turn ?? null })
        } else if (el === null && seq !== null) {
          // A session switch can unmount an old row after a new row with the
          // same sequence has mounted. Delete only the element this callback
          // registered, never the replacement anchor.
          if (S.anchors.get(seq)?.el === registered) S.anchors.delete(seq)
          registered = null
        }
      },
    }, btns.length > 0 ? React.createElement('span', { className: 'vx-turn-actions' }, btns) : null)
  }
  function FolderNode(props: { node: FolderNode; useSessions: OverlayProps['useSessions']; useWorkspaces: OverlayProps['useWorkspaces'] }): React.ReactElement {
    const { folderAdd, folderWsPick, dropHint } = useSSelector(
      (state) => ({ folderAdd: state.folderAdd, folderWsPick: state.folderWsPick, dropHint: state.dropHint }),
      shallowEqual,
    )
    const node = props.node
    const [open, setOpen] = React.useState(true)
    const sessions = useSessionsSafe(props)
    const byId = sessions !== null ? (sessions.byId as unknown as Record<string, { displayTitle?: string; title?: string; running?: boolean }>) : {}
    const workspaces = useWorkspacesSafe(props)
    const wsItems = workspaces !== null && workspaces.items !== undefined ? (workspaces.items as unknown as WorkspaceRowLike[]) : []
    const wsTitle = (w: WorkspaceRowLike): string => w.title || w.path || w.workspaceId
    const [renaming, setRenaming] = React.useState(false)
    const [draftName, setDraftName] = React.useState(node.name)
    const beginRename = (): void => {
      setDraftName(node.name)
      setRenaming(true)
    }
    const commitRename = (): void => {
      if (!renaming) return
      setRenaming(false)
      if (draftName.trim() === '' || draftName.trim() === node.name) { setDraftName(node.name); return }
      setS({ folders: renameFolderNode(S.folders, node.id, draftName) })
      saveCfg()
    }
    const addChildFolder = (): void => {
      askText('文件夹名称：', '', (name) => {
        const trimmed = name.trim()
        if (trimmed === '') return
        setS({
          folders: addFolderNode(S.folders, node.id, {
            id: 'f' + Date.now() + Math.floor(Math.random() * 9999),
            name: trimmed,
            children: [],
            sessionIds: [],
            workspaceIds: [],
            prompts: [],
          }),
        })
        saveCfg()
      })
    }
    const delFolder = (): void => {
      askConfirm(`删除文件夹「${node.name}」及其子文件夹？（会话与提示词不会被删除）`, (ok) => {
        if (!ok) return
        setS({ folders: deleteFolderNode(S.folders, node.id) })
        saveCfg()
      })
    }
    const removeRef = (kind: 'session' | 'workspace', id: string): void => {
      const folders = cloneFolders(S.folders)
      const target = findFolder(folders, node.id)
      if (target === null) return
      if (kind === 'session') target.sessionIds = (target.sessionIds ?? []).filter((x) => x !== id)
      else target.workspaceIds = (target.workspaceIds ?? []).filter((x) => x !== id)
      setS({ folders })
      saveCfg()
    }
    const moveNode = (srcId: string, targetId: string, mode: string): void => {
      if (srcId === '' || srcId === targetId) return
      const zone = mode === 'before' || mode === 'after' ? mode : 'inside'
      setS({ folders: moveFolderNode(S.folders, srcId, targetId, zone) })
      saveCfg()
    }
    const moveSelf = (direction: -1 | 1): void => {
      setS({ folders: moveFolderOrder(S.folders, node.id, direction) })
      saveCfg()
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
    const adding = folderAdd === node.id
    const pickingWs = folderWsPick === node.id
    const hintZone = dropHint !== null && dropHint.id === node.id ? dropHint.zone : null
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
        renaming
          ? React.createElement('input', {
            className: 'vx-input vx-rename-input',
            value: draftName,
            autoFocus: true,
            'aria-label': '文件夹名称',
            onClick: (e: React.MouseEvent) => e.stopPropagation(),
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraftName(e.currentTarget.value),
            onBlur: commitRename,
            onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename() }
              else if (e.key === 'Escape') { e.preventDefault(); setRenaming(false); setDraftName(node.name) }
            },
          })
          : React.createElement('span', {
            className: 'vx-folder-name',
            title: node.name,
            onDoubleClick: (e: React.MouseEvent) => { e.stopPropagation(); beginRename() },
          }, node.name),
        React.createElement('span', { className: 'vx-badge' }, folderCount(node)),
        React.createElement('button', { className: 'vx-mini', title: '上移', 'aria-label': '上移文件夹', onClick: (e: React.MouseEvent) => { e.stopPropagation(); moveSelf(-1) } }, React.createElement(Icon, { n: 'arrowUp', size: 11 })),
        React.createElement('button', { className: 'vx-mini', title: '下移', 'aria-label': '下移文件夹', onClick: (e: React.MouseEvent) => { e.stopPropagation(); moveSelf(1) } }, React.createElement(Icon, { n: 'arrowDown', size: 11 })),
        React.createElement('button', { className: 'vx-mini', title: '重命名', 'aria-label': '重命名文件夹', onClick: (e: React.MouseEvent) => { e.stopPropagation(); beginRename() } }, React.createElement(Icon, { n: 'pencil', size: 11 })),
        React.createElement('button', { className: 'vx-mini', title: '删除', 'aria-label': '删除文件夹', onClick: (e: React.MouseEvent) => { e.stopPropagation(); delFolder() } }, React.createElement(Icon, { n: 'trash', size: 11 })),
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
    const [query, setQuery] = React.useState('')
    const addRoot = (): void => {
      askText('文件夹名称：', '', (name) => {
        const trimmed = name.trim()
        if (trimmed === '') return
        setS({
          folders: addFolderNode(S.folders, null, {
            id: 'f' + Date.now() + Math.floor(Math.random() * 9999),
            name: trimmed,
            children: [],
            sessionIds: [],
            workspaceIds: [],
            prompts: [],
          }),
        })
        saveCfg()
      })
    }
    const visible = filterFolders(S.folders, query)
    return React.createElement('div', { className: 'vx-col' },
      React.createElement('div', { className: 'vx-toolbar' },
        React.createElement('input', {
          className: 'vx-input',
          placeholder: '搜索文件夹或引用…',
          value: query,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.currentTarget.value),
        }),
        React.createElement(Button, { variant: 'primary', size: 'sm', onClick: addRoot }, '新建文件夹'),
      ),
      S.folders.length === 0
        ? React.createElement(EmptyState, {
          title: '还没有文件夹',
          hint: '新建一个文件夹，把常用会话、工作区和提示词收在一起。',
          action: React.createElement(Button, { variant: 'primary', size: 'sm', onClick: addRoot }, '新建文件夹'),
        })
        : (visible.length === 0
          ? React.createElement(EmptyState, { title: '没有匹配的文件夹', hint: '换个关键词，或清空搜索。' })
          : React.createElement('div', { className: 'vx-folder-list' },
            visible.map((folder) => React.createElement(FolderNode, { key: folder.id, node: folder, useSessions: props.useSessions, useWorkspaces: props.useWorkspaces })),
          )),
    )
  }

  function PromptEditorDialog(props: { open: boolean; item: PromptItem | null; onClose: () => void }): React.ReactElement {
    const [name, setName] = React.useState('')
    const [text, setText] = React.useState('')
    const [tags, setTags] = React.useState('')
    const [favorite, setFavorite] = React.useState(false)
    const [errors, setErrors] = React.useState<string[]>([])
    const [confirmDiscard, setConfirmDiscard] = React.useState(false)
    React.useEffect(() => {
      if (!props.open) return
      setName(props.item?.name ?? '')
      setText(props.item?.text ?? '')
      setTags((props.item?.tags ?? []).join(', '))
      setFavorite(props.item?.favorite === true)
      setErrors([])
      setConfirmDiscard(false)
    }, [props.open, props.item?.id])
    const baseline = {
      name: props.item?.name ?? '',
      text: props.item?.text ?? '',
      tags: (props.item?.tags ?? []).join(', '),
      favorite: props.item?.favorite === true,
    }
    const dirty = name !== baseline.name || text !== baseline.text || tags !== baseline.tags || favorite !== baseline.favorite
    const requestClose = (): void => {
      if (!dirty) { props.onClose(); return }
      setConfirmDiscard(true)
    }
    const save = (): void => {
      const draft = { name: name.trim(), text, tags: normalizeTags(tags) }
      const issues = validatePromptDraft(draft)
      if (issues.length > 0) { setErrors(issues); return }
      const item: PromptItem = props.item === null
        ? { id: 'p' + Date.now() + Math.floor(Math.random() * 9999), ...draft, favorite, useCount: 0 }
        : { ...props.item, ...draft, favorite }
      S.prompts = props.item === null
        ? S.prompts.concat(item)
        : S.prompts.map((old) => old.id === item.id ? item : old)
      setS({ prompts: S.prompts })
      saveCfg()
      setConfirmDiscard(false)
      props.onClose()
    }
    return React.createElement(Dialog, {
      open: props.open,
      onClose: requestClose,
      title: props.item === null ? '新增提示词' : '编辑提示词',
      description: '支持 {{变量}} 模板；插入时会要求填写。',
      size: 'md',
      footer: React.createElement(React.Fragment, null,
        React.createElement(Button, { variant: 'ghost', onClick: requestClose }, '取消'),
        React.createElement(Button, { variant: 'primary', onClick: save }, '保存'),
      ),
    },
      confirmDiscard
        ? React.createElement('div', { className: 'vx-discard-bar', role: 'alert' },
          React.createElement('span', { className: 'vx-flex1' }, '有未保存的修改。'),
          React.createElement(Button, { variant: 'ghost', size: 'sm', onClick: () => setConfirmDiscard(false) }, '继续编辑'),
          React.createElement(Button, { variant: 'danger', size: 'sm', onClick: () => { setConfirmDiscard(false); props.onClose() } }, '放弃修改'),
        )
        : null,
      errors.length > 0 ? React.createElement('div', { className: 'vx-field-error', role: 'alert' }, errors.join('；')) : null,
      React.createElement(Field, { label: '名称', htmlFor: 'vx-prompt-name' },
        React.createElement('input', {
          id: 'vx-prompt-name',
          className: 'vx-input',
          value: name,
          autoFocus: true,
          'data-autofocus': true,
          placeholder: '例如：周报总结',
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => setName(event.currentTarget.value),
        }),
      ),
      React.createElement(Field, { label: '内容', htmlFor: 'vx-prompt-content' },
        React.createElement('textarea', {
          id: 'vx-prompt-content',
          className: 'vx-input vx-textarea',
          rows: 8,
          value: text,
          placeholder: '输入提示词正文；可用 {{主题}} 这样的变量。',
          onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => setText(event.currentTarget.value),
          onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save() }
          },
        }),
      ),
      React.createElement(Field, { label: '标签', hint: '用逗号分隔，例如：写作, 周报', htmlFor: 'vx-prompt-tags' },
        React.createElement('input', {
          id: 'vx-prompt-tags',
          className: 'vx-input',
          value: tags,
          placeholder: '写作, 周报',
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => setTags(event.currentTarget.value),
        }),
      ),
      React.createElement(Switch, { label: '收藏', checked: favorite, onChange: setFavorite, hint: '收藏项会显示在快捷面板顶部。' }),
    )
  }

  function PromptsTab(): React.ReactElement {
    const s = useS()
    const [query, setQuery] = React.useState('')
    const [tag, setTag] = React.useState<string | null>(null)
    const [favoritesOnly, setFavoritesOnly] = React.useState(false)
    const [sort, setSort] = React.useState<PromptSort>('manual')
    const [editor, setEditor] = React.useState<PromptItem | 'new' | null>(null)
    const [importState, setImportState] = React.useState<{ fileName: string; incoming: PromptItem[]; invalid: number } | null>(null)
    const [importMode, setImportMode] = React.useState<PromptImportMode>('merge')
    const dragId = React.useRef<string | null>(null)
    const tags = allTags(s.prompts)
    const visible = sortPrompts(filterPrompts(s.prompts, { query, tag, favoritesOnly }), sort)
    const savePrompts = (next: PromptItem[]): void => {
      S.prompts = next
      setS({ prompts: next })
      saveCfg()
    }
    const delPrompt = (prompt: PromptItem): void => {
      const index = S.prompts.findIndex((item) => item.id === prompt.id)
      savePrompts(S.prompts.filter((item) => item.id !== prompt.id))
      toast(`已删除「${prompt.name}」`, 'info', {
        label: '撤销',
        run: () => {
          const next = S.prompts.slice()
          next.splice(Math.max(0, Math.min(index, next.length)), 0, prompt)
          savePrompts(next)
        },
      })
    }
    const toggleFavorite = (prompt: PromptItem): void => {
      savePrompts(S.prompts.map((item) => item.id === prompt.id ? { ...item, favorite: item.favorite !== true } : item))
    }
    const parseImport = async (file: File): Promise<void> => {
      try {
        const text = await file.text()
        let incoming: PromptItem[]
        let invalid = 0
        if (/\.md$/i.test(file.name)) incoming = parsePromptsMarkdown(text)
        else {
          const doc = JSON.parse(text) as { format?: unknown; version?: unknown; prompts?: unknown }
          if (doc.format !== 'dsh-custom-plugin-prompts' || doc.version !== 1 || !Array.isArray(doc.prompts)) throw new Error('不支持的提示词文件')
          incoming = doc.prompts.map(normalizePromptItem).filter((item): item is PromptItem => item !== null)
          invalid = doc.prompts.length - incoming.length
        }
        // A portable file may repeat an id; keep the last occurrence once so
        // the conflict result is deterministic.
        incoming = [...new Map(incoming.map((item) => [item.id, item])).values()]
        setImportMode('merge')
        setImportState({ fileName: file.name, incoming, invalid })
      } catch (error) {
        toast('提示词导入失败: ' + String((error as Error)?.message ?? error), 'error')
      }
    }
    const confirmImport = (): void => {
      if (importState === null) return
      const result = mergePromptImport(S.prompts, importState.incoming, importMode)
      savePrompts(result.next)
      setImportState(null)
      toast(importMode === 'replace' ? `已替换为 ${result.next.length} 条提示词` : `已导入 ${result.added} 条、更新 ${result.updated} 条`, 'info')
    }
    const movePrompt = (fromId: string, toId: string): void => {
      if (fromId === toId) return
      const next = S.prompts.slice()
      const oldIndex = next.findIndex((item) => item.id === fromId)
      const newIndex = next.findIndex((item) => item.id === toId)
      if (oldIndex < 0 || newIndex < 0) return
      const moved = next.splice(oldIndex, 1)[0]
      next.splice(newIndex, 0, moved)
      savePrompts(next)
    }
    const card = (p: PromptItem): React.ReactElement => React.createElement('div', {
      key: p.id,
      className: 'vx-prompt-card',
      draggable: sort === 'manual',
      onDragStart: () => { dragId.current = p.id },
      onDragOver: (event: React.DragEvent) => { if (sort === 'manual') event.preventDefault() },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault()
        if (sort !== 'manual' || dragId.current === null) return
        movePrompt(dragId.current, p.id)
        dragId.current = null
      },
    },
      React.createElement('div', { className: 'vx-row' },
        React.createElement(IconButton, {
          label: p.favorite === true ? '取消收藏' : '收藏',
          size: 'sm',
          icon: React.createElement(Icon, { n: 'star', size: 12, filled: p.favorite === true }),
          onClick: () => toggleFavorite(p),
        }),
        React.createElement('span', { className: 'vx-prompt-title' }, p.name),
        React.createElement('span', { className: 'vx-flex1' }),
        React.createElement('span', { className: 'vx-muted' }, `使用 ${p.useCount ?? 0} 次`),
        React.createElement(Button, { variant: 'secondary', size: 'sm', onClick: () => insertPrompt(p) }, '插入'),
        React.createElement(IconButton, {
          label: '编辑',
          size: 'sm',
          icon: React.createElement(Icon, { n: 'wrench', size: 12 }),
          onClick: () => setEditor(p),
        }),
        React.createElement(IconButton, {
          label: '复制',
          size: 'sm',
          icon: React.createElement(Icon, { n: 'copy', size: 12 }),
          onClick: () => { void copyText(p.text).then((ok) => toast(ok ? '已复制提示词' : '复制失败', ok ? 'info' : 'error')) },
        }),
        React.createElement(IconButton, {
          label: '删除',
          size: 'sm',
          icon: React.createElement(Icon, { n: 'trash', size: 12 }),
          onClick: () => delPrompt(p),
        }),
      ),
      (p.tags ?? []).length > 0
        ? React.createElement('div', { className: 'vx-prompt-tags' }, (p.tags ?? []).map((value) => React.createElement('span', { key: value, className: 'vx-badge' }, `#${value}`)))
        : null,
      React.createElement('div', { className: 'vx-prompt-body' }, p.text),
    )
    return React.createElement('div', { className: 'vx-col' },
      React.createElement('div', { className: 'vx-toolbar' },
        React.createElement('input', {
          className: 'vx-input',
          placeholder: '搜索名称、内容或标签…',
          value: query,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.currentTarget.value),
        }),
        React.createElement(Button, {
          variant: favoritesOnly ? 'secondary' : 'ghost',
          size: 'sm',
          'aria-pressed': favoritesOnly,
          onClick: () => setFavoritesOnly(!favoritesOnly),
        }, '收藏'),
        React.createElement('select', {
          className: 'vx-input vx-select',
          value: tag ?? '',
          'aria-label': '按标签筛选',
          onChange: (event: React.ChangeEvent<HTMLSelectElement>) => setTag(event.currentTarget.value === '' ? null : event.currentTarget.value),
        },
          React.createElement('option', { value: '' }, '全部标签'),
          tags.map((value) => React.createElement('option', { key: value, value }, value)),
        ),
        React.createElement('select', {
          className: 'vx-input vx-select',
          value: sort,
          'aria-label': '排序方式',
          onChange: (event: React.ChangeEvent<HTMLSelectElement>) => setSort(event.currentTarget.value as PromptSort),
        },
          React.createElement('option', { value: 'manual' }, '手动排序'),
          React.createElement('option', { value: 'recent' }, '最近使用'),
          React.createElement('option', { value: 'used' }, '使用次数'),
          React.createElement('option', { value: 'name' }, '名称'),
        ),
        React.createElement(Button, { variant: 'primary', size: 'sm', onClick: () => setEditor('new') }, '新增'),
      ),
      visible.length === 0
        ? React.createElement(EmptyState, {
          title: s.prompts.length === 0 ? '还没有提示词' : '没有匹配的提示词',
          hint: s.prompts.length === 0 ? '新增第一条，或从 JSON / Markdown 导入。' : '换个关键词、标签或关掉收藏筛选。',
          action: React.createElement(Button, { variant: 'primary', size: 'sm', onClick: () => setEditor('new') }, '新增提示词'),
        })
        : React.createElement('div', { className: 'vx-prompt-grid' }, visible.map(card)),
      React.createElement('div', { className: 'vx-row wrap vx-pad-sm' },
        React.createElement(Button, {
          variant: 'ghost',
          size: 'sm',
          onClick: () => downloadText(JSON.stringify({ format: 'dsh-custom-plugin-prompts', version: 1, prompts: S.prompts }, null, 2), `custom-prompts-${dayKey()}.json`, 'application/json'),
        }, '导出 JSON'),
        React.createElement(Button, {
          variant: 'ghost',
          size: 'sm',
          onClick: () => downloadText(promptsMarkdown(S.prompts), `custom-prompts-${dayKey()}.md`, 'text/markdown'),
        }, '导出 Markdown'),
        React.createElement('label', { className: 'vx-button vx-button-ghost vx-button-sm' }, '导入文件',
          React.createElement('input', {
            type: 'file',
            accept: '.json,.md,application/json,text/markdown',
            style: { display: 'none' },
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
              const file = event.currentTarget.files?.[0]
              if (file !== undefined) void parseImport(file)
              event.currentTarget.value = ''
            },
          }),
        ),
        React.createElement('span', { className: 'vx-flex1' }),
        React.createElement('span', { className: 'vx-muted' }, `共 ${s.prompts.length} 条 · 当前显示 ${visible.length} 条`),
      ),
      React.createElement(PromptEditorDialog, {
        open: editor !== null,
        item: editor === 'new' || editor === null ? null : editor,
        onClose: () => setEditor(null),
      }),
      React.createElement(Dialog, {
        open: importState !== null,
        onClose: () => setImportState(null),
        title: '导入提示词',
        description: importState?.fileName,
        size: 'sm',
        footer: React.createElement(React.Fragment, null,
          React.createElement(Button, { variant: 'ghost', onClick: () => setImportState(null) }, '取消'),
          React.createElement(Button, { variant: 'primary', onClick: confirmImport }, importMode === 'replace' ? '替换导入' : '合并导入'),
        ),
      },
        importState === null ? null : React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'vx-muted' }, `有效 ${importState.incoming.length} 条，跳过 ${importState.invalid} 条无效记录；同 ID 的记录会被更新。`),
          React.createElement(Segmented, {
            value: importMode,
            options: [{ value: 'merge', label: '合并' }, { value: 'replace', label: '替换现有' }],
            onChange: (value) => setImportMode(value as PromptImportMode),
            ariaLabel: '导入方式',
          }),
          React.createElement('div', { className: 'vx-muted' }, importMode === 'replace'
            ? `替换后库中将有 ${importState.incoming.length} 条提示词，现有 ${S.prompts.length} 条会全部移除。`
            : `合并后库中将有 ${mergePromptImport(S.prompts, importState.incoming, 'merge').next.length} 条提示词。`),
        ),
      ),
    )
  }

  function BackupControls(): React.ReactElement {
    const [mode, setMode] = React.useState<BackupImportMode>('merge')
    const [preview, setPreview] = React.useState<{ document: unknown; preview: BackupImportPreview; fileName: string } | null>(null)
    const [importing, setImporting] = React.useState(false)
    const exportBackup = async (): Promise<void> => {
      try {
        const result = await apiBackupExport()
        if (!result.ok) { toast(result.error ?? '备份导出失败', 'error'); return }
        downloadText(JSON.stringify(result.data, null, 2), `custom-backup-${dayKey()}.json`, 'application/json')
        toast('已导出无密钥备份', 'info')
      } catch (error) { toast(String((error as Error)?.message ?? error), 'error') }
    }
    const importFile = async (file: File): Promise<void> => {
      if (file.size > 5 * 1024 * 1024) { toast('备份文件不能超过 5 MB', 'error'); return }
      let documentValue: unknown
      try { documentValue = JSON.parse(await file.text()) as unknown } catch { toast('备份文件不是有效 JSON', 'error'); return }
      try {
        const dry = await apiBackupImport(documentValue, 'merge', true)
        if (!dry.ok) { toast(dry.error ?? '备份校验失败', 'error'); return }
        setMode('merge')
        setPreview({ document: documentValue, preview: dry.preview, fileName: file.name })
      } catch (error) { toast(String((error as Error)?.message ?? error), 'error') }
    }
    const confirmImport = async (): Promise<void> => {
      if (preview === null) return
      setImporting(true)
      try {
        const result = await apiBackupImport(preview.document, mode, false)
        if (!result.ok) { toast(result.error ?? '备份导入失败', 'error'); return }
        await loadCfg()
        setPreview(null)
        toast('备份导入完成；原状态已生成恢复副本', 'info')
      } catch (error) {
        toast(String((error as Error)?.message ?? error), 'error')
      } finally {
        setImporting(false)
      }
    }
    const p = preview?.preview ?? null
    return React.createElement('div', { className: 'vx-col' },
      React.createElement('div', { className: 'vx-muted' }, '备份包含外观、文件夹、提示词、星标、用量和预算；不会包含账号凭据。'),
      React.createElement('div', { className: 'vx-row wrap' },
        React.createElement(Button, { variant: 'secondary', size: 'sm', onClick: () => { void exportBackup() } }, '导出 JSON 备份'),
        React.createElement('label', { className: 'vx-button vx-button-secondary vx-button-sm' }, '选择备份文件',
          React.createElement('input', {
            type: 'file',
            accept: 'application/json,.json',
            style: { display: 'none' },
            onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
              const file = event.currentTarget.files?.[0]
              if (file !== undefined) void importFile(file)
              event.currentTarget.value = ''
            },
          }),
        ),
      ),
      React.createElement(Dialog, {
        open: preview !== null,
        onClose: () => { if (!importing) setPreview(null) },
        title: '导入备份',
        description: preview?.fileName,
        size: 'md',
        dismissible: !importing,
        footer: React.createElement(React.Fragment, null,
          React.createElement(Button, { variant: 'ghost', onClick: () => setPreview(null), disabled: importing }, '取消'),
          React.createElement(Button, { variant: 'primary', onClick: () => { void confirmImport() }, disabled: importing }, importing ? '导入中…' : (mode === 'replace' ? '覆盖导入' : '合并导入')),
        ),
      },
        p === null ? null : React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'vx-count-grid' },
            [['文件夹', p.folders], ['提示词', p.prompts], ['星标会话', p.starredSessions], ['用量天数', p.usageDays]].map(([label, value]) => React.createElement('div', { key: String(label), className: 'vx-count-cell' },
              React.createElement('div', { className: 'vx-count-value' }, String(value)),
              React.createElement('div', { className: 'vx-count-label' }, String(label)),
            )),
          ),
          React.createElement('div', { className: 'vx-muted' }, `冲突：文件夹 ${p.conflicts.folders}、提示词 ${p.conflicts.prompts}、用量 ${p.conflicts.usageDays}。合并会按 ID 更新；覆盖会移除现有非敏感状态。`),
          React.createElement(Segmented, {
            value: mode,
            options: [{ value: 'merge', label: '合并导入' }, { value: 'replace', label: '覆盖导入' }],
            onChange: (value) => setMode(value as BackupImportMode),
            ariaLabel: '导入方式',
          }),
          React.createElement('div', { className: 'vx-muted' }, '导入前会自动生成一份恢复副本；账号登录不受影响。'),
        ),
      ),
    )
  }

  async function revealSearchResult(item: ConversationSearchItem): Promise<void> {
    try {
      if (S.sessionId !== item.sessionId) { toast('搜索结果所属会话已切换，请重新搜索', 'error'); return }
      const expectedSessionId = item.sessionId
      const sessions = C.get('sessions') as { binding(id: string): { session: { loadOlder(): Promise<void>; getSnapshot(): { hasMore: boolean } } } | undefined } | undefined
      const face = sessions?.binding(expectedSessionId)?.session
      if (face === undefined) { toast('目标会话不可用', 'error'); return }
      const rendered = (): boolean => S.anchors.get(item.anchorSeq)?.el !== undefined
      for (let page = 0; !rendered() && face.getSnapshot().hasMore && page < 20; page++) {
        if (S.sessionId !== expectedSessionId) { toast('会话已切换，搜索结果已失效', 'error'); return }
        await face.loadOlder()
        await new Promise<void>((resolve) => setTimeout(resolve, 60))
      }
      if (S.sessionId !== expectedSessionId) { toast('会话已切换，搜索结果已失效', 'error'); return }
      if (!rendered()) { toast('结果所在消息尚未加载，请继续加载历史后重试', 'error'); return }
      scrollToSeq(item.anchorSeq)
    } catch (error) {
      toast('加载搜索结果失败: ' + String((error as Error)?.message ?? error), 'error')
    }
  }

  function Highlight(props: { text: string; query: string }): React.ReactElement {
    const q = props.query.trim()
    const index = q === '' ? -1 : props.text.toLowerCase().indexOf(q.toLowerCase())
    if (index < 0) return React.createElement('span', null, props.text)
    return React.createElement('span', null, props.text.slice(0, index), React.createElement('mark', null, props.text.slice(index, index + q.length)), props.text.slice(index + q.length))
  }

  interface SearchRow {
    key: string
    sessionId: string
    snippet: string
    kind?: ConversationSearchKind
    time?: number
    anchorSeq?: number
    seq?: number
  }

  function SearchTab(): React.ReactElement {
    const [scope, setScope] = React.useState<'current' | 'all'>('current')
    const [query, setQuery] = React.useState('')
    const [kinds, setKinds] = React.useState<ConversationSearchKind[]>(['user', 'assistant', 'tool'])
    const [rows, setRows] = React.useState<SearchRow[]>([])
    const [status, setStatus] = React.useState<'idle' | 'loading' | 'done' | 'error'>('idle')
    const [error, setError] = React.useState('')
    const [hasMore, setHasMore] = React.useState(false)
    const [scanned, setScanned] = React.useState(false)
    const [active, setActive] = React.useState(0)
    React.useEffect(() => {
      const q = query.trim()
      if (q === '') { setRows([]); setStatus('idle'); setError(''); setHasMore(false); setScanned(false); return }
      const controller = new AbortController()
      const timer = setTimeout(() => {
        setStatus('loading')
        setError('')
        if (scope === 'all') {
          const remote = sessionRemote()
          if (remote === undefined) {
            setRows([])
            setStatus('error')
            setError(CROSS_SEARCH_UNAVAILABLE)
            return
          }
          void remote.search({ query: q }, controller.signal).then((result) => {
            if (controller.signal.aborted) return
            if (result.ok) {
              setRows(result.value.items.map((item, index) => ({ key: `r-${item.sessionId}-${index}`, sessionId: item.sessionId, snippet: item.snippet })))
              setStatus('done')
              setHasMore(false)
            } else {
              setRows([])
              setStatus('error')
              setError(remoteErrorMessage(result.error, CROSS_SEARCH_UNAVAILABLE))
            }
          }).catch(() => {
            if (!controller.signal.aborted) { setRows([]); setStatus('error'); setError(CROSS_SEARCH_UNAVAILABLE) }
          })
          return
        }
        if (S.sessionId === null) {
          setRows([])
          setStatus('error')
          setError('当前没有打开的会话')
          return
        }
        void apiConversationSearch(S.sessionId, q, kinds, controller.signal).then((result) => {
          if (controller.signal.aborted) return
          if (!result.ok) { setRows([]); setStatus('error'); setError(result.error ?? '搜索不可用'); return }
          setRows(result.items.map((item) => ({ ...item, key: `${item.seq}-${item.kind}` })))
          setHasMore(result.hasMore)
          setScanned(result.source === 'scan')
          setStatus('done')
        }).catch(() => {
          if (!controller.signal.aborted) { setRows([]); setStatus('error'); setError('搜索失败') }
        })
      }, 250)
      return () => { clearTimeout(timer); controller.abort() }
    }, [query, kinds.join(','), scope, S.sessionId])
    React.useEffect(() => { setActive(0) }, [rows])
    React.useEffect(() => {
      const node = document.getElementById(`vx-search-row-${active}`)
      if (node !== null) node.scrollIntoView({ block: 'nearest' })
    }, [active])
    const toggle = (kind: ConversationSearchKind): void => setKinds((old) => old.includes(kind) ? (old.length > 1 ? old.filter((item) => item !== kind) : old) : [...old, kind])
    const names: Record<ConversationSearchKind, string> = { user: '用户', assistant: '助手', tool: '工具' }
    const openRow = (row: SearchRow): void => {
      if (scope === 'all' || row.anchorSeq === undefined) { openSessionItem(row.sessionId); return }
      void revealSearchResult(row as unknown as ConversationSearchItem)
    }
    const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'ArrowDown') { event.preventDefault(); if (rows.length > 0) setActive((index) => Math.min(rows.length - 1, index + 1)) }
      else if (event.key === 'ArrowUp') { event.preventDefault(); if (rows.length > 0) setActive((index) => Math.max(0, index - 1)) }
      else if (event.key === 'Enter') {
        const row = rows[active]
        if (row !== undefined) { event.preventDefault(); openRow(row) }
      }
    }
    return React.createElement('div', { className: 'vx-col' },
      React.createElement(Segmented, {
        value: scope,
        options: [{ value: 'current', label: '当前会话' }, { value: 'all', label: '全部会话' }],
        onChange: (value) => setScope(value as 'current' | 'all'),
        ariaLabel: '搜索范围',
      }),
      React.createElement('input', {
        className: 'vx-input',
        autoFocus: true,
        placeholder: scope === 'all' ? '搜索全部会话…' : '搜索当前会话…',
        value: query,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.currentTarget.value),
        onKeyDown,
        role: 'combobox',
        'aria-expanded': rows.length > 0,
        'aria-controls': 'vx-search-results',
        'aria-activedescendant': rows.length > 0 ? `vx-search-row-${active}` : undefined,
      }),
      scope === 'current'
        ? React.createElement('div', { className: 'vx-row wrap' }, (['user', 'assistant', 'tool'] as const).map((kind) => React.createElement(Button, {
          key: kind,
          variant: kinds.includes(kind) ? 'secondary' : 'ghost',
          size: 'sm',
          'aria-pressed': kinds.includes(kind),
          onClick: () => toggle(kind),
        }, names[kind])))
        : null,
      scanned ? React.createElement('div', { className: 'vx-muted' }, '本部署未开启事件全文索引，已改为直接扫描会话日志（最多 100 条）。') : null,
      status === 'loading' ? React.createElement('div', { className: 'vx-row vx-muted' }, React.createElement(Spinner, { label: '搜索中' }), ' 搜索中…') : null,
      status === 'error' ? React.createElement('div', { className: 'vx-error', role: 'alert' }, error) : null,
      React.createElement('div', { className: 'vx-list', id: 'vx-search-results', role: 'listbox', 'aria-label': '搜索结果' },
        rows.map((row, index) => React.createElement('button', {
          key: row.key,
          id: `vx-search-row-${index}`,
          type: 'button',
          role: 'option',
          'aria-selected': index === active,
          className: 'vx-list-item' + (index === active ? ' on' : ''),
          onMouseEnter: () => setActive(index),
          onClick: () => openRow(row),
        },
          React.createElement('div', { className: 'vx-row' },
            React.createElement('span', { className: 'vx-badge' }, scope === 'all' ? '会话' : names[row.kind ?? 'user']),
            row.time === undefined ? null : React.createElement('span', { className: 'vx-muted' }, new Date(row.time).toLocaleString('zh-CN')),
          ),
          React.createElement('div', { className: 'vx-prompt-body' }, React.createElement(Highlight, { text: row.snippet, query })),
        )),
      ),
      status === 'done' && rows.length === 0
        ? React.createElement(EmptyState, { title: '没有匹配结果', hint: scope === 'all' ? '换个关键词，或切回当前会话。' : '换个关键词或放宽角色筛选。' })
        : null,
      hasMore ? React.createElement('div', { className: 'vx-muted' }, '结果超过 100 条，请缩小搜索范围。') : null,
    )
  }

  function ExportTab(): React.ReactElement {
    const s = useS()
    const [format, setFormat] = React.useState<'markdown' | 'json' | 'pdf'>('markdown')
    const [phase, setPhase] = React.useState<'idle' | 'running' | 'done' | 'error'>('idle')
    const [result, setResult] = React.useState<{ fileName: string; bytes: number } | null>(null)
    const [error, setError] = React.useState('')
    const controllerRef = React.useRef<AbortController | null>(null)
    React.useEffect(() => () => { controllerRef.current?.abort() }, [])
    const formats = [
      { value: 'markdown', label: 'Markdown', hint: '便于阅读与分享' },
      { value: 'json', label: 'JSON', hint: '可导入其他工具' },
      { value: 'pdf', label: 'HTML', hint: '内嵌图片，可打印为 PDF' },
    ] as const
    const start = async (): Promise<void> => {
      if (s.sessionId === null) { setPhase('error'); setError('当前没有打开的会话'); return }
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      setPhase('running')
      setError('')
      setResult(null)
      const outcome = await runExport(format, controller.signal)
      if (controller.signal.aborted) { setPhase('idle'); return }
      if (outcome.ok && outcome.fileName !== undefined) {
        setResult({ fileName: outcome.fileName, bytes: outcome.bytes ?? 0 })
        setPhase('done')
      } else {
        setPhase('error')
        setError('导出失败，请重试')
      }
    }
    const cancel = (): void => {
      controllerRef.current?.abort()
      controllerRef.current = null
      setPhase('idle')
    }
    return React.createElement('div', { className: 'vx-col' },
      React.createElement('div', { className: 'vx-muted' }, '将当前会话导出为文件。Markdown 便于阅读分享；JSON 可导入其他工具；HTML 内嵌图片，用浏览器打开后可打印为 PDF。'),
      React.createElement('div', { className: 'vx-format-grid', role: 'radiogroup', 'aria-label': '导出格式' },
        formats.map((item) => React.createElement('button', {
          key: item.value,
          type: 'button',
          role: 'radio',
          'aria-checked': format === item.value,
          className: 'vx-format-card' + (format === item.value ? ' on' : ''),
          onClick: () => setFormat(item.value),
        },
          React.createElement('span', { className: 'vx-format-title' }, item.label),
          React.createElement('span', { className: 'vx-format-hint' }, item.hint),
        )),
      ),
      React.createElement('div', { className: 'vx-row' },
        React.createElement(Button, {
          variant: 'primary',
          onClick: () => { void start() },
          disabled: phase === 'running' || s.sessionId === null,
        }, phase === 'done' ? '再次导出' : '开始导出'),
        phase === 'running' ? React.createElement(Button, { variant: 'ghost', onClick: cancel }, '取消') : null,
        React.createElement('span', { className: 'vx-flex1' }),
        s.sessionId === null ? React.createElement('span', { className: 'vx-muted' }, '当前没有打开的会话') : null,
      ),
      phase === 'running'
        ? React.createElement('div', { className: 'vx-export-progress', role: 'status' },
          React.createElement('div', { className: 'vx-row vx-muted' }, React.createElement(Spinner, { label: '导出中' }), ' 读取会话'),
          React.createElement('div', { className: 'vx-muted' }, '整理内容 → 生成文件'),
        )
        : null,
      phase === 'error'
        ? React.createElement('div', { className: 'vx-error', role: 'alert' }, error)
        : null,
      phase === 'done' && result !== null
        ? React.createElement('div', { className: 'vx-export-result' },
          React.createElement(Icon, { n: 'check', size: 14 }),
          React.createElement('div', { className: 'vx-export-result-copy' },
            React.createElement('div', { className: 'vx-prompt-title' }, result.fileName),
            React.createElement('div', { className: 'vx-muted' }, `${formatTokenCount(result.bytes)} 字节 · 已开始下载`),
          ),
        )
        : null,
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
      React.createElement(Toggle, { label: '防自动跳转', checked: s.cfg.antiScroll === true, onChange: (v) => set('antiScroll', v), hint: '拦截发送后强制滚动到底部' }),
      React.createElement(Toggle, { label: '公式复制', checked: s.cfg.formula === true, onChange: (v) => set('formula', v), hint: '消息下方显示 LaTeX/MathML 复制按钮' }),
      React.createElement('div', { className: 'vx-row vx-pad-sm' },
        React.createElement('button', { className: 'vx-btn', onClick: () => setS({ commandOpen: true }) }, React.createElement(Icon, { n: 'search', size: 13 }), ' 打开快捷面板（Ctrl/⌘ K）'),
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
    const rows: Array<[string, string]> = []
    if (info?.ok === true) {
      rows.push(['状态文件', String(info.statePath ?? '')])
      rows.push(['Mermaid 引擎', `${String(info.mermaidBytes ?? 0)} 字节`])
      rows.push(['客户端诊断', Array.isArray(info.diagReports) ? `${info.diagReports.length} 条` : '0 条'])
    }
    return React.createElement('div', { className: 'vx-col' },
      React.createElement('div', { className: 'vx-muted' }, 'Custom 便利套件：外观与天气特效、项目文件夹、提示词、会话导出、Mermaid、额度与备份。'),
      info === null
        ? React.createElement('div', { className: 'vx-row vx-muted' }, React.createElement(Spinner, { label: '读取信息' }), ' 读取信息…')
        : (info.ok !== true
          ? React.createElement('div', { className: 'vx-error', role: 'alert' }, '调试信息不可用')
          : React.createElement('div', { className: 'vx-col' },
            rows.map(([label, value]) => React.createElement('div', { className: 'vx-row', key: label },
              React.createElement('span', { className: 'vx-param-label' }, label),
              React.createElement('span', { className: 'vx-flex1' }),
              React.createElement('span', { className: 'vx-muted vx-ellipsis', title: value }, value),
              React.createElement(IconButton, {
                label: '复制' + label,
                size: 'sm',
                icon: React.createElement(Icon, { n: 'copy', size: 11 }),
                onClick: () => { void copyText(value).then((ok) => toast(ok ? '已复制' : '复制失败', ok ? 'info' : 'error')) },
              }),
            )),
          )),
      React.createElement('div', { className: 'vx-row' },
        React.createElement(Button, { variant: 'ghost', size: 'sm', onClick: () => { void loadInfo() } }, '刷新信息'),
      ),
    )
  }

  function AskModal(): React.ReactElement | null {
    const s = useS()
    const [val, setVal] = React.useState('')
    React.useEffect(() => { if (s.ask !== null) setVal(s.ask.value ?? '') }, [s.ask?.title])
    const ask = s.ask
    const submit = (): void => {
      if (ask === null) return
      const cb = ask.cb
      setS({ ask: null })
      if (ask.allowEmpty === true || val.trim() !== '') cb(ask.allowEmpty === true ? val : val.trim())
    }
    return React.createElement(Dialog, {
      open: ask !== null,
      onClose: () => setS({ ask: null }),
      title: ask?.title ?? '输入',
      size: 'sm',
      footer: ask === null ? undefined : React.createElement(React.Fragment, null,
        React.createElement(Button, { variant: 'ghost', onClick: () => setS({ ask: null }) }, '取消'),
        React.createElement(Button, { variant: 'primary', onClick: submit }, '确定'),
      ),
    },
      ask === null ? null : React.createElement('input', {
        className: 'vx-input',
        value: val,
        autoFocus: true,
        'data-autofocus': true,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => setVal(event.currentTarget.value),
        onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter') submit() },
      }),
    )
  }

  function ConfirmModal(): React.ReactElement | null {
    const s = useS()
    const c = s.confirmAsk
    const answer = (ok: boolean): void => {
      if (c === null) return
      const cb = c.cb
      setS({ confirmAsk: null })
      cb(ok)
    }
    return React.createElement(Dialog, {
      open: c !== null,
      onClose: () => answer(false),
      title: '确认操作',
      size: 'sm',
      footer: c === null ? undefined : React.createElement(React.Fragment, null,
        React.createElement(Button, { variant: 'ghost', autoFocus: true, onClick: () => answer(false) }, '取消'),
        React.createElement(Button, { variant: 'danger', onClick: () => answer(true) }, '确定'),
      ),
    },
      c === null ? null : React.createElement('div', { className: 'vx-dialog-text' }, c.message),
    )
  }

  function TemplateModal(): React.ReactElement | null {
    const s = useS()
    const prompt = s.templatePrompt
    const close = (): void => setS({ templatePrompt: null, templateValues: {} })
    const names = prompt === null ? [] : promptVariables(prompt.text)
    const submit = (): void => {
      if (prompt === null) return
      if (names.some((name) => (S.templateValues[name] ?? '').trim() === '')) { toast('请填写所有变量', 'error'); return }
      const text = fillPromptTemplate(prompt.text, S.templateValues)
      const ok = S.insertDraft !== null ? S.insertDraft(text, false) : false
      if (!ok) { toast('请在会话输入框中重试', 'error'); return }
      S.prompts = S.prompts.map((item) => item.id === prompt.id ? { ...item, useCount: (item.useCount ?? 0) + 1, lastUsedAt: Date.now() } : item)
      setS({ prompts: S.prompts, templatePrompt: null, templateValues: {} }); saveCfg(); toast('已插入提示词: ' + prompt.name, 'info')
    }
    return React.createElement(Dialog, {
      open: prompt !== null,
      onClose: close,
      title: prompt === null ? '填写变量' : `填写变量 · ${prompt.name}`,
      size: 'md',
      footer: prompt === null ? undefined : React.createElement(React.Fragment, null,
        React.createElement(Button, { variant: 'ghost', onClick: close }, '取消'),
        React.createElement(Button, { variant: 'primary', onClick: submit }, '插入'),
      ),
    },
      prompt === null ? null : names.map((name, index) => React.createElement(Field, { key: name, label: name, htmlFor: `vx-template-${index}` },
        React.createElement('input', {
          id: `vx-template-${index}`,
          className: 'vx-input',
          value: s.templateValues[name] ?? '',
          'data-autofocus': index === 0 ? true : undefined,
          onChange: (event: React.ChangeEvent<HTMLInputElement>) => setS({ templateValues: { ...S.templateValues, [name]: event.currentTarget.value } }),
        }),
      )),
    )
  }

  function MermaidInPlace(): React.ReactElement | null {
    const { enabled, dark } = useSSelector(
      (state) => ({ enabled: state.cfg.mermaid === true, dark: state.dark === true }),
      shallowEqual,
    )
    React.useEffect(() => {
      if (!enabled) {
        mermaidScanner.restore()
        return
      }
      const d = typeof document !== 'undefined' ? document : null
      const w = typeof window !== 'undefined' ? window : null
      if (d === null || d.body === null || w === null || w.MutationObserver === undefined) return
      let timer: ReturnType<typeof setTimeout> | null = null
      let stopped = false
      const scan = (): void => { if (!stopped) void mermaidScanner.scan(dark) }
      const schedule = (): void => {
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(scan, 400)
      }
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
    }, [mm])
    return React.createElement(Dialog, {
      open: mm !== null,
      onClose: () => setS({ mermaidModal: null }),
      title: mm === null ? 'Mermaid 图表' : `${mm.title} (${mm.index + 1}/${mm.codes.length})`,
      size: 'lg',
      footer: mm === null ? undefined : React.createElement('div', { className: 'vx-row' },
        mm.codes.length > 1 ? React.createElement(Button, { variant: 'ghost', size: 'sm', onClick: () => setS({ mermaidModal: { ...mm, index: (mm.index + mm.codes.length - 1) % mm.codes.length } }) }, '上一个') : null,
        mm.codes.length > 1 ? React.createElement(Button, { variant: 'ghost', size: 'sm', onClick: () => setS({ mermaidModal: { ...mm, index: (mm.index + 1) % mm.codes.length } }) }, '下一个') : null,
        React.createElement('a', { className: 'vx-button vx-button-secondary vx-button-sm vx-link', href: liveUrl, target: '_blank', rel: 'noopener noreferrer' }, '在 mermaid.live 打开'),
      ),
    },
      mm === null ? null : React.createElement(React.Fragment, null,
        loading ? React.createElement('div', { className: 'vx-row vx-muted' }, React.createElement(Spinner, { label: '渲染中' }), ' 渲染中…') : null,
        err !== null ? React.createElement('div', { className: 'vx-error', role: 'alert' }, err) : null,
        svg !== null ? React.createElement('div', { className: 'vx-svgbox', dangerouslySetInnerHTML: { __html: svg } }) : null,
      ),
    )
  }

  function CommandPalette(props: { useSessions: OverlayProps['useSessions']; useWorkspaces: OverlayProps['useWorkspaces'] }): React.ReactElement | null {
    const s = useS()
    const sessionsState = useSessionsSafe(props)
    const workspacesState = useWorkspacesSafe(props)
    // The session list snapshot intentionally exposes only the monotone
    // `phase` (errors stay on the service's internal state axis), so a null
    // hook result is the only reliable unavailable signal here.
    const sessionsUnavailable = sessionsState === null
    const workspacesUnavailable = workspacesState === null || workspacesState.state === 'error'
    const [query, setQuery] = React.useState('')
    const [index, setIndex] = React.useState(0)
    const [remote, setRemote] = React.useState<Array<{ sessionId: string; snippet: string }>>([])
    const [remoteStatus, setRemoteStatus] = React.useState('')
    const [recent, setRecent] = React.useState<string[]>([])
    React.useEffect(() => {
      if (!s.commandOpen) return
      const storage = typeof window === 'undefined' ? null : window.localStorage
      setRecent(loadRecent(storage))
      setQuery('')
      setIndex(0)
    }, [s.commandOpen])
    React.useEffect(() => {
      if (!s.commandOpen || query.trim().length < 2) { setRemote([]); setRemoteStatus(''); return }
      const controller = new AbortController()
      const timer = setTimeout(() => {
        const sessionSearch = sessionRemote()
        if (sessionSearch === undefined) { setRemoteStatus(CROSS_SEARCH_UNAVAILABLE); return }
        setRemoteStatus('跨会话搜索中…')
        try {
          void sessionSearch.search({ query: query.trim() }, controller.signal).then((result) => {
            if (controller.signal.aborted) return
            if (result.ok) { setRemote(result.value.items); setRemoteStatus('') }
            else {
              setRemote([]); setRemoteStatus(remoteErrorMessage(result.error, CROSS_SEARCH_UNAVAILABLE))
            }
          }).catch(() => { if (!controller.signal.aborted) { setRemote([]); setRemoteStatus(CROSS_SEARCH_UNAVAILABLE) } })
        } catch { if (!controller.signal.aborted) { setRemote([]); setRemoteStatus(CROSS_SEARCH_UNAVAILABLE) } }
      }, 250)
      return () => { clearTimeout(timer); controller.abort() }
    }, [query, s.commandOpen])
    const commands: PaletteCommand[] = [
      { key: 'balance', label: '打开额度与用量', detail: '设置', group: '功能', run: () => { setS({ commandOpen: false, settingsSection: 'usage' }); openHostSettings('用量与额度') } },
      { key: 'export', label: '导出当前会话', detail: S.sessionId === null ? '当前没有打开的会话' : 'Markdown', group: '功能', disabled: S.sessionId === null, run: () => { setS({ commandOpen: false }); void runExport('markdown') } },
      { key: 'search-current', label: '搜索当前会话', detail: S.sessionId === null ? '当前没有打开的会话' : '设置', group: '功能', disabled: S.sessionId === null, run: () => { setS({ commandOpen: false, settingsSection: 'search' }); openHostSettings('搜索') } },
      { key: 'folders', label: '打开项目文件夹', detail: '设置', group: '功能', run: () => { setS({ commandOpen: false, settingsSection: 'folders' }); openHostSettings('项目文件夹') } },
      { key: 'prompts', label: '打开提示词库', detail: '设置', group: '功能', run: () => { setS({ commandOpen: false, settingsSection: 'prompts' }); openHostSettings('提示词') } },
      { key: 'tools', label: '打开效率工具', detail: '设置', group: '功能', run: () => { setS({ commandOpen: false, settingsSection: 'extensions' }); openHostSettings('扩展') } },
      ...(sessionsUnavailable ? [{ key: 'sessions-unavailable', label: '打开会话', detail: sessionsState === null ? '会话服务不可用' : '会话列表加载失败', group: '会话', disabled: true, run: () => {} }] : []),
      ...(workspacesUnavailable ? [{ key: 'workspaces-unavailable', label: '打开工作区', detail: workspacesState === null ? '工作区服务不可用' : '工作区列表加载失败', group: '工作区', disabled: true, run: () => {} }] : []),
      ...S.prompts.map((prompt) => ({ key: `prompt-${prompt.id}`, label: prompt.name, detail: S.insertDraft === null ? '当前没有可用输入框' : '提示词', group: '提示词', disabled: S.insertDraft === null, run: () => { setS({ commandOpen: false }); insertPrompt(prompt) } })),
      ...(sessionsUnavailable ? [] : (sessionsState?.ids ?? []).map((id) => ({ key: `session-${id}`, label: sessionsState?.byId[id]?.displayTitle || sessionsState?.byId[id]?.title || id, detail: '会话', group: '会话', run: () => { setS({ commandOpen: false }); openSessionItem(id) } }))),
      ...(workspacesUnavailable ? [] : (workspacesState?.items ?? []).map((workspace) => ({ key: `workspace-${workspace.workspaceId}`, label: workspace.title || workspace.path || workspace.workspaceId, detail: '工作区', group: '工作区', run: () => { setS({ commandOpen: false }); void openWorkspaceItem(workspace.workspaceId) } }))),
      ...remote.map((item, index) => ({ key: `remote-${item.sessionId}-${index}`, label: item.snippet || item.sessionId, detail: '全文搜索结果', group: '全文搜索', run: () => { setS({ commandOpen: false }); openSessionItem(item.sessionId) } })),
    ]
    const visible = filterCommands(commands, query)
    const recentItems = query.trim() === '' ? recentCommands(commands, recent).slice(0, 3) : []
    const recentKeys = new Set(recentItems.map((item) => item.key))
    const elsewhere = groupCommands(visible.filter((item) => !recentKeys.has(item.key)))
    const groups: CommandGroup[] = recentItems.length > 0
      ? [{ group: '最近', items: recentItems }, ...elsewhere]
      : elsewhere
    const flat = groups.flatMap((group) => group.items)
    const chosen = Math.max(0, Math.min(index, flat.length - 1))
    const runCommand = (command: PaletteCommand): void => {
      if (command.disabled === true) return
      const storage = typeof window === 'undefined' ? null : window.localStorage
      const nextRecent = recordRecent(recent, command.key)
      setRecent(nextRecent)
      saveRecent(storage, nextRecent)
      command.run()
    }
    React.useEffect(() => {
      const node = document.getElementById(`vx-cmd-${chosen}`)
      if (node !== null) node.scrollIntoView({ block: 'nearest' })
    }, [chosen])
    const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'ArrowDown') { event.preventDefault(); setIndex(Math.min(flat.length - 1, chosen + 1)) }
      else if (event.key === 'ArrowUp') { event.preventDefault(); setIndex(Math.max(0, chosen - 1)) }
      else if (event.key === 'Home') { event.preventDefault(); setIndex(0) }
      else if (event.key === 'End') { event.preventDefault(); setIndex(Math.max(0, flat.length - 1)) }
      else if (event.key === 'Enter') {
        event.preventDefault()
        const command = flat[chosen]
        if (command !== undefined) runCommand(command)
      }
    }
    let flatIndex = -1
    return React.createElement(Dialog, {
      open: s.commandOpen,
      onClose: () => setS({ commandOpen: false }),
      title: '快捷面板',
      description: '搜索会话、工作区、提示词或功能',
      size: 'lg',
      className: 'vx-command-dialog',
      footer: React.createElement('div', { className: 'vx-command-foot' },
        React.createElement('span', null, React.createElement(Kbd, null, '↑'), React.createElement(Kbd, null, '↓'), ' 选择'),
        React.createElement('span', null, React.createElement(Kbd, null, 'Enter'), ' 打开'),
        React.createElement('span', null, React.createElement(Kbd, null, 'Esc'), ' 关闭'),
      ),
    },
      React.createElement('input', {
        className: 'vx-input vx-command-input',
        autoFocus: true,
        'data-autofocus': true,
        placeholder: '搜索会话、工作区、提示词或功能…',
        value: query,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => { setQuery(event.currentTarget.value); setIndex(0) },
        onKeyDown,
        role: 'combobox',
        'aria-expanded': flat.length > 0,
        'aria-controls': 'vx-command-list',
        'aria-activedescendant': flat.length > 0 ? `vx-cmd-${chosen}` : undefined,
      }),
      React.createElement('div', { className: 'vx-list vx-command-list', id: 'vx-command-list', role: 'listbox', 'aria-label': '命令列表' },
        groups.map((group) => React.createElement(React.Fragment, { key: group.group },
          React.createElement('div', { className: 'vx-pop-group' }, group.group),
          group.items.map((command) => {
            flatIndex++
            const itemIndex = flatIndex
            return React.createElement('button', {
              key: command.key,
              id: `vx-cmd-${itemIndex}`,
              type: 'button',
              role: 'option',
              'aria-selected': itemIndex === chosen,
              className: 'vx-list-item vx-command-item' + (itemIndex === chosen ? ' on' : ''),
              disabled: command.disabled === true,
              onMouseEnter: () => setIndex(itemIndex),
              onClick: () => runCommand(command),
            },
              React.createElement('span', { className: 'vx-command-label' }, command.label),
              React.createElement('span', { className: 'vx-muted' }, command.detail),
            )
          }),
        )),
      ),
      remoteStatus !== '' ? React.createElement('div', { className: 'vx-muted' }, remoteStatus) : null,
      flat.length === 0 ? React.createElement(EmptyState, { title: '没有匹配项', hint: '换个关键词，或直接输入功能名称。' }) : null,
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
    const batchArchive = async (targetIds: string[]): Promise<void> => {
      const workspaces = C.get('workspaces') as { archiveSession(id: string): Promise<void> } | undefined
      if (workspaces === undefined || typeof workspaces.archiveSession !== 'function') { toast('归档服务不可用', 'error'); return }
      const running = new Set(Object.keys(byId).filter((id) => byId[id]?.running === true))
      const { succeeded, failed, results } = await archiveBatch(targetIds, running, (id) => workspaces.archiveSession(id))
      setS({ batchModal: false })
      if (failed === 0) toast(`已归档 ${succeeded} 个会话`, 'info')
      else {
        const details = results.filter((item) => !item.ok).slice(0, 3).map((item) => `${item.id}: ${item.error ?? '失败'}`).join('；')
        toast(`归档完成：成功 ${succeeded}，失败 ${failed}${details === '' ? '' : `；${details}`}`, 'error')
      }
    }
    return React.createElement(Dialog, {
      open: s.batchModal === true,
      onClose: () => setS({ batchModal: false }),
      title: '批量归档会话',
      description: '运行中的会话不可选；DSH 当前未公开恢复接口，本插件不提供恢复入口。',
      size: 'lg',
      footer: React.createElement(React.Fragment, null,
        React.createElement(Button, { variant: 'ghost', onClick: () => setS({ batchModal: false }) }, '取消'),
        React.createElement(Button, {
          variant: 'danger',
          disabled: selCount === 0,
          onClick: () => askConfirm(`确认归档选中的 ${selCount} 个会话？`, (ok) => { if (ok) void batchArchive(Object.keys(sel)) }),
        }, `归档选中 (${selCount})`),
      ),
    },
      React.createElement('div', { className: 'vx-toolbar' },
        React.createElement(Icon, { n: 'search', size: 13 }),
        React.createElement('input', { className: 'vx-input', placeholder: '搜索会话…', value: q, 'data-autofocus': true, onChange: (event: React.ChangeEvent<HTMLInputElement>) => setQ(event.currentTarget.value) }),
        React.createElement(Button, {
          variant: 'ghost',
          size: 'sm',
          onClick: () => { const all: Record<string, boolean> = {}; for (const id of filtered) if (byId[id]?.running !== true) all[id] = true; setSel(all) },
        }, '全选可归档'),
        React.createElement(Button, { variant: 'ghost', size: 'sm', onClick: () => setSel({}) }, '清空'),
      ),
      React.createElement('div', { className: 'vx-list' },
        filtered.map((id) => {
          const sum = byId[id]
          const running = sum?.running === true
          return React.createElement('label', { key: id, className: 'vx-check-row' },
            React.createElement('input', { type: 'checkbox', disabled: running, checked: sel[id] === true, onChange: (event: React.ChangeEvent<HTMLInputElement>) => { const next = { ...sel }; if (event.target.checked) next[id] = true; else delete next[id]; setSel(next) } }),
            React.createElement('span', { className: 'vx-check-title' }, sum !== undefined ? (sum.displayTitle || sum.title || id) : id),
            running ? React.createElement(Badge, { tone: 'neutral' }, '运行中，不可归档') : null,
          )
        }),
      ),
    )
  }

  /** Anchor of the header quick panel; the click handler stores the button.
   *  A plain mutable object, not React.useRef: the install function is not a
   *  component, so calling a hook here reads a null dispatcher. */
  const panelAnchorRef: { current: HTMLElement | null } = { current: null }

  /**
   * Appearance write handlers shared by the quick panel and the settings page.
   * Discrete choices save once; a slider drag publishes immediately and only
   * the host POST is debounced.
   */
  function useAppearanceBindings(cfg: CustomPluginConfig) {
    const tier = tierFromCfg(cfg)
    const preset = presetForTier(tier, cfg.bgFxPreset)
    const set = (key: keyof CustomPluginConfig, value: string | boolean): void => {
      setS({ cfg: { ...S.cfg, [key]: value } })
      saveCfg()
    }
    const pickTier = (next: BgTier): void => {
      if (next === tier) return
      bgSaveDebounced.cancel()
      setS({ cfg: { ...S.cfg, bgFx: next, bgFxPreset: presetForTier(next, S.cfg.bgFxPreset) } })
      saveCfg()
    }
    const pickPreset = (next: BgFxPreset): void => {
      bgSaveDebounced.cancel()
      setS({ cfg: { ...S.cfg, bgFxPreset: next } })
      saveCfg()
    }
    const moveParam = (key: BgParamKey, value: number): void => {
      setS({ cfg: setParamInCfg(S.cfg, tier, preset, key, value) })
      bgSaveDebounced.push()
    }
    const pickStrength = (next: BgStrength): void => {
      if (next === strengthFromCfg(cfg)) return
      bgSaveDebounced.cancel()
      setS({ cfg: setStrengthInCfg(S.cfg, next) })
      saveCfg()
    }
    const pickFocus = (next: boolean): void => {
      if ((S.cfg.bgFocus !== false) === next) return
      bgSaveDebounced.cancel()
      setS({ cfg: { ...S.cfg, bgFocus: next } })
      saveCfg()
    }
    const restoreDefaults = (): void => {
      bgSaveDebounced.cancel()
      setS({ cfg: resetBgParams(S.cfg) })
      saveCfg()
    }
    return {
      tier,
      preset,
      onSet: set,
      onTier: pickTier,
      onPreset: pickPreset,
      onStrength: pickStrength,
      onFocus: pickFocus,
      onParam: moveParam,
      onRestoreParams: restoreDefaults,
    }
  }

  /** The host settings panel is portalled to <body> while open. */
  function hostSettingsDialog(): HTMLElement | null {
    if (typeof document === 'undefined') return null
    return document.querySelector<HTMLElement>('[role="dialog"][data-shortcut-modal="settings"]')
  }

  /** Click the first matching node, preferring one that is actually laid out. */
  function clickFirst(selector: string): boolean {
    if (typeof document === 'undefined') return false
    const nodes = [...document.querySelectorAll<HTMLElement>(selector)]
    const target = nodes.find((node) => node.getClientRects().length > 0) ?? nodes[0]
    if (target === undefined) return false
    target.click()
    return true
  }

  /** Poll a DOM probe until it finds something or the timeout elapses. */
  async function waitForDom<T>(probe: () => T | null, timeoutMs: number): Promise<T | null> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() <= deadline) {
      const value = probe()
      if (value !== null) return value
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    return null
  }

  /**
   * Open the host's settings page on our section. The shell publishes no
   * "open settings" method, and the sidebar entry is the account menu on a
   * default Desktop install, so this walks the real entry controls (account
   * menu → 设置, or a direct trigger) and then selects our nav cell. Anything
   * that cannot be reached falls back to the shortcut toast instead of
   * pretending it navigated.
   */
  function openHostSettings(sectionLabel?: string): void {
    const sectionFor = (label: string | undefined): string => {
      switch (label) {
        case '提示词': return 'prompts'
        case '用量与额度': return 'usage'
        case '搜索': return 'search'
        case '项目文件夹': return 'folders'
        case '扩展': return 'extensions'
        default: return 'appearance'
      }
    }
    setS({ settingsSection: sectionFor(sectionLabel) })
    const fallback = (): void => {
      const path = sectionLabel === undefined ? '设置 → 个性化' : `设置 → 个性化 → ${sectionLabel}`
      const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
      toast(`按 ${isMac ? '⌘+,' : 'Ctrl+Alt+,'} 打开${path}`, 'info')
    }
    if (typeof document === 'undefined') { fallback(); return }
    void (async () => {
      let dialog = hostSettingsDialog()
      if (dialog === null) {
        // The host opens Settings from its own shortcut handler, which accepts
        // the synthetic keydown (the menu route below is only a fallback). Try
        // the desktop binding first, then the web binding.
        const press = (init: KeyboardEventInit): void => {
          document.dispatchEvent(new KeyboardEvent('keydown', {
            key: ',', code: 'Comma', bubbles: true, cancelable: true, composed: true, ...init,
          }))
        }
        const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
        press(isMac ? { metaKey: true } : { ctrlKey: true })
        dialog = await waitForDom(hostSettingsDialog, 220)
        if (dialog === null) {
          press({ ctrlKey: true, altKey: true })
          dialog = await waitForDom(hostSettingsDialog, 300)
        }
        if (dialog === null && !isMac) {
          press({ metaKey: true })
          dialog = await waitForDom(hostSettingsDialog, 260)
        }
      }
      if (dialog === null) {
        const direct = clickFirst('button[aria-haspopup="dialog"][aria-keyshortcuts]')
          || clickFirst('button[aria-label="设置"], button[aria-label="Settings"]')
        if (!direct) {
          const findItem = (): HTMLElement | null => {
            const rows = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
            return rows.find((row) => /^(设置|Settings)/.test((row.textContent ?? '').trim())) ?? null
          }
          let item = findItem()
          if (item === null) {
            const launcher = clickFirst('button[aria-label="账号菜单"], button[aria-label="Account menu"]')
              || clickFirst('button[aria-haspopup="menu"][data-collapsed]')
            if (!launcher) { fallback(); return }
            item = await waitForDom(findItem, 800)
          }
          if (item === null) { fallback(); return }
          item.click()
        }
        dialog = await waitForDom(hostSettingsDialog, 1500)
        if (dialog === null) { fallback(); return }
      }
      const nav = dialog.querySelector('nav')
      const candidates = (): HTMLElement[] => nav === null
        ? []
        : [...nav.querySelectorAll<HTMLElement>('button')].filter((cell) => (cell.textContent ?? '').trim().includes('个性化'))
      for (let index = 0; index < candidates().length; index++) {
        // Re-query each pass: selecting another section re-renders the nav.
        const cell = candidates()[index]
        if (cell === undefined) break
        cell.click()
        const mounted = await waitForDom(() => dialog?.querySelector('.vx-settings-nav') === null ? null : true, 500)
        if (mounted !== null) return
      }
      if (dialog.querySelector('.vx-settings-nav') !== null) return
      fallback()
    })()
  }

  /**
   * Header quick panel: a 380px anchored popover with the appearance controls
   * only. Management lives in the settings page; this surface opens under the
   * button, closes on Escape/outside press, and hands focus back to it.
   */
  function QuickAppearancePanel(): React.ReactElement {
    const s = useS()
    const { cfg, dark } = useSSelector(selectAppearanceSlice, shallowEqual)
    const bindings = useAppearanceBindings(cfg)
    return React.createElement(Popover, {
      open: s.panelOpen,
      anchor: panelAnchorRef,
      onClose: () => setS({ panelOpen: false }),
      ariaLabel: '个性化',
      width: 380,
      maxHeight: 620,
      align: 'end',
    },
      React.createElement('div', { className: 'vx-pop-head' },
        React.createElement(Icon, { n: 'sliders', size: 13 }),
        React.createElement('span', null, '个性化'),
        React.createElement('span', { className: 'vx-flex1' }),
        React.createElement(IconButton, {
          label: '关闭个性化面板',
          size: 'sm',
          icon: React.createElement(Icon, { n: 'x', size: 12 }),
          onClick: () => setS({ panelOpen: false }),
        }),
      ),
      React.createElement('div', { className: 'vx-pop-body' },
        React.createElement(AppearanceControls, { cfg, dark, compact: true, ...bindings }),
      ),
      React.createElement('div', { className: 'vx-pop-foot' },
        React.createElement(Button, { variant: 'ghost', size: 'sm', onClick: () => { setS({ panelOpen: false }); openHostSettings() } }, '完整设置'),
        React.createElement('span', { className: 'vx-flex1' }),
        React.createElement('span', { className: 'vx-muted' }, '外观即时生效'),
      ),
    )
  }

  function SidebarFoldersPanel(props: { useSessions: OverlayProps['useSessions']; useWorkspaces: OverlayProps['useWorkspaces'] }): React.ReactElement {
    const s = useS()
    return React.createElement(Popover, {
      open: s.foldersOpen === true,
      anchor: foldersAnchorRef,
      onClose: () => setS({ foldersOpen: false }),
      ariaLabel: '项目文件夹',
      width: 300,
      maxHeight: 560,
      align: 'start',
      className: 'vx-folders-pop',
    },
      React.createElement('div', { className: 'vx-pop-head' },
        React.createElement(Icon, { n: 'folder', size: 13 }),
        React.createElement('span', null, '项目文件夹'),
        React.createElement('span', { className: 'vx-flex1' }),
        React.createElement(IconButton, {
          label: '新建文件夹',
          size: 'sm',
          icon: React.createElement(Icon, { n: 'folderPlus', size: 12 }),
          onClick: () => askText('文件夹名称：', '', (name) => {
            if (name.trim() === '') return
            S.folders = S.folders.concat({ id: 'f' + Date.now() + Math.floor(Math.random() * 9999), name, children: [], sessionIds: [], workspaceIds: [], prompts: [] })
            setS({ folders: S.folders })
            saveCfg()
          }),
        }),
        React.createElement(IconButton, {
          label: '关闭项目文件夹',
          size: 'sm',
          icon: React.createElement(Icon, { n: 'x', size: 12 }),
          onClick: () => setS({ foldersOpen: false }),
        }),
      ),
      React.createElement('div', { className: 'vx-pop-body' },
        S.folders.length === 0 ? React.createElement('div', { className: 'vx-muted vx-pad-sm' }, '暂无文件夹。在个性化中心可管理，或点击右上角新建。') : null,
        S.folders.map((f) => React.createElement(FolderNode, { key: f.id, node: f, useSessions: props.useSessions, useWorkspaces: props.useWorkspaces })),
      ),
    )
  }

  /** Settings sections, in navigation order. */
  const SETTINGS_SECTIONS: Array<[string, string, string]> = [
    ['appearance', 'sliders', '外观'],
    ['folders', 'folder', '项目文件夹'],
    ['prompts', 'zap', '提示词'],
    ['search', 'search', '搜索'],
    ['export', 'download', '导出'],
    ['extensions', 'wrench', '扩展'],
    ['usage', 'wallet', '用量与额度'],
    ['data', 'info', '数据与关于'],
  ]

  function AppearanceSection(): React.ReactElement {
    const { cfg, dark } = useSSelector(selectAppearanceSlice, shallowEqual)
    const bindings = useAppearanceBindings(cfg)
    return React.createElement(AppearanceControls, { cfg, dark, ...bindings })
  }

  /**
   * The settings-page hub. The host renders this entry inside its own settings
   * page; the left navigation and the cards are ours, everything visual comes
   * from the host tokens.
   */
  function SettingsPage(props: Partial<OverlayProps>): React.ReactElement {
    const section = useSSelector((state) => state.settingsSection)
    // The settings surface can live in its own host window, whose <html> does
    // not necessarily carry the appearance classes applied to the main window.
    // Mirror the material decision on this subtree so cards keep the frost /
    // liquid treatment (and the filter is present in this document).
    const glassOn = useSSelector((state) => state.cfg.glass === true)
    const liquid = useSSelector((state) => state.cfg.glass === true && state.cfg.glassMode === 'liquid')
    const bgLive = useSSelector((state) => state.cfg.bgFx !== 'none')
    const pageRef = React.useRef<HTMLDivElement | null>(null)
    React.useEffect(() => {
      if (!liquid) return
      const doc = pageRef.current?.ownerDocument
      if (doc !== undefined) ensureLiquidGlass(doc)
    }, [liquid])
    // The host settings overlay is above .vx-root; global modals and toasts
    // must render from inside it while it is mounted or they are invisible.
    React.useEffect(() => {
      setS({ settingsSurfaceOpen: true })
      return () => { setS({ settingsSurfaceOpen: false }) }
    }, [])
    // The host panel owns the scroll container; entering a section from a
    // scrolled position would otherwise keep that offset on the new cards.
    React.useEffect(() => {
      let node = document.getElementById('vx-settings-page')?.parentElement ?? null
      while (node !== null) {
        const overflowY = getComputedStyle(node).overflowY
        if (overflowY === 'auto' || overflowY === 'scroll') { node.scrollTop = 0; return }
        node = node.parentElement
      }
    }, [section])
    const useSessions = (props.useSessions ?? useBridgedSessions) as OverlayProps['useSessions']
    const useWorkspaces = (props.useWorkspaces ?? useBridgedWorkspaces) as OverlayProps['useWorkspaces']
    const foldersProps = { useSessions, useWorkspaces }
    const pick = (id: string): void => setS({ settingsSection: id })
    // The page root carries the whole material decision: the settings surface is
    // hosted in its own document, where the appearance classes on the main
    // <html> do not exist. Cards are transparent groups inside that sheet, not a
    // second material layer.
    const card = (cardProps: React.ComponentProps<typeof Card>, ...children: React.ReactNode[]): React.ReactElement => {
      return React.createElement(Card, cardProps, ...children)
    }
    const content = (): React.ReactElement => {
      if (section === 'folders') {
        return card({
          title: '项目文件夹',
          description: '跨工作区共享的会话与工作区收藏夹，支持多级嵌套与拖拽排序。',
        }, React.createElement(FoldersTab, foldersProps))
      }
      if (section === 'prompts') {
        return card({
          title: '提示词',
          description: '收藏、标签与变量模板；插入到当前输入框。',
        }, React.createElement(PromptsTab, null))
      }
      if (section === 'search') {
        return card({
          title: '会话搜索',
          description: '搜索当前会话的消息与工具记录。',
        }, React.createElement(SearchTab, null))
      }
      if (section === 'export') {
        return card({
          title: '导出与备份',
          description: '把当前会话导出为 JSON、Markdown 或 HTML；备份非敏感状态。',
        }, React.createElement(ExportTab, null))
      }
      if (section === 'extensions') {
        return React.createElement(React.Fragment, null,
          card({ title: 'Mermaid', description: '助手回复中的图表代码块自动就地渲染。' }, React.createElement(MermaidTab, null)),
          card({ title: '效率工具', description: '防自动跳转、公式复制与批量归档。' }, React.createElement(ToolsTab, null)),
        )
      }
      if (section === 'usage') {
        return card({
          title: '用量与额度',
          description: '本机会话记录统计；费用为按官方价目表折算的估算值。',
        }, React.createElement(BalancePanelContent, null))
      }
      if (section === 'data') {
        return React.createElement(React.Fragment, null,
          card({ title: '备份', description: '导出或导入不含账号凭据的本地状态。' }, React.createElement(BackupControls, null)),
          card({ title: '关于', description: '版本、状态文件与诊断信息。' }, React.createElement(AboutTab, null)),
        )
      }
      return card({
        title: '外观',
        description: '主题背景、天气特效、背景动效与玻璃质感，选择后即时生效。',
      }, React.createElement(AppearanceSection, null))
    }
    return React.createElement(React.Fragment, null,
      React.createElement('div', {
        ref: pageRef,
        className: 'vx-settings-page vx-settings-shell'
          + (glassOn ? ' vx-glass-on' : ' vx-glass-off')
          + (liquid ? ' vx-liquid' : '')
          + (bgLive ? ' vx-bg-live' : ''),
        id: 'vx-settings-page',
      },
        React.createElement('nav', { className: 'vx-settings-nav', 'aria-label': '个性化设置分区' },
          SETTINGS_SECTIONS.map(([id, iconName, label]) => React.createElement('button', {
            key: id,
            type: 'button',
            className: 'vx-settings-nav-item' + (section === id ? ' on' : ''),
            'aria-current': section === id ? 'page' : undefined,
            onClick: () => pick(id),
          }, React.createElement(Icon, { n: iconName, size: 14 }), label)),
        ),
        React.createElement('div', { className: 'vx-settings-content' },
          React.createElement('div', { key: section, className: 'vx-section-in' }, content())),
      ),
      // Global decision surfaces follow the settings overlay's stacking level.
      React.createElement(SettingsOverlays, { useSessions: foldersProps.useSessions, useWorkspaces: foldersProps.useWorkspaces }),
    )
  }

  /** Modals/toasts owned by the settings overlay while it is open. */
  function SettingsOverlays(props: { useSessions?: OverlayProps['useSessions']; useWorkspaces?: OverlayProps['useWorkspaces'] }): React.ReactElement {
    return React.createElement(React.Fragment, null,
      React.createElement(AskModal, { key: 'ask' }),
      React.createElement(ConfirmModal, { key: 'confirm' }),
      React.createElement(TemplateModal, { key: 'template' }),
      React.createElement(MermaidModal, { key: 'mermaid' }),
      React.createElement(BatchModal, { key: 'batch', useSessions: props.useSessions as OverlayProps['useSessions'] }),
      React.createElement(CommandPalette, { key: 'command', useSessions: props.useSessions as OverlayProps['useSessions'], useWorkspaces: props.useWorkspaces as OverlayProps['useWorkspaces'] }),
      React.createElement(Toasts, { key: 'toasts' }),
    )
  }

  function Toasts(): React.ReactElement {
    const toasts = useSSelector((state) => state.toasts)
    return React.createElement(ToastStack, { items: toasts, onDismiss: dismissToast })
  }

  function OverlayRoot(props: OverlayProps): React.ReactElement {
    // The overlay tree is always mounted; subscribe only to the fields it
    // renders (overlays/config/theme/session), not to turns/toasts/usage.
    const {
      cfg, dark, booted, sessionId, settingsSurfaceOpen,
    } = useSSelector(
      (state) => ({
        cfg: state.cfg,
        dark: state.dark,
        booted: state.booted,
        sessionId: state.sessionId,
        settingsSurfaceOpen: state.settingsSurfaceOpen,
      }),
      shallowEqual,
    )
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
    React.useEffect(() => {
      const d = typeof document !== 'undefined' ? document : null
      if (d === null) return
      const onKey = (event: KeyboardEvent): void => {
        const target = event.target as HTMLElement | null
        if (!isCommandPaletteShortcut(event, target)) return
        event.preventDefault()
        setS({ commandOpen: !S.commandOpen })
      }
      d.addEventListener('keydown', onKey)
      return () => d.removeEventListener('keydown', onKey)
    }, [])
    React.useEffect(() => { if (booted) applyAppearance() }, [booted, cfg.bg, cfg.bgFx, cfg.bgFxPreset, cfg.bgStrength, cfg.bgDensity, cfg.bgSpeed, cfg.bgFps, cfg.bgFontPx, cfg.bgOpacity, cfg.bgIntensity, cfg.bgFocus, cfg.glass, cfg.glassMode, cfg.globalGlass, dark])
    React.useEffect(() => {
      syncAntiScroll(cfg.antiScroll === true)
      // Unmount/disable must restore scroll-behavior on every element this
      // page-global effect touched; otherwise the GUI keeps the forced
      // `auto` behavior after the plugin is gone.
      return () => { syncAntiScroll(false) }
    }, [cfg.antiScroll])
    React.useEffect(() => {
      const w = typeof window !== 'undefined' ? window : null
      const d = typeof document !== 'undefined' ? document : null
      const applyDark = (nextDark: boolean): void => {
        // Palette backgrounds follow the theme now (dark variants are
        // derived), so a flip only needs to re-render and re-paint.
        S.dark = nextDark
        setS({ dark: nextDark })
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
      setS({ dark })
    }, [booted])
    // Mirror the resolved GUI theme onto <html>: the glass fill rules are
    // theme-scoped at :root so they reach every surface with one selector —
    // including ones mounted outside .vx-root (the balance hover), which the
    // .vx-root-scoped rules can never match.
    React.useEffect(() => {
      const d = typeof document !== 'undefined' ? document : null
      if (d === null) return
      d.documentElement.classList.toggle('vx-dark', dark === true)
      d.documentElement.classList.toggle('vx-light', dark !== true)
    }, [dark])
    // Refresh the turns data while the session is streaming: the turn-tail
    // chips (LaTeX / MathML / Mermaid) appear as soon as the next fetch lands,
    // without waiting for a session switch to trigger one.
    const sessions = useSessionsSafe(props)
    const workspaces = useWorkspacesSafe(props)
    const lastIndexRef = React.useRef<{ sessions: SessionListLike | null; workspaces: WorkspaceListLike | null }>({ sessions: null, workspaces: null })
    React.useEffect(() => {
      if (lastIndexRef.current.sessions === sessions && lastIndexRef.current.workspaces === workspaces) return
      lastIndexRef.current = { sessions, workspaces }
      setS({
        sessionIndex: sessions === null ? null : { ...sessions, ids: uniqueIds(sessions.ids) },
        workspaceIndex: workspaces,
      })
    }, [sessions, workspaces])
    const summary = sessions !== null && sessionId !== null ? sessions.byId[sessionId] : null
    React.useEffect(() => {
      const watchedId = S.sessionId
      if (watchedId === null) return
      const running = summary?.running === true
      if (!running) return
      let inFlight = false
      const tick = (): void => {
        if (inFlight) return
        const d = typeof document !== 'undefined' ? document : null
        // Background tabs do not need a full log replay every 3 seconds; the
        // visibility handler catches up immediately on return.
        if (d !== null && d.hidden) return
        const id = S.sessionId
        if (id === null) return
        inFlight = true
        void fetchTurns(id).finally(() => { inFlight = false })
      }
      const handle = setInterval(tick, 3000)
      const onVisibility = (): void => {
        const d = typeof document !== 'undefined' ? document : null
        if (d === null || !d.hidden) tick()
      }
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
      return () => {
        clearInterval(handle)
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
        // The run just ended (or the effect re-ran): take one final snapshot
        // so the last streamed turn's chips land without a manual session
        // switch. A session switch is handled by useViewedSession, so only
        // fetch when the watched session is still the selected one.
        if (!disposed && S.sessionId === watchedId) void fetchTurns(watchedId)
      }
    }, [sessionId, summary?.running])
    const children: React.ReactElement[] = [React.createElement(FxCanvas, { key: 'fx' })]
    children.push(React.createElement(MermaidInPlace, { key: 'mmd' }))
    // The quick panel stays mounted so its exit animation can run; the
    // Popover renders nothing while fully closed.
    children.push(React.createElement(QuickAppearancePanel, { key: 'panel' }))
    children.push(React.createElement(SidebarFoldersPanel, { key: 'folders', useSessions: props.useSessions, useWorkspaces: props.useWorkspaces }))
    children.push(React.createElement(PromptPopover, { key: 'prompt' }))
    children.push(React.createElement(BalancePopover, { key: 'balance' }))
    // The host settings overlay sits at body-level z-index 1000, above the
    // shell's overlay layer that contains .vx-root. While our hub is mounted
    // inside it, the global modals/toasts must render from SettingsPage or
    // they would be invisible behind that overlay.
    if (!settingsSurfaceOpen) {
      // Keep the decision surfaces mounted so Dialog can run its exit motion.
      children.push(React.createElement(MermaidModal, { key: 'mermaid' }))
      children.push(React.createElement(BatchModal, { key: 'batch', useSessions: props.useSessions }))
      children.push(React.createElement(CommandPalette, { key: 'command', useSessions: props.useSessions, useWorkspaces: props.useWorkspaces }))
      children.push(React.createElement(AskModal, { key: 'ask' }))
      children.push(React.createElement(ConfirmModal, { key: 'confirm' }))
      children.push(React.createElement(TemplateModal, { key: 'template' }))
      children.push(React.createElement(Toasts, { key: 'toasts' }))
    }
    return React.createElement('div', { className: `vx-root ${dark ? 'vx-dark' : 'vx-light'}` }, children)
  }

  // ================= install =================
  setDynCss('')
  try { ensureLiquidGlass() } catch (error) { reportDiag('ensureLiquidGlass: ' + String((error as Error)?.message ?? error)) }
  const slots = C.get('slots') as { inject(key: string, fn: () => (() => void) | void): (() => void) | void; register(options: Record<string, unknown>, component: unknown): () => void } | undefined
  if (slots === undefined) {
    console.error('[custom-plugin] slots service unavailable')
    reportDiag('slots service unavailable; surfaces skipped')
    return () => {}
  }
  const unregisterAll: Array<() => void> = []
  const injectedKeys = new Set<string>()
  let injectedCount = 0
  const injectOne = (key: string, id: string, options: Record<string, unknown>, comp: unknown): void => {
    try {
      slots.inject(key, () => {
        try {
          const unregister = slots.register({ name: key, ...options }, comp)
          unregisterAll.push(unregister)
          return unregister
        } catch (error) {
          // `register` runs later, when the host materializes the slot, so it is
          // outside the try below: without this guard a rejected registration
          // (wrong slot kind, bad options) would take the surface down silently
          // while the ring still read green.
          reportDiag('register ' + key + ' (' + id + '): ' + String((error as Error)?.message ?? error))
          return () => {}
        }
      })
      reportDiag('ok ' + key + ' (' + id + ')')
      injectedCount++
      injectedKeys.add(key)
    } catch (error) {
      const message = 'inject ' + key + ' (' + id + '): ' + String((error as Error)?.message ?? error)
      console.error('[custom-plugin] ' + message)
      reportDiag(message)
    }
  }
  injectOne('sidebar.footer.action', 'custom-plugin-folders', { id: 'custom-plugin-folders', order: -100, label: '项目' }, FolderSidebarButton)
  injectOne('shell.overlay', 'custom-plugin-overlay', { id: 'custom-plugin-overlay', order: 10, label: 'Custom 便利套件' }, OverlayRoot)
  injectOne('conversation.input.dock', 'custom-plugin-column-bg', { id: 'custom-plugin-column-bg', order: 20, label: '会话区背景' }, ColumnBgAnchor)
  injectOne('conversation.input.dock', 'custom-plugin-input', { id: 'custom-plugin-input', order: 30, label: '输入桥接' }, InputBridge)
  injectOne('conversation.chat.turnTail', 'custom-plugin-turn-tail', { id: 'custom-plugin-turn-tail', order: 10 }, TurnTailEntry)
  injectOne('settings.section', 'custom-plugin-appearance', { id: 'custom-plugin-appearance', order: 30, label: '个性化' }, SettingsPage)
  injectOne('conversation.session.header.actions', 'custom-plugin-panel-open', { id: 'custom-plugin-panel-open', order: 5, label: '个性化' }, HeaderPanelButton)
  injectOne('conversation.session.header.actions', 'custom-plugin-prompts', { id: 'custom-plugin-prompts', order: 6, label: '提示词' }, PromptQuickButton)
  injectOne('conversation.session.header.utilities', 'custom-plugin-balance', { id: 'custom-plugin-balance', order: -5, label: '额度' }, HeaderBalance)
  // Requests submitted, not surfaces proven: dsh defers the callback above until
  // the slot is declared, so nothing here knows yet whether the host accepted
  // any of them. Materialization reports itself, per slot, through the `ok` /
  // `register` lines this one follows.
  reportDiag(`client installed: ${injectedCount} injection requests / ${injectedKeys.size} slots`)
  return () => {
    disposed = true
    for (const unregister of unregisterAll.splice(0)) {
      try { unregister() } catch { /* already unregistered */ }
    }
    if (loadRetryTimer !== null) {
      clearTimeout(loadRetryTimer)
      loadRetryTimer = null
    }
    if (greetTimer !== null) {
      clearTimeout(greetTimer)
      greetTimer = null
    }
    // A slider burst may still be waiting to POST when the plugin is disabled;
    // drop it rather than writing after teardown.
    bgSaveDebounced.cancel()
    if (stateChannel !== null) {
      try { stateChannel.close() } catch { /* already closed */ }
    }
    // The calm-zone poll is a page-global timer owned by the background
    // painter; it must not survive the plugin.
    stopBgFocusTracking()
    // Slot teardown unmounts only the React surfaces; the appearance
    // painter's page-global side effects — theme token overrides, root
    // classes, the liquid-glass SVG filter, a pending balance retry — live
    // outside those surfaces and outlive a live disable/re-declare unless
    // reverted here.
    if (tokenDisposer !== null) {
      try { tokenDisposer() } catch { /* best effort */ }
      tokenDisposer = null
    }
    lastTokenKey = null
    lastTokenTheme = undefined
    if (balanceRetryTimer !== null) {
      clearTimeout(balanceRetryTimer)
      balanceRetryTimer = null
    }
    // Both settle DOM the plugin owns rather than styles: the anti-scroll
    // attributes and the in-place Mermaid wrappers would otherwise outlive
    // the plugin (the React effect cleanup does not run for entries the host
    // unmounts after this disposer).
    try { syncAntiScroll(false) } catch { /* best effort */ }
    try { mermaidScanner.restore() } catch { /* best effort */ }
    const d = typeof document !== 'undefined' ? document : null
    if (d !== null) {
      for (const cls of ['vx-liquid', 'vx-bg-live', 'vx-glass-off', 'vx-dark', 'vx-light']) {
        try { d.documentElement.classList.remove(cls) } catch { /* classList unavailable */ }
      }
      try { d.getElementById('vx-lg-filter')?.remove() } catch { /* node already gone */ }
      // The background layer is a page-global node created by the appearance
      // painter, not by a slot surface: the host can unmount slot entries
      // after this disposer, so React effect cleanup may never run for it.
      // The renderer goes first (canvas/context, rAF, listeners, observer,
      // atlas, level buffer), then the host node that contained the canvas.
      if (bgLayerHealTimer !== null) {
        clearTimeout(bgLayerHealTimer)
        bgLayerHealTimer = null
      }
      destroyBgRenderer()
      try { unmountBgLayer(d as unknown as BgLayerDocLike) } catch { /* node already gone */ }
    }
    removeDynCss()
  }
}
