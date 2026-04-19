import type { MailFolder, MailMessage } from '../types/mail'

const noCache: RequestInit = { cache: 'no-store' }

type ApiMailRow = {
  id: string
  folder: string
  subject: string
  snippet: string
  from: { name: string; email: string }
  sentAt: string
  read: boolean
  starred: boolean
  hasAttachment?: boolean
  s3Key?: string
}

function toMailMessage(row: ApiMailRow): MailMessage {
  return {
    id: row.id,
    folder: row.folder as MailFolder,
    from: row.from,
    to: [],
    subject: row.subject,
    snippet: row.snippet,
    body: '',
    sentAt: row.sentAt,
    read: row.read,
    starred: row.starred,
    hasAttachment: row.hasAttachment,
    s3Key: row.s3Key,
  }
}

export async function fetchLiveMailbox(apiBase: string, token: string): Promise<MailMessage[]> {
  const folders: MailFolder[] = ['inbox', 'sent', 'drafts', 'spam', 'trash']
  const chunks = await Promise.all(
    folders.map(async (folder) => {
      const res = await fetch(`${apiBase}/mail/messages?folder=${encodeURIComponent(folder)}`, {
        ...noCache,
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(t || `HTTP ${res.status}`)
      }
      const data = (await res.json()) as { messages: ApiMailRow[] }
      return data.messages.map(toMailMessage)
    }),
  )
  return chunks.flat()
}

/** System folder ids accepted by PATCH /mail/message */
export async function moveMailMessage(
  apiBase: string,
  token: string,
  sk: string,
  folder: 'inbox' | 'sent' | 'drafts' | 'spam' | 'trash',
): Promise<void> {
  const res = await fetch(`${apiBase}/mail/message`, {
    ...noCache,
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sk, folder }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t || `HTTP ${res.status}`)
  }
}

export async function sendMailMessage(
  apiBase: string,
  token: string,
  payload: { to: string; cc?: string; bcc?: string; subject: string; body: string },
): Promise<void> {
  const res = await fetch(`${apiBase}/mail/send`, {
    ...noCache,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t || `HTTP ${res.status}`)
  }
}

export async function deleteMailMessage(apiBase: string, token: string, sk: string): Promise<void> {
  const qs = new URLSearchParams({ sk })
  const res = await fetch(`${apiBase}/mail/message?${qs.toString()}`, {
    ...noCache,
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t || `HTTP ${res.status}`)
  }
}

export async function fetchMailBody(
  apiBase: string,
  token: string,
  s3Key: string,
): Promise<{ body: string; isHtml: boolean }> {
  const qs = new URLSearchParams({ s3_key: s3Key })
  const res = await fetch(`${apiBase}/mail/content?${qs.toString()}`, {
    ...noCache,
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t || `HTTP ${res.status}`)
  }
  const data = (await res.json()) as { body: string; isHtml: boolean }
  return data
}

export function mailApiConfigured(): boolean {
  const v = import.meta.env.VITE_MAIL_API_URL
  return typeof v === 'string' && v.trim() !== ''
}

export function mailApiBaseUrl(): string {
  return (import.meta.env.VITE_MAIL_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''
}
