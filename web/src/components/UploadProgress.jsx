import { useSyncExternalStore } from 'react'
import { formatETA, formatSize, formatSpeed } from '../format.js'
import { uploadStore } from '../upload.js'

export default function UploadProgress() {
  const uploads = useSyncExternalStore(uploadStore.subscribe, uploadStore.getSnapshot)
  if (uploads.length === 0) return null
  return (
    <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
      {uploads.map((u) => {
        const pct = u.size > 0 ? Math.min(100, (u.sent / u.size) * 100) : 100
        return (
          <div key={u.key} className="msg-in mb-2 rounded-xl bg-surface p-3 shadow-sm ring-1 ring-line dark:bg-surface-dark dark:ring-line-dark">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate font-medium">{u.name}</span>
              {u.status === 'uploading' && (
                <button onClick={u.cancel} className="shrink-0 text-xs text-faint hover:text-clay-deep dark:text-faint-dark">
                  取消
                </button>
              )}
              {u.status === 'error' && (
                <button onClick={u.dismiss} className="shrink-0 text-xs text-faint dark:text-faint-dark">
                  关闭
                </button>
              )}
            </div>
            {u.status === 'error' ? (
              <p className="mt-1 text-xs text-clay-deep">上传失败：{u.error}（重新选择同一文件可续传）</p>
            ) : (
              <>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken dark:bg-sunken-dark">
                  <div
                    className={`relative h-full overflow-hidden rounded-full bg-gradient-to-r from-clay to-clay-deep transition-[width] duration-200 ${
                      u.status === 'uploading' ? 'bar-shimmer' : ''
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-xs text-faint dark:text-faint-dark">
                  <span>
                    {formatSize(u.sent)} / {formatSize(u.size)}
                  </span>
                  {u.status === 'uploading' && u.speed > 0 && (
                    <span>
                      {formatSpeed(u.speed)} · 剩余 {formatETA(u.eta)}
                    </span>
                  )}
                  {u.status === 'done' && <span>完成</span>}
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
