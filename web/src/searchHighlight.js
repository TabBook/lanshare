// Word-style in-text search highlighting via the CSS Custom Highlight API:
// no DOM mutation, so it works on top of rendered markdown and survives
// React re-renders. Browsers without CSS.highlights just skip it.
import { useEffect } from 'react'

const supported = typeof CSS !== 'undefined' && 'highlights' in CSS

export function useSearchHighlight(ref, query) {
  useEffect(() => {
    const root = ref.current
    const q = query?.toLowerCase()
    if (!supported || !root || !q) return
    let raf = 0

    const apply = () => {
      raf = 0
      const normal = []
      const active = []
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node; (node = walker.nextNode()); ) {
        const text = node.data.toLowerCase()
        let i = 0
        while ((i = text.indexOf(q, i)) !== -1) {
          const r = new Range()
          r.setStart(node, i)
          r.setEnd(node, i + q.length)
          ;(node.parentElement?.closest('[data-active-result]') ? active : normal).push(r)
          i += q.length
        }
      }
      CSS.highlights.set('search-match', new Highlight(...normal))
      CSS.highlights.set('search-active', new Highlight(...active))
    }

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply)
    }
    schedule()
    // The virtualized list mounts/unmounts rows on scroll and markdown chunks
    // load lazily; recompute whenever the subtree changes.
    const mo = new MutationObserver(schedule)
    mo.observe(root, { childList: true, subtree: true, characterData: true, attributes: true })
    return () => {
      mo.disconnect()
      cancelAnimationFrame(raf)
      CSS.highlights.delete('search-match')
      CSS.highlights.delete('search-active')
    }
  }, [ref, query])
}
