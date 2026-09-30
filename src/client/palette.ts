/**
 * Background palette and the dark-mode derivation shared by the appearance
 * panel and the body/token painting.
 *
 * The 20 families are tuned as light pastels. Dark mode reuses the same hue
 * family instead of disabling them: {@link toDarkRamp} keeps hue and
 * saturation and drops lightness onto a dark-ramp target, so 雾蓝 reads as a
 * dark blue-gray, 裸桃 as a warm dark gray, and so on — the canvas stays
 * readable while the palette's character survives.
 * @module @alexpeng/dsh-custom-plugin/client/palette
 */

/** Palette of 20 muted low-saturation backgrounds (with matching tab colors).
 * 天青灰 leads the list: it is the install default and renders first among
 * the palette swatches, right after 无颜色. */
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

function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? '').trim())
  if (match === null) return [235, 238, 242]
  const value = parseInt(match[1], 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function rgbToHsl(rgb: [number, number, number]): [number, number, number] {
  const [r0, g0, b0] = rgb.map((v) => v / 255) as [number, number, number]
  const max = Math.max(r0, g0, b0)
  const min = Math.min(r0, g0, b0)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === r0) h = ((g0 - b0) / d + (g0 < b0 ? 6 : 0)) / 6
  else if (max === g0) h = ((b0 - r0) / d + 2) / 6
  else h = ((r0 - g0) / d + 4) / 6
  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t0: number): number => {
    let t = t0
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [
    Math.round(channel(h + 1 / 3) * 255),
    Math.round(channel(h) * 255),
    Math.round(channel(h - 1 / 3) * 255),
  ]
}

/**
 * Map a palette color onto the dark ramp: hue is kept, saturation is
 * compressed by {@link DARK_SATURATION_SCALE}, and lightness is clamped to
 * `lightness`. The compression is not optional polish: HSL saturation at dark
 * lightness reads far stronger for warm hues (gold / rose / peach) than for
 * blue-grays on a dark canvas, so the raw values made most families glare.
 * Invalid input degrades to a neutral gray at the same lightness.
 */
export function toDarkRamp(hex: string, lightness: number): string {
  const l = Math.max(0, Math.min(1, lightness))
  const [h, s] = rgbToHsl(hexToRgb(hex))
  const clampedS = Math.max(0, Math.min(1, s * DARK_SATURATION_SCALE))
  const [r, g, b] = hslToRgb(h, clampedS, l)
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** Body-canvas lightness for the dark variant of a palette family. */
export const DARK_CANVAS_LIGHTNESS = 0.12

/** How much of a family's HSL saturation survives on the dark ramp. 0.55
 * keeps the families clearly distinguishable while pulling the warm hues
 * (gold / rose / peach) down from "eye-catching" to "ambient" on the dark
 * canvas; 0.4 turned them into mud, 0.7 still glared. */
export const DARK_SATURATION_SCALE = 0.55
