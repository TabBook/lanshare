import { useCallback, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { thumbURL } from '../api.js'
import { monthLabel } from '../format.js'

const COLS = 4

// Photo-album view for the image filter: thumbnails in a virtualized grid,
// newest first, grouped by month like a system gallery.
export default function ImageGrid({ timeline, onOpenImage }) {
  const { msgs, hasOlder, loading, loadOlder } = timeline
  const parentRef = useRef(null)

  // Build virtual rows: month headers + rows of COLS thumbs, newest first.
  const rows = useMemo(() => {
    const desc = [...msgs].reverse()
    const out = []
    let curMonth = ''
    let curRow = null
    for (const m of desc) {
      const label = monthLabel(m.created_at)
      if (label !== curMonth) {
        curMonth = label
        out.push({ kind: 'header', label, key: `h-${label}` })
        curRow = null
      }
      if (!curRow || curRow.items.length === COLS) {
        curRow = { kind: 'row', items: [], key: `r-${m.id}` }
        out.push(curRow)
      }
      curRow.items.push(m)
    }
    return out
  }, [msgs])

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rows[i].kind === 'header' ? 44 : 120),
    overscan: 6,
    getItemKey: (i) => rows[i].key,
  })

  const onScroll = useCallback(() => {
    const el = parentRef.current
    if (!el) return
    if (hasOlder && el.scrollHeight - el.scrollTop - el.clientHeight < 800) loadOlder()
  }, [hasOlder, loadOlder])

  if (!loading && msgs.length === 0) {
    return (
      <div className="rise-in flex flex-1 flex-col items-center justify-center gap-3 text-faint dark:text-faint-dark">
        <div className="float-y flex h-16 w-16 items-center justify-center rounded-2xl bg-sunken text-clay dark:bg-sunken-dark">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
          </svg>
        </div>
        <span className="text-sm">还没有图片</span>
      </div>
    )
  }

  return (
    <div ref={parentRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
      <div
        className="relative mx-auto max-w-3xl"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index]
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full px-4 sm:px-6"
              style={{ transform: `translateY(${vi.start}px)` }}
            >
              {row.kind === 'header' ? (
                <div className="pb-2 pt-5 text-sm font-semibold">{row.label}</div>
              ) : (
                <div className="grid grid-cols-4 gap-1.5 pb-1.5">
                  {row.items.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => onOpenImage(m)}
                      className="group/thumb relative aspect-square overflow-hidden rounded-lg bg-sunken transition-shadow duration-200 hover:z-10 hover:shadow-lg dark:bg-sunken-dark dark:hover:shadow-black/40"
                    >
                      {m.type === 'video' ? (
                        <span className="absolute inset-0 flex items-center justify-center">
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white transition-transform duration-200 group-hover/thumb:scale-110">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </span>
                        </span>
                      ) : (
                        <img
                          src={thumbURL(m.file_id)}
                          alt={m.file_name}
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover/thumb:scale-110"
                        />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
