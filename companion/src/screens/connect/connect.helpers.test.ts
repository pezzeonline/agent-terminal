import { describe, expect, test } from 'bun:test'
import {
  connectErrorMessage,
  looksLikeUuid,
  normaliseWssUrl,
  validateInputs,
} from './connect.helpers'

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

describe('validateInputs', () => {
  test('rejects empty URL', () => {
    expect(validateInputs('', 'token').kind).toBe('error')
  })
  test('rejects empty token', () => {
    expect(validateInputs('ws://x', '').kind).toBe('error')
  })
  test('trims and normalises on success', () => {
    const result = validateInputs('192.168.1.1:47823', '  token  ')
    expect(result).toEqual({
      kind: 'ok',
      url: 'ws://192.168.1.1:47823',
      token: 'token',
    })
  })
})

describe('connectErrorMessage', () => {
  test('validation errors win over status errors', () => {
    expect(
      connectErrorMessage('auth_failed', 'bad token', 'URL required'),
    ).toBe('URL required')
  })

  test('auth_failed surfaces the server-provided reason', () => {
    expect(connectErrorMessage('auth_failed', 'bad token', null)).toBe(
      'Auth failed, bad token',
    )
  })

  test('unreachable falls back to a generic message when no error', () => {
    expect(connectErrorMessage('unreachable', null, null)).toBe(
      'Server not reachable. Check the URL and your Wi-Fi.',
    )
  })

  test('unreachable includes the error reason when present', () => {
    expect(connectErrorMessage('unreachable', 'timeout', null)).toBe(
      'Server not reachable, timeout',
    )
  })

  test('returns null when nothing is wrong', () => {
    expect(connectErrorMessage('connected', null, null)).toBe(null)
    expect(connectErrorMessage('connecting', null, null)).toBe(null)
  })
})
