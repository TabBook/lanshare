import { useRef, useState } from 'react'

const coarsePointer = matchMedia('(pointer: coarse)').matches

// Bottom input bar. Desktop: Enter sends, Shift+Enter breaks. Touch: the send
// button sends. Attach button and paste both funnel into the same onFiles
// upload pipeline as drag & drop.
export default function Composer({ onSend, onFiles }) {
  const [text, setText] = useState('')
  const taRef = useRef(null)
  const fileRef = useRef(null)

  function autoresize() {
    const ta = taRef.current
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
  }

  function send() {
    const t = text.trim()
    if (!t) return
    setText('')
    requestAnimationFrame(autoresize)
    onSend(t)
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !coarsePointer && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  function onPaste(e) {
    const files = [...(e.clipboardData?.files || [])]
    if (files.length > 0) {
      e.preventDefault()
      onFiles(files)
    }
  }

  return (
    <div className="border-t border-line bg-paper px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 dark:border-line-dark dark:bg-paper-dark sm:px-6">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          title="发送文件"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-faint transition-all duration-200 hover:-rotate-12 hover:scale-110 hover:bg-sunken hover:text-ink active:scale-90 dark:text-faint-dark dark:hover:bg-sunken-dark dark:hover:text-ink-dark"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            onFiles([...e.target.files])
            e.target.value = ''
          }}
        />
        <textarea
          ref={taRef}
          value={text}
          rows={1}
          placeholder="输入消息，支持 Markdown…"
          onChange={(e) => {
            setText(e.target.value)
            autoresize()
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          className="max-h-[200px] min-h-10 flex-1 resize-none rounded-xl bg-surface px-4 py-2.5 outline-none ring-1 ring-line transition-shadow duration-200 placeholder:text-faint focus:shadow-md focus:shadow-clay/10 focus:ring-2 focus:ring-clay dark:bg-surface-dark dark:ring-line-dark dark:placeholder:text-faint-dark"
        />
        <button
          onClick={send}
          disabled={!text.trim()}
          title="发送"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-clay text-white transition-all duration-200 enabled:hover:scale-105 enabled:hover:bg-clay-deep enabled:hover:shadow-md enabled:hover:shadow-clay/40 enabled:active:scale-90 disabled:opacity-30"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m22 2-7 20-4-9-9-4z" />
            <path d="M22 2 11 13" />
          </svg>
        </button>
      </div>
    </div>
  )
}
