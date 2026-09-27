/**
 * Unit tests for the export builders and timeline extraction.
 * @module @alexpeng/dsh-custom-plugin/tests/extract
 */

import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionSeq } from '@deepseek-ai/dsh-session'
import { buildExportRows, buildMarkdown, eventSearchText, extractTurns, flagsOf, messageText, searchKindOf, snippetAround } from '../src/extract.ts'

/**
 * Session ids and sequence numbers are branded at compile time but plain
 * numbers on the wire; fixtures describe the wire, so they cast once here
 * rather than sprinkling `as never` through the assertions.
 */
function seqOf(value: number): SessionSeq {
  return value as unknown as SessionSeq
}

function asSessionEvent(event: unknown): SessionEvent {
  return event as SessionEvent
}

function userEvent(seq: number, text: string, kind: 'user' | 'system-prompt' = 'user'): SessionEvent {
  return asSessionEvent({
    type: 'user/message',
    seq: seqOf(seq),
    time: 1000 + seq,
    data: {
      role: 'user',
      id: `m${seq}`,
      content: [{ type: 'text', text }],
      source: { kind, id: `m${seq}` },
    },
  })
}

function assistantEvent(seq: number, text: string): SessionEvent {
  return asSessionEvent({
    type: 'assistant/message',
    seq: seqOf(seq),
    time: 2000 + seq,
    data: {
      turn: 1,
      step: 1,
      message: {
        id: `a${seq}`,
        role: 'assistant',
        content: [{ type: 'text', text }],
        source: { kind: 'model', id: `a${seq}`, provider: 'deepseek' },
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    },
  })
}

function toolCallEvent(seq: number): SessionEvent {
  return asSessionEvent({
    type: 'tool/call',
    seq: seqOf(seq),
    time: 3000 + seq,
    data: { turn: 1, step: 1, callId: `c${seq}`, name: 'read', arguments: '{"path":"a.md"}' },
  })
}

describe('messageText', () => {
  it('flattens text, reasoning and image blocks', () => {
    const text = messageText([
      { type: 'text', text: '你好' },
      { type: 'reasoning', text: '思考' },
      { type: 'image', attachment: { attachmentId: 'a' as never, mediaType: 'image/png' as never, bytes: 1, width: 2, height: 2 } },
    ])
    expect(text).toContain('你好')
    expect(text).toContain('思考')
    expect(text).toContain('[图片]')
  })

  it('names offloaded images, files, and tool-availability changes', () => {
    const text = messageText([
      { type: 'image', offloaded: true, attachment: { attachmentId: 'a' as never, mediaType: 'image/png' as never, bytes: 1, width: 2, height: 2 } },
      { type: 'file', attachment: { attachmentId: 'f' as never, name: 'spec.md', bytes: 12 } },
      { type: 'tool-addition', toolName: 'web_search' },
      { type: 'tool-removal', toolName: 'web_search' },
    ])
    expect(text).toContain('[图片（已折叠）]')
    expect(text).toContain('[文件 spec.md]')
    expect(text).toContain('[启用工具 web_search]')
    expect(text).toContain('[移除工具 web_search]')
  })

  it('flattens a tool-result block written by an older harness log', () => {
    // 0.1.7 removed the `tool-result` content block in favour of a tool-role
    // message, but logs written before that still carry it.
    const text = messageText([asSessionBlock({ type: 'tool-result', toolCallId: 'c5', content: [{ type: 'text', text: '文件内容' }] })])
    expect(text).toContain('[工具结果]')
    expect(text).toContain('文件内容')
  })
})

function asSessionBlock(block: unknown): ContentBlock {
  return block as ContentBlock
}

describe('flagsOf', () => {
  it('detects LaTeX, MathML and Mermaid markers', () => {
    expect(flagsOf('公式 $$x^2$$ 结束').hasLatex).toBe(true)
    expect(flagsOf('<math><mi>x</mi></math>').hasMathml).toBe(true)
    expect(flagsOf('```mermaid\ngraph TD\n```').hasMermaid).toBe(true)
    expect(flagsOf('普通文本').hasLatex).toBe(false)
  })
})

describe('extractTurns', () => {
  it('keeps direct user messages only, tracking turn numbers', () => {
    const items = extractTurns([
      asSessionEvent({ type: 'turn/start', seq: seqOf(1), time: 1, data: { turn: 3 } }),
      userEvent(2, '直接提问'),
      userEvent(3, '注入上下文', 'system-prompt'),
      assistantEvent(4, '回答'),
      toolCallEvent(5),
    ])
    expect(items).toHaveLength(1)
    expect(items[0].seq).toBe(2)
    expect(items[0].turn).toBe(3)
    expect(items[0].text).toBe('直接提问')
  })
})

describe('buildMarkdown', () => {
  it('renders user, assistant and tool rows', () => {
    const md = buildMarkdown([
      { seq: 2, time: 1002, kind: 'user', text: '你好', images: [] },
      { seq: 4, time: 2004, kind: 'assistant', text: '你好！' },
      { seq: 5, time: 3005, kind: 'tool-call', text: '', toolName: 'read', toolArgs: '{"path":"a.md"}' },
    ], 's1')
    expect(md).toContain('# 会话导出')
    expect(md).toContain('## 用户')
    expect(md).toContain('## 助手')
    expect(md).toContain('### 工具调用: read')
  })
})

describe('buildExportRows', () => {
  it('carries the tool name onto tool-result rows via the paired callId', async () => {
    // 0.1.7: a first-class tool-role message carrying `toolCallId`.
    const toolResultEvent = asSessionEvent({
      type: 'tool/result',
      seq: seqOf(6),
      time: 3006,
      data: {
        turn: 1,
        step: 1,
        message: {
          id: 'r6',
          role: 'tool',
          toolCallId: 'c5',
          content: [{ type: 'text', text: '文件内容' }],
          source: { kind: 'tool', callId: 'c5' },
        },
      },
    })
    const rows = await buildExportRows({
      session: { id: 's1' as never, createdAt: 1 },
      events: [userEvent(2, '读一下'), toolCallEvent(5), toolResultEvent],
    } as never, 'json')
    const call = rows.find((row) => row.kind === 'tool-call')
    const result = rows.find((row) => row.kind === 'tool-result')
    expect(call?.toolName).toBe('read')
    expect(result?.toolName).toBe('read')
    expect(result?.text).toContain('文件内容')
  })

  it('pairs a legacy tool-result message through its source callId', async () => {
    const legacyEvent = asSessionEvent({
      type: 'tool/result',
      seq: seqOf(6),
      time: 3006,
      data: {
        turn: 1,
        step: 1,
        message: {
          id: 'r6',
          role: 'user',
          content: [{ type: 'tool-result', toolCallId: 'c5', content: [{ type: 'text', text: '旧版结果' }] }],
          source: { kind: 'tool', callId: 'c5' },
        },
      },
    })
    const rows = await buildExportRows({
      session: { id: 's1' as never, createdAt: 1 },
      events: [toolCallEvent(5), legacyEvent],
    } as never, 'markdown')
    const result = rows.find((row) => row.kind === 'tool-result')
    expect(result?.toolName).toBe('read')
    expect(result?.text).toContain('旧版结果')
  })

  it('exports system and developer messages as injected context', async () => {
    const events = [
      asSessionEvent({ type: 'system/message', seq: seqOf(1), time: 1001, data: { turn: 0, step: 0, message: { id: 's1', role: 'system', content: [{ type: 'text', text: '你是助手' }], source: { kind: 'system-prompt' } } } }),
      asSessionEvent({ type: 'developer/message', seq: seqOf(2), time: 1002, data: { turn: 0, step: 0, message: { id: 'd1', role: 'developer', content: [{ type: 'tool-addition', toolName: 'web_search' }], source: { kind: 'tool-registry' } } } }),
    ]
    const rows = await buildExportRows({ session: { id: 's1' as never, createdAt: 1 }, events } as never, 'markdown')
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.kind === 'context')).toBe(true)
    expect(rows[0].text).toContain('你是助手')
    expect(rows[1].text).toContain('启用工具 web_search')
  })
})

describe('search scan fallback helpers', () => {
  it('flattens each searchable event shape', () => {
    expect(eventSearchText(asSessionEvent({ type: 'user/message', seq: seqOf(1), time: 1, data: { role: 'user', content: [{ type: 'text', text: '用户说的' }], source: { kind: 'user' } } }))).toBe('用户说的')
    expect(eventSearchText(asSessionEvent({ type: 'assistant/message', seq: seqOf(2), time: 1, data: { turn: 1, step: 1, message: { role: 'assistant', content: [{ type: 'text', text: '助手说的' }] } } }))).toBe('助手说的')
    expect(eventSearchText(toolCallEvent(3))).toContain('read {"path":"a.md"}')
    expect(eventSearchText(asSessionEvent({ type: 'tool/result', seq: seqOf(4), time: 1, data: { turn: 1, step: 1, message: { role: 'tool', content: [{ type: 'text', text: '结果文本' }] } } }))).toBe('结果文本')
    expect(eventSearchText(asSessionEvent({ type: 'turn/end', seq: seqOf(5), time: 1, data: { turn: 1, reason: 'complete' } }))).toBe('')
  })

  it('maps event types to the three searchable roles', () => {
    expect(searchKindOf('user/message')).toBe('user')
    expect(searchKindOf('assistant/message')).toBe('assistant')
    expect(searchKindOf('tool/call')).toBe('tool')
    expect(searchKindOf('tool/result')).toBe('tool')
    expect(searchKindOf('system/message')).toBeNull()
    expect(searchKindOf('developer/message')).toBeNull()
  })

  it('keeps the whole match inside the excerpt even near the end', () => {
    const needle = 'needle-at-the-tail'
    const text = 'x'.repeat(900) + needle + 'y'.repeat(200)
    const snippet = snippetAround(text, text.indexOf(needle), needle.length, 500)
    expect(snippet).toContain(needle)
    expect(snippet.startsWith('…')).toBe(true)
    // The window ran to the end of the message, so there is nothing after it
    // to promise: no trailing ellipsis.
    expect(snippet.endsWith('…')).toBe(false)
    // A strictly interior window is marked on both sides.
    const middle = 'a'.repeat(600) + 'core' + 'b'.repeat(600)
    const inner = snippetAround(middle, middle.indexOf('core'), 4, 100)
    expect(inner.startsWith('…') && inner.endsWith('…')).toBe(true)
    expect(inner).toContain('core')
    // A hit at the very start has no leading ellipsis.
    expect(snippetAround('head text here', 0, 4, 500)).toBe('head text here')
  })
})
