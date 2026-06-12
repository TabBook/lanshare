// Chunked upload pipeline: 3 concurrent chunk PUTs, progress with speed/ETA,
// and resume across reloads. The fingerprint (name+size+lastModified) maps to
// a server upload_id in localStorage; re-picking the same file resumes from
// whatever chunks the server already has. No whole-file hashing — big files
// are never read twice.
import { api, getAuth } from './api.js'

const CONCURRENCY = 3

// --- tiny external store so React can useSyncExternalStore over the list ---
let uploads = []
const listeners = new Set()
export const uploadStore = {
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  getSnapshot: () => uploads,
}
function update(key, patch) {
  uploads = uploads.map((u) => (u.key === key ? { ...u, ...patch } : u))
  listeners.forEach((fn) => fn())
}
function add(u) {
  uploads = [...uploads, u]
  listeners.forEach((fn) => fn())
}
function removeEntry(key) {
  uploads = uploads.filter((u) => u.key !== key)
  listeners.forEach((fn) => fn())
}

function fingerprint(file) {
  return `up:${file.name}:${file.size}:${file.lastModified}`
}

function putChunk(uploadId, n, blob, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', `/api/uploads/${uploadId}/chunks/${n}`)
    const { token, deviceId } = getAuth()
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    if (deviceId) xhr.setRequestHeader('X-Device-Id', deviceId)
    xhr.upload.onprogress = (e) => onProgress(e.loaded)
    xhr.onload = () =>
      xhr.status < 300 ? resolve() : reject(new Error(`chunk ${n}: HTTP ${xhr.status}`))
    xhr.onerror = () => reject(new Error(`chunk ${n}: 网络错误`))
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'))
    signal.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(blob)
  })
}

async function resolveUploadId(file) {
  const fp = fingerprint(file)
  const saved = localStorage.getItem(fp)
  if (saved) {
    try {
      const st = await api.uploadStatus(saved)
      if (!st.completed) return { id: saved, received: new Set(st.received) }
    } catch { /* gone on the server; start fresh */ }
    localStorage.removeItem(fp)
  }
  const init = await api.initUpload(file.name, file.size, file.type || 'application/octet-stream')
  localStorage.setItem(fp, init.upload_id)
  return { id: init.upload_id, received: new Set(init.received), chunkSize: init.chunk_size }
}

async function uploadOne(file, key, controller) {
  const { id, received } = await resolveUploadId(file)
  const chunkSize = 8 * 1024 * 1024
  const nChunks = file.size === 0 ? 0 : Math.ceil(file.size / chunkSize)

  const chunkLen = (n) => Math.min(chunkSize, file.size - n * chunkSize)
  let baseSent = 0
  for (const n of received) baseSent += chunkLen(n)
  const inFlight = new Map() // n -> bytes progressed

  // speed: sliding window of samples
  const samples = [[performance.now(), baseSent]]
  function report() {
    let sent = baseSent
    for (const b of inFlight.values()) sent += b
    const now = performance.now()
    samples.push([now, sent])
    while (samples.length > 2 && now - samples[0][0] > 3000) samples.shift()
    const [t0, b0] = samples[0]
    const speed = now > t0 ? ((sent - b0) / (now - t0)) * 1000 : 0
    update(key, { sent, speed, eta: speed > 0 ? (file.size - sent) / speed : Infinity })
  }

  const queue = []
  for (let n = 0; n < nChunks; n++) if (!received.has(n)) queue.push(n)

  let queueErr = null
  async function worker() {
    while (queue.length > 0 && !queueErr) {
      const n = queue.shift()
      const blob = file.slice(n * chunkSize, n * chunkSize + chunkLen(n))
      try {
        await putChunk(id, n, blob, (b) => { inFlight.set(n, b); report() }, controller.signal)
        inFlight.delete(n)
        baseSent += chunkLen(n)
        report()
      } catch (err) {
        queueErr = err
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  if (queueErr) throw queueErr

  const msg = await api.completeUpload(id)
  localStorage.removeItem(fingerprint(file))
  return msg
}

// enqueueUploads is the single entry point for all three intakes: attach
// button, drag & drop, and paste.
export async function enqueueUploads(files, { onMessage } = {}) {
  for (const file of files) {
    const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const controller = new AbortController()
    add({
      key, name: file.name, size: file.size,
      sent: 0, speed: 0, eta: Infinity, status: 'uploading',
      cancel: () => { controller.abort(); removeEntry(key) },
      dismiss: () => removeEntry(key),
    })
    try {
      const msg = await uploadOne(file, key, controller)
      update(key, { status: 'done', sent: file.size })
      onMessage?.(msg)
      setTimeout(() => removeEntry(key), 1200)
    } catch (err) {
      if (err.name === 'AbortError') continue // entry already removed
      update(key, { status: 'error', error: err.message })
    }
  }
}
