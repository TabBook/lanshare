import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import MessageItem from './MessageItem.jsx'

// Virtualized chat timeline. Oldest at top, newest at bottom, input below.
// - near top -> load older, scrollTop corrected so the view doesn't jump
// - near bottom in anchor mode -> load newer
// - stick to bottom while the user is at the live edge
export default function Timeline({ timeline, onDelete, onOpenImage, onJump }) {
  const { msgs, hasOlder, hasNewer, anchorId, loading, generation, loadOlder, loadNewer } = timeline
  const parentRef = useRef(null)
  const stickBottomRef = useRef(true)
  const prependRef = useRef(null) // { prevTotal, prevScrollTop } during an older-load
  const didInitialScroll = useRef(0)

  const virtualizer = useVirtualizer({
    count: msgs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 10,
    getItemKey: (i) => msgs[i].id,
  })
  const totalSize = virtualizer.getTotalSize()

  // Initial position: bottom for live mode, anchor message centered for
  // anchor mode. Re-run on every full reload (generation bump).
  useLayoutEffect(() => {
    if (loading || msgs.length === 0) return
    if (didInitialScroll.current === generation) return
    didInitialScroll.current = generation
    if (anchorId) {
      let idx = msgs.findIndex((m) => m.id >= anchorId)
      if (idx === -1) idx = msgs.length - 1
      stickBottomRef.current = false
      virtualizer.scrollToIndex(idx, { align: 'center' })
    } else {
      stickBottomRef.current = true
      virtualizer.scrollToIndex(msgs.length - 1, { align: 'end' })
    }
  }, [loading, generation, msgs, anchorId, virtualizer])

  // Keep pinned to bottom as items measure/arrive while at the live edge.
  useLayoutEffect(() => {
    const el = parentRef.current
    if (!el) return
    if (prependRef.current) {
      // Older messages were prepended: keep the viewport where it was.
      const { prevTotal, prevScrollTop } = prependRef.current
      prependRef.current = null
      el.scrollTop = prevScrollTop + (totalSize - prevTotal)
    } else if (stickBottomRef.current && !hasNewer) {
      el.scrollTop = el.scrollHeight
    }
  }, [totalSize, msgs.length, hasNewer])

  const onScroll = useCallback(() => {
    const el = parentRef.current
    if (!el) return
    stickBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (el.scrollTop < 600 && hasOlder && !loading && !prependRef.current && msgs.length > 0) {
      prependRef.current = { prevTotal: virtualizer.getTotalSize(), prevScrollTop: el.scrollTop }
      loadOlder().then((added) => {
        if (!added) prependRef.current = null
      })
    }
    if (hasNewer && el.scrollHeight - el.scrollTop - el.clientHeight < 600) {
      loadNewer()
    }
  }, [hasOlder, hasNewer, loading, msgs.length, loadOlder, loadNewer, virtualizer])

  // Re-check after data settles (a short page may not fill the viewport).
  useEffect(() => {
    const id = requestAnimationFrame(onScroll)
    return () => cancelAnimationFrame(id)
  }, [msgs.length, onScroll])

  if (!loading && msgs.length === 0) {
    return (
      <div className="rise-in flex flex-1 flex-col items-center justify-center gap-3 text-faint dark:text-faint-dark">
        <div className="float-y flex h-16 w-16 items-center justify-center rounded-2xl bg-sunken text-clay dark:bg-sunken-dark">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </div>
        <span className="text-sm">还没有消息，发一条试试</span>
      </div>
    )
  }

  return (
    <div ref={parentRef} onScroll={onScroll} className="flex-1 overflow-y-auto overscroll-contain">
      <div className="relative mx-auto max-w-3xl" style={{ height: totalSize }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const msg = msgs[vi.index]
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${vi.start}px)` }}
            >
              <MessageItem
                msg={msg}
                prev={vi.index > 0 ? msgs[vi.index - 1] : null}
                highlight={msg.id === anchorId}
                onDelete={onDelete}
                onOpenImage={onOpenImage}
                onJump={onJump}
              />
            </div>
          )
        })}
      </div>
      <div className="h-4" />
    </div>
  )
}
