import { useCallback, useEffect, useState } from 'react'
import { api, clearAuth, getAuth, setUnauthorizedHandler } from './api.js'
import { useTimeline } from './useTimeline.js'
import { enqueueUploads } from './upload.js'
import Composer from './components/Composer.jsx'
import Confirm from './components/Confirm.jsx'
import ImageGrid from './components/ImageGrid.jsx'
import Lightbox from './components/Lightbox.jsx'
import Onboarding from './components/Onboarding.jsx'
import SearchResults from './components/SearchResults.jsx'
import Sidebar from './components/Sidebar.jsx'
import Timeline from './components/Timeline.jsx'
import UploadProgress from './components/UploadProgress.jsx'

// Animated mobile drawer: stays mounted through the exit transition so the
// slide-out and backdrop fade actually play.
function Drawer({ open, onClose, children }) {
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (open) {
      setMounted(true)
      // two frames so the closed state paints before transitioning
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)))
      return () => cancelAnimationFrame(id)
    }
    setShown(false)
    const t = setTimeout(() => setMounted(false), 240)
    return () => clearTimeout(t)
  }, [open])
  if (!mounted) return null
  return (
    <div className="fixed inset-0 z-40 md:hidden">
      <div
        className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ${
          shown ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={onClose}
      />
      <div
        className={`absolute bottom-0 left-0 top-0 shadow-xl transition-transform duration-200 ease-out ${
          shown ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {children}
      </div>
    </div>
  )
}

function viewTitle(view) {
  if (view.q) return `搜索：${view.q}`
  if (view.anchor) return '历史定位'
  return { '': '时间线', file: '仅文件', image: '图片', text: '仅文本' }[view.type] || '时间线'
}

function Main({ onLogout }) {
  const [view, setView] = useState({ type: '', q: '', anchor: '' })
  const timeline = useTimeline(view)
  const [lightbox, setLightbox] = useState(null) // { list, index }
  const [pendingDelete, setPendingDelete] = useState(null)
  const [drawer, setDrawer] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [sideOpen, setSideOpen] = useState(() => localStorage.getItem('sidebar') !== '0')

  function toggleSide() {
    setSideOpen((v) => {
      localStorage.setItem('sidebar', v ? '0' : '1')
      return !v
    })
  }

  const onFiles = useCallback(
    (files) => {
      if (files.length > 0) enqueueUploads(files, { onMessage: timeline.append })
    },
    [timeline.append],
  )

  const onSend = useCallback(
    async (text) => {
      const m = await api.sendText(text).catch(() => null)
      if (m) timeline.append(m)
    },
    [timeline.append],
  )

  const onOpenImage = useCallback(
    (msg) => {
      const list = timeline.msgs.filter((m) => m.type === 'image' || m.type === 'video')
      setLightbox({ list, index: list.findIndex((m) => m.id === msg.id) })
    },
    [timeline.msgs],
  )

  const onJump = useCallback((id) => {
    setDrawer(false)
    setView({ type: '', q: '', anchor: id })
  }, [])

  // Full-page drag & drop -> same upload pipeline.
  useEffect(() => {
    let depth = 0
    const enter = (e) => {
      e.preventDefault()
      if (e.dataTransfer?.types?.includes('Files') && ++depth === 1) setDragging(true)
    }
    const leave = (e) => {
      e.preventDefault()
      if (--depth <= 0) { depth = 0; setDragging(false) }
    }
    const over = (e) => e.preventDefault()
    const drop = (e) => {
      e.preventDefault()
      depth = 0
      setDragging(false)
      onFiles([...e.dataTransfer.files])
    }
    addEventListener('dragenter', enter)
    addEventListener('dragleave', leave)
    addEventListener('dragover', over)
    addEventListener('drop', drop)
    return () => {
      removeEventListener('dragenter', enter)
      removeEventListener('dragleave', leave)
      removeEventListener('dragover', over)
      removeEventListener('drop', drop)
    }
  }, [onFiles])

  // Left-edge swipe opens the drawer on mobile.
  useEffect(() => {
    let startX = -1
    const ts = (e) => { startX = e.touches[0].clientX <= 24 ? e.touches[0].clientX : -1 }
    const tm = (e) => {
      if (startX >= 0 && e.touches[0].clientX - startX > 50) {
        setDrawer(true)
        startX = -1
      }
    }
    addEventListener('touchstart', ts, { passive: true })
    addEventListener('touchmove', tm, { passive: true })
    return () => {
      removeEventListener('touchstart', ts)
      removeEventListener('touchmove', tm)
    }
  }, [])

  const isGrid = view.type === 'image' && !view.q
  const isSearch = !!view.q

  return (
    <div className="flex h-full">
      {/* Collapsible on desktop: the wrapper animates width and clips the
          fixed-width sidebar so content doesn't reflow mid-transition. */}
      <aside
        className={`hidden shrink-0 overflow-hidden transition-[width] duration-300 ease-out md:block ${
          sideOpen ? 'w-72' : 'w-0'
        }`}
      >
        <Sidebar view={view} setView={setView} refreshKey={timeline.msgs.length} />
      </aside>

      <Drawer open={drawer} onClose={() => setDrawer(false)}>
        <Sidebar
          view={view}
          setView={setView}
          refreshKey={timeline.msgs.length}
          onClose={() => setDrawer(false)}
          onNavigate={() => setDrawer(false)}
        />
      </Drawer>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line px-4 py-2.5 dark:border-line-dark sm:px-6">
          <button onClick={() => setDrawer(true)} className="-ml-1 p-1 text-faint transition active:scale-90 dark:text-faint-dark md:hidden" title="菜单">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M3 6h18M3 12h18M3 18h18" />
            </svg>
          </button>
          <button
            onClick={toggleSide}
            title={sideOpen ? '收起侧边栏' : '展开侧边栏'}
            className="-ml-1 hidden rounded-lg p-1.5 text-faint transition-all hover:bg-sunken hover:text-ink active:scale-90 dark:text-faint-dark dark:hover:bg-sunken-dark dark:hover:text-ink-dark md:block"
          >
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16" />
            </svg>
          </button>
          <h2 key={viewTitle(view)} className="fade-in text-sm font-medium">{viewTitle(view)}</h2>
          {(view.anchor || view.q || view.type) && (
            <button
              onClick={() => setView({ type: '', q: '', anchor: '' })}
              className="pop-in rounded-lg bg-sunken px-2 py-1 text-xs text-faint transition hover:text-ink active:scale-95 dark:bg-sunken-dark dark:text-faint-dark dark:hover:text-ink-dark"
            >
              回到最新
            </button>
          )}
          <button
            onClick={onLogout}
            className="ml-auto text-xs text-faint transition hover:text-clay-deep dark:text-faint-dark"
            title="退出并重新配置"
          >
            退出
          </button>
        </header>

        {isGrid ? (
          <ImageGrid timeline={timeline} onOpenImage={onOpenImage} />
        ) : isSearch ? (
          <SearchResults
            timeline={timeline}
            query={view.q}
            onDelete={setPendingDelete}
            onOpenImage={onOpenImage}
            onJump={onJump}
          />
        ) : (
          <Timeline
            timeline={timeline}
            onDelete={setPendingDelete}
            onOpenImage={onOpenImage}
            onJump={view.anchor ? null : undefined}
          />
        )}

        <UploadProgress />
        <Composer onSend={onSend} onFiles={onFiles} />
      </main>

      {dragging && (
        <div className="fade-in pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-clay/10 backdrop-blur-sm">
          <div className="pop-in drop-pulse flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-clay bg-paper px-12 py-10 text-clay dark:bg-paper-dark">
            <svg className="animate-bounce" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="m17 8-5-5-5 5" />
              <path d="M12 3v12" />
            </svg>
            <span className="font-medium">松开以上传文件</span>
          </div>
        </div>
      )}

      {lightbox && (
        <Lightbox
          list={lightbox.list}
          index={lightbox.index}
          onNav={(i) => setLightbox((lb) => ({ ...lb, index: i }))}
          onClose={() => setLightbox(null)}
        />
      )}

      {pendingDelete && (
        <Confirm
          title="删除这条消息？"
          detail={
            pendingDelete.type === 'text'
              ? undefined
              : `「${pendingDelete.file_name}」的文件本体也会一并删除。`
          }
          onConfirm={async () => {
            const id = pendingDelete.id
            setPendingDelete(null)
            await api.deleteMessage(id).catch(() => {})
            timeline.remove(id)
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}

export default function App() {
  const [authed, setAuthed] = useState(() => {
    const { token, deviceId } = getAuth()
    return !!(token && deviceId)
  })

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearAuth()
      setAuthed(false)
    })
  }, [])

  if (!authed) return <Onboarding onDone={() => setAuthed(true)} />
  return (
    <Main
      onLogout={() => {
        clearAuth()
        setAuthed(false)
      }}
    />
  )
}
