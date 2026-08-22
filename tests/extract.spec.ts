/**
 * Unit tests for the export builders and timeline extraction.
 * @module @alexpeng/dsh-custom-plugin/tests/extract
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { buildExportRows, buildMarkdown, extractTurns, flagsOf, messageText } from '../src/extract.ts'

function userEvent(seq: number, text: string, kind: 'user' | 'plugin' = 'user'): SessionEvent {
  return {
    type: 'user/message',
    seq,
    time: 1000 + seq,
    data: {
      role: 'user',
      id: `m${seq}`,
      content: [{ type: 'text', text }],
      source: { kind, id: `m${seq}` },
    } as never,
  } as SessionEvent
}

function assistantEvent(seq: number, text: string): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
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
    } as never,
  } as SessionEvent
}

function toolCallEvent(seq: number): SessionEvent {
  return {
    type: 'tool/call',
    seq,
    time: 3000 + seq,
    data: { turn: 1, step: 1, callId: `c${seq}`, name: 'read', arguments: '{"path":"a.md"}' },
  } as SessionEvent
}

describe('messageText', () => {
  it('flattens text, reasoning and tool blocks', () => {
    const text = messageText([
      { type: 'text', text: '你好' },
      { type: 'reasoning', text: '思考' },
      { type: 'image', attachment: { attachmentId: 'a' as never, mediaType: 'image/png' as never, bytes: 1, width: 2, height: 2 } },
    ])
    expect(text).toContain('你好')
    expect(text).toContain('思考')
    expect(text).toContain('[图片]')
  })
})

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
      { type: 'turn/start', seq: 1, time: 1, data: { turn: 3 } },
      userEvent(2, '直接提问'),
      userEvent(3, '注入上下文', 'plugin'),
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
    const toolResultEvent: SessionEvent = {
      type: 'tool/result',
      seq: 6,
      time: 3006,
      data: {
        turn: 1,
        step: 1,
        message: {
          id: 'r6',
          role: 'user',
          content: [{ type: 'tool-result', toolCallId: 'c5', content: [{ type: 'text', text: '文件内容' }] }],
          source: { kind: 'tool', callId: 'c5' },
        },
      } as never,
    }
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
})
