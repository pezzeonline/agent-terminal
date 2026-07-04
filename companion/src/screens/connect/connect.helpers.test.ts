import { describe, expect, test } from 'bun:test'
import { looksLikeUuid, normaliseWssUrl } from './connect.helpers'

describe('normaliseWssUrl', () => {
  test('preserves ws:// and wss:// prefixes', () => {
    expect(normaliseWssUrl('ws://192.168.1.42:47823/stream')).toBe(
      'ws://192.168.1.42:47823/stream',
    )
    expect(normaliseWssUrl('wss://example.com/stream')).toBe(
      'wss://example.com/stream',
    )
  })

  test('prepends ws:// to a bare host:port', () => {
    expect(normaliseWssUrl('192.168.1.42:47823')).toBe(
      'ws://192.168.1.42:47823',
    )
  })

  test('returns empty for empty input', () => {
    expect(normaliseWssUrl('   ')).toBe('')
    expect(normaliseWssUrl('')).toBe('')
  })
})

describe('looksLikeUuid', () => {
  test('accepts a canonical UUID', () => {
    expect(looksLikeUuid('99be5462-d34a-49d6-9754-8c4ed9f2456f')).toBe(true)
  })

  test('rejects non-hex garbage', () => {
    expect(looksLikeUuid('hello world')).toBe(false)
    expect(looksLikeUuid('short')).toBe(false)
  })
})
