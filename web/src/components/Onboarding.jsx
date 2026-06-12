import { useState } from 'react'
import { api, setAuth } from '../api.js'

function defaultDeviceName() {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android 手机'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows 电脑'
  return '我的设备'
}

export default function Onboarding({ onDone }) {
  const [token, setToken] = useState('')
  const [name, setName] = useState(defaultDeviceName())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!token.trim() || !name.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      setAuth({ token: token.trim() })
      await api.stats() // validates the token
      const d = await api.registerDevice(name.trim())
      setAuth({ deviceId: d.device_id, deviceName: d.name })
      onDone()
    } catch (err) {
      setError(err.message === '未授权' ? '访问令牌不正确' : `连接失败：${err.message}`)
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form onSubmit={submit} className="rise-in w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="float-y mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-clay to-clay-deep text-2xl font-bold text-white shadow-lg shadow-clay/30">
            分
          </div>
          <h1 className="text-2xl font-semibold">LanShare</h1>
          <p className="mt-1 text-sm text-faint dark:text-faint-dark">局域网私人分享站</p>
        </div>
        <label className="mb-1 block text-sm text-faint dark:text-faint-dark">访问令牌</label>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoFocus
          className="mb-4 w-full rounded-xl bg-surface px-4 py-3 outline-none ring-1 ring-line transition-shadow duration-200 focus:shadow-md focus:shadow-clay/10 focus:ring-2 focus:ring-clay dark:bg-surface-dark dark:ring-line-dark"
          placeholder="TOKEN"
        />
        <label className="mb-1 block text-sm text-faint dark:text-faint-dark">设备名称</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mb-6 w-full rounded-xl bg-surface px-4 py-3 outline-none ring-1 ring-line transition-shadow duration-200 focus:shadow-md focus:shadow-clay/10 focus:ring-2 focus:ring-clay dark:bg-surface-dark dark:ring-line-dark"
          placeholder="例如：客厅电脑"
        />
        {error && <p key={error} className="shake-x mb-4 text-sm text-clay-deep">{error}</p>}
        <button
          type="submit"
          disabled={busy || !token.trim() || !name.trim()}
          className="w-full rounded-xl bg-clay py-3 font-medium text-white transition-all duration-200 enabled:hover:-translate-y-0.5 enabled:hover:bg-clay-deep enabled:hover:shadow-lg enabled:hover:shadow-clay/30 enabled:active:translate-y-0 enabled:active:scale-[0.98] disabled:opacity-40"
        >
          {busy ? '连接中…' : '开始使用'}
        </button>
      </form>
    </div>
  )
}
