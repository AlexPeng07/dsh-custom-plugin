/**
 * The background-motion panel's pure half: which knobs a tier exposes, how a
 * stored flat value maps onto a preset's declared `ranges`, and the debounced
 * saver the sliders use.
 *
 * Everything here is React-free and DOM-free on purpose. The panel component
 * only renders; all clamping, fallback and timing rules live in functions a
 * node test can call directly. The two renderer modules own the `ranges`
 * themselves — this module never duplicates a bound.
 * @module @alexpeng/dsh-custom-plugin/client/bg-params
 */

import { ASCII_PRESETS, resolveAsciiPreset, type AsciiParams, type AsciiPreset } from './bg-ascii.ts'
import { SHADER_STYLES, resolveShaderStyle, type ShaderParams, type ShaderStyle } from './bg-shader.ts'
import { BG_FX_ASCII_PRESETS, BG_FX_SHADER_STYLES, type BgFxPreset, type CustomPluginConfig } from '../protocol.ts'

/** Stored value meaning "follow the active preset's own default". */
export const BG_PARAM_UNSET = -1

/** Slider debounce: one POST per pause, not one per input event. */
export const BG_PARAM_SAVE_MS = 320

/** The three-tier value space of `bgFx`. */
export type BgTier = 'none' | 'ascii' | 'shader'

/** Every knob the panel can render. */
export type BgParamKey = 'density' | 'speed' | 'fps' | 'fontPx' | 'opacity' | 'intensity'

/** The flat config field that stores one knob. */
export type BgParamCfgKey = 'bgDensity' | 'bgSpeed' | 'bgFps' | 'bgFontPx' | 'bgOpacity' | 'bgIntensity'

/** Presentation metadata for one slider row. */
export interface BgParamMeta {
  readonly key: BgParamKey
  readonly cfgKey: BgParamCfgKey
  readonly label: string
  readonly unit: string
  readonly step: number
  readonly decimals: number
}

export const BG_PARAM_META: Record<BgParamKey, BgParamMeta> = {
  density: { key: 'density', cfgKey: 'bgDensity', label: '密度', unit: '', step: 0.05, decimals: 2 },
  speed: { key: 'speed', cfgKey: 'bgSpeed', label: '速度', unit: '', step: 0.05, decimals: 2 },
  fps: { key: 'fps', cfgKey: 'bgFps', label: '帧率', unit: '', step: 1, decimals: 0 },
  fontPx: { key: 'fontPx', cfgKey: 'bgFontPx', label: '字号', unit: ' px', step: 1, decimals: 0 },
  opacity: { key: 'opacity', cfgKey: 'bgOpacity', label: '浓度', unit: '', step: 0.05, decimals: 2 },
  intensity: { key: 'intensity', cfgKey: 'bgIntensity', label: '强度', unit: '', step: 0.05, decimals: 2 },
}

/** Knobs the ASCII tier exposes, in render order. */
export const BG_ASCII_PARAM_KEYS: readonly BgParamKey[] = ['density', 'speed', 'fps', 'fontPx', 'opacity']

/** Knobs the shader tier exposes, in render order (no font/opacity there). */
export const BG_SHADER_PARAM_KEYS: readonly BgParamKey[] = ['density', 'speed', 'intensity', 'fps']

/** Which sliders a tier shows. `none` shows none, so the panel can hide the
 * whole block instead of rendering disabled rows. */
export function panelParamKeys(tier: BgTier): readonly BgParamKey[] {
  if (tier === 'ascii') return BG_ASCII_PARAM_KEYS
  if (tier === 'shader') return BG_SHADER_PARAM_KEYS
  return []
}

/** Read the tier from a config snapshot; unknown modes are `none`. */
export function tierFromCfg(cfg: CustomPluginConfig): BgTier {
  const mode = cfg.bgFx
  return mode === 'ascii' || mode === 'shader' ? mode : 'none'
}

/**
 * Pick the preset a tier can mount. Switching tiers with a preset id from the
 * other tier (or a hand-edited unknown value) lands on that tier's default
 * instead of mounting a piece the renderer does not know.
 */
export function presetForTier(tier: BgTier, preset: string | undefined): BgFxPreset {
  if (tier === 'shader') return resolveShaderStyle(preset)
  return resolveAsciiPreset(preset)
}

/** Inclusive slider bounds for one knob, or null when the tier has no such
 * knob. Reads the active preset's own `ranges` — never a local copy. */
export function paramRange(tier: BgTier, preset: BgFxPreset, key: BgParamKey): { min: number, max: number } | null {
  if (tier === 'ascii') {
    const spec = ASCII_PRESETS[resolveAsciiPreset(preset)]
    const range = key === 'density' || key === 'speed' || key === 'fps' || key === 'fontPx' || key === 'opacity'
      ? spec.ranges[key]
      : null
    return range === null ? null : { min: range.min, max: range.max }
  }
  if (tier === 'shader') {
    const spec = SHADER_STYLES[resolveShaderStyle(preset)]
    const range = key === 'speed' || key === 'density' || key === 'intensity' || key === 'fps'
      ? spec.ranges[key]
      : null
    return range === null ? null : { min: range.min, max: range.max }
  }
  return null
}

/** The preset's own value for a knob. */
export function paramDefault(tier: BgTier, preset: BgFxPreset, key: BgParamKey): number {
  if (tier === 'ascii') {
    const spec = ASCII_PRESETS[resolveAsciiPreset(preset)] as unknown as Record<string, number>
    return typeof spec[key] === 'number' ? spec[key] : 0
  }
  if (tier === 'shader') {
    const spec = SHADER_STYLES[resolveShaderStyle(preset)] as unknown as Record<string, number>
    return typeof spec[key] === 'number' ? spec[key] : 0
  }
  return 0
}

/** True when the stored value is a real override (anything but the sentinel). */
export function paramConfigured(cfg: CustomPluginConfig, key: BgParamKey): boolean {
  const raw = cfg[BG_PARAM_META[key].cfgKey]
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0
}

/**
 * The value a slider should display: the stored override clamped into the
 * current preset's range, or that preset's default when unset. An unknown
 * preset already resolved to the tier default upstream.
 */
export function effectiveParam(cfg: CustomPluginConfig, tier: BgTier, preset: BgFxPreset, key: BgParamKey): number {
  const range = paramRange(tier, preset, key)
  if (range === null) return 0
  const value = cfg[BG_PARAM_META[key].cfgKey]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return clampInto(paramDefault(tier, preset, key), range.min, range.max)
  }
  return clampInto(value, range.min, range.max)
}

/** Clamp a number into an inclusive band. Non-finite values take the minimum,
 * which is the conservative choice for every knob here. */
export function clampInto(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return value < min ? min : value > max ? max : value
}

/**
 * Write one slider value into a config snapshot: clamp first, then overwrite
 * the flat field. The cfg object is shallow-copied, matching every other panel
 * edit, so the store can diff and subscribers re-render once.
 */
export function setParamInCfg(cfg: CustomPluginConfig, tier: BgTier, preset: BgFxPreset, key: BgParamKey, value: number): CustomPluginConfig {
  const range = paramRange(tier, preset, key)
  const next = { ...cfg }
  next[BG_PARAM_META[key].cfgKey] = range === null ? BG_PARAM_UNSET : clampInto(value, range.min, range.max)
  return next
}

/** Clear every override so each preset's own defaults apply again. */
export function resetBgParams(cfg: CustomPluginConfig): CustomPluginConfig {
  const next = { ...cfg }
  for (const meta of Object.values(BG_PARAM_META)) next[meta.cfgKey] = BG_PARAM_UNSET
  return next
}

/** ASCII renderer overrides for the current config. All five knobs are
 * resolved, so a preset switch is handled by passing the new preset too. */
export function asciiParamsFromCfg(cfg: CustomPluginConfig, preset: AsciiPreset): AsciiParams {
  return {
    density: effectiveParam(cfg, 'ascii', preset, 'density'),
    speed: effectiveParam(cfg, 'ascii', preset, 'speed'),
    fps: effectiveParam(cfg, 'ascii', preset, 'fps'),
    fontPx: effectiveParam(cfg, 'ascii', preset, 'fontPx'),
    opacity: effectiveParam(cfg, 'ascii', preset, 'opacity'),
  }
}

/** Shader renderer overrides for the current config. */
export function shaderParamsFromCfg(cfg: CustomPluginConfig, style: ShaderStyle): ShaderParams {
  return {
    density: effectiveParam(cfg, 'shader', style, 'density'),
    speed: effectiveParam(cfg, 'shader', style, 'speed'),
    intensity: effectiveParam(cfg, 'shader', style, 'intensity'),
    fps: effectiveParam(cfg, 'shader', style, 'fps'),
  }
}

/** Timer surface the debounced saver needs; injectable for tests. */
export interface DebounceTimers {
  set(callback: () => void, delayMs: number): unknown
  clear(handle: unknown): void
}

/** Handle returned by {@link createDebouncedSaver}. */
export interface DebouncedSaver {
  /** (Re)start the timer; a burst of calls still fires `save` once. */
  push(): void
  /** Drop the pending call, e.g. when "restore defaults" saves immediately. */
  cancel(): void
  isPending(): boolean
}

const DEFAULT_TIMERS: DebounceTimers = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/**
 * One timer per burst: every slider input restarts it, and only the pause
 * after the last event POSTs. The save reads the live store when it fires, so
 * the debounced write always carries the final value.
 */
export function createDebouncedSaver(save: () => void, delayMs: number, timers: DebounceTimers = DEFAULT_TIMERS): DebouncedSaver {
  let handle: unknown = null
  const cancel = (): void => {
    if (handle === null) return
    timers.clear(handle)
    handle = null
  }
  return {
    push() {
      cancel()
      handle = timers.set(() => {
        handle = null
        save()
      }, delayMs)
    },
    cancel,
    isPending() {
      return handle !== null
    },
  }
}

/** The slice the appearance tab subscribes to. Kept as one named function so
 * a test can pin the scope: the tab never subscribes to turns, toasts, usage
 * or any other per-turn field. */
export function selectAppearanceSlice(state: { cfg: CustomPluginConfig, dark: boolean }): { cfg: CustomPluginConfig, dark: boolean } {
  return { cfg: state.cfg, dark: state.dark }
}

/**
 * The one-line note the panel shows when the active preset draws exactly one
 * frame and never animates. Switching to such a preset looks like "nothing
 * happened" because the still picture is the whole point, so the panel says so
 * in place instead of firing a toast. Returns null for every animated preset.
 */
export function presetStillNote(tier: BgTier, preset: BgFxPreset): string | null {
  if (tier === 'ascii' && resolveAsciiPreset(preset) === 'static') {
    return '静态：只画一帧、不占动画帧，所以切过来画面不会流动——这是设计如此，不是没生效。'
  }
  if (tier === 'shader' && SHADER_STYLES[resolveShaderStyle(preset)].animated === false) {
    return '颗粒：静态纹理，同样只画一帧；看不到流动属正常。'
  }
  return null
}

/** Every preset id the active tier can show, in panel order. */
export function tierPresets(tier: BgTier): readonly BgFxPreset[] {
  if (tier === 'shader') return BG_FX_SHADER_STYLES
  if (tier === 'ascii') return BG_FX_ASCII_PRESETS
  return []
}
