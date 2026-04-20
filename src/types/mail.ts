/** System mailboxes only; user folders use `custom:${id}`. */
export type SystemFolder = 'inbox' | 'sent' | 'drafts' | 'spam' | 'trash'

/** Stored folder for a message (not virtual). */
export type MailFolder = SystemFolder | `custom:${string}`

/** Sidebar selection includes virtual Starred. */
export type NavFolder = MailFolder | 'starred'

export interface UserFolder {
  id: string
  name: string
}

export interface MailContact {
  name: string
  email: string
}

export interface MailAttachment {
  name: string
  /** MIME type if known (for open behavior). */
  contentType?: string
  /** Base64 payload from API; only for inbound message attachment open/download. */
  contentBase64?: string
  /** Approximate size for display, bytes */
  size?: number
}

/** MIME parts with Content-ID (for <img src="cid:...">); loaded with full message body. */
export interface InlineImagePart {
  cid: string
  contentType: string
  contentBase64: string
}

export interface MailMessage {
  id: string
  folder: MailFolder
  from: MailContact
  to: MailContact[]
  cc?: MailContact[]
  bcc?: MailContact[]
  subject: string
  snippet: string
  body: string
  /** When set, preferred over guessing HTML from body text (live API). */
  bodyIsHtml?: boolean
  sentAt: string
  read: boolean
  starred: boolean
  hasAttachment?: boolean
  attachments?: MailAttachment[]
  labels?: string[]
  /** S3 object key for archived .eml (live mailbox API) */
  s3Key?: string
  /** CID inline images from raw .eml (shown only after user trusts sender / chooses “show images”) */
  inlineImages?: InlineImagePart[]
}

export function customFolderKey(userFolderId: string): `custom:${string}` {
  return `custom:${userFolderId}`
}
