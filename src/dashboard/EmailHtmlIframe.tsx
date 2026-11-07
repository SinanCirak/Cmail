import { useEffect, useMemo, useRef } from 'react'
import { injectCidIntoHtml } from '../mail/cidImages'
import type { InlineImagePart } from '../types/mail'

type Props = {
  html: string
  /** Match app chrome so email body does not inherit broken contrast */
  dark: boolean
  /** When false, CID images stay unresolved until the user opts in (privacy). */
  loadInlineImages?: boolean
  inlineImages?: InlineImagePart[]
}

/**
 * Renders untrusted HTML mail in a sandboxed iframe so newsletter CSS cannot break the app shell.
 * `allow-same-origin` is required so the parent can access contentDocument to inject HTML and measure height;
 * without it, contentDocument is null (unique opaque origin) and the pane stays blank.
 * Scripts are still blocked (no allow-scripts).
 * Tracking pixels (1×1) are hidden; images are constrained.
 */
export function EmailHtmlIframe({
  html,
  dark,
  loadInlineImages = false,
  inlineImages,
}: Props) {
  const ref = useRef<HTMLIFrameElement>(null)

  const resolvedHtml = useMemo(() => {
    if (!loadInlineImages || !inlineImages?.length) return html
    return injectCidIntoHtml(html, inlineImages)
  }, [html, loadInlineImages, inlineImages])

  useEffect(() => {
    const iframe = ref.current
    if (!iframe) return
    const doc = iframe.contentDocument
    if (!doc) return

    const bg = dark ? '#0f172a' : '#f8fafc'
    const fg = dark ? '#e2e8f0' : '#0f172a'
    const link = dark ? '#38bdf8' : '#0284c7'
    const muted = dark ? '#94a3b8' : '#64748b'

    const shell = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 12px 10px 20px;
        font-size: 15px;
        line-height: 1.65;
        font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial,
          'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji', sans-serif;
        color: ${fg};
        background: ${bg};
        word-wrap: break-word;
        overflow-wrap: anywhere;
        -webkit-font-smoothing: antialiased;
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
    doc.body.innerHTML = resolvedHtml

    // Mail-supplied targets such as _self must never navigate the reader frame.
    doc.querySelectorAll('base').forEach((base) => base.setAttribute('target', '_blank'))
    doc.querySelectorAll('meta[http-equiv]').forEach((meta) => {
      if (meta.getAttribute('http-equiv')?.toLowerCase() === 'refresh') meta.remove()
    })
    const prepareLink = (element: Element) => {
      element.setAttribute('target', '_blank')
      element.setAttribute('rel', 'noopener noreferrer')
      element.removeAttribute('download')
    }
    doc.querySelectorAll('a, area').forEach(prepareLink)
    const enforceNewTab = (event: MouseEvent) => {
      const target = event.target as Element | null
      const anchor = target?.closest?.('a, area')
      if (!anchor) return
      const href = anchor.getAttribute('href') ?? anchor.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
      if (!href) return
      try {
        const url = new URL(href, doc.baseURI)
        if (!['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol)) {
          event.preventDefault()
          return
        }
      } catch {
        event.preventDefault()
        return
      }
      prepareLink(anchor)
    }
    doc.addEventListener('click', enforceNewTab, true)
    doc.addEventListener('auxclick', enforceNewTab, true)

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
      doc.removeEventListener('click', enforceNewTab, true)
      doc.removeEventListener('auxclick', enforceNewTab, true)
      ro?.disconnect()
      imgs.forEach((img) => img.removeEventListener('load', syncHeight))
    }
  }, [resolvedHtml, dark])

  return (
    <iframe
      ref={ref}
      className="cm-read__iframe"
      title="Email message"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
    />
  )
}
