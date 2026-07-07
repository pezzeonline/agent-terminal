'use dom'

import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { DOMImperativeFactory, DOMProps } from 'expo/dom'
import { useDOMImperativeHandle } from 'expo/dom'
import { type Ref, useEffect, useRef } from 'react'

type Args = Parameters<DOMImperativeFactory[string]>

export interface TerminalHandle extends DOMImperativeFactory {
  write: (...args: Args) => void
  clear: (...args: Args) => void
  fit: (...args: Args) => void
}

interface TerminalDomProps {
  onData: (data: string) => Promise<void>
  onResize: (cols: number, rows: number) => Promise<void>
  onReady: () => Promise<void>
  ref: Ref<TerminalHandle>
  dom?: DOMProps
}

export default function TerminalDom({
  onData,
  onResize,
  onReady,
  ref,
}: TerminalDomProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useDOMImperativeHandle(ref, () => ({
    write: (...args: Args) => {
      const data = args[0]
      if (typeof data === 'string') termRef.current?.write(data)
    },
    clear: () => {
      termRef.current?.clear()
    },
    fit: () => {
      fitRef.current?.fit()
    },
  }))

  useEffect(() => {
    if (!containerRef.current) return
    const term = new Terminal({
      cols: 80,
      rows: 24,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 12,
      cursorBlink: true,
      scrollback: 2000,
      theme: {
        background: '#0e0f10',
        foreground: '#e6e8eb',
        cursor: '#e6e8eb',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(containerRef.current)
    fit.fit()
    termRef.current = term
    fitRef.current = fit

    const dataDisposable = term.onData((data) => {
      void onData(data)
    })
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      void onResize(cols, rows)
    })

    const observer = new ResizeObserver(() => fit.fit())
    observer.observe(containerRef.current)

    void onReady()

    return () => {
      observer.disconnect()
      dataDisposable.dispose()
      resizeDisposable.dispose()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [onData, onResize, onReady])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100vw',
        height: '100vh',
        background: '#0e0f10',
      }}
    />
  )
}
