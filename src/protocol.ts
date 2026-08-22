/**
 * Wire protocol shared by the host routes and the browser transport.
 *
 * The browser talks to the host through plain same-origin fetch against
 * {@link CUSTOM_PLUGIN_API_PREFIX}; every handler answers with the `{ ok }`
 * envelope below so the client can surface host errors without coupling to
 * route details. Types here are the JSON currency only — no Cordis or React
 * objects cross this boundary.
 * @module @alexpeng/dsh-custom-plugin/protocol
 */

/** Prefix of every host route this plugin registers. */
export const CUSTOM_PLUGIN_API_PREFIX = '/api/custom-plugin'

/** Path the host serves the fetched Mermaid engine at (script src). */
export const MERMAID_SCRIPT_PATH = '/custom-plugin/mermaid.js'

/** Plugin appearance and behavior configuration, persisted in the host state file. */
export interface CustomPluginConfig {
  /** Background preset: 'default' | 'aurora' | one of the 20 palette names. */
  bg?: string
  /** Weather overlay: 'none' | 'snow' | 'rain' | 'sakura'. */
  weather?: string
  /** Master glass toggle for the plugin's own surfaces. */
  glass?: boolean
  /** 'frost' frosted glass or 'liquid' displacement glass. */
  glassMode?: 'frost' | 'liquid'
  /** Apply backdrop blur to global dialogs/menus/tooltips as well. */
  globalGlass?: boolean
  /** Show the per-user-message timeline rail. */
  timeline?: boolean
  /** Place the timeline rail on the left instead of the right. */
  timelineLeft?: boolean
  /** Show only starred timeline nodes. */
  starsOnly?: boolean
  /** Enable the selection-quote-reply feature. */
  quote?: boolean
  /** Force `scroll-behavior: auto` to stop automatic jump-to-bottom. */
  antiScroll?: boolean
  /** Show LaTeX / MathML copy chips under matching messages. */
  formula?: boolean
  /** Show Mermaid render chips under matching messages. */
  mermaid?: boolean
}

/** Default configuration (also the composition-layer default). */
export const DEFAULT_CONFIG: CustomPluginConfig = {
  bg: '天青灰',
  weather: 'none',
  glass: true,
  glassMode: 'frost',
  globalGlass: true,
  timeline: true,
  timelineLeft: false,
  starsOnly: false,
  quote: true,
  antiScroll: false,
  mermaid: true,
  formula: true,
}

/** One folder node in the multi-level project tree. */
export interface FolderNode {
  id: string
  name: string
  children: FolderNode[]
  sessionIds: string[]
  workspaceIds: string[]
  prompts: string[]
}

/** One saved prompt. */
export interface PromptItem {
  id: string
  name: string
  text: string
}

/** Starred timeline nodes, keyed by session id then by user-message seq. */
export type StarsMap = Record<string, Record<string, boolean>>

/** Per-model token counters for one day. */
export interface UsageRow {
  in: number
  out: number
  cacheIn: number
  cacheW: number
  reason: number
  calls: number
  /** Peak-hour (Beijing 09-12 / 14-18) portion of each counter; the rest is
   * off-peak. Optional because rows persisted before the peak/off-peak split
   * predate these fields. */
  peakIn?: number
  peakCacheIn?: number
  peakCacheW?: number
  peakOut?: number
}

/** Day -> model -> counters. */
export type UsageMap = Record<string, Record<string, UsageRow>>

/** The complete persisted state file shape. */
export interface CustomPluginState {
  cfg: CustomPluginConfig
  folders: FolderNode[]
  prompts: PromptItem[]
  stars: StarsMap
  /** DeepSeek API key for the balance panel; kept out of settings config. */
  apiKey: string
  usage: UsageMap
}

/** One timeline node: one direct user message in a session. */
export interface TimelineItem {
  seq: number
  time: number
  turn: number
  text: string
  imageCount: number
  hasLatex: boolean
  hasMathml: boolean
  hasMermaid: boolean
}

/** Balance payload returned by the DeepSeek balance endpoint. */
export interface BalanceInfo {
  currency: string
  total: string
  granted: string
  toppedUp: string
}
