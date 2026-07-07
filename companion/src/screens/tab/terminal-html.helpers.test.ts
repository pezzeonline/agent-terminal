import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_TERMINAL_HTML_CONFIG,
  buildTerminalHtml,
} from './terminal-html.helpers'

describe('buildTerminalHtml', () => {
  const html = buildTerminalHtml(DEFAULT_TERMINAL_HTML_CONFIG)

  test('references pinned unpkg URLs for xterm + addons', () => {
    expect(html).toContain('https://unpkg.com/@xterm/xterm@6.0.0/css/xterm.css')
    expect(html).toContain('https://unpkg.com/@xterm/xterm@6.0.0/lib/xterm.js')
    expect(html).toContain(
      'https://unpkg.com/@xterm/addon-fit@0.11.0/lib/addon-fit.js',
    )
    expect(html).toContain(
      'https://unpkg.com/@xterm/addon-web-links@0.12.0/lib/addon-web-links.js',
    )
  })

  test('embeds initial cols and rows from config', () => {
    expect(html).toContain('cols: 80')
    expect(html).toContain('rows: 24')
  })

  test('installs the RN bridge as window.__terminal_bridge with write/clear/fit', () => {
    expect(html).toContain('window.__terminal_bridge')
    expect(html).toContain('write: function')
    expect(html).toContain('clear: function')
    expect(html).toContain('fit: function')
  })

  test('posts ready/data/resize message types to RN', () => {
    expect(html).toContain("type: 'ready'")
    expect(html).toContain("type: 'data'")
    expect(html).toContain("type: 'resize'")
  })

  test('sets viewport meta for mobile scaling', () => {
    expect(html).toContain('name="viewport"')
    expect(html).toContain('initial-scale=1')
  })

  test('quotes theme values through JSON.stringify (no raw templating)', () => {
    const evil = buildTerminalHtml({
      ...DEFAULT_TERMINAL_HTML_CONFIG,
      themeBackground: 'red"; window.pwned = true; //',
    })
    // JSON.stringify keeps the string escaped; the payload appears only
    // as a quoted string literal, never as bare JS.
    expect(evil).toContain('"red\\"; window.pwned = true; //"')
  })
})
