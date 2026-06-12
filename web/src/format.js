const pad = (n) => String(n).padStart(2, '0')

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = -1
  do {
    v /= 1024
    i++
  } while (v >= 1024 && i < units.length - 1)
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

export function formatSpeed(bps) {
  return `${formatSize(bps)}/s`
}

export function formatETA(sec) {
  if (!isFinite(sec) || sec < 0) return ''
  if (sec < 60) return `${Math.ceil(sec)} 秒`
  if (sec < 3600) return `${Math.ceil(sec / 60)} 分钟`
  return `${(sec / 3600).toFixed(1)} 小时`
}

export function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

// Date separator label: 今天 / 昨天 / 2026年6月8日.
export function dayLabel(ms) {
  const d = new Date(ms)
  const now = new Date()
  if (sameDay(d, now)) return '今天'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, yesterday)) return '昨天'
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

// Corner timestamp: relative when recent, HH:mm same day, date otherwise.
export function shortTime(ms) {
  const diff = Date.now() - ms
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  const d = new Date(ms)
  if (sameDay(d, new Date())) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fullTime(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function monthLabel(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}年${d.getMonth() + 1}月`
}
