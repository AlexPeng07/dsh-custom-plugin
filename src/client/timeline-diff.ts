/**
 * Pure timeline-diff helpers for the browser half: reuse unchanged items so a
 * 3-second poll that appends one turn does not invalidate every turn-tail row,
 * and derive a compact DOM identity for an in-place Mermaid block.
 * @module @alexpeng/dsh-custom-plugin/client/timeline-diff
 */

import type { TimelineItem } from '../protocol.ts'

/** Whether two timeline entries would render identically. */
export function sameTimelineItem(a: TimelineItem, b: TimelineItem): boolean {
  return a.seq === b.seq
    && a.time === b.time
    && a.turn === b.turn
    && a.text === b.text
    && a.imageCount === b.imageCount
    && a.hasLatex === b.hasLatex
    && a.hasMathml === b.hasMathml
    && a.hasMermaid === b.hasMermaid
}

/** One poll's diff against the previous snapshot. */
export interface TimelineDiff {
  /** Next items, with unchanged entries kept by reference. */
  items: TimelineItem[]
  /** seq → item index over {@link items}. */
  bySeq: Map<number, TimelineItem>
  /** False when the previous snapshot renders identically (no store write). */
  changed: boolean
}

/**
 * Diff one fetched timeline against the previous snapshot by sequence.
 * @param previous - previous ordered items, or null when this is the first fetch.
 * @param previousBySeq - seq index for `previous` (same generation), or null.
 * @param next - freshly fetched items.
 * @returns reused items plus whether any rendered field changed.
 */
export function reuseTimelineItems(
  previous: readonly TimelineItem[] | null,
  previousBySeq: ReadonlyMap<number, TimelineItem> | null,
  next: readonly TimelineItem[],
): TimelineDiff {
  const bySeq = new Map<number, TimelineItem>()
  const items: TimelineItem[] = []
  let changed = previous === null || previous.length !== next.length
  for (let index = 0; index < next.length; index++) {
    const raw = next[index]
    const old = previousBySeq?.get(raw.seq)
    const item = old !== undefined && sameTimelineItem(old, raw) ? old : raw
    items.push(item)
    bySeq.set(item.seq, item)
    if (!changed && previous !== null && previous[index] !== item) changed = true
  }
  return { items, bySeq, changed }
}

/** Compact DOM identity for a rendered Mermaid block. A 32-bit FNV-1a hash
 * plus the source length is enough to distinguish live blocks without
 * duplicating every diagram's text into a `data-*` attribute. */
export function mermaidCodeKey(code: string): string {
  let hash = 2166136261
  for (let i = 0; i < code.length; i++) {
    hash ^= code.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36) + '-' + code.length.toString(36)
}
