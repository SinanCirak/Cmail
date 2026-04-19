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
  /** Approximate size for display, bytes */
  size?: number
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
}

export function customFolderKey(userFolderId: string): `custom:${string}` {
  return `custom:${userFolderId}`
}
