// Thin API client. Token / device identity live in localStorage; a 401 from
// any call clears the session and bounces back to onboarding.

export function getAuth() {
  return {
    token: localStorage.getItem('token') || '',
    deviceId: localStorage.getItem('device_id') || '',
    deviceName: localStorage.getItem('device_name') || '',
  }
}

export function setAuth({ token, deviceId, deviceName }) {
  if (token !== undefined) localStorage.setItem('token', token)
  if (deviceId !== undefined) localStorage.setItem('device_id', deviceId)
  if (deviceName !== undefined) localStorage.setItem('device_name', deviceName)
}

export function clearAuth() {
  localStorage.removeItem('token')
  localStorage.removeItem('device_id')
}

let onUnauthorized = () => {}
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn
}

export async function apiFetch(path, opts = {}) {
  const { token, deviceId } = getAuth()
  const headers = { ...(opts.headers || {}) }
  headers['Authorization'] = `Bearer ${token}`
  if (deviceId) headers['X-Device-Id'] = deviceId
  const resp = await fetch(path, { ...opts, headers })
  if (resp.status === 401) {
    onUnauthorized()
    throw new Error('未授权')
  }
  if (!resp.ok) {
    let msg = `${resp.status}`
    try {
      msg = (await resp.json()).error || msg
    } catch { /* not json */ }
    throw new Error(msg)
  }
  if (resp.status === 204) return null
  return resp.json()
}

export const api = {
  stats: () => apiFetch('/api/stats'),
  registerDevice: (name) =>
    apiFetch('/api/devices', { method: 'POST', body: JSON.stringify({ name }) }),
  listDevices: () => apiFetch('/api/devices'),
  renameDevice: (id, name) =>
    apiFetch(`/api/devices/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteDevice: (id) => apiFetch(`/api/devices/${id}`, { method: 'DELETE' }),

  listMessages: (params) => apiFetch(`/api/messages?${new URLSearchParams(params)}`),
  sendText: (content) =>
    apiFetch('/api/messages', { method: 'POST', body: JSON.stringify({ type: 'text', content }) }),
  deleteMessage: (id) => apiFetch(`/api/messages/${id}`, { method: 'DELETE' }),

  initUpload: (name, size, mime) =>
    apiFetch('/api/uploads', { method: 'POST', body: JSON.stringify({ name, size, mime }) }),
  uploadStatus: (id) => apiFetch(`/api/uploads/${id}`),
  completeUpload: (id) => apiFetch(`/api/uploads/${id}/complete`, { method: 'POST' }),
}

export function fileURL(fileId, { dl = false } = {}) {
  const { token } = getAuth()
  return `/api/files/${fileId}?token=${encodeURIComponent(token)}${dl ? '&dl=1' : ''}`
}

export function thumbURL(fileId) {
  const { token } = getAuth()
  return `/api/files/${fileId}/thumb?token=${encodeURIComponent(token)}`
}
