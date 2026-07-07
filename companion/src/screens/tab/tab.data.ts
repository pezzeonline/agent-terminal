import { useStore } from '@nanostores/react'
import { decode } from 'js-base64'
import { useCallback, useEffect, useRef, useState } from 'react'
import { $session } from '@/modules/stores/$session'
import {
  resizeTab as resizeTabWss,
  subscribeToTab,
  unsubscribeFromTab,
  writeToTab,
} from '@/modules/wss/client'
import type { TerminalHandle } from './TerminalDom'

const SCROLLBACK = 2000

export function useTabData(tabId: string) {
  const session = useStore($session)
  const terminalRef = useRef<TerminalHandle | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!ready) return
    subscribeToTab(tabId, SCROLLBACK, {
      onSnapshot: (payload) => {
        const handle = terminalRef.current
        if (typeof handle?.clear !== 'function') return
        handle.clear()
        handle.write(payload)
      },
      onBytes: (b64) => {
        const handle = terminalRef.current
        if (typeof handle?.write !== 'function') return
        handle.write(decode(b64))
      },
    })
    return () => {
      unsubscribeFromTab(tabId)
    }
  }, [tabId, ready])

  const onReady = useCallback(async () => {
    setReady(true)
  }, [])

  const onData = useCallback(
    async (data: string) => {
      writeToTab(tabId, data)
    },
    [tabId],
  )

  const onResize = useCallback(
    async (cols: number, rows: number) => {
      resizeTabWss(tabId, cols, rows)
    },
    [tabId],
  )

  return {
    terminalRef,
    onData,
    onResize,
    onReady,
    status: session.status,
    deviceName: session.deviceName,
  }
}
