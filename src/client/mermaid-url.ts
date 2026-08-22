/**
 * mermaid.live editor link builder.
 *
 * mermaid.live restores a diagram from `#pako:` + base64url of a DEFLATE
 * (zlib) compressed JSON state `{ code, mermaid: { theme } }` — the same
 * bytes `pako.deflate` produces. A plain base64url of the raw JSON (without
 * compressing it) leaves the editor unable to inflate the payload, and the
 * link opens an empty diagram. This module compresses for real and keeps the
 * uncompressed payload only as a fallback for browsers without
 * CompressionStream.
 * @module @alexpeng/dsh-custom-plugin/client/mermaid-url
 */

interface DeflateStream {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const byte of bytes) bin += String.fromCharCode(byte)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function deflateZlibBase64Url(text: string): Promise<string | null> {
  const Ctor = (globalThis as { CompressionStream?: unknown }).CompressionStream
  if (typeof Ctor !== 'function') return null
  try {
    const stream = new (Ctor as new (format: 'deflate') => DeflateStream)('deflate')
    const writer = stream.writable.getWriter()
    void writer.write(new TextEncoder().encode(text))
    void writer.close()
    const buffer = new Uint8Array(await new Response(stream.readable).arrayBuffer())
    return bytesToBase64Url(buffer)
  } catch {
    return null
  }
}

/** Build the `https://mermaid.live/edit#pako:…` share link for one diagram. */
export async function mermaidLiveUrl(code: string): Promise<string> {
  const state = JSON.stringify({ code, mermaid: { theme: 'default' } })
  const packed = await deflateZlibBase64Url(state)
  return 'https://mermaid.live/edit#pako:' + (packed ?? bytesToBase64Url(new TextEncoder().encode(state)))
}
