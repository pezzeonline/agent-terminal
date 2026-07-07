import { useStore } from '@nanostores/react'
import { decode } from 'js-base64'
import { useEffect, useRef } from 'react'
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

  useEffect(() => {
    subscribeToTab(tabId, SCROLLBACK, {
      onSnapshot: (payload) => {
        terminalRef.current?.clear()
        terminalRef.current?.write(payload)
      },
      onBytes: (b64) => {
        terminalRef.current?.write(decode(b64))
      },
    })
    return () => {
      unsubscribeFromTab(tabId)
    }
  }, [tabId])

  const onData = async (data: string) => {
    writeToTab(tabId, data)
  }

  const onResize = async (cols: number, rows: number) => {
    resizeTabWss(tabId, cols, rows)
  }

  return {
    terminalRef,
    onData,
    onResize,
    status: session.status,
    deviceName: session.deviceName,
  }
}
