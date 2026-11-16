/**
 * Appearance controls shared by the header quick panel and the settings page.
 *
 * Presentational only: config in, callbacks out. Every visual value comes from
 * the host tokens in styles.ts.
 * @module @alexpeng/dsh-custom-plugin/client/ui/appearance-controls
 */

import * as React from 'react'
import type { BgFxPreset, BgStrength, CustomPluginConfig } from '../../protocol.ts'
import { PALETTE, toDarkRamp, DARK_CANVAS_LIGHTNESS } from '../palette.ts'
import {
  BG_PARAM_META,
  BG_STRENGTH_META,
  effectiveParam,
  panelParamKeys,
  paramRange,
  presetForTier,
  presetStillNote,
  strengthFromCfg,
  tierFromCfg,
  tierPresets,
  type BgParamKey,
  type BgTier,
} from '../bg-params.ts'

import { Button, Segmented, Switch, cx } from './primitives.tsx'

const PRESET_LABELS: Record<string, string> = {
  flow: '流动', rain: '数字雨', ocean: '海面', ripple: '涟漪', starfield: '星野', static: '静态',
  liquid: '液态墨', grain: '颗粒',
}

const WEATHER_OPTIONS = [
  { value: 'none', label: '无' },
  { value: 'snow', label: '飘雪' },
  { value: 'rain', label: '雨滴' },
  { value: 'sakura', label: '樱花' },
] as const

const TIER_OPTIONS = [
  { value: 'none', label: '关闭' },
  { value: 'ascii', label: '字符' },
  { value: 'shader', label: '光影' },
] as const

const INTERACTION_HINTS: Record<string, string> = {
  ocean: '海面只铺在会话中栏，需要打开一个会话；设置页会盖住它，关闭后可见。拖动会泛起涟漪，点击溅起水花，鱼群会被惊动后重新聚拢。',
  flow: '拖动会搅动雾面，点击会推开一圈涟漪。',
  rain: '鼠标划过像一阵风，会把雨丝吹斜；点击向两侧拨开雨帘，随后慢慢合拢。',
  ripple: '点击会在落点漾开一圈新的涟漪，拖动会沿途留下小水纹。',
  starfield: '点击会在落点点亮一小片星尘，拖动会沿途撒下星光，随后渐渐暗去。',
  liquid: '鼠标划过会卷动墨云，点击会从落点扩散出一圈涟漪。',
}

export interface AppearanceControlsProps {
  cfg: CustomPluginConfig
  dark: boolean
  onSet: (key: keyof CustomPluginConfig, value: string | boolean) => void
  onTier: (tier: BgTier) => void
  onPreset: (preset: BgFxPreset) => void
  onStrength: (strength: BgStrength) => void
  onFocus: (on: boolean) => void
  onParam: (key: BgParamKey, value: number) => void
  onRestoreParams: () => void
  compact?: boolean
}

/** Colour, weather, glass and background-motion controls. */
export function AppearanceControls(props: AppearanceControlsProps): React.ReactElement {
  const { cfg, dark, onSet, onTier, onPreset, onStrength, onFocus, onParam, onRestoreParams, compact = false } = props
  const tier = tierFromCfg(cfg)
  const preset = presetForTier(tier, cfg.bgFxPreset)
  const strength = strengthFromCfg(cfg)
  const params = panelParamKeys(tier)
  const stillNote = presetStillNote(tier, preset)
  const hint = tier === 'ascii' ? INTERACTION_HINTS[preset] : (tier === 'shader' ? INTERACTION_HINTS[preset] : undefined)
  return React.createElement(React.Fragment, null,
    React.createElement('div', { className: 'vx-section-title' }, '背景颜色'),
    React.createElement('div', { className: 'vx-muted' }, compact
      ? '20 组低饱和色板，深浅色模式通用。'
      : '20 组低饱和色板，深浅色模式均可用；深色下自动使用同色系的深色变体（预览即实际效果）。'),
    React.createElement('div', { className: 'vx-swatches' },
      React.createElement('button', {
        type: 'button',
        className: cx('vx-swatch', cfg.bg === 'default' ? 'on' : ''),
        onClick: () => onSet('bg', 'default'),
        title: '无颜色（默认主题）',
      },
        React.createElement('span', { className: 'vx-swatch-box', style: { background: 'repeating-conic-gradient(#ccc 0 25%, #eee 0 50%) 0 0/10px 10px' } }),
        React.createElement('span', { className: 'vx-swatch-label' }, '无颜色'),
      ),
      PALETTE.map((entry) => {
        const preview = dark ? toDarkRamp(entry[1], DARK_CANVAS_LIGHTNESS) : entry[1]
        return React.createElement('button', {
          key: entry[0],
          type: 'button',
          className: cx('vx-swatch', cfg.bg === entry[0] ? 'on' : ''),
          onClick: () => onSet('bg', entry[0]),
          title: entry[0] + ' ' + entry[1],
        },
          React.createElement('span', { className: 'vx-swatch-box', style: { background: preview } }),
          React.createElement('span', { className: 'vx-swatch-label' }, entry[0]),
        )
      }),
    ),

    React.createElement('div', { className: 'vx-section-title' }, '天气特效'),
    React.createElement(Segmented, {
      value: cfg.weather ?? 'none',
      options: WEATHER_OPTIONS.map((item) => ({ value: item.value, label: item.label })),
      onChange: (value) => onSet('weather', value),
      ariaLabel: '天气特效',
    }),

    React.createElement('div', { className: 'vx-section-title' }, '玻璃效果'),
    React.createElement(Switch, {
      label: '启用玻璃',
      checked: cfg.glass === true,
      onChange: (value) => onSet('glass', value),
    }),
    cfg.glass === true
      ? React.createElement(Segmented, {
        value: cfg.glassMode === 'liquid' ? 'liquid' : 'frost',
        options: [{ value: 'frost', label: '毛玻璃' }, { value: 'liquid', label: '液态玻璃' }],
        onChange: (value) => onSet('glassMode', value),
        ariaLabel: '玻璃模式',
      })
      : null,
    React.createElement(Switch, {
      label: '全局浮层玻璃',
      checked: cfg.globalGlass === true,
      onChange: (value) => onSet('globalGlass', value),
      hint: '对弹窗、菜单等浮层应用玻璃质感；液态玻璃模式下浮层同样位移折射',
    }),

    React.createElement('div', { className: 'vx-section-title' }, '背景动效'),
    React.createElement('div', { className: 'vx-muted' }, '整页铺一层很淡的背景动效，垫在内容下面，不挡任何操作。'),
    React.createElement(Segmented, {
      value: tier,
      options: TIER_OPTIONS.map((item) => ({ value: item.value, label: item.label })),
      onChange: (value) => onTier(value as BgTier),
      ariaLabel: '背景动效档位',
    }),
    tier === 'none'
      ? React.createElement('div', { className: 'vx-muted' }, '背景动效已关闭，页面只用当前色板的底色。')
      : React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'vx-row wrap', role: 'group', 'aria-label': '背景动效预设' },
          tierPresets(tier).map((id) => React.createElement('button', {
            key: id,
            type: 'button',
            className: cx('vx-button vx-button-sm', preset === id ? 'vx-button-secondary' : 'vx-button-ghost'),
            'aria-pressed': preset === id,
            onClick: () => onPreset(id),
          }, PRESET_LABELS[id] ?? id)),
        ),
        hint === undefined ? null : React.createElement('div', { className: 'vx-muted' }, hint),
        React.createElement('div', { className: 'vx-row wrap', role: 'group', 'aria-label': '背景墨色强度' },
          React.createElement('span', { className: 'vx-param-label' }, '墨色强度'),
          BG_STRENGTH_META.map((item) => React.createElement('button', {
            key: item.value,
            type: 'button',
            className: cx('vx-button vx-button-sm', strength === item.value ? 'vx-button-secondary' : 'vx-button-ghost'),
            'aria-pressed': strength === item.value,
            onClick: () => onStrength(item.value),
          }, item.label)),
        ),
        stillNote === null ? null : React.createElement('div', { className: 'vx-note' }, stillNote),
        React.createElement('div', { className: 'vx-param-list' },
          params.map((key) => {
            const meta = BG_PARAM_META[key]
            const range = paramRange(tier, preset, key)
            const value = effectiveParam(cfg, tier, preset, key)
            return React.createElement('div', { className: 'vx-param-row', key },
              React.createElement('span', { className: 'vx-param-label' }, meta.label),
              React.createElement('input', {
                type: 'range',
                className: 'vx-range',
                min: range === null ? 0 : range.min,
                max: range === null ? 0 : range.max,
                step: meta.step,
                value,
                'aria-label': '背景' + meta.label,
                onChange: (event: React.ChangeEvent<HTMLInputElement>) => onParam(key, Number(event.currentTarget.value)),
              }),
              React.createElement('span', { className: 'vx-param-val' }, value.toFixed(meta.decimals) + meta.unit),
            )
          }),
        ),
        React.createElement('div', { className: 'vx-row' },
          React.createElement(Button, { variant: 'ghost', size: 'sm', onClick: onRestoreParams, title: '只把参数恢复为「跟随预设」，不改变动效档位与预设。' }, '恢复默认参数'),
          React.createElement('span', { className: 'vx-muted' }, '仅重置参数'),
        ),
      ),
    React.createElement(Switch, {
      label: '避让正文',
      checked: cfg.bgFocus !== false,
      onChange: onFocus,
      hint: '打开时内容区域会更淡、四周更浓；关掉则整页均匀。',
    }),
  )
}
