import type { MailFolder, MailContact, MailMessage } from '../types/mail'

const noCache: RequestInit = { cache: 'no-store' }

function guessMimeFromFilename(name: string, declared: string): string {
  if (declared) return declared
  const n = name.toLowerCase()
  if (n.endsWith('.pdf')) return 'application/pdf'
  if (n.endsWith('.png')) return 'image/png'
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg'
  if (n.endsWith('.gif')) return 'image/gif'
  if (n.endsWith('.webp')) return 'image/webp'
  return 'application/octet-stream'
}

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

export async function fetchLiveMailbox(
  apiBase: string,
  token: string,
  userFolders: { id: string }[],
): Promise<MailMessage[]> {
  const sys: MailFolder[] = ['inbox', 'sent', 'drafts', 'spam', 'trash']
  const customs: MailFolder[] = userFolders.map((f) => `custom:${f.id}` as MailFolder)
  const folders = [...sys, ...customs]
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

export async function fetchUserFolders(apiBase: string, token: string): Promise<{ id: string; name: string }[]> {
  const res = await fetch(`${apiBase}/mail/user-folders`, {
    ...noCache,
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t || `HTTP ${res.status}`)
  }
  const data = (await res.json()) as { folders: { id: string; name: string }[] }
  return data.folders ?? []
}

export async function createUserFolderApi(
  apiBase: string,
  token: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const res = await fetch(`${apiBase}/mail/user-folders`, {
    ...noCache,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t || `HTTP ${res.status}`)
  }
  return (await res.json()) as { id: string; name: string }
}

export async function deleteUserFolderApi(apiBase: string, token: string, folderId: string): Promise<void> {
  const res = await fetch(`${apiBase}/mail/user-folders/${encodeURIComponent(folderId)}`, {
    ...noCache,
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t || `HTTP ${res.status}`)
  }
}

/** Move message to a system folder or `custom:<uuid>`. */
export async function moveMailMessage(apiBase: string, token: string, sk: string, folder: string): Promise<void> {
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

export type OutboundAttachment = {
  filename: string
  contentType: string
  contentBase64: string
}

/** Base64-encode files for JSON POST to `/mail/send` (watch Lambda ~6MB payload limit). */
export async function encodeFilesForMail(files: File[]): Promise<OutboundAttachment[]> {
  return Promise.all(
    files.map(
      (f) =>
        new Promise<OutboundAttachment>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => {
            const s = r.result as string
            const i = s.indexOf(',')
            resolve({
              filename: f.name,
              contentType: guessMimeFromFilename(f.name, f.type),
              contentBase64: i >= 0 ? s.slice(i + 1) : s,
            })
          }
          r.onerror = () => reject(r.error ?? new Error('read failed'))
          r.readAsDataURL(f)
        }),
    ),
  )
}

export async function sendMailMessage(
  apiBase: string,
  token: string,
  payload: {
    to: string
    cc?: string
    bcc?: string
    subject: string
    body: string
    attachments?: OutboundAttachment[]
  },
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

export async function markMailMessagesReadState(
  apiBase: string,
  token: string,
  sks: string[],
  read: boolean,
): Promise<void> {
  const uniq = [...new Set(sks.filter(Boolean))]
  if (uniq.length === 0) return
  const res = await fetch(`${apiBase}/mail/messages/read`, {
    ...noCache,
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sks: uniq, read }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t || `HTTP ${res.status}`)
  }
}

export type MailContentPayload = {
  body: string
  isHtml: boolean
  attachments?: { name: string }[]
  inlineImages?: { cid: string; contentType: string; contentBase64: string }[]
  from?: MailContact | null
  to?: MailContact[]
  cc?: MailContact[]
  bcc?: MailContact[]
}

export async function fetchMailBody(apiBase: string, token: string, s3Key: string): Promise<MailContentPayload> {
  const qs = new URLSearchParams({ s3_key: s3Key })
  const res = await fetch(`${apiBase}/mail/content?${qs.toString()}`, {
    ...noCache,
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t || `HTTP ${res.status}`)
  }
  return (await res.json()) as MailContentPayload
}

export function mailApiConfigured(): boolean {
  const v = import.meta.env.VITE_MAIL_API_URL
  return typeof v === 'string' && v.trim() !== ''
}

export function mailApiBaseUrl(): string {
  return (import.meta.env.VITE_MAIL_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''
}
