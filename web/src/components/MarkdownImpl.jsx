import { useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import css from 'highlight.js/lib/languages/css'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { copy } from '../copy.js'

// Only the common subset; anything else renders as plain code.
const languages = {
  bash, sh: bash, shell: bash, zsh: bash,
  c, cpp, css, dockerfile, go, golang: go, ini, toml: ini, java,
  javascript, js: javascript, jsx: javascript,
  json, markdown, md: markdown, python, py: python, rust, sql,
  typescript, ts: typescript, tsx: typescript,
  xml, html: xml, yaml, yml: yaml,
}

function Pre({ children, ...props }) {
  const ref = useRef(null)
  const [copied, setCopied] = useState(false)
  async function onCopy() {
    if (await copy(ref.current?.innerText ?? '')) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }
  return (
    <div className="group/code relative">
      <button
        onClick={onCopy}
        className="absolute right-2 top-2 rounded-md bg-paper/80 px-2 py-0.5 text-xs text-faint opacity-0 transition group-hover/code:opacity-100 hover:text-ink dark:bg-paper-dark/80 dark:text-faint-dark dark:hover:text-ink-dark"
      >
        {copied ? '已复制' : '复制'}
      </button>
      <pre ref={ref} {...props}>{children}</pre>
    </div>
  )
}

export default function MarkdownImpl({ text }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { languages, detect: false, ignoreMissing: true }]]}
        components={{ pre: Pre }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
