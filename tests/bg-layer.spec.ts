/**
 * Invariant tests for the page-background layer skeleton: the layer is off
 * unless `bgFx` is explicitly true, the WebGL gate is a real gate, the node
 * is created at most once, and unmount leaves nothing behind. The DOM is
 * faked structurally because vitest runs in a node environment and the
 * module deliberately touches only four DOM operations.
 * @module @alexpeng/dsh-custom-plugin/tests/bg-layer
 */

import { describe, expect, it } from 'vitest'
import { BG_LAYER_ID, bgLayerTint, decideBgLayer, mountBgLayer, unmountBgLayer, type BgLayerDocLike, type BgLayerElementLike } from '../src/client/bg-layer.ts'
import { DARK_CANVAS_LIGHTNESS, PALETTE, toDarkRamp } from '../src/client/palette.ts'

interface FakeElement extends BgLayerElementLike {
  attrs: Map<string, string>
  props: Map<string, string>
  removed: boolean
}

interface FakeDoc extends BgLayerDocLike {
  nodes: FakeElement[]
}

function fakeElement(): FakeElement {
  const el: FakeElement = {
    id: '',
    className: '',
    attrs: new Map<string, string>(),
    props: new Map<string, string>(),
    removed: false,
    setAttribute(name: string, value: string) { el.attrs.set(name, value) },
    style: { setProperty(name: string, value: string) { el.props.set(name, value) } },
    remove() { el.removed = true },
  }
  return el
}

function fakeDoc(): FakeDoc {
  const nodes: FakeElement[] = []
  return {
    nodes,
    body: { appendChild(node: BgLayerElementLike) { nodes.push(node as FakeElement); return node } },
    createElement() { return fakeElement() },
    getElementById(id: string) { return nodes.find((node) => node.id === id && !node.removed) ?? null },
  }
}

const CAPS = { webgl: true, reducedMotion: false, hidden: false }

describe('decideBgLayer', () => {
  it('is off unless bgFx is explicitly true, even when every capability is present', () => {
    expect(decideBgLayer(false, CAPS)).toEqual({ mount: false, reason: 'disabled' })
  })

  it('does not mount without WebGL — the body tint is the documented fallback', () => {
    expect(decideBgLayer(true, { ...CAPS, webgl: false })).toEqual({ mount: false, reason: 'no-webgl' })
  })

  it('animates only when motion is allowed', () => {
    expect(decideBgLayer(true, CAPS)).toEqual({ mount: true, motion: 'animated' })
  })

  it('records reduced motion as static so the renderer draws one frame and no rAF', () => {
    expect(decideBgLayer(true, { ...CAPS, reducedMotion: true })).toEqual({ mount: true, motion: 'static' })
  })

  it('pauses while the document is hidden, even with reduced motion', () => {
    expect(decideBgLayer(true, { ...CAPS, hidden: true })).toEqual({ mount: true, motion: 'paused' })
  })
})

describe('mountBgLayer / unmountBgLayer', () => {
  it('creates one decorative layer on body with the motion attribute and tint', () => {
    const doc = fakeDoc()
    const el = mountBgLayer(doc, { mount: true, motion: 'animated' }, '#e9ebee') as FakeElement
    expect(doc.nodes).toHaveLength(1)
    expect(el.id).toBe(BG_LAYER_ID)
    expect(el.className).toBe('vx-bg')
    expect(el.attrs.get('aria-hidden')).toBe('true')
    expect(el.attrs.get('data-vx-bg-motion')).toBe('animated')
    expect(el.props.get('--vx-bg-tint')).toBe('#e9ebee')
  })

  it('is idempotent: a repaint updates the existing node instead of duplicating it', () => {
    const doc = fakeDoc()
    mountBgLayer(doc, { mount: true, motion: 'animated' }, '#e9ebee')
    mountBgLayer(doc, { mount: true, motion: 'static' }, '#0f1117')
    expect(doc.nodes).toHaveLength(1)
    expect(doc.nodes[0].attrs.get('data-vx-bg-motion')).toBe('static')
    expect(doc.nodes[0].props.get('--vx-bg-tint')).toBe('#0f1117')
  })

  it('removes the node on unmount and stays a no-op afterwards', () => {
    const doc = fakeDoc()
    const el = mountBgLayer(doc, { mount: true, motion: 'animated' }, '#e9ebee') as FakeElement
    unmountBgLayer(doc)
    expect(el.removed).toBe(true)
    expect(doc.getElementById(BG_LAYER_ID)).toBeNull()
    expect(() => unmountBgLayer(doc)).not.toThrow()
  })

  it('tolerates a fresh page where the layer never existed', () => {
    const doc = fakeDoc()
    expect(() => unmountBgLayer(doc)).not.toThrow()
  })
})

describe('bgLayerTint', () => {
  it('uses the selected palette family in light mode', () => {
    expect(bgLayerTint('雾蓝', false)).toBe('#E8EDF2')
  })

  it('derives the same family onto the dark ramp in dark mode', () => {
    expect(bgLayerTint('雾蓝', true)).toBe(toDarkRamp('#E8EDF2', DARK_CANVAS_LIGHTNESS))
  })

  it('falls back to the neutral canvas for "default" and unknown names', () => {
    expect(bgLayerTint('default', false)).toBe('#f8f9fb')
    expect(bgLayerTint('default', true)).toBe('#0f1117')
    expect(bgLayerTint('no-such-family', false)).toBe(PALETTE[0][1])
  })
})
