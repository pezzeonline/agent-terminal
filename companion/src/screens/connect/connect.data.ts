import { useStore } from '@nanostores/react'
import { useState } from 'react'
import { loadPairingConfig, savePairingConfig } from '@/modules/env/dev-config'
import { $session } from '@/modules/stores/$session'
import { connect } from '@/modules/wss/client'
import { validateInputs } from './connect.helpers'

export function useConnectData() {
  const session = useStore($session)
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [prefilled, setPrefilled] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  if (!prefilled) {
    setPrefilled(true)
    loadPairingConfig()
      .then(({ url: u, token: t }) => {
        if (u) setUrl(u)
        if (t) setToken(t)
      })
      .catch((err: unknown) => {
        console.error('[connect] loadPairingConfig failed:', err)
      })
  }

  async function submit(): Promise<void> {
    setValidationError(null)
    const validated = validateInputs(url, token)
    if (validated.kind === 'error') {
      setValidationError(validated.message)
      return
    }
    try {
      await savePairingConfig(validated.url, validated.token)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[connect] savePairingConfig failed:', err)
      setValidationError(`Failed to save credentials: ${msg}`)
      return
    }
    connect(validated.url, validated.token)
  }

  return {
    url,
    token,
    setUrl,
    setToken,
    submit,
    status: session.status,
    error: session.lastError,
    validationError,
  }
}
