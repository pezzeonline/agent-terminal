// VS Code's default integrated-terminal ANSI palettes (MIT), plus the two
// base16 palettes (Monokai, Solarized) that VS Code themes override with.
// Split out of `colorThemes.ts` so that file stays under the line-length cap.

/** ANSI palette: black,red,green,yellow,blue,magenta,cyan,white + 8 brights. */
export type Ansi16 = readonly [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
]

export const ANSI_DARK: Ansi16 = [
  '#000000',
  '#cd3131',
  '#0dbc79',
  '#e5e510',
  '#2472c8',
  '#bc3fbc',
  '#11a8cd',
  '#e5e5e5',
  '#666666',
  '#f14c4c',
  '#23d18b',
  '#f5f543',
  '#3b8eea',
  '#d670d6',
  '#29b8db',
  '#e5e5e5',
]

export const ANSI_LIGHT: Ansi16 = [
  '#000000',
  '#cd3131',
  '#00bc00',
  '#949800',
  '#0451a5',
  '#bc05bc',
  '#0598bc',
  '#555555',
  '#666666',
  '#cd3131',
  '#14ce14',
  '#b5ba00',
  '#0451a5',
  '#bc05bc',
  '#0598bc',
  '#a5a5a5',
]

export const ANSI_MONOKAI: Ansi16 = [
  '#333333',
  '#f92672',
  '#a6e22e',
  '#f4bf75',
  '#66d9ef',
  '#ae81ff',
  '#a1efe4',
  '#f8f8f2',
  '#75715e',
  '#f92672',
  '#a6e22e',
  '#f4bf75',
  '#66d9ef',
  '#ae81ff',
  '#a1efe4',
  '#f9f8f5',
]

export const ANSI_SOLARIZED: Ansi16 = [
  '#073642',
  '#dc322f',
  '#859900',
  '#b58900',
  '#268bd2',
  '#d33682',
  '#2aa198',
  '#eee8d5',
  '#002b36',
  '#cb4b16',
  '#586e75',
  '#657b83',
  '#839496',
  '#6c71c4',
  '#93a1a1',
  '#fdf6e3',
]
