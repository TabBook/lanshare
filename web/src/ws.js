// Server-push websocket with silent exponential-backoff reconnect. Never
// surfaces errors to the UI; a reconnect triggers `onReconnect` so the
// timeline can refetch anything it missed.
import { getAuth } from './api.js'

export function connectWS({ onEvent, onReconnect }) {
  let ws = null
  let attempts = 0
  let closed = false
  let everConnected = false
  let timer = null

  function open() {
    if (closed) return
    const { token } = getAuth()
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/api/ws?token=${encodeURIComponent(token)}`)
    ws.onopen = () => {
      attempts = 0
      if (everConnected) onReconnect?.()
      everConnected = true
    }
    ws.onmessage = (e) => {
      try {
        onEvent(JSON.parse(e.data))
      } catch { /* ignore malformed */ }
    }
    ws.onclose = () => {
      if (closed) return
      const delay = Math.min(30_000, 1000 * 2 ** attempts++)
      timer = setTimeout(open, delay)
    }
    ws.onerror = () => ws.close()
  }

  open()
  return () => {
    closed = true
    clearTimeout(timer)
    ws?.close()
  }
}
