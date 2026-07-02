import { beforeEach, describe, expect, test } from 'bun:test'
import {
  $fontFamily,
  FONT_FAMILY_OPTIONS,
  fontFamilyStack,
  setFontFamily,
} from '@/modules/stores/$fontFamily'

function installDomStubs() {
  const store = new Map<string, string>()
  const localStorageStub = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => store.clear(),
    key: () => null,
    length: 0,
  } as Storage
  ;(globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    localStorageStub
  // `$fontFamily`'s persistence guard checks `typeof window !== 'undefined'`
  // (matching `$fontSize.ts`) — bun:test has no `window` global by default.
  ;(
    globalThis as typeof globalThis & { window: { localStorage: Storage } }
  ).window = { localStorage: localStorageStub }
  return store
}

beforeEach(() => {
  $fontFamily.set('Geist Mono')
  installDomStubs()
})

describe('font family store', () => {
  test('setFontFamily updates the store and persists to localStorage', () => {
    setFontFamily('JetBrains Mono')

    expect($fontFamily.get()).toBe('JetBrains Mono')
    expect(localStorage.getItem('agent-terminal:font-family')).toBe(
      'JetBrains Mono',
    )
  })

  test('FONT_FAMILY_OPTIONS includes the bundled default font', () => {
    expect(FONT_FAMILY_OPTIONS).toContain('Geist Mono')
  })

  test('fontFamilyStack appends a generic monospace fallback', () => {
    expect(fontFamilyStack('Fira Code')).toBe('"Fira Code", monospace')
  })
})
