/**
 * Unit tests for the mermaid in-place detection heuristics: keyword prefix,
 * streaming completeness, generic banner labels and whitespace normalization.
 * @module @alexpeng/dsh-custom-plugin/tests/mermaid-code
 */

import { describe, expect, it } from 'vitest'
import { isGenericInfostring, isMermaidCode, normalizeMermaidText } from '../src/client/mermaid-code.ts'

const MINDMAP = `mindmap
  root((AI 助手))
    前端
      React
      Vue
    后端
      Node.js`

const FLOWCHART = `flowchart TD
  Start[开始处理] --> Input[/读取输入/]
  Input --> Check{数据合法?}
  Check -->|是| Transform[清洗转换]
  Check -->|否| Reject[拒绝并提示]
  Transform --> Store[(写入存储)]
  Store --> Done[结束处理]`

describe('isMermaidCode', () => {
  it('detects a complete mindmap', () => {
    expect(isMermaidCode(MINDMAP)).toBe(true)
  })

  it('detects a complete flowchart', () => {
    expect(isMermaidCode(FLOWCHART)).toBe(true)
  })

  it('rejects a keyword-only stub still streaming in', () => {
    expect(isMermaidCode('mindmap')).toBe(false)
    expect(isMermaidCode('mindmap\n  root((测试))')).toBe(false)
  })

  it('rejects a dangling edge mid-stream', () => {
    expect(isMermaidCode('flowchart TD\n  A --> B -->')).toBe(false)
    expect(isMermaidCode('flowchart TD\n  A --> B,\n')).toBe(false)
  })

  it('rejects foreign source that merely starts like a keyword', () => {
    // "timeline:" as a python variable annotation is not a diagram.
    expect(isMermaidCode('timeline: list[str] = load()\n# 常规配置读取\nvalue = timeline[0]')).toBe(false)
    expect(isMermaidCode('const state = { a: 1, b: 2 };\n// 渲染循环\nrequestAnimationFrame(step)')).toBe(false)
  })

  it('accepts a directive-prefixed diagram', () => {
    expect(isMermaidCode(`%%{init: {"theme":"dark"}}%%\nmindmap\n  root((x))\n  a\n  b`)).toBe(true)
  })

  it('matches keywords case-insensitively', () => {
    expect(isMermaidCode('Mindmap\n  root((人工智能))\n  前端技术\n  后端架构\n  数据与算法\n  产品与设计')).toBe(true)
    expect(isMermaidCode('SEQUENCEDIAGRAM\n  a->>b: 你好请求\n  b-->>a: 收到响应\n  a->>b: 确认结束')).toBe(true)
  })

  it('requires the keyword to end its token', () => {
    // `graphite`, `piedata` — plain identifiers, not diagram keywords.
    expect(isMermaidCode('graphite_metrics = collect()\n# 采集频率配置\ninterval = 60')).toBe(false)
    expect(isMermaidCode('piedata = load_pie_chart_data_from_store()\nreturn piedata\n# end of loader')).toBe(false)
  })
})

describe('isGenericInfostring', () => {
  it('treats blank and missing labels as generic', () => {
    expect(isGenericInfostring(null)).toBe(true)
    expect(isGenericInfostring(undefined)).toBe(true)
    expect(isGenericInfostring('')).toBe(true)
    expect(isGenericInfostring('   ')).toBe(true)
  })

  it('recognizes localized generic labels', () => {
    expect(isGenericInfostring('代码')).toBe(true)
    expect(isGenericInfostring('代码段')).toBe(true)
    expect(isGenericInfostring('Code')).toBe(true)
    expect(isGenericInfostring('TEXT')).toBe(true)
  })

  it('rejects concrete language labels so foreign code is never touched', () => {
    expect(isGenericInfostring('python')).toBe(false)
    expect(isGenericInfostring('typescript')).toBe(false)
    expect(isGenericInfostring('mermaid')).toBe(false)
  })
})

describe('normalizeMermaidText', () => {
  it('maps CJK and web whitespace to plain spaces and drops zero-widths', () => {
    const input = 'mindmap\n\u3000root((测试))\n\u00A0分支\u200B一\n\u2003分支二'
    const out = normalizeMermaidText(input)
    expect(out).toContain(' root((测试))')
    expect(out).toContain(' 分支一')
    expect(out).not.toContain('\u200B')
    expect(out).not.toContain('\u3000')
  })
})
