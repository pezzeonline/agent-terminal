import { $session, resetSession } from '@/modules/stores/$session'
import type { ClientFrame, ServerFrame } from '@/modules/wss/protocol.gen'

type ConnectionState = {
  socket: WebSocket | null
  url: string | null
  token: string | null
  reconnectAttempts: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
  heartbeatTimer: ReturnType<typeof setInterval> | null
  pongDeadline: number | null
  intentionallyDisconnected: boolean
}

const state: ConnectionState = {
  socket: null,
  url: null,
  token: null,
  reconnectAttempts: 0,
  reconnectTimer: null,
  heartbeatTimer: null,
  pongDeadline: null,
  intentionallyDisconnected: false,
}

const HEARTBEAT_INTERVAL_MS = 15_000
const PONG_TIMEOUT_MS = 30_000
const BACKOFF_MIN_MS = 1_000
const BACKOFF_MAX_MS = 30_000

export function connect(url: string, token: string): void {
  console.log('[wss.client] connect()', { url, tokenLen: token.length })
  clearTimers()
  state.url = url
  state.token = token
  state.intentionallyDisconnected = false
  state.reconnectAttempts = 0
  openSocket()
}

export function disconnect(): void {
  state.intentionallyDisconnected = true
  clearTimers()
  state.socket?.close()
  state.socket = null
  resetSession()
}

function send(frame: ClientFrame): void {
  if (state.socket?.readyState !== WebSocket.OPEN) return
  state.socket.send(JSON.stringify(frame))
}

export function nextBackoffDelay(attempt: number): number {
  const raw = BACKOFF_MIN_MS * 2 ** attempt
  return Math.min(raw, BACKOFF_MAX_MS)
}

function openSocket(): void {
  if (!state.url || !state.token) {
    console.warn('[wss.client] openSocket skipped, missing url or token')
    return
  }
  $session.setKey('status', 'connecting')
  console.log('[wss.client] opening WebSocket to', state.url)
  let ws: WebSocket
  try {
    ws = new WebSocket(state.url)
  } catch (err) {
    console.error('[wss.client] WebSocket constructor threw:', err)
    $session.setKey('status', 'unreachable')
    $session.setKey(
      'lastError',
      err instanceof Error ? err.message : String(err),
    )
    scheduleReconnect()
    return
  }
  state.socket = ws
  ws.onopen = () => {
    console.log('[wss.client] socket open, sending auth')
    send({ op: 'auth', body: { token: state.token ?? '' } })
  }
  ws.onmessage = (event) => handleFrame(event.data as string)
  ws.onclose = (event) => {
    console.log('[wss.client] socket closed', {
      code: event.code,
      reason: event.reason,
    })
    clearTimers()
    state.socket = null
    if (state.intentionallyDisconnected) return
    if ($session.get().status !== 'auth_failed') {
      $session.setKey('status', 'unreachable')
      if (event.reason) $session.setKey('lastError', event.reason)
    }
    scheduleReconnect()
  }
  ws.onerror = (event) => {
    console.error('[wss.client] socket error event', event)
    // onerror is always followed by onclose in browsers and RN. Let
    // the close handler drive the reconnect + state transition so we
    // avoid double-scheduling.
  }
}

function handleFrame(raw: string): void {
  let frame: ServerFrame
  try {
    frame = JSON.parse(raw) as ServerFrame
  } catch (err) {
    console.error('[wss.client] failed to parse frame:', err, 'raw:', raw)
    return
  }
  console.log('[wss.client] frame', frame.op)
  switch (frame.op) {
    case 'auth_ok':
      state.reconnectAttempts = 0
      $session.set({
        status: 'connected',
        deviceName: frame.body.device_name,
        projects: $session.get().projects,
        lastError: null,
        lastConnectedAt: Date.now(),
      })
      startHeartbeat()
      break
    case 'auth_fail':
      console.warn('[wss.client] auth failed:', frame.body.reason)
      $session.setKey('status', 'auth_failed')
      $session.setKey('lastError', frame.body.reason)
      state.intentionallyDisconnected = true
      state.socket?.close()
      break
    case 'projects':
      $session.setKey('projects', frame.body.data)
      break
    case 'pong':
      state.pongDeadline = null
      break
    default:
      // snapshot / bytes / resized / tab_state land in sub-step 6
      // once the terminal renderer subscribes to a tab.
      break
  }
}

function scheduleReconnect(): void {
  const delay = nextBackoffDelay(state.reconnectAttempts)
  state.reconnectAttempts += 1
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null
    openSocket()
  }, delay)
}

function startHeartbeat(): void {
  clearTimers()
  state.heartbeatTimer = setInterval(() => {
    if (state.socket?.readyState !== WebSocket.OPEN) return
    send({ op: 'ping' })
    if (state.pongDeadline === null) {
      state.pongDeadline = Date.now() + PONG_TIMEOUT_MS
    } else if (Date.now() > state.pongDeadline) {
      state.socket?.close()
    }
  }, HEARTBEAT_INTERVAL_MS)
}

function clearTimers(): void {
  if (state.reconnectTimer) clearTimeout(state.reconnectTimer)
  if (state.heartbeatTimer) clearInterval(state.heartbeatTimer)
  state.reconnectTimer = null
  state.heartbeatTimer = null
  state.pongDeadline = null
}
