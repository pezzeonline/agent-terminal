import { beforeEach, describe, expect, test } from 'bun:test'
import {
  $colorTheme,
  applyColorThemeToDocument,
  initColorThemeFromStorage,
  resolveTheme,
  setColorTheme,
} from '@/modules/stores/$colorTheme'

// Minimal DOM + storage stubs. bun:test has no window/document by default;
// `applyColorThemeToDocument` reads/writes attributes and inline CSS vars, so
// the documentElement stub tracks both.
function installDomStubs(osDark = false) {
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
  } as unknown as Storage
  ;(globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    localStorageStub

  const attributes = new Map<string, string>()
  const styleProps = new Map<string, string>()
  const documentElement = {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value)
    },
    style: {
      setProperty: (name: string, value: string) => {
        styleProps.set(name, value)
      },
    },
  } as unknown as HTMLElement
  ;(globalThis as typeof globalThis & { document: Document }).document = {
    documentElement,
  } as unknown as Document
  ;(globalThis as { window: Window & typeof globalThis }).window = {
    localStorage: localStorageStub,
    matchMedia: () =>
      ({
        matches: osDark,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  } as unknown as Window & typeof globalThis

  return { attributes, styleProps }
}

beforeEach(() => {
  $colorTheme.set('auto')
  installDomStubs()
})

describe('color theme store', () => {
  test('setColorTheme persists an explicit theme and applies attributes', () => {
    setColorTheme('monokai')

    expect($colorTheme.get()).toBe('monokai')
    expect(document.documentElement.getAttribute('data-color-theme')).toBe(
      'monokai',
    )
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem('agent-terminal:color-theme')).toBe('monokai')
  })

  test('setColorTheme auto removes the persisted key and resolves via OS', () => {
    setColorTheme('monokai')
    setColorTheme('auto')

    expect($colorTheme.get()).toBe('auto')
    // OS is light in the stub → resolves to the light default.
    expect(document.documentElement.getAttribute('data-color-theme')).toBe(
      'agent-light',
    )
    expect(localStorage.getItem('agent-terminal:color-theme')).toBeNull()
  })

  test('applyColorThemeToDocument writes derived CSS variables', () => {
    const { styleProps } = installDomStubs()
    $colorTheme.set('solarized-dark')

    applyColorThemeToDocument('solarized-dark')

    expect(styleProps.get('--background')).toBe('#002b36')
    expect(styleProps.get('--term-color-1')).toBe('#dc322f')
  })

  test('initColorThemeFromStorage restores a saved theme', () => {
    localStorage.setItem('agent-terminal:color-theme', 'dark-modern')

    initColorThemeFromStorage()

    expect($colorTheme.get()).toBe('dark-modern')
    expect(document.documentElement.getAttribute('data-color-theme')).toBe(
      'dark-modern',
    )
  })

  test('initColorThemeFromStorage migrates the legacy light/dark key', () => {
    localStorage.setItem('agent-terminal:theme', 'dark')

    initColorThemeFromStorage()

    expect($colorTheme.get()).toBe('agent-dark')
    expect(localStorage.getItem('agent-terminal:color-theme')).toBe(
      'agent-dark',
    )
    expect(localStorage.getItem('agent-terminal:theme')).toBeNull()
  })

  test('resolveTheme falls back to the OS default for unknown ids', () => {
    expect(resolveTheme('does-not-exist').id).toBe('agent-light')
    expect(resolveTheme('monokai').id).toBe('monokai')
  })
})
