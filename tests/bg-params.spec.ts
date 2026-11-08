/**
 * Unit tests for the background-motion panel's pure half. Everything asserted
 * here runs in node: clamping against the renderers' own `ranges`, the
 * per-tier knob lists, fallbacks for stale preset ids, the restore-defaults
 * write, the slider debounce, and the appearance tab's subscription scope.
 * @module @alexpeng/dsh-custom-plugin/tests/bg-params
 */

import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type CustomPluginConfig } from '../src/protocol.ts'
import { ASCII_PRESETS, resolveAsciiSpec } from '../src/client/bg-ascii.ts'
import { SHADER_STYLES, resolveShaderSpec } from '../src/client/bg-shader.ts'
import {
  BG_PARAM_UNSET,
  asciiParamsFromCfg,
  createDebouncedSaver,
  effectiveParam,
  panelParamKeys,
  paramDefault,
  paramRange,
  presetForTier,
  presetStillNote,
  resetBgParams,
  selectAppearanceSlice,
  setParamInCfg,
  shaderParamsFromCfg,
  tierFromCfg,
  tierPresets,
} from '../src/client/bg-params.ts'

function cfgWith(partial: Partial<CustomPluginConfig>): CustomPluginConfig {
  return { ...DEFAULT_CONFIG, ...partial }
}

describe('tier and preset fallbacks', () => {
  it('maps an unknown bgFx value to the disabled tier', () => {
    expect(tierFromCfg(cfgWith({ bgFx: 'none' }))).toBe('none')
    expect(tierFromCfg({ ...DEFAULT_CONFIG, bgFx: 'bogus' as unknown as 'none' })).toBe('none')
  })

  it('falls a cross-tier preset id back to that tier default', () => {
    expect(presetForTier('ascii', 'liquid')).toBe('flow')
    expect(presetForTier('ascii', 'grain')).toBe('flow')
    expect(presetForTier('ascii', 'not-a-preset')).toBe('flow')
    expect(presetForTier('shader', 'rain')).toBe('liquid')
    expect(presetForTier('shader', 'not-a-style')).toBe('liquid')
    expect(presetForTier('shader', undefined)).toBe('liquid')
  })

  it('lists only the presets the tier can mount', () => {
    expect(tierPresets('none')).toEqual([])
    expect(tierPresets('ascii')).toEqual(['flow', 'rain', 'ocean', 'starfield', 'ripple', 'static'])
    expect(tierPresets('shader')).toEqual(['liquid', 'grain'])
  })

  it('explains a still preset in place instead of firing a toast', () => {
    // Only the zero-rAF presets need the note: the picture is the frame.
    expect(presetStillNote('ascii', 'static')).toContain('只画一帧')
    expect(presetStillNote('shader', 'grain')).toContain('只画一帧')
    // Every animated preset stays silent, and the note follows the tier, so a
    // cross-tier id (already re-homed upstream) never borrows the other tier's
    // copy.
    for (const preset of tierPresets('ascii')) {
      if (preset === 'static') continue
      expect(presetStillNote('ascii', preset)).toBeNull()
    }
    expect(presetStillNote('shader', 'liquid')).toBeNull()
    expect(presetStillNote('none', 'static')).toBeNull()
    // A shader id inside the ASCII tier falls back to `flow`, i.e. no note.
    expect(presetStillNote('ascii', 'grain')).toBeNull()
    expect(presetStillNote('shader', 'static')).toBeNull()
  })
})

describe('panel fields per tier', () => {
  it('shows no sliders when the layer is off', () => {
    expect(panelParamKeys('none')).toEqual([])
  })

  it('shows the five ASCII knobs', () => {
    expect(panelParamKeys('ascii')).toEqual(['density', 'speed', 'fps', 'fontPx', 'opacity'])
  })

  it('shows the four shader knobs and hides font/opacity', () => {
    expect(panelParamKeys('shader')).toEqual(['density', 'speed', 'intensity', 'fps'])
    expect(panelParamKeys('shader')).not.toContain('fontPx')
    expect(panelParamKeys('shader')).not.toContain('opacity')
  })

  it('reads bounds from the active preset, never a local copy', () => {
    expect(paramRange('ascii', 'flow', 'fps')).toEqual({ min: 15, max: 30 })
    expect(paramRange('ascii', 'rain', 'fps')).toEqual({ min: 15, max: 30 })
    expect(paramRange('shader', 'liquid', 'intensity')).toEqual({ min: 0.2, max: 0.6 })
    expect(paramRange('shader', 'grain', 'speed')).toEqual({ min: 0, max: 0 })
    expect(paramRange('none', 'flow', 'density')).toBeNull()
    expect(paramRange('ascii', 'flow', 'intensity')).toBeNull()
  })
})

describe('clamping and defaults', () => {
  it('clamps an out-of-range stored value into the preset band', () => {
    expect(effectiveParam(cfgWith({ bgDensity: 99 }), 'ascii', 'flow', 'density')).toBe(ASCII_PRESETS.flow.ranges.density.max)
    expect(effectiveParam(cfgWith({ bgDensity: 0.4 }), 'ascii', 'flow', 'density')).toBe(ASCII_PRESETS.flow.ranges.density.min)
    expect(effectiveParam(cfgWith({ bgIntensity: 5 }), 'shader', 'liquid', 'intensity')).toBe(SHADER_STYLES.liquid.ranges.intensity.max)
  })

  it('uses the sentinel and the preset default when no override is stored', () => {
    expect(effectiveParam(cfgWith({ bgDensity: BG_PARAM_UNSET }), 'ascii', 'rain', 'density')).toBe(ASCII_PRESETS.rain.density)
    expect(effectiveParam(cfgWith({}), 'shader', 'liquid', 'density')).toBe(SHADER_STYLES.liquid.density)
    expect(paramDefault('ascii', 'ocean', 'speed')).toBe(ASCII_PRESETS.ocean.speed)
    expect(paramDefault('shader', 'grain', 'speed')).toBe(SHADER_STYLES.grain.speed)
  })

  it('clamps a value while writing one flat field', () => {
    const base = cfgWith({ bgDensity: 0.5 })
    const next = setParamInCfg(base, 'ascii', 'rain', 'density', 0.1)
    expect(next.bgDensity).toBe(ASCII_PRESETS.rain.ranges.density.min)
    expect(next.bgSpeed).toBe(base.bgSpeed)
    expect(base.bgDensity).toBe(0.5)
  })

  it('clamps a cross-preset value when the preset changes', () => {
    const cfg = cfgWith({ bgFontPx: 16, bgDensity: 0.4 })
    // ocean's density floor is 0.5, so the flow-tuned 0.4 is pulled up.
    expect(asciiParamsFromCfg(cfg, 'ocean').density).toBe(ASCII_PRESETS.ocean.ranges.density.min)
    // 16 px stays inside rain's font range, so it survives unchanged.
    expect(asciiParamsFromCfg(cfg, 'rain').fontPx).toBe(16)
    // grain's speed is locked at 0; liquid's own default comes through.
    expect(shaderParamsFromCfg(cfgWith({}), 'grain').speed).toBe(0)
    expect(shaderParamsFromCfg(cfg, 'liquid').intensity).toBe(SHADER_STYLES.liquid.intensity)
  })

  it('keeps the base spec object when nothing is overridden', () => {
    expect(resolveAsciiSpec('flow', {})).toBe(ASCII_PRESETS.flow)
    expect(resolveShaderSpec('liquid', {})).toBe(SHADER_STYLES.liquid)
  })

  it('clamps overrides inside the renderers themselves', () => {
    expect(resolveAsciiSpec('flow', { density: 9 }).density).toBe(ASCII_PRESETS.flow.ranges.density.max)
    expect(resolveAsciiSpec('flow', { speed: -1 }).speed).toBe(ASCII_PRESETS.flow.ranges.speed.min)
    expect(resolveAsciiSpec('flow', { fontPx: 10, opacity: 0.6 }).fontPx).toBe(10)
    expect(resolveShaderSpec('liquid', { intensity: 9 }).intensity).toBe(SHADER_STYLES.liquid.ranges.intensity.max)
    expect(resolveShaderSpec('grain', { speed: 1 }).speed).toBe(0)
  })
})

describe('restore defaults', () => {
  it('clears every override and keeps unrelated fields', () => {
    const cfg = cfgWith({
      bgFx: 'ascii',
      bgFxPreset: 'rain',
      bgDensity: 1.2,
      bgSpeed: 1.8,
      bgFps: 20,
      bgFontPx: 14,
      bgOpacity: 0.7,
      bgIntensity: 0.5,
      glass: false,
    })
    const next = resetBgParams(cfg)
    expect(next.bgDensity).toBe(BG_PARAM_UNSET)
    expect(next.bgSpeed).toBe(BG_PARAM_UNSET)
    expect(next.bgFps).toBe(BG_PARAM_UNSET)
    expect(next.bgFontPx).toBe(BG_PARAM_UNSET)
    expect(next.bgOpacity).toBe(BG_PARAM_UNSET)
    expect(next.bgIntensity).toBe(BG_PARAM_UNSET)
    expect(next.bgFx).toBe('ascii')
    expect(next.bgFxPreset).toBe('rain')
    expect(next.glass).toBe(false)
    expect(cfg.bgDensity).toBe(1.2)
  })
})

describe('debounced slider saves', () => {
  it('fires once for a burst of pushes', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const saver = createDebouncedSaver(save, 320)
    for (let i = 0; i < 6; i++) saver.push()
    expect(save).not.toHaveBeenCalled()
    expect(saver.isPending()).toBe(true)
    vi.advanceTimersByTime(319)
    expect(save).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(saver.isPending()).toBe(false)
    vi.useRealTimers()
  })

  it('cancel drops the pending call', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const saver = createDebouncedSaver(save, 320)
    saver.push()
    saver.cancel()
    vi.advanceTimersByTime(400)
    expect(save).not.toHaveBeenCalled()
    expect(saver.isPending()).toBe(false)
    vi.useRealTimers()
  })

  it('starts a fresh window after the previous save fired', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const saver = createDebouncedSaver(save, 100)
    saver.push()
    vi.advanceTimersByTime(100)
    saver.push()
    vi.advanceTimersByTime(100)
    expect(save).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
})

describe('appearance tab subscription scope', () => {
  it('selects the config and the theme only', () => {
    const cfg = cfgWith({ bgFx: 'ascii' })
    const slice = selectAppearanceSlice({ cfg, dark: true })
    expect(Object.keys(slice).sort()).toEqual(['cfg', 'dark'])
    expect(slice.cfg).toBe(cfg)
    expect(slice.dark).toBe(true)
    // Per-turn fields must not leak into the tab's render scope.
    expect(Object.keys(slice)).not.toContain('turns')
    expect(Object.keys(slice)).not.toContain('toasts')
    expect(Object.keys(slice)).not.toContain('usage')
  })
})
