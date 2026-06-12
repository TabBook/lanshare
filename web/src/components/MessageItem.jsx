import { memo, useRef, useState } from 'react'
import { fileURL, thumbURL } from '../api.js'
import { copy } from '../copy.js'
import { dayLabel, formatSize, fullTime, sameDay, shortTime } from '../format.js'
import Markdown from './Markdown.jsx'

const COLLAPSE_MS = 3 * 60 * 1000

function IconBtn({ label, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2 py-0.5 text-xs transition active:scale-90 hover:bg-sunken dark:hover:bg-sunken-dark ${
        danger ? 'text-clay-deep' : 'text-faint dark:text-faint-dark'
      }`}
    >
      {label}
    </button>
  )
}

function FileBody({ msg }) {
  return (
    <a
      href={fileURL(msg.file_id, { dl: true })}
      download={msg.file_name}
      className="group/file flex max-w-xs items-center gap-3 rounded-xl bg-sunken p-3 transition-all duration-200 hover:-translate-y-0.5 hover:bg-line hover:shadow-md dark:bg-sunken-dark dark:hover:bg-line-dark dark:hover:shadow-black/30"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-clay/15 text-clay transition-transform duration-200 group-hover/file:scale-110">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{msg.file_name}</div>
        <div className="text-xs text-faint dark:text-faint-dark">
          {formatSize(msg.file_size)} · 点击下载
        </div>
      </div>
    </a>
  )
}

function ImageBody({ msg, onOpenImage }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <FileBody msg={msg} />
  return (
    <button
      onClick={() => onOpenImage(msg)}
      className="block overflow-hidden rounded-xl transition-shadow duration-200 hover:shadow-lg dark:hover:shadow-black/40"
    >
      {/* Fixed box prevents layout shift; thumbnails lazy-load. */}
      <img
        src={thumbURL(msg.file_id)}
        alt={msg.file_name}
        loading="lazy"
        width={256}
        height={192}
        onError={() => setFailed(true)}
        className="h-48 w-64 rounded-xl bg-sunken object-cover transition-transform duration-300 ease-out hover:scale-[1.04] dark:bg-sunken-dark"
      />
    </button>
  )
}

function VideoBody({ msg }) {
  const [playing, setPlaying] = useState(false)
  if (playing) {
    return (
      <video
        src={fileURL(msg.file_id)}
        controls
        autoPlay
        playsInline
        className="max-h-80 w-full max-w-md rounded-xl bg-black"
      />
    )
  }
  return (
    <button
      onClick={() => setPlaying(true)}
      className="group/play relative flex h-48 w-64 items-center justify-center rounded-xl bg-sunken transition-shadow duration-200 hover:shadow-lg dark:bg-sunken-dark dark:hover:shadow-black/40"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-clay text-white shadow-lg shadow-clay/40 transition-transform duration-200 group-hover/play:scale-110 group-active/play:scale-95">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>
      <span className="absolute bottom-2 left-3 right-3 truncate text-left text-xs text-faint dark:text-faint-dark">
        {msg.file_name} · {formatSize(msg.file_size)}
      </span>
    </button>
  )
}

function MessageItem({ msg, prev, highlight, active, onDelete, onOpenImage, onJump }) {
  const [showFull, setShowFull] = useState(false)
  const pressTimer = useRef(null)
  const [menuPinned, setMenuPinned] = useState(false)
  // Animate entrance only for just-arrived messages (sent here or via WS),
  // not for rows the virtualizer remounts while scrolling history.
  const [fresh] = useState(() => Date.now() - msg.created_at < 2500)

  const newDay = !prev || !sameDay(new Date(prev.created_at), new Date(msg.created_at))
  const collapsed =
    !newDay &&
    prev &&
    prev.device_id === msg.device_id &&
    msg.created_at - prev.created_at < COLLAPSE_MS

  function startPress() {
    pressTimer.current = setTimeout(() => setMenuPinned(true), 550)
  }
  function endPress() {
    clearTimeout(pressTimer.current)
  }

  return (
    <div className="px-4 sm:px-6">
      {newDay && (
        <div className="flex items-center gap-3 py-4">
          <div className="h-px flex-1 bg-line dark:bg-line-dark" />
          <span className="rounded-full bg-sunken px-3 py-1 text-xs text-faint dark:bg-sunken-dark dark:text-faint-dark">
            {dayLabel(msg.created_at)}
          </span>
          <div className="h-px flex-1 bg-line dark:bg-line-dark" />
        </div>
      )}
      <div
        data-active-result={active ? '1' : undefined}
        className={`group relative rounded-2xl px-3 py-1.5 transition hover:bg-surface dark:hover:bg-surface-dark ${
          collapsed ? '' : 'mt-2'
        } ${highlight ? 'anchor-flash' : ''} ${fresh ? 'msg-in' : ''} ${
          active ? 'bg-surface ring-2 ring-clay/60 dark:bg-surface-dark' : ''
        }`}
        onTouchStart={startPress}
        onTouchEnd={endPress}
        onTouchMove={endPress}
      >
        {!collapsed && (
          <div className="mb-1 flex items-baseline gap-2">
            <span className="text-sm font-medium text-clay">{msg.device_name || '未知设备'}</span>
            <button
              onClick={() => setShowFull((v) => !v)}
              className="text-xs text-faint dark:text-faint-dark"
              title={fullTime(msg.created_at)}
            >
              {showFull ? fullTime(msg.created_at) : shortTime(msg.created_at)}
            </button>
          </div>
        )}
        {msg.type === 'text' && <Markdown text={msg.content} />}
        {msg.type === 'file' && <FileBody msg={msg} />}
        {msg.type === 'image' && <ImageBody msg={msg} onOpenImage={onOpenImage} />}
        {msg.type === 'video' && <VideoBody msg={msg} />}

        <div
          className={`absolute -top-3 right-2 flex items-center gap-0.5 rounded-lg bg-surface p-0.5 shadow-sm ring-1 ring-line transition-all duration-200 dark:bg-surface-dark dark:ring-line-dark ${
            menuPinned
              ? 'translate-y-0 opacity-100'
              : 'translate-y-1 opacity-0 group-hover:translate-y-0 group-hover:opacity-100'
          }`}
        >
          {msg.type === 'text' && <IconBtn label="复制" onClick={() => copy(msg.content)} />}
          {msg.type !== 'text' && (
            <a
              href={fileURL(msg.file_id, { dl: true })}
              download={msg.file_name}
              className="rounded-md px-2 py-0.5 text-xs text-faint transition hover:bg-sunken dark:text-faint-dark dark:hover:bg-sunken-dark"
            >
              下载
            </a>
          )}
          {onJump && <IconBtn label="跳回上下文" onClick={() => onJump(msg.id)} />}
          <IconBtn label="删除" danger onClick={() => { setMenuPinned(false); onDelete(msg) }} />
          {menuPinned && <IconBtn label="✕" onClick={() => setMenuPinned(false)} />}
        </div>
      </div>
    </div>
  )
}

// Stable identity + memo: WS appends must not re-render the whole list.
export default memo(MessageItem)
