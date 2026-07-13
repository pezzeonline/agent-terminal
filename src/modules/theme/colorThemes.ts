// VS Code–style named color themes.
//
// Each theme is a compact set of "anchor" colors (window/editor background,
// foreground, sidebar, accent, terminal selection + the 16-slot ANSI
// palette). The full app design-token set and the xterm ITheme are *derived*
// from these anchors in `themeVars.ts`, so a new theme only needs a handful
// of values rather than the ~50 CSS custom properties the UI consumes.
//
// Colors are copied from Visual Studio Code's default themes (MIT):
//   - editor.background / editor.foreground / sideBar.background
//   - the integrated-terminal ANSI palette (terminalConfiguration.ts).
// Themes that don't override the terminal in VS Code reuse VS Code's default
// dark/light terminal palette, which is exactly what VS Code does at runtime.
//
// `agent-dark` / `agent-light` preserve this app's original hand-tuned look
// and are the defaults that `auto` resolves to.

import {
  ANSI_DARK,
  ANSI_LIGHT,
  ANSI_MONOKAI,
  ANSI_SOLARIZED,
  type Ansi16,
} from '@/modules/theme/ansiPalettes'

export type ThemeType = 'dark' | 'light'

export type ThemeDef = {
  id: string
  label: string
  type: ThemeType
  /** Window / editor background. */
  bg: string
  /** Primary foreground. */
  fg: string
  /** Sidebar / tab-bar / status-bar background. */
  sidebar: string
  /** Saturated accent (focus ring, primary buttons, prompt). */
  accent: string
  /** Readable text on top of `accent`. Defaults to white. */
  accentFg?: string
  /** Terminal selection background. */
  selection: string
  ansi: Ansi16
  /** Solid terminal foreground for xterm (when `fg` is translucent). */
  termFg?: string
  /** Solid terminal background for xterm (defaults to `bg`). */
  termBg?: string
  /** Terminal cursor color (defaults to the terminal foreground). */
  cursor?: string
  /** Inactive-selection background (defaults per polarity). */
  selInactive?: string
}

export const THEME_DEFS: readonly ThemeDef[] = [
  // ── Dark ──────────────────────────────────────────────────────────────
  {
    id: 'agent-dark',
    label: 'Agent Dark',
    type: 'dark',
    bg: '#0e0f10',
    fg: 'rgba(230, 232, 235, 0.92)',
    sidebar: '#141517',
    accent: 'oklch(0.68 0.15 225)',
    accentFg: '#000000',
    selection: '#264f78',
    ansi: ANSI_DARK,
    termFg: '#cccccc',
    cursor: '#aeafad',
  },
  {
    id: 'dark-modern',
    label: 'Dark Modern',
    type: 'dark',
    bg: '#1f1f1f',
    fg: '#cccccc',
    sidebar: '#181818',
    accent: '#0078d4',
    selection: '#264f78',
    ansi: ANSI_DARK,
  },
  {
    id: 'dark-plus',
    label: 'Dark (Visual Studio)',
    type: 'dark',
    bg: '#1e1e1e',
    fg: '#d4d4d4',
    sidebar: '#252526',
    accent: '#007acc',
    selection: '#264f78',
    ansi: ANSI_DARK,
  },
  {
    id: 'abyss',
    label: 'Abyss',
    type: 'dark',
    bg: '#000c18',
    fg: '#6688cc',
    sidebar: '#051336',
    accent: '#384887',
    selection: '#770811',
    ansi: ANSI_DARK,
    termFg: '#6688cc',
  },
  {
    id: 'kimbie-dark',
    label: 'Kimbie Dark',
    type: 'dark',
    bg: '#221a0f',
    fg: '#d3af86',
    sidebar: '#2b2013',
    accent: '#f79a32',
    accentFg: '#000000',
    selection: '#7c5021',
    ansi: ANSI_DARK,
    termFg: '#d3af86',
  },
  {
    id: 'monokai',
    label: 'Monokai',
    type: 'dark',
    bg: '#272822',
    fg: '#f8f8f2',
    sidebar: '#1e1f1c',
    accent: '#f92672',
    selection: '#49483e',
    ansi: ANSI_MONOKAI,
    cursor: '#f8f8f0',
  },
  {
    id: 'red',
    label: 'Red',
    type: 'dark',
    bg: '#390000',
    fg: '#f8f8f8',
    sidebar: '#330000',
    accent: '#f12727',
    selection: '#750000',
    ansi: ANSI_DARK,
    termFg: '#f8f8f8',
  },
  {
    id: 'solarized-dark',
    label: 'Solarized Dark',
    type: 'dark',
    bg: '#002b36',
    fg: '#839496',
    sidebar: '#00212b',
    accent: '#268bd2',
    selection: '#274642',
    ansi: ANSI_SOLARIZED,
    termFg: '#839496',
  },
  {
    id: 'tomorrow-night-blue',
    label: 'Tomorrow Night Blue',
    type: 'dark',
    bg: '#002451',
    fg: '#ffffff',
    sidebar: '#001c40',
    accent: '#bbdaff',
    accentFg: '#000000',
    selection: '#003f8e',
    ansi: ANSI_DARK,
  },
  // ── Light ─────────────────────────────────────────────────────────────
  {
    id: 'agent-light',
    label: 'Agent Light',
    type: 'light',
    bg: '#ffffff',
    fg: 'rgba(20, 22, 25, 0.9)',
    sidebar: '#fafafa',
    accent: 'oklch(0.55 0.18 225)',
    selection: '#add6ff',
    ansi: ANSI_LIGHT,
    termFg: '#333333',
    cursor: '#333333',
  },
  {
    id: 'light-modern',
    label: 'Light Modern',
    type: 'light',
    bg: '#ffffff',
    fg: '#3b3b3b',
    sidebar: '#f8f8f8',
    accent: '#005fb8',
    selection: '#add6ff',
    ansi: ANSI_LIGHT,
    cursor: '#3b3b3b',
  },
  {
    id: 'light-plus',
    label: 'Light (Visual Studio)',
    type: 'light',
    bg: '#ffffff',
    fg: '#000000',
    sidebar: '#f3f3f3',
    accent: '#007acc',
    selection: '#add6ff',
    ansi: ANSI_LIGHT,
    cursor: '#000000',
  },
  {
    id: 'quiet-light',
    label: 'Quiet Light',
    type: 'light',
    bg: '#f5f5f5',
    fg: '#333333',
    sidebar: '#f5f4f2',
    accent: '#705697',
    selection: '#c9d0d9',
    ansi: ANSI_LIGHT,
    cursor: '#333333',
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light',
    type: 'light',
    bg: '#fdf6e3',
    fg: '#657b83',
    sidebar: '#eee8d5',
    accent: '#268bd2',
    selection: '#dfd9c3',
    ansi: ANSI_SOLARIZED,
    termFg: '#657b83',
    cursor: '#657b83',
  },
] as const

export const THEME_MAP: Readonly<Record<string, ThemeDef>> = Object.fromEntries(
  THEME_DEFS.map((t) => [t.id, t]),
)

export const DEFAULT_DARK_ID = 'agent-dark'
export const DEFAULT_LIGHT_ID = 'agent-light'

/** The `auto` sentinel follows the OS between the two defaults. */
export const AUTO_ID = 'auto'
