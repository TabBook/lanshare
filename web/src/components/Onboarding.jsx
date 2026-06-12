import { useEffect, useState } from 'react'
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

const inputCls =
  'mb-4 w-full rounded-xl bg-surface px-4 py-3 outline-none ring-1 ring-line transition-shadow duration-200 focus:shadow-md focus:shadow-clay/10 focus:ring-2 focus:ring-clay dark:bg-surface-dark dark:ring-line-dark'

export default function Onboarding({ onDone }) {
  // mode: 'loading' 探测中 | 'setup' 首次运行设置令牌 | 'login' 正常登录
  const [mode, setMode] = useState('loading')
  const [token, setToken] = useState('')
  const [confirm, setConfirm] = useState('')
  const [name, setName] = useState(defaultDeviceName())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetch('/api/setup')
      .then((r) => r.json())
      .then((s) => setMode(s.needed ? 'setup' : 'login'))
      .catch(() => setMode('login'))
  }, [])

  const isSetup = mode === 'setup'
  const ready =
    token.trim().length > 0 && name.trim() && (!isSetup || (token.trim().length >= 6 && confirm === token))

  async function submit(e) {
    e.preventDefault()
    if (busy || !token.trim() || !name.trim()) return
    if (isSetup) {
      if (token.trim().length < 6) return setError('令牌至少 6 个字符')
      if (confirm !== token) return setError('两次输入的令牌不一致')
    }
    setBusy(true)
    setError('')
    try {
      if (isSetup) {
        const r = await fetch('/api/setup', {
          method: 'POST',
          body: JSON.stringify({ token: token.trim() }),
        })
        // 409 = 别人抢先设置过了，按普通登录尝试当前输入的令牌
        if (!r.ok && r.status !== 409) throw new Error((await r.json()).error || r.status)
      }
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

  if (mode === 'loading') return null

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form onSubmit={submit} className="rise-in w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="float-y mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-clay to-clay-deep text-2xl font-bold text-white shadow-lg shadow-clay/30">
            分
          </div>
          <h1 className="text-2xl font-semibold">LanShare</h1>
          <p className="mt-1 text-sm text-faint dark:text-faint-dark">
            {isSetup ? '首次使用，先设置一个访问令牌' : '局域网私人分享站'}
          </p>
        </div>

        <label className="mb-1 block text-sm text-faint dark:text-faint-dark">
          {isSetup ? '设置访问令牌（至少 6 个字符）' : '访问令牌'}
        </label>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoFocus
          className={inputCls}
          placeholder={isSetup ? '所有设备将凭它访问，请妥善保管' : 'TOKEN'}
        />

        {isSetup && (
          <>
            <label className="mb-1 block text-sm text-faint dark:text-faint-dark">确认令牌</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputCls}
              placeholder="再输一遍"
            />
          </>
        )}

        <label className="mb-1 block text-sm text-faint dark:text-faint-dark">设备名称</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`${inputCls} mb-6`}
          placeholder="例如：客厅电脑"
        />

        {error && <p key={error} className="shake-x mb-4 text-sm text-clay-deep">{error}</p>}
        <button
          type="submit"
          disabled={busy || !ready}
          className="w-full rounded-xl bg-clay py-3 font-medium text-white transition-all duration-200 enabled:hover:-translate-y-0.5 enabled:hover:bg-clay-deep enabled:hover:shadow-lg enabled:hover:shadow-clay/30 enabled:active:translate-y-0 enabled:active:scale-[0.98] disabled:opacity-40"
        >
          {busy ? '连接中…' : isSetup ? '完成设置并进入' : '开始使用'}
        </button>

        {isSetup && (
          <p className="mt-4 text-center text-xs text-faint dark:text-faint-dark">
            之后想换令牌：用 TOKEN 环境变量启动可直接覆盖
          </p>
        )}
      </form>
    </div>
  )
}
