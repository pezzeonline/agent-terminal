import { describe, expect, test } from 'bun:test'
import { nextBackoffDelay } from './client'

describe('nextBackoffDelay', () => {
  test('starts at 1 s on the first attempt', () => {
    expect(nextBackoffDelay(0)).toBe(1_000)
  })

  test('doubles each attempt', () => {
    expect(nextBackoffDelay(1)).toBe(2_000)
    expect(nextBackoffDelay(2)).toBe(4_000)
    expect(nextBackoffDelay(3)).toBe(8_000)
    expect(nextBackoffDelay(4)).toBe(16_000)
  })

  test('caps at 30 s', () => {
    expect(nextBackoffDelay(5)).toBe(30_000)
    expect(nextBackoffDelay(10)).toBe(30_000)
    expect(nextBackoffDelay(100)).toBe(30_000)
  })
})
