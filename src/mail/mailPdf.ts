import type { MailMessage } from '../types/mail'
import { injectCidIntoHtml } from './cidImages'

/** Create a PDF containing only this email, without application navigation or actions. */
export async function downloadMailPdf(message: MailMessage, showImages: boolean): Promise<void> {
  const [{ jsPDF }, { default: DOMPurify }] = await Promise.all([
    import('jspdf'), import('dompurify'),
  ])
  const container = document.createElement('div')
  container.style.cssText = 'width:720px;padding:24px;background:#fff;color:#111827;font:14px Arial,sans-serif;line-height:1.6;overflow-wrap:anywhere;'
  const title = document.createElement('h1')
  title.style.cssText = 'font-size:22px;margin:0 0 16px;'
  title.textContent = message.subject
  container.append(title)
  const contacts = (people: typeof message.to) => people.map((p) => `${p.name} <${p.email}>`).join(', ')
  const fields = [
    ['From', contacts([message.from])], ['To', contacts(message.to)],
    ['Cc', contacts(message.cc ?? [])], ['Bcc', contacts(message.bcc ?? [])],
    ['Date', new Date(message.sentAt).toLocaleString()],
    ['Attachments', (message.attachments ?? []).map((a) => a.name).join(', ')],
  ]
  for (const [label, value] of fields) {
    if (!value) continue
    const row = document.createElement('div')
    row.textContent = `${label}: ${value}`
    container.append(row)
  }
  const body = document.createElement('div')
  body.style.cssText = 'margin-top:24px;padding-top:16px;border-top:1px solid #ddd;'
  if (message.bodyIsHtml || /^\s*<(?:!doctype|html|div|p|table|body)\b/i.test(message.body)) {
    const html = showImages ? injectCidIntoHtml(message.body, message.inlineImages ?? []) : message.body
    body.innerHTML = DOMPurify.sanitize(html, {
      FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'link', 'meta'],
      FORBID_ATTR: ['srcset', 'style'],
    })
    body.querySelectorAll('img').forEach((img) => {
      // Avoid new remote tracking requests while exporting.
      if (!img.src.startsWith('data:image/')) img.remove()
      else img.style.maxWidth = '100%'
    })
    body.querySelectorAll('table').forEach((table) => { table.style.maxWidth = '100%' })
  } else {
    body.style.whiteSpace = 'pre-wrap'
    body.textContent = message.body
  }
  container.append(body)
  const staging = document.createElement('div')
  staging.style.cssText = 'position:fixed;left:-10000px;top:0;pointer-events:none;'
  staging.append(container)
  document.body.append(staging)
  try {
    await document.fonts.ready
    const pdf = new jsPDF({ unit: 'pt', format: 'a4' })
    pdf.setProperties({ title: message.subject, subject: 'Email', creator: 'Cmail' })
    await pdf.html(container, {
      margin: [32, 32, 32, 32], autoPaging: 'text', width: 531, windowWidth: 720,
      html2canvas: { scale: 531 / 720, backgroundColor: '#ffffff', logging: false },
    })
    const name = [...(message.subject || 'email')].filter((c) => c.charCodeAt(0) >= 32).join('').replace(/[<>:"/\\|?*]/g, '_').slice(0, 100)
    pdf.save(`${name}.pdf`)
  } finally {
    staging.remove()
  }
}
