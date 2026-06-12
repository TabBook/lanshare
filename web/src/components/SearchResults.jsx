import { useCallback, useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useSearchHighlight } from '../searchHighlight.js'
import MessageItem from './MessageItem.jsx'

// Search results: newest first, top-down, scroll down for older matches.
// Word-style: every occurrence of the query is highlighted in the rendered
// text, a toolbar shows 第 i / N 条, and ↑/↓ (or Enter / Shift+Enter in the
// search box) walk through the matches.
export default function SearchResults({ timeline, query, onDelete, onOpenImage, onJump }) {
  const { msgs, hasOlder, total, loading, generation, loadOlder } = timeline
  const parentRef = useRef(null)
  const desc = msgs // ascending storage; render reversed by index
  const [activeIdx, setActiveIdx] = useState(-1) // index in render (newest-first) order

  useSearchHighlight(parentRef, query)

  const virtualizer = useVirtualizer({
    count: desc.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 10,
    getItemKey: (i) => desc[desc.length - 1 - i].id,
  })

  // New query -> fresh walk position.
  useEffect(() => setActiveIdx(-1), [generation])

  const stateRef = useRef(null)
  stateRef.current = { activeIdx, count: desc.length, hasOlder, loadOlder }

  const nav = useCallback(async (dir) => {
    const { activeIdx, count, hasOlder, loadOlder } = stateRef.current
    const next = activeIdx === -1 ? 0 : activeIdx + dir
    if (next < 0 || count === 0) return
    if (next >= count) {
      // Render order is newest-first, so "next" past the end means older
      // matches; rendered indices stay stable across the prepend.
      if (!hasOlder || !(await loadOlder())) return
    }
    setActiveIdx(next)
  }, [loadOlder])

  // Enter / Shift+Enter in the sidebar search box dispatches this event.
  useEffect(() => {
    const onNav = (e) => nav(e.detail)
    addEventListener('search:nav', onNav)
    return () => removeEventListener('search:nav', onNav)
  }, [nav])

  useEffect(() => {
    if (activeIdx >= 0) virtualizer.scrollToIndex(activeIdx, { align: 'center' })
  }, [activeIdx, virtualizer])

  const totalLabel = total >= 0 ? `${total}` : `${msgs.length}${hasOlder ? '+' : ''}`

  if (!loading && msgs.length === 0) {
    return (
      <div className="rise-in flex flex-1 flex-col items-center justify-center gap-3 text-faint dark:text-faint-dark">
        <div className="float-y flex h-16 w-16 items-center justify-center rounded-2xl bg-sunken text-clay dark:bg-sunken-dark">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </div>
        <span className="text-sm">没有匹配的消息</span>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="fade-in flex items-center gap-2 border-b border-line px-4 py-1.5 text-xs text-faint dark:border-line-dark dark:text-faint-dark sm:px-6">
        <span>
          共 <span className="font-medium text-clay">{totalLabel}</span> 条结果
          {activeIdx >= 0 && <span className="ml-2">第 {activeIdx + 1} 条</span>}
        </span>
        <span className="ml-auto hidden sm:block">Enter 下一条 · Shift+Enter 上一条</span>
        <button
          onClick={() => nav(-1)}
          disabled={activeIdx <= 0}
          title="上一条（较新）"
          className="rounded-md p-1 transition hover:bg-sunken hover:text-ink active:scale-90 disabled:opacity-30 dark:hover:bg-sunken-dark dark:hover:text-ink-dark"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="m18 15-6-6-6 6" />
          </svg>
        </button>
        <button
          onClick={() => nav(1)}
          disabled={!hasOlder && activeIdx >= desc.length - 1}
          title="下一条（较旧）"
          className="rounded-md p-1 transition hover:bg-sunken hover:text-ink active:scale-90 disabled:opacity-30 dark:hover:bg-sunken-dark dark:hover:text-ink-dark"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>

      <div
        ref={parentRef}
        onScroll={() => {
          const el = parentRef.current
          if (el && hasOlder && el.scrollHeight - el.scrollTop - el.clientHeight < 600) loadOlder()
        }}
        className="flex-1 overflow-y-auto"
      >
        <div className="relative mx-auto max-w-3xl pt-2" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const msg = desc[desc.length - 1 - vi.index]
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
                  prev={null}
                  active={vi.index === activeIdx}
                  onDelete={onDelete}
                  onOpenImage={onOpenImage}
                  onJump={onJump}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
