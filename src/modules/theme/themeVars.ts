// Derives the full app design-token set and the xterm ITheme from a theme's
// compact anchor colors — see `colorThemes.ts` for the anchor definitions.
//
// Chrome overlays (borders, hovers, muted foregrounds) are computed from the
// theme polarity and foreground the same way the original light/dark CSS did,
// so every theme stays internally cohesive without hand-authoring ~50 tokens.

import type { ITheme } from '@xterm/xterm'
import {
  DEFAULT_DARK_ID,
  DEFAULT_LIGHT_ID,
  THEME_MAP,
  type ThemeDef,
  type ThemeType,
} from '@/modules/theme/colorThemes'

/** White veil for dark themes, black veil for light — matches the old CSS. */
function overlay(type: ThemeType, alpha: number): string {
  return type === 'dark'
    ? `rgba(255, 255, 255, ${alpha})`
    : `rgba(0, 0, 0, ${alpha})`
}

/** `color` at `pct`% opacity, via color-mix (supported by the app webview). */
function fade(color: string, pct: number): string {
  return `color-mix(in srgb, ${color} ${pct}%, transparent)`
}

/**
 * Full CSS custom-property map for a theme, applied as inline styles on
 * <html> so it overrides the stylesheet defaults regardless of specificity.
 */
export function deriveThemeVars(def: ThemeDef): Record<string, string> {
  const { type, bg, fg, sidebar, accent, ansi } = def
  const accentFg = def.accentFg ?? '#ffffff'
  const strongPct = type === 'dark' ? 90 : 88

  return {
    '--background': bg,
    '--foreground': fg,
    '--window-border': overlay(type, 0.08),

    '--sidebar-background': sidebar,
    '--sidebar-border': overlay(type, 0.06),
    '--sidebar-foreground': fade(fg, 55),
    '--sidebar-foreground-strong': fade(fg, strongPct),
    '--sidebar-hover': overlay(type, type === 'dark' ? 0.04 : 0.03),
    '--sidebar-active': overlay(type, type === 'dark' ? 0.07 : 0.05),
    '--sidebar-section-label': fade(fg, 40),

    '--tab-bar-background': sidebar,
    '--tab-bar-border': overlay(type, 0.06),
    '--tab-active-background': bg,
    '--tab-foreground': fade(fg, 50),
    '--tab-foreground-active': fade(fg, 95),
    '--tab-border': overlay(type, 0.08),

    '--terminal-background': bg,
    '--terminal-foreground': fg,
    '--terminal-dim': fade(fg, 55),
    '--terminal-muted': fade(fg, 40),
    '--terminal-red': ansi[1],
    '--terminal-green': ansi[2],
    '--terminal-yellow': ansi[3],
    '--terminal-magenta': ansi[5],
    '--terminal-cyan': ansi[6],
    '--terminal-prompt': accent,

    '--status-bar-background': sidebar,
    '--status-bar-border': overlay(type, 0.06),
    '--status-bar-foreground': fade(fg, 45),
    '--status-bar-foreground-strong': fade(fg, 82),

    '--accent': accent,
    '--accent-foreground': accentFg,
    '--accent-soft': fade(accent, 12),
    '--running-dot': ansi[2],

    '--card': bg,
    '--card-foreground': fg,
    '--popover': sidebar,
    '--popover-foreground': fg,
    '--primary': accent,
    '--primary-foreground': accentFg,
    '--secondary': overlay(type, type === 'dark' ? 0.07 : 0.05),
    '--secondary-foreground': fg,
    '--muted': overlay(type, type === 'dark' ? 0.04 : 0.03),
    '--muted-foreground': fade(fg, 55),
    '--border': overlay(type, 0.08),
    '--input': overlay(type, 0.08),
    '--ring': accent,
    '--destructive': ansi[1],

    // wterm ANSI palette (CSS-var consumers)
    '--term-fg': def.termFg ?? fg,
    '--term-bg': bg,
    '--term-color-0': ansi[0],
    '--term-color-1': ansi[1],
    '--term-color-2': ansi[2],
    '--term-color-3': ansi[3],
    '--term-color-4': ansi[4],
    '--term-color-5': ansi[5],
    '--term-color-6': ansi[6],
    '--term-color-7': ansi[7],
    '--term-color-8': ansi[8],
    '--term-color-9': ansi[9],
    '--term-color-10': ansi[10],
    '--term-color-11': ansi[11],
    '--term-color-12': ansi[12],
    '--term-color-13': ansi[13],
    '--term-color-14': ansi[14],
    '--term-color-15': ansi[15],
  }
}

const SEL_INACTIVE: Record<ThemeType, string> = {
  dark: '#3a3d41',
  light: '#e5ebf1',
}

/** xterm.js ITheme built from a theme's anchors. */
export function buildXtermTheme(def: ThemeDef): ITheme {
  const a = def.ansi
  const fg = def.termFg ?? def.fg
  const bg = def.termBg ?? def.bg
  return {
    background: bg,
    foreground: fg,
    cursor: def.cursor ?? fg,
    cursorAccent: bg,
    selectionBackground: def.selection,
    selectionForeground: fg,
    selectionInactiveBackground: def.selInactive ?? SEL_INACTIVE[def.type],
    black: a[0],
    red: a[1],
    green: a[2],
    yellow: a[3],
    blue: a[4],
    magenta: a[5],
    cyan: a[6],
    white: a[7],
    brightBlack: a[8],
    brightRed: a[9],
    brightGreen: a[10],
    brightYellow: a[11],
    brightBlue: a[12],
    brightMagenta: a[13],
    brightCyan: a[14],
    brightWhite: a[15],
  }
}

/**
 * Resolve an xterm ITheme from the `data-color-theme` id currently on <html>.
 * Falls back to the polarity default if the id is unknown (e.g. the store
 * hasn't applied yet on very first paint).
 */
export function xtermThemeForId(
  id: string | null,
  prefersDark: boolean,
): ITheme {
  const def =
    (id && THEME_MAP[id]) ||
    THEME_MAP[prefersDark ? DEFAULT_DARK_ID : DEFAULT_LIGHT_ID]
  return buildXtermTheme(def)
}
