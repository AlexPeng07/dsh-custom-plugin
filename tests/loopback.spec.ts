/**
 * Unit tests for the request-level loopback fence, including the two header
 * shapes dsh Desktop produces when its Electron shell forwards a renderer
 * request: HTTP requests arrive with `origin` and `sec-fetch-site` removed,
 * and the WebSocket upgrade arrives with `origin` rewritten to the Host
 * authority.
 * @module @alexpeng/dsh-custom-plugin/tests/loopback
 */

import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { isIPv4Loopback, isLoopbackAddress, isLoopbackHostname, isLoopbackRequest } from '../src/loopback.ts'

function req(remoteAddress: string | undefined, headers: Record<string, string>): IncomingMessage {
  return { socket: { remoteAddress }, headers } as unknown as IncomingMessage
}

const HOST = '127.0.0.1:19387'

describe('isLoopbackRequest', () => {
  it('accepts what the Desktop shell forwards over HTTP', () => {
    // web-document.ts deletes host, origin, cookie and sec-fetch-site before
    // re-issuing the request against the Host authority, so the only browser
    // markers left are none — the same shape a non-browser client produces.
    expect(isLoopbackRequest(req('127.0.0.1', { host: HOST }))).toBe(true)
  })

  it('accepts the Desktop WebSocket upgrade shape', () => {
    // main.ts rewrites Origin to the Host origin and adds same-origin, so the
    // host comparison has to match rather than be skipped.
    expect(isLoopbackRequest(req('127.0.0.1', {
      host: HOST,
      origin: `http://${HOST}`,
      'sec-fetch-site': 'same-origin',
    }))).toBe(true)
  })

  it('accepts a localhost authority and the IPv6 loopback forms', () => {
    expect(isLoopbackRequest(req('127.0.0.42', { host: 'localhost:3080' }))).toBe(true)
    expect(isLoopbackRequest(req('::1', { host: '[::1]:3080' }))).toBe(true)
    expect(isLoopbackRequest(req('::ffff:127.0.0.1', { host: HOST }))).toBe(true)
  })

  it('rejects a foreign Origin even from a loopback socket', () => {
    expect(isLoopbackRequest(req('127.0.0.1', { host: HOST, origin: 'https://example.com' }))).toBe(false)
  })

  it('rejects an unparseable Origin', () => {
    expect(isLoopbackRequest(req('127.0.0.1', { host: HOST, origin: 'not a url' }))).toBe(false)
  })

  it('rejects a cross-site fetch regardless of the Origin match', () => {
    expect(isLoopbackRequest(req('127.0.0.1', {
      host: HOST,
      origin: `http://${HOST}`,
      'sec-fetch-site': 'cross-site',
    }))).toBe(false)
  })

  it('rejects a socket that is not loopback', () => {
    expect(isLoopbackRequest(req('10.0.0.5', { host: HOST }))).toBe(false)
    expect(isLoopbackRequest(req(undefined, { host: HOST }))).toBe(false)
  })

  it('rejects a Host header that names a non-loopback authority', () => {
    expect(isLoopbackRequest(req('127.0.0.1', { host: 'attacker.example' }))).toBe(false)
    expect(isLoopbackRequest(req('127.0.0.1', { host: 'localhost.evil.example' }))).toBe(false)
  })

  it('rejects a missing or malformed Host header', () => {
    expect(isLoopbackRequest(req('127.0.0.1', {}))).toBe(false)
    expect(isLoopbackRequest(req('127.0.0.1', { host: 'not a host:with spaces' }))).toBe(false)
  })
})

describe('loopback predicates', () => {
  it('holds the 127/8 prefix and rejects out-of-range octets', () => {
    expect(isIPv4Loopback('127.0.0.1')).toBe(true)
    expect(isIPv4Loopback('127.255.255.255')).toBe(true)
    expect(isIPv4Loopback('127.999.0.1')).toBe(false)
    expect(isIPv4Loopback('128.0.0.1')).toBe(false)
    expect(isIPv4Loopback('127.0.0')).toBe(false)
    expect(isIPv4Loopback('127.0.0.1.1')).toBe(false)
  })

  it('treats a mapped IPv4 outside 127/8 as not loopback', () => {
    expect(isLoopbackAddress('::ffff:10.0.0.1')).toBe(false)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress(' ::1')).toBe(false)
    expect(isLoopbackAddress('::1:')).toBe(false)
  })

  it('names only the loopback authorities', () => {
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('[::1]')).toBe(true)
    expect(isLoopbackHostname('127.1')).toBe(false)
    expect(isLoopbackHostname('::1')).toBe(false)
  })
})
