import { useStore } from '@nanostores/react'
import { useState } from 'react'
import { loadPairingConfig, savePairingConfig } from '@/modules/env/dev-config'
import { $session } from '@/modules/stores/$session'
import { connect } from '@/modules/wss/client'
import { normaliseWssUrl } from './connect.helpers'

export function useConnectData() {
  const session = useStore($session)
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [prefilled, setPrefilled] = useState(false)

  if (!prefilled) {
    setPrefilled(true)
    void loadPairingConfig().then(({ url: u, token: t }) => {
      if (u) setUrl(u)
      if (t) setToken(t)
    })
  }

  async function submit(): Promise<void> {
    const normalised = normaliseWssUrl(url)
    if (!normalised || !token.trim()) return
    await savePairingConfig(normalised, token.trim())
    connect(normalised, token.trim())
  }

  return {
    url,
    token,
    setUrl,
    setToken,
    submit,
    status: session.status,
    error: session.lastError,
  }
}
