import { lazy, Suspense } from 'react'

// The real renderer (react-markdown + highlight.js) is a separate chunk so the
// first paint never pays for it.
const Impl = lazy(() => import('./MarkdownImpl.jsx'))

export default function Markdown({ text }) {
  return (
    <Suspense fallback={<pre className="md whitespace-pre-wrap font-sans">{text}</pre>}>
      <Impl text={text} />
    </Suspense>
  )
}
