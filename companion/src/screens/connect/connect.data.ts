import { zodResolver } from '@hookform/resolvers/zod'
import { useStore } from '@nanostores/react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { loadPairingConfig, savePairingConfig } from '@/modules/env/dev-config'
import { $session } from '@/modules/stores/$session'
import { connect } from '@/modules/wss/client'
import {
  type ConnectInputs,
  type ConnectOutputs,
  connectSchema,
} from './connect.schemas'

export function useConnectData() {
  const session = useStore($session)
  const form = useForm<ConnectInputs, unknown, ConnectOutputs>({
    resolver: zodResolver(connectSchema),
    defaultValues: { url: '', token: '' },
    mode: 'onSubmit',
  })
  const [prefilled, setPrefilled] = useState(false)

  if (!prefilled) {
    setPrefilled(true)
    loadPairingConfig()
      .then(({ url, token }) => {
        form.reset({ url: url ?? '', token: token ?? '' })
      })
      .catch((err: unknown) => {
        console.error('[connect] loadPairingConfig failed:', err)
      })
  }

  const onSubmit = form.handleSubmit(async (data) => {
    try {
      await savePairingConfig(data.url, data.token)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[connect] savePairingConfig failed:', err)
      form.setError('root', { message: `Failed to save credentials, ${msg}` })
      return
    }
    connect(data.url, data.token)
  })

  return {
    form,
    onSubmit,
    status: session.status,
    serverError: session.lastError,
  }
}
