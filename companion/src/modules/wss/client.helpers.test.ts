import { describe, expect, test } from 'bun:test'
import { computeBackoffDelay } from './client.helpers'

describe('computeBackoffDelay', () => {
  test('starts at 1 s on the first attempt', () => {
    expect(computeBackoffDelay(0)).toBe(1_000)
  })

  test('doubles each attempt', () => {
    expect(computeBackoffDelay(1)).toBe(2_000)
    expect(computeBackoffDelay(2)).toBe(4_000)
    expect(computeBackoffDelay(3)).toBe(8_000)
    expect(computeBackoffDelay(4)).toBe(16_000)
  })

  test('caps at 30 s', () => {
    expect(computeBackoffDelay(5)).toBe(30_000)
    expect(computeBackoffDelay(10)).toBe(30_000)
    expect(computeBackoffDelay(100)).toBe(30_000)
  })
})
