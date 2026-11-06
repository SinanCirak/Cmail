import DOMPurify from 'dompurify'
import type { InlineImagePart, MailMessage } from '../types/mail'
import { normalizeCidKey } from './cidImages'

export type MailQuote = { html: string; inlineImages: InlineImagePart[] }

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** Inline email styles in a sandbox, so a quoted template cannot style the reply. */
export async function prepareMailQuote(message: MailMessage, mode: 'reply' | 'forward'): Promise<MailQuote> {
  const isHtml = message.bodyIsHtml || /^\s*</.test(message.body)
  let content: string
  if (!isHtml) {
    content = `<div style="white-space:pre-wrap">${escape(message.body)}</div>`
  } else {
    const clean = DOMPurify.sanitize(message.body, {
      WHOLE_DOCUMENT: true,
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'link', 'meta', 'base'],
    })
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-same-origin')
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:720px;height:800px;border:0;pointer-events:none;'
    document.body.append(frame)
    try {
      const doc = frame.contentDocument!
      const parsed = new DOMParser().parseFromString(clean, 'text/html')
      parsed.querySelectorAll('img[src]').forEach((img) => {
        img.setAttribute('data-cmail-src', img.getAttribute('src')!)
        img.removeAttribute('src')
        img.removeAttribute('srcset')
      })
      // No network loads, scripts or remote styles while preparing the quote.
      doc.open()
      doc.write('<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:;">' + parsed.head.innerHTML + '</head><body>' + parsed.body.innerHTML + '</body></html>')
      doc.close()
      for (const attr of parsed.body.attributes) doc.body.setAttribute(attr.name, attr.value)
      for (const attr of parsed.documentElement.attributes) doc.documentElement.setAttribute(attr.name, attr.value)
      const properties = ['display', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-align', 'line-height', 'white-space', 'vertical-align', 'border-collapse', 'border-spacing', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius']
      // Collect before removing style elements: computed CSS must still be available.
      const elements = [...doc.body.querySelectorAll<HTMLElement>('*')]
      const computed = elements.map((el) => ({ el, css: frame.contentWindow!.getComputedStyle(el) }))
      const styles = computed.map(({ el, css }) => ({ el,
        hidden: (el.tagName === 'IMG' && Number(el.getAttribute('width')) === 1 && Number(el.getAttribute('height')) === 1) || css.display === 'none' || css.visibility === 'hidden' || el.hidden || (css.maxHeight === '0px' && ['hidden', 'clip'].includes(css.overflow)),
        style: properties.map((name) => `${name}:${css.getPropertyValue(name)}`).join(';') + (['TABLE', 'TD', 'TH', 'IMG'].includes(el.tagName) ? `;width:${css.width};max-width:100%` : ''),
      }))
      for (const { el, hidden, style } of styles) {
        if (hidden || ['STYLE', 'SCRIPT', 'NOSCRIPT', 'TEMPLATE'].includes(el.tagName)) el.remove()
        else el.setAttribute('style', style)
      }
      doc.body.querySelectorAll<HTMLElement>('[data-cmail-src]').forEach((el) => {
        el.setAttribute('src', el.getAttribute('data-cmail-src')!)
        el.removeAttribute('data-cmail-src')
        el.style.maxWidth = '100%'
      })
      const bodyStyle = frame.contentWindow!.getComputedStyle(doc.body)
      const wrapper = doc.createElement('div')
      wrapper.style.color = bodyStyle.color
      wrapper.style.backgroundColor = bodyStyle.backgroundColor
      wrapper.style.fontFamily = bodyStyle.fontFamily
      wrapper.style.fontSize = bodyStyle.fontSize
      wrapper.style.overflowWrap = 'anywhere'
      wrapper.innerHTML = doc.body.innerHTML
      content = wrapper.outerHTML
    } finally { frame.remove() }
  }
  const date = new Date(message.sentAt).toLocaleString()
  const heading = mode === 'reply'
    ? `On ${date}, ${message.from.name} <${message.from.email}> wrote:`
    : `Forwarded message — From: ${message.from.name} <${message.from.email}> | Date: ${date} | Subject: ${message.subject}`
  const html = `<blockquote style="margin:20px 0 0;padding:12px 0 0 16px;border-left:2px solid #d1d5db"><p style="font-family:Arial,sans-serif;font-size:13px;color:#64748b">${escape(heading)}</p>${content}</blockquote>`
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const cids = new Set([...doc.querySelectorAll('img[src]')].map((img) => img.getAttribute('src')!).filter((src) => src.toLowerCase().startsWith('cid:')).map(normalizeCidKey))
  return { html, inlineImages: (message.inlineImages ?? []).filter((image) => cids.has(normalizeCidKey(image.cid))) }
}
