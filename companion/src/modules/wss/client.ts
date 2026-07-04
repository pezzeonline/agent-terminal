import { $session, resetSession } from '@/modules/stores/$session'
import type { ClientFrame, ServerFrame } from '@/modules/wss/protocol.gen'
import { computeBackoffDelay } from './client.helpers'

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

function openSocket(): void {
  if (!state.url || !state.token) {
    console.warn('[wss.client] openSocket skipped, missing url or token')
    return
  }
  $session.setKey('status', 'connecting')
  console.log('[wss.client] opening WebSocket to', state.url)
  const ws = tryConstructSocket(state.url)
  if (!ws) return
  state.socket = ws
  ws.onopen = handleOpen
  ws.onmessage = (event) => handleFrame(event.data as string)
  ws.onclose = handleClose
  ws.onerror = (event) => {
    console.error('[wss.client] socket error event', event)
  }
}

function tryConstructSocket(url: string): WebSocket | null {
  try {
    return new WebSocket(url)
  } catch (err) {
    console.error('[wss.client] WebSocket constructor threw:', err)
    $session.setKey('status', 'unreachable')
    $session.setKey(
      'lastError',
      err instanceof Error ? err.message : String(err),
    )
    scheduleReconnect()
    return null
  }
}

function handleOpen(): void {
  console.log('[wss.client] socket open, sending auth')
  send({ op: 'auth', body: { token: state.token ?? '' } })
}

function handleClose(event: CloseEvent): void {
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

function handleFrame(raw: string): void {
  let frame: ServerFrame
  try {
    frame = JSON.parse(raw) as ServerFrame
  } catch (err) {
    console.error('[wss.client] failed to parse frame:', err, 'raw:', raw)
    return
  }
  console.log('[wss.client] frame', frame.op)
  dispatchFrame(frame)
}

// fallow-ignore-next-line complexity
function dispatchFrame(frame: ServerFrame): void {
  if (frame.op === 'auth_ok') {
    handleAuthOk(frame.body.device_name)
    return
  }
  if (frame.op === 'auth_fail') {
    handleAuthFail(frame.body.reason)
    return
  }
  if (frame.op === 'projects') {
    $session.setKey('projects', frame.body.data)
    return
  }
  if (frame.op === 'pong') {
    state.pongDeadline = null
  }
}

function handleAuthOk(deviceName: string): void {
  state.reconnectAttempts = 0
  $session.set({
    status: 'connected',
    deviceName,
    projects: $session.get().projects,
    lastError: null,
    lastConnectedAt: Date.now(),
  })
  startHeartbeat()
}

function handleAuthFail(reason: string): void {
  console.warn('[wss.client] auth failed:', reason)
  $session.setKey('status', 'auth_failed')
  $session.setKey('lastError', reason)
  state.intentionallyDisconnected = true
  state.socket?.close()
}

function scheduleReconnect(): void {
  const delay = computeBackoffDelay(state.reconnectAttempts)
  state.reconnectAttempts += 1
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null
    openSocket()
  }, delay)
}

function startHeartbeat(): void {
  clearTimers()
  state.heartbeatTimer = setInterval(heartbeatTick, HEARTBEAT_INTERVAL_MS)
}

function heartbeatTick(): void {
  if (state.socket?.readyState !== WebSocket.OPEN) return
  send({ op: 'ping' })
  updatePongDeadline()
}

function updatePongDeadline(): void {
  if (state.pongDeadline === null) {
    state.pongDeadline = Date.now() + PONG_TIMEOUT_MS
    return
  }
  if (Date.now() > state.pongDeadline) {
    state.socket?.close()
  }
}

function clearTimers(): void {
  if (state.reconnectTimer) clearTimeout(state.reconnectTimer)
  if (state.heartbeatTimer) clearInterval(state.heartbeatTimer)
  state.reconnectTimer = null
  state.heartbeatTimer = null
  state.pongDeadline = null
}
