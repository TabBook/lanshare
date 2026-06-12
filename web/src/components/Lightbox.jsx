import { useCallback, useEffect } from 'react'
import { fileURL } from '../api.js'

// Fullscreen viewer. The original image is only requested here, never in the
// timeline. Left/right navigates adjacent image/video messages.
export default function Lightbox({ list, index, onNav, onClose }) {
  const msg = list[index]

  const nav = useCallback(
    (dir) => {
      const next = index + dir
      if (next >= 0 && next < list.length) onNav(next)
    },
    [index, list.length, onNav],
  )

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') nav(-1)
      else if (e.key === 'ArrowRight') nav(1)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [nav, onClose])

  if (!msg) return null

  return (
    <div className="fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/90" onClick={onClose}>
      <button
        onClick={onClose}
        className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white transition-all duration-200 hover:rotate-90 hover:scale-110 hover:bg-white/20 active:scale-90"
        title="关闭"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
      {index > 0 && (
        <button
          onClick={(e) => { e.stopPropagation(); nav(-1) }}
          className="absolute left-3 z-10 rounded-full bg-white/10 p-2.5 text-white transition-all duration-200 hover:scale-110 hover:bg-white/20 active:scale-90"
          title="上一张"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
      )}
      {index < list.length - 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); nav(1) }}
          className="absolute right-3 z-10 rounded-full bg-white/10 p-2.5 text-white transition-all duration-200 hover:scale-110 hover:bg-white/20 active:scale-90"
          title="下一张"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      )}
      {/* Keyed by message id so each navigation replays the zoom entrance. */}
      <div key={msg.id} className="zoom-in max-h-full max-w-full p-4" onClick={(e) => e.stopPropagation()}>
        {msg.type === 'video' ? (
          <video src={fileURL(msg.file_id)} controls autoPlay playsInline className="max-h-[90vh] max-w-[92vw]" />
        ) : (
          <img src={fileURL(msg.file_id)} alt={msg.file_name} className="max-h-[90vh] max-w-[92vw] object-contain" />
        )}
        <div className="mt-2 text-center text-xs text-white/60">
          {msg.file_name} · {index + 1}/{list.length}
        </div>
      </div>
    </div>
  )
}
