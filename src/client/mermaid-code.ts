/**
 * Pure Mermaid code-block detection helpers for the in-place renderer.
 *
 * The GUI renders a settled ```mermaid fence with its language in the code
 * banner, but while the assistant is still streaming the banner is blank and
 * the fence content grows chunk by chunk — detection then has to fall back to
 * content heuristics (keyword prefix + completeness), the same approach the
 * Gemini Voyager extension uses. Everything here is string-in/string-out so
 * the heuristics stay unit-testable without a DOM.
 * @module @alexpeng/dsh-custom-plugin/client/mermaid-code
 */

/** Diagram-type keywords aligned with mermaid's own detectors (longest first
 * so `flowchart-elk` is not eaten by `flowchart`). `mindmap` included. */
const MERMAID_KEYWORDS = [
  'flowchart-elk',
  'flowchart',
  'graph',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'erDiagram',
  'gantt',
  'pie',
  'gitGraph',
  'journey',
  'mindmap',
  'timeline',
  'zenuml',
  'quadrantChart',
  'requirementDiagram',
  'requirement',
  'sankey-beta',
  'sankey',
  'C4Context',
  'C4Container',
  'C4Component',
  'C4Dynamic',
  'C4Deployment',
  'xychart-beta',
  'xychart',
  'block-beta',
  'block',
  'packet-beta',
  'packet',
  'architecture-beta',
  'architecture',
  'kanban',
  'radar-beta',
  'treemap',
] as const

/** Banner labels that carry no language information (GUI locales + plain
 * `mermaid` obviously excluded): content detection still applies to them. */
const GENERIC_INFOSTRINGS = new Set([
  '代码段',
  '代码',
  '代码块',
  '示例',
  '示例代码',
  '程式碼片段',
  'コード スニペット',
  'code',
  'code snippet',
  'snippet',
  'example',
  'code example',
  'sample',
  'text',
  'plain',
  'plaintext',
  'raw',
  'output',
  'result',
])

/** A banner label that names a real programming language must not be
 * content-detected (a Python `%%` comment is not a mermaid directive). */
export function isGenericInfostring(label: string | null | undefined): boolean {
  if (label === null || label === undefined || label.trim() === '') return true
  return GENERIC_INFOSTRINGS.has(label.trim().toLowerCase())
}

/** Whitespace normalization: web/CJK paste artifacts break the parser. */
export function normalizeMermaidText(code: string): string {
  return code
    .replace(/[\u00A0\u2002\u2003\u2009\u3000]/g, ' ')
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
}

/** Does this text look like complete mermaid source? Conservative: during
 * streaming we would rather skip a beat than flash a syntax error. */
export function isMermaidCode(code: string): boolean {
  const trimmed = code.trim()
  if (trimmed.length < 50) return false
  const lower = trimmed.toLowerCase()
  const startsWithKeyword =
    trimmed.startsWith('%%')
    || MERMAID_KEYWORDS.some((keyword) => {
      // The keyword must end its token: `timeline` opens a diagram, but
      // `timeline: list[str] = load()` is ordinary source that happens to
      // start with the same word.
      if (!lower.startsWith(keyword.toLowerCase())) return false
      const next = lower.charAt(keyword.length)
      return next === '' || next === ' ' || next === '\n' || next === '\t' || next === '\r'
    })
  if (!startsWithKeyword) return false
  const lines = trimmed.split('\n').filter((line) => line.trim().length > 0)
  if (lines.length < 3) return false
  const lastLine = lines[lines.length - 1].trim()
  const incompleteEndings = ['-->', '---', '-.', '==>', ':::', '[', '(', '{', '|', '&', ',']
  if (incompleteEndings.some((ending) => lastLine.endsWith(ending))) return false
  return true
}
