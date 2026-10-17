/**
 * Tests for the browser timeline diff: unchanged turns must keep their object
 * identity so a poll does not re-render every turn-tail row.
 * @module @alexpeng/dsh-custom-plugin/tests/timeline-diff
 */

import { describe, expect, it } from 'vitest'
import { mermaidCodeKey, reuseTimelineItems } from '../src/client/timeline-diff.ts'
import type { TimelineItem } from '../src/protocol.ts'

function item(seq: number, text = `turn ${seq}`): TimelineItem {
  return { seq, time: seq, turn: seq, text, imageCount: 0, hasLatex: false, hasMathml: false, hasMermaid: false }
}

describe('reuseTimelineItems', () => {
  it('reports a change on the first fetch and keeps the fetched objects', () => {
    const next = [item(1), item(2)]
    const diff = reuseTimelineItems(null, null, next)
    expect(diff.changed).toBe(true)
    expect(diff.items).toEqual(next)
    expect(diff.items[0]).toBe(next[0])
    expect(diff.bySeq.get(2)).toBe(next[1])
  })

  it('reports no change when every rendered field is identical', () => {
    const previous = [item(1), item(2)]
    const bySeq = new Map(previous.map((entry) => [entry.seq, entry]))
    const fetched = [item(1), item(2)]
    const diff = reuseTimelineItems(previous, bySeq, fetched)
    expect(diff.changed).toBe(false)
    expect(diff.items[0]).toBe(previous[0])
    expect(diff.items[1]).toBe(previous[1])
  })

  it('reuses every unchanged prefix and only replaces the changed tail', () => {
    const previous = [item(1), item(2), item(3)]
    const bySeq = new Map(previous.map((entry) => [entry.seq, entry]))
    const fetched = [item(1), item(2), item(3, 'streamed')]
    const diff = reuseTimelineItems(previous, bySeq, fetched)
    expect(diff.changed).toBe(true)
    expect(diff.items[0]).toBe(previous[0])
    expect(diff.items[1]).toBe(previous[1])
    expect(diff.items[2]).not.toBe(previous[2])
    expect(diff.items[2].text).toBe('streamed')
  })

  it('marks an append as changed and reuses the overlapping rows', () => {
    const previous = [item(1), item(2)]
    const bySeq = new Map(previous.map((entry) => [entry.seq, entry]))
    const fetched = [item(1), item(2), item(3)]
    const diff = reuseTimelineItems(previous, bySeq, fetched)
    expect(diff.changed).toBe(true)
    expect(diff.items).toHaveLength(3)
    expect(diff.items[0]).toBe(previous[0])
    expect(diff.items[1]).toBe(previous[1])
    expect(diff.bySeq.get(3)).toBe(fetched[2])
  })

  it('treats the tail cap sliding forward as a change at index zero', () => {
    const previous = [item(1), item(2), item(3)]
    const bySeq = new Map(previous.map((entry) => [entry.seq, entry]))
    const fetched = [item(2), item(3), item(4)]
    const diff = reuseTimelineItems(previous, bySeq, fetched)
    expect(diff.changed).toBe(true)
    expect(diff.items[0]).toBe(previous[1])
    expect(diff.items[1]).toBe(previous[2])
    expect(diff.items[2]).toBe(fetched[2])
  })
})

describe('mermaidCodeKey', () => {
  it('is stable for the same source and distinct for different sources', () => {
    expect(mermaidCodeKey('graph TD; A-->B')).toBe(mermaidCodeKey('graph TD; A-->B'))
    expect(mermaidCodeKey('graph TD; A-->B')).not.toBe(mermaidCodeKey('graph TD; A-->C'))
    expect(mermaidCodeKey('')).toBe(mermaidCodeKey(''))
  })

  it('does not embed the source text', () => {
    const code = 'graph TD\n' + 'x'.repeat(10_000)
    const key = mermaidCodeKey(code)
    expect(key.length).toBeLessThan(24)
    expect(key).not.toContain('graph')
  })
})
