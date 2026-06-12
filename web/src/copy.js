// Unified clipboard helper. navigator.clipboard requires a secure context,
// which plain-HTTP LAN deployments don't have, so fall back to execCommand.
export async function copy(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch { /* fall through */ }
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.cssText = 'position:fixed;top:-1000px;opacity:0'
  document.body.appendChild(ta)
  ta.focus()
  ta.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch { /* unsupported */ }
  document.body.removeChild(ta)
  return ok
}
