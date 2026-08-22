import { describe, expect, it } from 'vitest'
import { mermaidLiveUrl } from '../src/client/mermaid-url.ts'

const LINK_PREFIX = 'https://mermaid.live/edit#pako:'

function base64UrlToBytes(packed: string): Uint8Array {
  const b64 = packed.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function inflate(packed: string): Promise<string> {
  const stream = new DecompressionStream('deflate')
  const writer = stream.writable.getWriter()
  void writer.write(base64UrlToBytes(packed))
  void writer.close()
  return await new Response(stream.readable).text()
}

describe('mermaidLiveUrl', () => {
  it('builds a #pako: link whose payload inflates back to the mermaid.live state document', async () => {
    const code = 'graph TD\nA --> 中文节点'
    const url = await mermaidLiveUrl(code)
    expect(url.startsWith(LINK_PREFIX)).toBe(true)
    const packed = url.slice(LINK_PREFIX.length)
    expect(packed.length).toBeGreaterThan(0)
    const state = JSON.parse(await inflate(packed)) as { code: string, mermaid: { theme: string } }
    expect(state.code).toBe(code)
    expect(state.mermaid.theme).toBe('default')
  })

  it('falls back to the uncompressed baseline payload when CompressionStream is unavailable', async () => {
    const scope = globalThis as { CompressionStream?: unknown }
    const original = scope.CompressionStream
    scope.CompressionStream = undefined
    try {
      const url = await mermaidLiveUrl('graph TD\nA --> B')
      const state = JSON.parse(new TextDecoder().decode(base64UrlToBytes(url.slice(LINK_PREFIX.length)))) as { code: string }
      expect(state.code).toBe('graph TD\nA --> B')
    } finally {
      scope.CompressionStream = original
    }
  })
})
