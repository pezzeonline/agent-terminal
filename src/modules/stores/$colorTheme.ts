import { atom } from 'nanostores'
import {
  AUTO_ID,
  DEFAULT_DARK_ID,
  DEFAULT_LIGHT_ID,
  THEME_MAP,
  type ThemeDef,
} from '@/modules/theme/colorThemes'
import { deriveThemeVars } from '@/modules/theme/themeVars'

const KEY = 'agent-terminal:color-theme'
// The pre-color-theme setting stored only 'light' | 'dark' (system = absent).
const LEGACY_KEY = 'agent-terminal:theme'

/**
 * Selected theme id, or the `auto` sentinel (follow the OS between the two
 * default themes). This is the persisted user choice; the *resolved* concrete
 * theme is derived via `resolveTheme`.
 */
export const $colorTheme = atom<string>(AUTO_ID)

function osPrefersDark(): boolean {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Concrete theme for a selection id, resolving `auto` against the OS. */
export function resolveTheme(id: string): ThemeDef {
  if (id !== AUTO_ID) {
    const found = THEME_MAP[id]
    if (found) return found
  }
  return THEME_MAP[osPrefersDark() ? DEFAULT_DARK_ID : DEFAULT_LIGHT_ID]
}

// OS-preference listener refs — kept so the subscription can be torn down
// (test teardown, hot reload) and re-binding doesn't stack listeners.
let systemMq: MediaQueryList | null = null
let systemListener: (() => void) | null = null

function subscribeSystemChanges() {
  disposeColorThemeSubscriptions()
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return
  }
  systemMq = window.matchMedia('(prefers-color-scheme: dark)')
  systemListener = () => {
    if ($colorTheme.get() === AUTO_ID) applyColorThemeToDocument(AUTO_ID)
  }
  systemMq.addEventListener('change', systemListener)
}

/** Removes the OS prefers-color-scheme listener. No-op if not subscribed. */
export function disposeColorThemeSubscriptions() {
  if (systemMq && systemListener) {
    systemMq.removeEventListener('change', systemListener)
  }
  systemMq = null
  systemListener = null
}

function migrateLegacyKey() {
  try {
    if (localStorage.getItem(KEY) !== null) return
    const legacy = localStorage.getItem(LEGACY_KEY)
    if (legacy === 'dark') localStorage.setItem(KEY, DEFAULT_DARK_ID)
    else if (legacy === 'light') localStorage.setItem(KEY, DEFAULT_LIGHT_ID)
    localStorage.removeItem(LEGACY_KEY)
  } catch {}
}

/**
 * Apply a theme selection to <html>: `data-theme` carries the polarity (for
 * stylesheet fallbacks + PR/shadow tokens), `data-color-theme` carries the
 * resolved id (read by xterm), and every design token is written as an inline
 * CSS custom property so it overrides the stylesheet defaults.
 */
export function applyColorThemeToDocument(id: string) {
  if (typeof document === 'undefined') return
  const def = resolveTheme(id)
  const html = document.documentElement

  if (html.getAttribute('data-color-theme') !== def.id) {
    html.setAttribute('data-color-theme', def.id)
  }
  // data-theme is also observed by xterm and gates the shadow/PR CSS blocks.
  if (html.getAttribute('data-theme') !== def.type) {
    html.setAttribute('data-theme', def.type)
  }

  const vars = deriveThemeVars(def)
  for (const [name, value] of Object.entries(vars)) {
    html.style.setProperty(name, value)
  }
}

/** Persist + apply a theme selection. Pass `AUTO_ID` to follow the OS. */
export function setColorTheme(id: string) {
  try {
    if (id === AUTO_ID) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, id)
  } catch {}
  $colorTheme.set(id)
  applyColorThemeToDocument(id)
}

export function initColorThemeFromStorage() {
  migrateLegacyKey()
  try {
    const v = localStorage.getItem(KEY)
    if (v && (v === AUTO_ID || THEME_MAP[v])) $colorTheme.set(v)
  } catch {}
  applyColorThemeToDocument($colorTheme.get())
  subscribeSystemChanges()
}
