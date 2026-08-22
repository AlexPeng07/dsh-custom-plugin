/**
 * Pure extraction and export builders for dsh-custom-plugin.
 *
 * All functions here are side-effect free (image embedding aside, which takes
 * an optional reader seam) so they can be unit-tested without a Cordis
 * context. The host routes call them over {@link SessionLogSnapshot} objects
 * from `ctx.sessionQuery`.
 * @module @alexpeng/dsh-custom-plugin/extract
 */

import type { ImageAttachmentRef, StoredImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionLogSnapshot } from '@deepseek-ai/dsh-session-query'
import type { TimelineItem } from './protocol.ts'

/** Base64 encode bytes without relying on Buffer (browser-host parity). */
export function bytesToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  const step = 0x8000
  for (let i = 0; i < bytes.length; i += step) {
    const chunk = bytes.subarray(i, Math.min(i + step, bytes.length))
    const bin = String.fromCharCode.apply(null, chunk as unknown as number[])
    for (let j = 0; j < bin.length; j += 3) {
      const a = bin.charCodeAt(j)
      const b = bin.charCodeAt(j + 1)
      const c = bin.charCodeAt(j + 2)
      out += chars[a >> 2] + chars[((a & 3) << 4) | (b >> 4)]
      out += j + 1 < bin.length ? chars[((b & 15) << 2) | (c >> 6)] : '='
      out += j + 2 < bin.length ? chars[c & 63] : '='
    }
  }
  return out
}

/** Flatten one content block into plain display text. */
export function blockText(block: ContentBlock | undefined | null): string {
  if (block === undefined || block === null) return ''
  switch (block.type) {
    case 'text':
    case 'reasoning':
      return String(block.text ?? '')
    case 'image':
      return '[图片]'
    case 'tool-call':
      return `[调用工具 ${block.name ?? ''}]`
    case 'tool-result': {
      let text = ''
      for (const item of block.content ?? []) text += blockText(item)
      return `[工具结果] ${text.slice(0, 240)}`
    }
    default:
      return ''
  }
}

/** Flatten a message content array into plain display text. */
export function messageText(content: readonly ContentBlock[] | undefined | null): string {
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) text += blockText(block)
  return text
}

/** Content flags used by the timeline and the copy/rendering chips. */
export function flagsOf(text: string): { hasLatex: boolean; hasMathml: boolean; hasMermaid: boolean } {
  return {
    hasLatex: text.includes('$$') || text.includes('\\(') || text.includes('\\[') || /\$[^$\n]{1,400}?\$/.test(text),
    hasMathml: text.toLowerCase().includes('<math'),
    hasMermaid: text.includes('```mermaid'),
  }
}

/** Extract one timeline node per direct user message from a session log. */
export function extractTurns(events: readonly SessionEvent[]): TimelineItem[] {
  const items: TimelineItem[] = []
  let turn = 0
  for (const event of events) {
    if (event === undefined || event === null) continue
    if (event.type === 'turn/start') {
      turn = event.data.turn ?? 0
    } else if (event.type === 'user/message') {
      const message = event.data
      if (message.role !== 'user') continue
      if (message.source.kind !== 'user') continue
      const text = messageText(message.content).slice(0, 4000)
      let imageCount = 0
      for (const block of message.content ?? []) {
        if (block.type === 'image') imageCount++
      }
      const flags = flagsOf(text)
      items.push({
        seq: event.seq,
        time: event.time,
        turn,
        text,
        imageCount,
        hasLatex: flags.hasLatex,
        hasMathml: flags.hasMathml,
        hasMermaid: flags.hasMermaid,
      })
    }
  }
  return items
}

/** One flattened export row. */
export interface ExportRow {
  seq: number
  time: number
  kind: 'user' | 'context' | 'assistant' | 'tool-call' | 'tool-result'
  text: string
  toolName?: string
  toolArgs?: string
  images?: Array<{
    name: string
    mediaType: string
    bytes: number
    width: number
    height: number
    dataUrl?: string
    skipped?: string
  }>
}

const IMAGE_BUDGET = 12 * 1024 * 1024

/** Embed user-message images as data URLs when the attachment reader is available. */
export async function collectImages(
  content: readonly ContentBlock[] | undefined | null,
  embed: boolean,
  readImage?: (ref: ImageAttachmentRef) => Promise<StoredImageAttachment>,
): Promise<ExportRow['images']> {
  const out: NonNullable<ExportRow['images']> = []
  if (!Array.isArray(content)) return out
  let budget = IMAGE_BUDGET
  for (const block of content) {
    if (block === undefined || block === null || block.type !== 'image') continue
    const ref = block.attachment
    if (ref === undefined) continue
    const meta: NonNullable<ExportRow['images']>[number] = {
      name: ref.name ?? '',
      mediaType: ref.mediaType ?? '',
      bytes: ref.bytes ?? 0,
      width: ref.width ?? 0,
      height: ref.height ?? 0,
    }
    if (embed && readImage !== undefined && out.length < 30 && budget > 0) {
      try {
        const stored = await readImage(ref)
        if (stored !== undefined && stored.data !== undefined && stored.data.length <= 4 * 1024 * 1024 && stored.data.length <= budget) {
          budget -= stored.data.length
          meta.dataUrl = `data:${ref.mediaType ?? 'image/png'};base64,${bytesToBase64(stored.data)}`
        } else if (stored !== undefined && stored.data !== undefined) {
          meta.skipped = '超出导出预算'
        }
      } catch {
        // Unreadable image: the row keeps its metadata only.
      }
    }
    out.push(meta)
  }
  return out
}

/** Build flattened export rows for one session log (newest 3000 kept). */
export async function buildExportRows(
  snapshot: SessionLogSnapshot,
  format: 'json' | 'markdown' | 'pdf',
  readImage?: (ref: ImageAttachmentRef) => Promise<StoredImageAttachment>,
): Promise<ExportRow[]> {
  const rows: ExportRow[] = []
  // tool/result events carry only the ToolResultMessage (whose source holds the
  // callId) — the producing tool's name has to be remembered from the paired
  // tool/call event while walking the log in order.
  const callNames = new Map<string, string>()
  for (const event of snapshot.events) {
    if (event === undefined || event === null) continue
    if (event.type === 'user/message') {
      const message = event.data
      const text = messageText(message.content)
      const images = await collectImages(message.content, format === 'pdf', readImage)
      if (message.source.kind === 'user') {
        rows.push({ seq: event.seq, time: event.time, kind: 'user', text, images })
      } else {
        rows.push({ seq: event.seq, time: event.time, kind: 'context', text: text.slice(0, 2000), images: [] })
      }
    } else if (event.type === 'assistant/message') {
      const message = event.data.message
      rows.push({ seq: event.seq, time: event.time, kind: 'assistant', text: messageText(message.content) })
    } else if (event.type === 'tool/call') {
      if (event.data.callId !== undefined) callNames.set(String(event.data.callId), event.data.name ?? '')
      rows.push({ seq: event.seq, time: event.time, kind: 'tool-call', text: '', toolName: event.data.name ?? '', toolArgs: event.data.arguments ?? '' })
    } else if (event.type === 'tool/result') {
      const callId = event.data.message?.source?.callId
      rows.push({
        seq: event.seq,
        time: event.time,
        kind: 'tool-result',
        toolName: (callId !== undefined ? callNames.get(String(callId)) : undefined) ?? '',
        text: messageText(event.data.message.content).slice(0, 3000),
      })
    }
  }
  return rows.slice(-3000)
}

function fmtTime(time: number): string {
  const d = new Date(time)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Build the Markdown export document. */
export function buildMarkdown(rows: readonly ExportRow[], sessionId: string): string {
  const out: string[] = []
  out.push('# 会话导出', '')
  out.push(`> 会话 ID: \`${sessionId}\``)
  out.push(`> 导出时间: ${new Date().toLocaleString()}`, '')
  for (const row of rows) {
    if (row.kind === 'user') {
      out.push(`## 用户 (${fmtTime(row.time)})`, '')
      if (row.text) { out.push(row.text, '') }
      for (const image of row.images ?? []) {
        out.push(`> 图片${image.name ? ` ${image.name}` : ''}: ${image.mediaType}, ${image.width}x${image.height}${image.skipped ? `（${image.skipped}）` : ''}`)
      }
      out.push('')
    } else if (row.kind === 'assistant') {
      out.push(`## 助手 (${fmtTime(row.time)})`, '')
      if (row.text) { out.push(row.text, '') }
    } else if (row.kind === 'tool-call') {
      out.push(`### 工具调用: ${row.toolName ?? ''} (${fmtTime(row.time)})`, '', '```json')
      out.push(String(row.toolArgs ?? '').slice(0, 4000), '```', '')
    } else if (row.kind === 'tool-result') {
      out.push(`### 工具结果 (${fmtTime(row.time)})`, '', '```')
      out.push(String(row.text ?? '').slice(0, 1500), '```', '')
    } else if (row.kind === 'context') {
      out.push(`### 注入上下文 (${fmtTime(row.time)})`, '', String(row.text ?? '').slice(0, 1200), '')
    }
  }
  return out.join('\n')
}

/** Build the print-ready HTML document (browser "Save as PDF" target). */
export function buildPdfHtml(rows: readonly ExportRow[], sessionId: string): string {
  const out: string[] = []
  out.push('<!DOCTYPE html><html><head><meta charset="utf-8"><style>')
  out.push('@page { size: A4; margin: 18mm 16mm; } body { font-family: "Segoe UI","Microsoft YaHei",system-ui,sans-serif; font-size: 13px; line-height: 1.7; color: #14161c; } .m { margin: 0 0 14px 0; } .user { background:#edf2f8; border-left:3px solid #7d93b2; padding:8px 12px; border-radius:6px; } .assistant { padding:2px 0; } .tool { font-size:12px; color:#4a4f5a; background:#f5f3ec; padding:6px 10px; border-radius:6px; } .tool pre { white-space:pre-wrap; word-break:break-all; max-height:220px; overflow:hidden; } img { max-width:100%; border-radius:6px; margin:6px 0; } h1 { font-size:19px; } .time { color:#8a909e; font-size:11px; } hr { border:none; border-top:1px solid #d8dce4; margin: 14px 0; } .role { font-weight:600; }')
  out.push('</style></head><body><h1>会话导出</h1><div class="time">ID: ' + escapeHtml(sessionId) + ' · 导出时间: ' + new Date().toLocaleString() + '</div><hr/>')
  for (const row of rows) {
    if (row.kind === 'user') {
      out.push(`<div class="m user"><span class="role">用户</span> <span class="time">${fmtTime(row.time)}</span>`)
      if (row.text) out.push(`<div>${escapeHtml(row.text).replace(/\n/g, '<br/>')}</div>`)
      for (const image of row.images ?? []) {
        if (image.dataUrl !== undefined) out.push(`<img src="${image.dataUrl}" alt="图片"/>`)
        else out.push(`<div class="time">图片${image.name ? ` ${escapeHtml(image.name)}` : ''} (${image.mediaType}, ${image.width}x${image.height}${image.skipped ? `, ${image.skipped}` : ''})</div>`)
      }
      out.push('</div>')
    } else if (row.kind === 'assistant') {
      out.push(`<div class="m assistant"><span class="role">助手</span> <span class="time">${fmtTime(row.time)}</span>`)
      if (row.text) out.push(`<div>${escapeHtml(row.text).replace(/\n/g, '<br/>')}</div>`)
      out.push('</div>')
    } else if (row.kind === 'tool-call') {
      out.push(`<div class="m tool"><div class="role">工具调用: ${escapeHtml(row.toolName ?? '')} <span class="time">${fmtTime(row.time)}</span></div><pre>${escapeHtml(String(row.toolArgs ?? '').slice(0, 4000))}</pre></div>`)
    } else if (row.kind === 'tool-result') {
      out.push(`<div class="m tool"><div class="role">工具结果 <span class="time">${fmtTime(row.time)}</span></div><pre>${escapeHtml(String(row.text ?? '').slice(0, 1500))}</pre></div>`)
    } else if (row.kind === 'context') {
      out.push(`<div class="m tool"><div class="role">注入上下文 <span class="time">${fmtTime(row.time)}</span></div><pre>${escapeHtml(String(row.text ?? '').slice(0, 1200))}</pre></div>`)
    }
  }
  out.push('</body></html>')
  return out.join('')
}
