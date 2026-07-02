import { atom } from 'nanostores'

const STORAGE_KEY = 'agent-terminal:font-family'

/**
 * Curated list of well-known monospace/programming fonts. "Geist Mono" is
 * bundled with the app (`@fontsource-variable/geist`); the rest are common
 * system/developer fonts users are likely to already have installed —
 * `fontFamilyStack` falls back to the browser's generic `monospace` if the
 * chosen one isn't present.
 */
export const FONT_FAMILY_OPTIONS = [
  'Geist Mono',
  'Menlo',
  'Monaco',
  'SF Mono',
  'Cascadia Code',
  'Fira Code',
  'JetBrains Mono',
  'Courier New',
] as const

export type FontFamilyOption = (typeof FONT_FAMILY_OPTIONS)[number]

const DEFAULT: FontFamilyOption = 'Geist Mono'

function isFontFamilyOption(value: string): value is FontFamilyOption {
  return (FONT_FAMILY_OPTIONS as readonly string[]).includes(value)
}

function readPersisted(): FontFamilyOption {
  if (typeof window === 'undefined') return DEFAULT
  const raw = window.localStorage.getItem(STORAGE_KEY)
  return raw !== null && isFontFamilyOption(raw) ? raw : DEFAULT
}

export const $fontFamily = atom<FontFamilyOption>(readPersisted())

$fontFamily.subscribe((value) => {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, value)
  }
})

export function setFontFamily(value: FontFamilyOption): void {
  $fontFamily.set(value)
}

/** CSS font-family stack: chosen font first, generic monospace fallback last. */
export function fontFamilyStack(value: FontFamilyOption): string {
  return `"${value}", monospace`
}
