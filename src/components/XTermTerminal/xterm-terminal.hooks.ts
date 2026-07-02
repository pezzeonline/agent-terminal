import type { FitAddon } from '@xterm/addon-fit'
import type { Terminal } from '@xterm/xterm'
import { useEffect } from 'react'
import {
  type FontFamilyOption,
  fontFamilyStack,
} from '@/modules/stores/$fontFamily'

/**
 * Applies live font-size / font-family changes to an already-mounted
 * terminal. Defers `fit()` so the canvas re-rasterizes glyphs at the new
 * metrics before recomputing cols/rows; `refresh()` runs after `fit()`
 * because the old-metric glyphs still occupy atlas slots that the visible
 * buffer's cells point at — refresh re-resolves them at the new metrics.
 *
 * Takes the live `term`/`fit` instances (not refs) so they're proper
 * effect dependencies — the caller reads them from its own refs, which
 * are already populated by the time font settings can change.
 */
export function useLiveTerminalFont(
  term: Terminal | null,
  fit: FitAddon | null,
  fontSize: number,
  fontFamily: FontFamilyOption,
): void {
  useEffect(() => {
    if (!term || !fit) return
    term.options.fontSize = fontSize
    requestAnimationFrame(() => {
      fit.fit()
      if (term.rows > 0) term.refresh(0, term.rows - 1)
    })
  }, [term, fit, fontSize])

  useEffect(() => {
    if (!term || !fit) return
    term.options.fontFamily = fontFamilyStack(fontFamily)
    requestAnimationFrame(() => {
      fit.fit()
      if (term.rows > 0) term.refresh(0, term.rows - 1)
    })
  }, [term, fit, fontFamily])
}
