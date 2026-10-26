/**
 * Unit tests for the extracted Mermaid renderer. The failure path is the point:
 * a rejected render must return a clean error and remove every scratch node
 * Mermaid may have appended to the page. The real Mermaid engine is exercised
 * by the headless-browser stage of `pnpm smoke`.
 * @module @alexpeng/dsh-custom-plugin/tests/mermaid-render
 */

import { describe, expect, it, vi } from 'vitest'
import { removeLegacyMermaidErrors, removeMermaidScratch, renderMermaid } from '../src/client/mermaid-render.ts'
import type { MermaidLike } from '../src/client/mermaid-render.ts'

function fakeWindow(mermaid?: MermaidLike): Window {
  return { mermaid } as unknown as Window
}

function fakeDocument(
  getById: (id: string) => { remove(): void } | null = () => null,
  legacy: Array<{ remove(): void }> = [],
): Document {
  return { getElementById: getById, querySelectorAll: () => legacy } as unknown as Document
}

function fakeEngine(overrides: Partial<MermaidLike> = {}): MermaidLike {
  return {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg>ok</svg>' })),
    ...overrides,
  }
}

describe('renderMermaid', () => {
  it('renders a valid diagram with error suppression enabled', async () => {
    const initialize = vi.fn()
    const engine = fakeEngine({ initialize })
    const result = await renderMermaid('flowchart LR\nA-->B', true, {
      win: fakeWindow(engine),
      doc: fakeDocument(),
    })
    expect(result).toEqual({ ok: true, svg: '<svg>ok</svg>' })
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({
      suppressErrorRendering: true,
      theme: 'dark',
      securityLevel: 'strict',
    }))
  })

  it('returns a clean failure when Mermaid rejects the code', async () => {
    const engine = fakeEngine({
      render: vi.fn(async () => { throw new Error('Parse error on line 1') }),
    })
    const result = await renderMermaid('not a diagram', false, {
      win: fakeWindow(engine),
      doc: fakeDocument(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Parse error on line 1')
  })

  it('rejects an empty SVG payload', async () => {
    const engine = fakeEngine({ render: vi.fn(async () => ({ svg: '' })) })
    const result = await renderMermaid('flowchart LR\nA-->B', false, {
      win: fakeWindow(engine),
      doc: fakeDocument(),
    })
    expect(result).toEqual({ ok: false, error: '引擎未返回 SVG' })
  })

  it('reports a missing engine instead of throwing', async () => {
    const result = await renderMermaid('flowchart LR\nA-->B', false, {
      win: fakeWindow(undefined),
      doc: fakeDocument(),
    })
    expect(result).toEqual({ ok: false, error: '引擎未就绪' })
  })

  it('removes all three scratch nodes after a successful render', async () => {
    const removed: string[] = []
    const result = await renderMermaid('flowchart LR\nA-->B', false, {
      win: fakeWindow(fakeEngine()),
      doc: fakeDocument((id) => ({ remove: () => removed.push(id) })),
    })
    expect(result.ok).toBe(true)
    expect(removed).toHaveLength(3)
    expect(removed[1]).toBe('d' + removed[0])
    expect(removed[2]).toBe('i' + removed[0])
  })

  it('still removes the scratch nodes after a rejected render', async () => {
    const removed: string[] = []
    await renderMermaid('not a diagram', false, {
      win: fakeWindow(fakeEngine({ render: vi.fn(async () => { throw new Error('bad') }) })),
      doc: fakeDocument((id) => ({ remove: () => removed.push(id) })),
    })
    expect(removed).toHaveLength(3)
  })
})

describe('scratch-node sweeps', () => {
  it('removes the id, d<id> and i<id> nodes', () => {
    const removed: string[] = []
    const doc = fakeDocument((id) => ({ remove: () => removed.push(id) }))
    removeMermaidScratch(doc, 'vx-mmd-test')
    expect(removed).toEqual(['vx-mmd-test', 'dvx-mmd-test', 'ivx-mmd-test'])
  })

  it('removes legacy error diagrams from <body>', () => {
    const first = { remove: vi.fn() }
    const second = { remove: vi.fn() }
    removeLegacyMermaidErrors(fakeDocument(undefined, [first, second]))
    expect(first.remove).toHaveBeenCalledOnce()
    expect(second.remove).toHaveBeenCalledOnce()
  })

  it('accepts a null document', () => {
    expect(() => removeMermaidScratch(null, 'x')).not.toThrow()
    expect(() => removeLegacyMermaidErrors(null)).not.toThrow()
  })
})
