import { useEffect, useRef } from 'react'

type Props = {
  html: string
  /** Match app chrome so email body does not inherit broken contrast */
  dark: boolean
}

/**
 * Renders untrusted HTML mail in a sandboxed iframe so newsletter CSS cannot break the app shell.
 * Tracking pixels (1×1) are hidden; images are constrained.
 */
export function EmailHtmlIframe({ html, dark }: Props) {
  const ref = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const iframe = ref.current
    if (!iframe) return
    const doc = iframe.contentDocument
    if (!doc) return

    const bg = dark ? '#0f172a' : '#f8fafc'
    const fg = dark ? '#e2e8f0' : '#0f172a'
    const link = dark ? '#38bdf8' : '#0284c7'
    const muted = dark ? '#94a3b8' : '#64748b'

    const shell = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 12px 10px 20px;
        font: 15px/1.65 system-ui, -apple-system, 'Segoe UI', sans-serif;
        color: ${fg};
        background: ${bg};
        word-wrap: break-word;
        overflow-wrap: anywhere;
      }
      img { max-width: 100% !important; height: auto !important; }
      img[width="1"][height="1"], img[width="0"][height="0"] { display: none !important; }
      a { color: ${link}; }
      p { margin: 0.65em 0; }
      ul, ol { margin: 0.5em 0; padding-left: 1.35rem; }
      table { max-width: 100%; border-collapse: collapse; }
      blockquote { margin: 0.5em 0; padding-left: 0.75rem; border-left: 3px solid ${muted}; color: ${muted}; }
    </style></head><body></body></html>`

    doc.open()
    doc.write(shell)
    doc.close()
    if (!doc.body) return
    doc.body.innerHTML = html

    const syncHeight = () => {
      const h = Math.max(doc.body?.scrollHeight ?? 0, 120)
      iframe.style.height = `${h}px`
    }
    syncHeight()

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => syncHeight()) : null
    if (ro && doc.body) ro.observe(doc.body)

    const imgs = doc.body.querySelectorAll('img')
    imgs.forEach((img) => {
      img.addEventListener('load', syncHeight)
    })

    return () => {
      ro?.disconnect()
      imgs.forEach((img) => img.removeEventListener('load', syncHeight))
    }
  }, [html, dark])

  return (
    <iframe
      ref={ref}
      className="cm-read__iframe"
      title="Email message"
      sandbox="allow-popups allow-popups-to-escape-sandbox"
    />
  )
}
