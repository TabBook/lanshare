// Timeline data engine: keyset pagination in both directions, anchor windows,
// websocket live-append with dedup. Messages are kept ascending (oldest
// first); ULIDs make string comparison == time comparison.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api.js'
import { connectWS } from './ws.js'

const PAGE = 50

function mergeAsc(existing, incoming) {
  const seen = new Set(existing.map((m) => m.id))
  const fresh = incoming.filter((m) => !seen.has(m.id))
  if (fresh.length === 0) return existing
  return [...existing, ...fresh].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export function useTimeline({ type = '', q = '', anchor = '' }) {
  const [msgs, setMsgs] = useState([])
  const [hasOlder, setHasOlder] = useState(false)
  const [hasNewer, setHasNewer] = useState(false) // anchor mode only
  const [anchorId, setAnchorId] = useState('')
  const [total, setTotal] = useState(-1) // search match count; -1 = unknown
  const [loading, setLoading] = useState(true)
  const [generation, setGeneration] = useState(0) // bumps on full reload
  const busyRef = useRef({ older: false, newer: false })
  const stateRef = useRef({ msgs, hasNewer, type, q })
  stateRef.current = { msgs, hasNewer, type, q }

  const baseParams = useCallback(() => {
    const p = {}
    if (type) p.type = type
    if (q) p.q = q
    return p
  }, [type, q])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      if (anchor) {
        const r = await api.listMessages({ ...baseParams(), anchor })
        setMsgs(r.messages)
        setAnchorId(r.anchor_id)
        setHasOlder(true)
        setHasNewer(true)
      } else {
        const r = await api.listMessages({ ...baseParams(), limit: PAGE })
        setMsgs(r.messages.slice().reverse()) // server gives newest-first
        setAnchorId('')
        setTotal(typeof r.total === 'number' ? r.total : -1)
        setHasOlder(r.messages.length >= PAGE)
        setHasNewer(false)
      }
      setGeneration((g) => g + 1)
    } finally {
      setLoading(false)
    }
  }, [anchor, baseParams])

  useEffect(() => {
    reload()
  }, [reload])

  // Returns the number of prepended messages so the view can fix scrollTop.
  const loadOlder = useCallback(async () => {
    const { msgs } = stateRef.current
    if (busyRef.current.older || msgs.length === 0) return 0
    busyRef.current.older = true
    try {
      const r = await api.listMessages({ ...baseParams(), before: msgs[0].id, limit: PAGE })
      if (r.messages.length < PAGE) setHasOlder(false)
      if (r.messages.length === 0) return 0
      let added = 0
      setMsgs((cur) => {
        const merged = mergeAsc(cur, r.messages)
        added = merged.length - cur.length
        return merged
      })
      return added
    } finally {
      busyRef.current.older = false
    }
  }, [baseParams])

  const loadNewer = useCallback(async () => {
    const { msgs, hasNewer } = stateRef.current
    if (busyRef.current.newer || !hasNewer || msgs.length === 0) return
    busyRef.current.newer = true
    try {
      const r = await api.listMessages({
        ...baseParams(),
        after: msgs[msgs.length - 1].id,
        limit: PAGE,
      })
      if (r.messages.length < PAGE) setHasNewer(false) // reached the live edge
      if (r.messages.length > 0) setMsgs((cur) => mergeAsc(cur, r.messages))
    } finally {
      busyRef.current.newer = false
    }
  }, [baseParams])

  const append = useCallback((m) => {
    setMsgs((cur) => (cur.some((x) => x.id === m.id) ? cur : mergeAsc(cur, [m])))
  }, [])

  const remove = useCallback((id) => {
    setMsgs((cur) => {
      if (!cur.some((m) => m.id === id)) return cur
      if (stateRef.current.q) setTotal((t) => (t > 0 ? t - 1 : t))
      return cur.filter((m) => m.id !== id)
    })
  }, [])

  const matchesView = useCallback((m) => {
    const { type, q } = stateRef.current
    if (q) return false // search results are a snapshot
    if (!type) return true
    if (type === 'image') return m.type === 'image' || m.type === 'video'
    return m.type === type
  }, [])

  // Live events. Only append when we actually hold the newest edge; otherwise
  // pagination will pick the message up later.
  useEffect(() => {
    const close = connectWS({
      onEvent: (ev) => {
        if (ev.event === 'new_message' && !stateRef.current.hasNewer && matchesView(ev.message)) {
          append(ev.message)
        } else if (ev.event === 'message_deleted') {
          remove(ev.id)
        }
      },
      onReconnect: () => {
        // Catch up on anything missed while offline.
        if (!stateRef.current.hasNewer) loadNewer0()
      },
    })
    // catch-up loader that ignores the hasNewer gate
    async function loadNewer0() {
      const { msgs, type, q } = stateRef.current
      if (msgs.length === 0 || q) return
      const p = { after: msgs[msgs.length - 1].id, limit: PAGE }
      if (type) p.type = type
      const r = await api.listMessages(p).catch(() => null)
      if (r?.messages?.length) setMsgs((cur) => mergeAsc(cur, r.messages))
    }
    return close
  }, [append, remove, matchesView])

  return {
    msgs, hasOlder, hasNewer, anchorId, total, loading, generation,
    loadOlder, loadNewer, append, remove,
  }
}
