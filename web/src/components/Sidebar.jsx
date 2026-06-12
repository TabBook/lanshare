import { useEffect, useRef, useState } from 'react'
import { api, getAuth } from '../api.js'
import { formatSize } from '../format.js'
import { currentTheme, toggleTheme } from '../theme.js'

const FILTERS = [
  { key: '', label: '全部' },
  { key: 'file', label: '仅文件' },
  { key: 'image', label: '仅图片' },
  { key: 'text', label: '仅文本' },
]

function DeviceRow({ d, self, onRename, onRemove }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(d.name)
  function commit() {
    setEditing(false)
    const n = name.trim()
    if (n && n !== d.name) onRename(d.id, n)
    else setName(d.name)
  }
  return (
    <div className="group flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-sunken dark:hover:bg-sunken-dark">
      {editing ? (
        <input
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          className="w-full rounded bg-surface px-1 py-0.5 text-sm outline-none ring-1 ring-clay dark:bg-surface-dark"
        />
      ) : (
        <>
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
              self ? 'bg-clay' : 'bg-line dark:bg-line-dark'
            }`}
          />
          <span className="flex-1 truncate text-sm">
            {d.name}
            {self && <span className="ml-1 text-xs text-clay">（本机）</span>}
          </span>
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-faint opacity-0 transition-opacity hover:text-ink group-hover:opacity-100 dark:text-faint-dark dark:hover:text-ink-dark"
          >
            改名
          </button>
          {!self && (
            <button
              onClick={() => onRemove(d.id)}
              className="text-xs text-faint opacity-0 transition-opacity hover:text-clay-deep group-hover:opacity-100 dark:text-faint-dark"
            >
              移除
            </button>
          )}
        </>
      )}
    </div>
  )
}

export default function Sidebar({ view, setView, refreshKey, onClose, onNavigate }) {
  const [query, setQuery] = useState(view.q)
  const [date, setDate] = useState('')
  const [stats, setStats] = useState(null)
  const [devices, setDevices] = useState([])
  const [theme, setTheme] = useState(currentTheme())
  const debounceRef = useRef(null)
  const { deviceId } = getAuth()

  // 300ms debounce into ?q=
  function onQuery(v) {
    setQuery(v)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setView((cur) => ({ ...cur, q: v.trim(), anchor: '' }))
    }, 300)
  }

  // Enter commits a pending query immediately; on an already-active query it
  // walks the results (Shift+Enter walks backwards), Word-style.
  function onQueryKey(e) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    const v = query.trim()
    if (v !== view.q) {
      clearTimeout(debounceRef.current)
      setView((cur) => ({ ...cur, q: v, anchor: '' }))
    } else if (v) {
      dispatchEvent(new CustomEvent('search:nav', { detail: e.shiftKey ? -1 : 1 }))
    }
  }

  useEffect(() => setQuery(view.q), [view.q])

  useEffect(() => {
    let live = true
    const load = () => {
      api.stats().then((s) => live && setStats(s)).catch(() => {})
      api.listDevices().then((d) => live && setDevices(d)).catch(() => {})
    }
    load()
    const t = setInterval(load, 30_000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [refreshKey])

  const pct = stats && stats.limit > 0 ? Math.min(100, (stats.used / stats.limit) * 100) : 0

  return (
    <div className="flex h-full w-72 flex-col bg-sunken dark:bg-sunken-dark">
      <div className="group/logo flex items-center gap-2 px-4 pb-2 pt-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-clay to-clay-deep text-sm font-bold text-white shadow-sm shadow-clay/30 transition-transform duration-300 group-hover/logo:-rotate-6 group-hover/logo:scale-110">
          分
        </div>
        <span className="font-semibold">LanShare</span>
        {onClose && (
          <button onClick={onClose} className="ml-auto p-1 text-faint dark:text-faint-dark md:hidden">
            ✕
          </button>
        )}
      </div>

      <div className="px-4 py-2">
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onQueryKey}
          placeholder="搜索消息与文件名…"
          className="w-full rounded-xl bg-surface px-3 py-2 text-sm outline-none ring-1 ring-line transition-shadow duration-200 placeholder:text-faint focus:shadow-md focus:shadow-clay/10 focus:ring-2 focus:ring-clay dark:bg-surface-dark dark:ring-line-dark dark:placeholder:text-faint-dark"
        />
      </div>

      <div className="px-4 py-2">
        <div className="mb-1 text-xs font-medium text-faint dark:text-faint-dark">视图</div>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => {
              setView((cur) => ({ ...cur, type: f.key, anchor: '' }))
              onNavigate?.()
            }}
            className={`mb-0.5 flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition-all duration-200 active:scale-[0.98] ${
              view.type === f.key && !view.q
                ? 'bg-clay/15 font-medium text-clay'
                : 'hover:translate-x-0.5 hover:bg-surface dark:hover:bg-surface-dark'
            }`}
          >
            <span
              className={`h-1 w-1 rounded-full bg-clay transition-all duration-300 ${
                view.type === f.key && !view.q ? 'scale-100 opacity-100' : 'scale-0 opacity-0'
              }`}
            />
            {f.label}
          </button>
        ))}
      </div>

      <div className="px-4 py-2">
        <div className="mb-1 text-xs font-medium text-faint dark:text-faint-dark">跳转到日期</div>
        <div className="flex gap-1.5">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="min-w-0 flex-1 rounded-lg bg-surface px-2 py-1.5 text-sm outline-none ring-1 ring-line dark:bg-surface-dark dark:ring-line-dark"
          />
          <button
            disabled={!date}
            onClick={() => {
              setView((cur) => ({ ...cur, q: '', anchor: date }))
              onNavigate?.()
            }}
            className="rounded-lg bg-clay px-3 py-1.5 text-sm text-white transition-all hover:bg-clay-deep enabled:hover:shadow-md enabled:hover:shadow-clay/30 enabled:active:scale-95 disabled:opacity-30"
          >
            跳转
          </button>
        </div>
      </div>

      <div className="mt-auto border-t border-line px-4 py-3 dark:border-line-dark">
        {stats && (
          <div className="mb-3">
            <div className="mb-1 flex justify-between text-xs text-faint dark:text-faint-dark">
              <span>存储用量</span>
              <span>
                {formatSize(stats.used)} / {formatSize(stats.limit)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface dark:bg-surface-dark">
              <div
                className={`h-full rounded-full transition-[width] duration-700 ease-out ${
                  pct > 90
                    ? 'bg-clay-deep'
                    : 'bg-gradient-to-r from-clay to-clay-deep'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-1 text-xs text-faint dark:text-faint-dark">
              共 {stats.message_count} 条消息
            </div>
          </div>
        )}

        <div className="mb-1 text-xs font-medium text-faint dark:text-faint-dark">设备</div>
        <div className="mb-3 max-h-40 overflow-y-auto">
          {devices.map((d) => (
            <DeviceRow
              key={d.id}
              d={d}
              self={d.id === deviceId}
              onRename={async (id, name) => {
                await api.renameDevice(id, name).catch(() => {})
                setDevices(await api.listDevices().catch(() => devices))
              }}
              onRemove={async (id) => {
                await api.deleteDevice(id).catch(() => {})
                setDevices(await api.listDevices().catch(() => devices))
              }}
            />
          ))}
        </div>

        <button
          onClick={() => setTheme(toggleTheme())}
          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-faint transition hover:bg-surface hover:text-ink dark:text-faint-dark dark:hover:bg-surface-dark dark:hover:text-ink-dark"
        >
          {theme === 'dark' ? '☀️ 浅色模式' : '🌙 深色模式'}
        </button>
      </div>
    </div>
  )
}
