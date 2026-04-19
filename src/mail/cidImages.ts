/** Resolve multipart/related CID references (<img src="cid:...">) using parts from /mail/content */

import type { InlineImagePart } from '../types/mail'

export function normalizeCidKey(raw: string): string {
  let s = raw.trim()
  try {
    s = decodeURIComponent(s)
  } catch {
    /* ignore */
  }
  if (s.toLowerCase().startsWith('cid:')) s = s.slice(4)
  s = s.replace(/^<|>$/g, '').trim().toLowerCase()
  return s
}

/** Replace cid: URLs with data URLs when we have matching inline image parts from the server. */
export function injectCidIntoHtml(html: string, images: InlineImagePart[]): string {
  if (!images.length) return html
  const map = new Map<string, string>()
  for (const img of images) {
    const key = normalizeCidKey(img.cid)
    const mime = img.contentType?.trim() || 'application/octet-stream'
    map.set(key, `data:${mime};base64,${img.contentBase64}`)
  }
  return html.replace(/\bcid:([^\s"'<>]+)/gi, (full, ref: string) => {
    const key = normalizeCidKey(ref)
    return map.get(key) ?? full
  })
}
