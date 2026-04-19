import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { getBearerTokenForApi, getSession } from '../auth/cognito'
import { mockEmails } from '../data/mockEmails'
import {
  createUserFolderApi,
  deleteMailMessage,
  deleteUserFolderApi,
  fetchLiveMailbox,
  fetchMailBody,
  fetchUserFolders,
  mailApiBaseUrl,
  mailApiConfigured,
  encodeFilesForMail,
  moveMailMessage,
  sendMailMessage,
} from '../mail/mailApi'
import type { MailFolder, MailMessage, NavFolder, UserFolder } from '../types/mail'
import { customFolderKey } from '../types/mail'
import { EmailHtmlIframe } from './EmailHtmlIframe'

const ComposeRichEditor = lazy(() =>
  import('./ComposeRichEditor').then((m) => ({ default: m.ComposeRichEditor })),
)

import {
  IconArchive,
  IconChevronLeft,
  IconClose,
  IconCompose,
  IconDraft,
  IconFolder,
  IconFolderPlus,
  IconForward,
  IconInbox,
  IconMenu,
  IconMoon,
  IconMove,
  IconPaperclip,
  IconReply,
  IconRefresh,
  IconSearch,
  IconSend,
  IconSettings,
  IconSpam,
  IconStar,
  IconSun,
  IconTrash,
} from './icons'
import './MailDashboard.css'

const SYSTEM_NAV: { id: NavFolder; label: string; icon: typeof IconInbox }[] = [
  { id: 'inbox', label: 'Inbox', icon: IconInbox },
  { id: 'starred', label: 'Starred', icon: IconStar },
  { id: 'sent', label: 'Sent', icon: IconSend },
  { id: 'drafts', label: 'Drafts', icon: IconDraft },
  { id: 'spam', label: 'Spam', icon: IconSpam },
  { id: 'trash', label: 'Trash', icon: IconTrash },
]

const STORAGE_FOLDERS = 'cmail-user-folders'
const STORAGE_THEME = 'cmail-theme'
const STORAGE_SPLIT = 'cmail-split-list-width'
const STORAGE_TRUSTED_IMAGE_DOMAINS = 'cmail-trusted-image-domains'
const STORAGE_READ_PREFIX = 'cmail-read-ids:'
const LIVE_MAIL_POLL_MS = 8000

function readTrustedImageDomains(): Set<string> {
  try {
    const s = localStorage.getItem(STORAGE_TRUSTED_IMAGE_DOMAINS)
    const a = s ? JSON.parse(s) : []
    if (!Array.isArray(a)) return new Set()
    return new Set(a.map((x) => String(x).toLowerCase()).filter(Boolean))
  } catch {
    return new Set()
  }
}

function emailDomainFromAddress(addr: string): string {
  const i = addr.lastIndexOf('@')
  if (i < 0) return ''
  return addr.slice(i + 1).trim().toLowerCase()
}

type SettingsTab = 'account' | 'security' | 'appearance' | 'privacy'

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function loadSplitWidth(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_SPLIT)
    if (!raw) return null
    const v = Number(raw)
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

function saveSplitWidth(v: number) {
  try {
    localStorage.setItem(STORAGE_SPLIT, String(v))
  } catch {
    /* ignore */
  }
}

function SettingsModal(props: {
  open: boolean
  onClose: () => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  primaryEmail: string | null
  trustedDomains: string[]
  onRemoveTrustedDomain: (domain: string) => void
  onClearTrustedDomains: () => void
}) {
  const {
    open,
    onClose,
    theme,
    onToggleTheme,
    primaryEmail,
    trustedDomains,
    onRemoveTrustedDomain,
    onClearTrustedDomains,
  } = props
  const [tab, setTab] = useState<SettingsTab>('account')
  const [displayName, setDisplayName] = useState('')

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwStatus, setPwStatus] = useState<'idle' | 'error' | 'success'>('idle')
  const [pwMsg, setPwMsg] = useState('')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    setPwStatus('idle')
    setPwMsg('')
    setCurrentPw('')
    setNewPw('')
    setConfirmPw('')
  }, [open, tab])

  const submitPassword = useCallback(() => {
    const cur = currentPw.trim()
    const np = newPw.trim()
    const cp = confirmPw.trim()
    if (!cur || !np || !cp) {
      setPwStatus('error')
      setPwMsg('Please fill all password fields.')
      return
    }
    if (np.length < 8) {
      setPwStatus('error')
      setPwMsg('New password must be at least 8 characters.')
      return
    }
    if (np !== cp) {
      setPwStatus('error')
      setPwMsg('New password and confirmation do not match.')
      return
    }
    setPwStatus('success')
    setPwMsg('Password updated (demo). Wire this to your auth API.')
  }, [currentPw, newPw, confirmPw])

  if (!open) return null

  return (
    <div className="cm-modal" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="cm-modal__panel">
        <div className="cm-modal__head">
          <div className="cm-modal__title-wrap">
            <h2 className="cm-modal__title">Settings</h2>
            <p className="cm-modal__subtitle">Account, password, privacy, and display</p>
          </div>
          <button type="button" className="cm-icon-btn" aria-label="Close settings" onClick={onClose}>
            <IconClose className="cm-icon" />
          </button>
        </div>

        <div className="cm-modal__body">
          <div className="cm-tabs" role="tablist" aria-label="Settings sections">
            <button
              type="button"
              className={`cm-tab ${tab === 'account' ? 'cm-tab--active' : ''}`}
              role="tab"
              aria-selected={tab === 'account'}
              onClick={() => setTab('account')}
            >
              Account
            </button>
            <button
              type="button"
              className={`cm-tab ${tab === 'security' ? 'cm-tab--active' : ''}`}
              role="tab"
              aria-selected={tab === 'security'}
              onClick={() => setTab('security')}
            >
              Security
            </button>
            <button
              type="button"
              className={`cm-tab ${tab === 'appearance' ? 'cm-tab--active' : ''}`}
              role="tab"
              aria-selected={tab === 'appearance'}
              onClick={() => setTab('appearance')}
            >
              Appearance
            </button>
            <button
              type="button"
              className={`cm-tab ${tab === 'privacy' ? 'cm-tab--active' : ''}`}
              role="tab"
              aria-selected={tab === 'privacy'}
              onClick={() => setTab('privacy')}
            >
              Privacy
            </button>
          </div>

          {tab === 'account' ? (
            <div className="cm-settings">
              <div className="cm-settings__section">
                <h3 className="cm-settings__h">Profile</h3>
                <div className="cm-settings__grid">
                  <label className="cm-field">
                    <span className="cm-field__label">Display name</span>
                    <input
                      className="cm-field__input"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Your name"
                      autoComplete="name"
                    />
                  </label>
                  <label className="cm-field">
                    <span className="cm-field__label">Email</span>
                    <input
                      className="cm-field__input"
                      readOnly
                      value={primaryEmail ?? ''}
                      placeholder="Sign in to see your email"
                    />
                  </label>
                </div>
                <p className="cm-settings__note">
                  Email comes from your sign-in session. Display name is stored only in this browser until profiles
                  are wired to your directory.
                </p>
              </div>
            </div>
          ) : null}

          {tab === 'security' ? (
            <div className="cm-settings">
              <div className="cm-settings__section">
                <h3 className="cm-settings__h">Change password</h3>
                <div className="cm-settings__grid">
                  <label className="cm-field">
                    <span className="cm-field__label">Current password</span>
                    <input
                      className="cm-field__input"
                      type="password"
                      value={currentPw}
                      onChange={(e) => setCurrentPw(e.target.value)}
                      autoComplete="current-password"
                    />
                  </label>
                  <div />
                  <label className="cm-field">
                    <span className="cm-field__label">New password</span>
                    <input
                      className="cm-field__input"
                      type="password"
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      autoComplete="new-password"
                    />
                  </label>
                  <label className="cm-field">
                    <span className="cm-field__label">Confirm new password</span>
                    <input
                      className="cm-field__input"
                      type="password"
                      value={confirmPw}
                      onChange={(e) => setConfirmPw(e.target.value)}
                      autoComplete="new-password"
                    />
                  </label>
                </div>
                {pwStatus !== 'idle' ? (
                  <div className={`cm-alert ${pwStatus === 'success' ? 'cm-alert--ok' : 'cm-alert--err'}`} role="status">
                    {pwMsg}
                  </div>
                ) : null}
                <div className="cm-settings__actions">
                  <button type="button" className="cm-btn cm-btn--primary" onClick={submitPassword}>
                    Update password
                  </button>
                  <button
                    type="button"
                    className="cm-btn cm-btn--ghost"
                    onClick={() => {
                      setCurrentPw('')
                      setNewPw('')
                      setConfirmPw('')
                      setPwStatus('idle')
                      setPwMsg('')
                    }}
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'appearance' ? (
            <div className="cm-settings">
              <div className="cm-settings__section">
                <h3 className="cm-settings__h">Theme</h3>
                <div className="cm-settings__row">
                  <div>
                    <p className="cm-settings__k">Color mode</p>
                    <p className="cm-settings__v">{theme === 'dark' ? 'Dark' : 'Light'}</p>
                  </div>
                  <button type="button" className="cm-btn cm-btn--primary" onClick={onToggleTheme}>
                    Toggle theme
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {tab === 'privacy' ? (
            <div className="cm-settings">
              <div className="cm-settings__section">
                <h3 className="cm-settings__h">Embedded images</h3>
                <p className="cm-settings__note">
                  Mail bodies can reference inline (CID) images. Those bytes stay on our servers until you choose to
                  render them. Domains you approve load logos and signatures automatically next time.
                </p>
                {trustedDomains.length === 0 ? (
                  <p className="cm-settings__v">No domains are trusted yet. Use “Always show from @domain” when
                    reading a message.</p>
                ) : (
                  <ul className="cm-trusted-domains">
                    {trustedDomains.map((d) => (
                      <li key={d} className="cm-trusted-domains__row">
                        <span className="cm-trusted-domains__domain">@{d}</span>
                        <button
                          type="button"
                          className="cm-btn cm-btn--ghost cm-btn--sm"
                          onClick={() => onRemoveTrustedDomain(d)}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {trustedDomains.length > 0 ? (
                  <div className="cm-settings__actions">
                    <button type="button" className="cm-btn cm-btn--ghost" onClick={() => onClearTrustedDomains()}>
                      Clear all trusted domains
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <button type="button" className="cm-modal__scrim" aria-label="Close settings" onClick={onClose} />
    </div>
  )
}

function loadUserFolders(): UserFolder[] {
  try {
    const raw = localStorage.getItem(STORAGE_FOLDERS)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (x): x is UserFolder =>
        x && typeof x === 'object' && typeof (x as UserFolder).id === 'string' && typeof (x as UserFolder).name === 'string',
    )
  } catch {
    return []
  }
}

function formatListTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  }
  const diff = now.getTime() - d.getTime()
  if (diff < 7 * 86400000) {
    return d.toLocaleDateString(undefined, { weekday: 'short' })
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatFullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatBytes(n?: number): string {
  if (n == null || Number.isNaN(n)) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function filterByFolder(emails: MailMessage[], folder: NavFolder): MailMessage[] {
  if (folder === 'starred') {
    return emails.filter((m) => m.starred && m.folder !== 'spam' && m.folder !== 'trash')
  }
  return emails.filter((m) => m.folder === folder)
}

function looksLikeHtmlBody(body: string, explicit?: boolean): boolean {
  if (explicit === true) return true
  const t = body.replace(/^\ufeff/, '').trim()
  // Many newsletters / SES pipes ship HTML with text/plain or wrong flags — still detect markup
  if (
    t.startsWith('<') &&
    (/<\/[a-z][a-z0-9.-]*\s*>/i.test(t) || /<(p|div|span|table|html|body|ul|ol|li|a|br)\b/i.test(t))
  ) {
    return true
  }
  if (explicit === false) return false
  if (!t.startsWith('<')) return false
  return /<\/(p|div|h[1-6]|ul|ol|li|br|span)\s*>/i.test(t) || /<p[\s>]/.test(t)
}

function stripHtml(html: string): string {
  if (typeof window === 'undefined') return html.replace(/<[^>]+>/g, ' ')
  const d = document.createElement('div')
  d.innerHTML = html
  return (d.innerText || d.textContent || '').trim()
}

function emailFromIdToken(): string | null {
  const s = getSession()
  if (!s?.idToken) return null
  try {
    const p = JSON.parse(atob(s.idToken.split('.')[1])) as Record<string, unknown>
    const tryStr = (k: string) => {
      const v = p[k]
      return typeof v === 'string' && v.includes('@') ? v.trim() : null
    }
    return tryStr('email') ?? tryStr('preferred_username') ?? tryStr('cognito:username')
  } catch {
    return null
  }
}

function readReadIds(mailboxEmail: string | null): Set<string> {
  if (!mailboxEmail) return new Set()
  try {
    const raw = localStorage.getItem(`${STORAGE_READ_PREFIX}${mailboxEmail.toLowerCase()}`)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((x): x is string => typeof x === 'string' && x.length > 0))
  } catch {
    return new Set()
  }
}

function saveReadIds(mailboxEmail: string | null, ids: Set<string>) {
  if (!mailboxEmail) return
  try {
    localStorage.setItem(`${STORAGE_READ_PREFIX}${mailboxEmail.toLowerCase()}`, JSON.stringify([...ids]))
  } catch {
    /* ignore */
  }
}

function filterBySearch(emails: MailMessage[], q: string): MailMessage[] {
  const s = q.trim().toLowerCase()
  if (!s) return emails
  return emails.filter((m) => {
    const hay = [
      m.subject,
      m.snippet,
      m.from.name,
      m.from.email,
      ...(m.labels ?? []),
    ]
      .join(' ')
      .toLowerCase()
    return hay.includes(s)
  })
}

export function MailDashboard({ onLogout }: { onLogout?: () => void }) {
  const useLiveMail = mailApiConfigured()
  const mailApiBase = mailApiBaseUrl()
  const fetchedBodyIds = useRef<Set<string>>(new Set())
  const mailboxEmail = (emailFromIdToken() ?? '').toLowerCase() || null

  const [emails, setEmails] = useState<MailMessage[]>(() =>
    mailApiConfigured() ? [] : [...mockEmails],
  )
  const [mailLoading, setMailLoading] = useState(false)
  const [mailLoadError, setMailLoadError] = useState<string | null>(null)
  const [contentBusyId, setContentBusyId] = useState<string | null>(null)
  const [userFolders, setUserFolders] = useState<UserFolder[]>(loadUserFolders)
  const [folder, setFolder] = useState<NavFolder>('inbox')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [composeOpen, setComposeOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [mobileShowDetail, setMobileShowDetail] = useState(false)
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(() => new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)

  const panesRef = useRef<HTMLElement | null>(null)
  const selectAllCheckboxRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{ active: boolean; startX: number; startW: number }>({
    active: false,
    startX: 0,
    startW: 0,
  })
  const [listWidth, setListWidth] = useState<number>(() => loadSplitWidth() ?? 360)

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_THEME) as 'light' | 'dark' | null
      if (raw === 'light' || raw === 'dark') return raw
    } catch {
      /* ignore */
    }
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  })

  const [composeTo, setComposeTo] = useState('')
  const [composeCc, setComposeCc] = useState('')
  const [composeBcc, setComposeBcc] = useState('')
  const [composeSubject, setComposeSubject] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [composeShowCcBcc, setComposeShowCcBcc] = useState(false)
  const [composeFiles, setComposeFiles] = useState<File[]>([])
  const [composeSending, setComposeSending] = useState(false)
  const [composeError, setComposeError] = useState<string | null>(null)

  const [trustedImageDomains, setTrustedImageDomains] = useState(() => readTrustedImageDomains())
  const [showImagesSessionIds, setShowImagesSessionIds] = useState<Set<string>>(() => new Set())

  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [readMessageIds, setReadMessageIds] = useState<Set<string>>(() => readReadIds(mailboxEmail))
  const readMessageIdsRef = useRef<Set<string>>(readMessageIds)

  useEffect(() => {
    setReadMessageIds(readReadIds(mailboxEmail))
  }, [mailboxEmail])

  useEffect(() => {
    readMessageIdsRef.current = readMessageIds
    saveReadIds(mailboxEmail, readMessageIds)
  }, [mailboxEmail, readMessageIds])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_THEME, theme)
    } catch {
      /* ignore */
    }
    document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : 'light'
  }, [theme])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_FOLDERS, JSON.stringify(userFolders))
    } catch {
      /* ignore */
    }
  }, [userFolders])

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  useEffect(() => {
    saveSplitWidth(listWidth)
  }, [listWidth])

  const beginResize = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    const el = panesRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const max = Math.max(420, rect.width - 360)
    dragRef.current = { active: true, startX: e.clientX, startW: listWidth }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current.active) return
      const dx = ev.clientX - dragRef.current.startX
      const next = clamp(dragRef.current.startW + dx, 280, max)
      setListWidth(next)
    }
    const onUp = () => {
      dragRef.current.active = false
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  }, [listWidth])

  const counts = useMemo(() => {
    const c: Record<string, number> = { starred: 0 }
    for (const m of emails) {
      c[m.folder] = (c[m.folder] ?? 0) + 1
      if (m.starred && m.folder !== 'spam' && m.folder !== 'trash') {
        c.starred += 1
      }
    }
    return c
  }, [emails])

  const listEmails = useMemo(() => {
    const byFolder = filterByFolder(emails, folder)
    return filterBySearch(byFolder, search).sort(
      (a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime(),
    )
  }, [emails, folder, search])

  const selected = useMemo(
    () => emails.find((m) => m.id === selectedId) ?? null,
    [emails, selectedId],
  )

  const toolbarTargetIds = useMemo(() => {
    if (bulkSelectedIds.size > 0) return [...bulkSelectedIds]
    if (selectedId) return [selectedId]
    return []
  }, [bulkSelectedIds, selectedId])

  const allBulkSelected =
    listEmails.length > 0 && listEmails.every((m) => bulkSelectedIds.has(m.id))
  const someBulkSelected = listEmails.some((m) => bulkSelectedIds.has(m.id))

  const allowInlineImages = useMemo(() => {
    if (!selected?.inlineImages?.length) return true
    if (showImagesSessionIds.has(selected.id)) return true
    const d = emailDomainFromAddress(selected.from.email)
    if (d && trustedImageDomains.has(d)) return true
    return false
  }, [selected, showImagesSessionIds, trustedImageDomains])

  const trustSenderImagesDomain = useCallback(() => {
    const d = selected ? emailDomainFromAddress(selected.from.email) : ''
    if (!d) return
    setTrustedImageDomains((prev) => {
      if (prev.has(d)) return prev
      const n = new Set(prev)
      n.add(d)
      try {
        localStorage.setItem(STORAGE_TRUSTED_IMAGE_DOMAINS, JSON.stringify([...n]))
      } catch {
        /* ignore */
      }
      return n
    })
  }, [selected])

  const showEmbeddedImagesOnce = useCallback(() => {
    if (!selected) return
    setShowImagesSessionIds((prev) => {
      const n = new Set(prev)
      n.add(selected.id)
      return n
    })
  }, [selected])

  const removeTrustedDomain = useCallback((domain: string) => {
    const d = domain.trim().toLowerCase()
    if (!d) return
    setTrustedImageDomains((prev) => {
      const n = new Set(prev)
      n.delete(d)
      try {
        localStorage.setItem(STORAGE_TRUSTED_IMAGE_DOMAINS, JSON.stringify([...n]))
      } catch {
        /* ignore */
      }
      return n
    })
  }, [])

  const clearTrustedDomains = useCallback(() => {
    setTrustedImageDomains(new Set())
    try {
      localStorage.removeItem(STORAGE_TRUSTED_IMAGE_DOMAINS)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    setSelectedId((prev) => {
      if (listEmails.length === 0) return null
      if (prev && listEmails.some((m) => m.id === prev)) return prev
      return listEmails[0].id
    })
  }, [listEmails])

  useEffect(() => {
    const el = selectAllCheckboxRef.current
    if (!el) return
    el.indeterminate = someBulkSelected && !allBulkSelected
  }, [someBulkSelected, allBulkSelected])

  useEffect(() => {
    setBulkSelectedIds(new Set())
  }, [search])

  useEffect(() => {
    setMobileShowDetail(false)
    setBulkSelectedIds(new Set())
  }, [folder])

  useEffect(() => {
    if (!sidebarOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sidebarOpen])

  useEffect(() => {
    if (!sidebarOpen) {
      document.body.style.overflow = ''
      return
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [sidebarOpen])

  const toggleStar = useCallback((id: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    setEmails((prev) =>
      prev.map((m) => (m.id === id ? { ...m, starred: !m.starred } : m)),
    )
  }, [])

  const toggleSelectAll = useCallback(() => {
    setBulkSelectedIds((prev) => {
      const ids = listEmails.map((m) => m.id)
      if (ids.length === 0) return new Set()
      const allOn = ids.every((id) => prev.has(id))
      if (allOn) return new Set()
      return new Set(ids)
    })
  }, [listEmails])

  const toggleBulkRow = useCallback((id: string) => {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const openMail = useCallback((id: string) => {
    setBulkSelectedIds(new Set())
    setSelectedId(id)
    setReadMessageIds((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      return next
    })
    setEmails((prev) =>
      prev.map((m) => (m.id === id ? { ...m, read: true } : m)),
    )
    setMobileShowDetail(true)
  }, [])

  const loadLiveMailbox = useCallback(async (opts?: { silent?: boolean }) => {
    if (!useLiveMail || !mailApiBase) return
    const silent = opts?.silent === true
    const session = getSession()
    if (!session) {
      setMailLoadError('Sign in to load your mail from the archive.')
      return
    }
    if (!silent) {
      setMailLoading(true)
      setMailLoadError(null)
    }
    try {
      const token = getBearerTokenForApi(session)
      const folders = await fetchUserFolders(mailApiBase, token)
      setUserFolders(folders)
      const list = await fetchLiveMailbox(mailApiBase, token, folders)
      const readSet = readMessageIdsRef.current
      setEmails((prev) => {
        const prevById = new Map(prev.map((m) => [m.id, m]))
        return list.map((m) => {
          const old = prevById.get(m.id)
          const read = m.folder === 'inbox' ? (old?.read ?? false) || readSet.has(m.id) : true
          return {
            ...m,
            read,
            body: old?.body ?? m.body,
            bodyIsHtml: old?.bodyIsHtml ?? m.bodyIsHtml,
            to: old?.to?.length ? old.to : m.to,
            cc: old?.cc?.length ? old.cc : m.cc,
            bcc: old?.bcc?.length ? old.bcc : m.bcc,
            attachments: old?.attachments?.length ? old.attachments : m.attachments,
            inlineImages: old?.inlineImages?.length ? old.inlineImages : m.inlineImages,
            starred: old?.starred ?? m.starred,
          }
        })
      })
    } catch (e) {
      if (!silent) {
        setMailLoadError(e instanceof Error ? e.message : 'Could not load mail.')
      }
    } finally {
      if (!silent) {
        setMailLoading(false)
      }
    }
  }, [useLiveMail, mailApiBase])

  useEffect(() => {
    if (!useLiveMail) return
    void loadLiveMailbox()
  }, [useLiveMail, loadLiveMailbox])

  useEffect(() => {
    if (!useLiveMail || !mailApiBase) return

    let running = false
    const tick = async () => {
      if (running) return
      if (document.hidden) return
      if (!getSession()) return
      running = true
      try {
        await loadLiveMailbox({ silent: true })
      } finally {
        running = false
      }
    }

    const intervalId = window.setInterval(() => {
      void tick()
    }, LIVE_MAIL_POLL_MS)

    const onFocus = () => {
      void tick()
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [useLiveMail, mailApiBase, loadLiveMailbox])

  useEffect(() => {
    if (!useLiveMail || !mailApiBase || !selected?.s3Key) return
    if (fetchedBodyIds.current.has(selected.id)) return

    const session = getSession()
    if (!session) return

    const id = selected.id
    const key = selected.s3Key
    let cancelled = false
    setContentBusyId(id)

    ;(async () => {
      try {
        const payload = await fetchMailBody(mailApiBase, getBearerTokenForApi(session), key)
        if (cancelled) return
        fetchedBodyIds.current.add(id)
        const atts = payload.attachments?.map((a) => ({ name: a.name }))
        setEmails((prev) =>
          prev.map((m) =>
            m.id === id
              ? {
                  ...m,
                  body: payload.body,
                  bodyIsHtml: payload.isHtml,
                  to: payload.to?.length ? payload.to : m.to,
                  cc: payload.cc?.length ? payload.cc : m.cc,
                  bcc: payload.bcc?.length ? payload.bcc : m.bcc,
                  from: payload.from ?? m.from,
                  attachments:
                    atts && atts.length > 0 ? atts : m.attachments,
                  inlineImages: payload.inlineImages?.length ? payload.inlineImages : undefined,
                }
              : m,
          ),
        )
      } catch (e) {
        if (cancelled) return
        fetchedBodyIds.current.add(id)
        const msg = e instanceof Error ? e.message : 'Error'
        setEmails((prev) =>
          prev.map((m) =>
            m.id === id ? { ...m, body: `Could not load message body: ${msg}` } : m,
          ),
        )
      } finally {
        if (!cancelled) {
          setContentBusyId((cur) => (cur === id ? null : cur))
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [useLiveMail, mailApiBase, selected?.id, selected?.s3Key])

  const goBackMobile = useCallback(() => {
    setMobileShowDetail(false)
  }, [])

  const unreadInInbox = useMemo(
    () => emails.filter((m) => m.folder === 'inbox' && !m.read).length,
    [emails],
  )

  const moveMessage = useCallback(
    async (messageId: string, target: MailFolder) => {
      if (useLiveMail && mailApiBase) {
        const session = getSession()
        if (!session) return
        try {
          await moveMailMessage(mailApiBase, getBearerTokenForApi(session), messageId, target)
          await loadLiveMailbox()
        } catch (e) {
          setMailLoadError(e instanceof Error ? e.message : 'Move failed')
        }
        return
      }
      setEmails((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, folder: target } : m)),
      )
    },
    [useLiveMail, mailApiBase, loadLiveMailbox],
  )

  /** Trash on server when live; otherwise local state only. */
  const deleteOrTrashMessage = useCallback(
    async (messageId: string) => {
      const msg = emails.find((m) => m.id === messageId)
      if (!msg) return
      if (useLiveMail && mailApiBase) {
        const session = getSession()
        if (!session) return
        try {
          if (msg.folder === 'trash') {
            await deleteMailMessage(mailApiBase, getBearerTokenForApi(session), messageId)
          } else {
            await moveMailMessage(mailApiBase, getBearerTokenForApi(session), messageId, 'trash')
          }
          await loadLiveMailbox()
        } catch (e) {
          setMailLoadError(e instanceof Error ? e.message : 'Delete failed')
        }
        return
      }
      setEmails((prev) => {
        const m = prev.find((x) => x.id === messageId)
        if (!m) return prev
        if (m.folder === 'trash') {
          return prev.filter((x) => x.id !== messageId)
        }
        return prev.map((x) => (x.id === messageId ? { ...x, folder: 'trash' as const } : x))
      })
    },
    [emails, useLiveMail, mailApiBase, loadLiveMailbox],
  )

  /** Inbox-only triage: move to Trash (until a real Archive folder/API exists). */
  const archiveFromInbox = useCallback(
    async (messageId: string) => {
      const msg = emails.find((m) => m.id === messageId)
      if (!msg || msg.folder !== 'inbox') return
      if (useLiveMail && mailApiBase) {
        const session = getSession()
        if (!session) return
        try {
          await moveMailMessage(mailApiBase, getBearerTokenForApi(session), messageId, 'trash')
          await loadLiveMailbox()
        } catch (e) {
          setMailLoadError(e instanceof Error ? e.message : 'Archive failed')
        }
        return
      }
      setEmails((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, folder: 'trash' as const } : m)),
      )
    },
    [emails, useLiveMail, mailApiBase, loadLiveMailbox],
  )

  const archiveToolbar = useCallback(async () => {
    const inboxIds = toolbarTargetIds.filter((id) => emails.find((m) => m.id === id)?.folder === 'inbox')
    if (inboxIds.length === 0) return
    if (useLiveMail && mailApiBase) {
      const session = getSession()
      if (!session) return
      try {
        const token = getBearerTokenForApi(session)
        await Promise.all(inboxIds.map((id) => moveMailMessage(mailApiBase, token, id, 'trash')))
        await loadLiveMailbox()
      } catch (e) {
        setMailLoadError(e instanceof Error ? e.message : 'Archive failed')
      }
      setBulkSelectedIds(new Set())
      return
    }
    setEmails((prev) =>
      prev.map((m) => (inboxIds.includes(m.id) ? { ...m, folder: 'trash' as const } : m)),
    )
    setBulkSelectedIds(new Set())
  }, [toolbarTargetIds, emails, useLiveMail, mailApiBase, loadLiveMailbox])

  const deleteToolbar = useCallback(async () => {
    const ids = toolbarTargetIds
    if (ids.length === 0) return
    if (useLiveMail && mailApiBase) {
      const session = getSession()
      if (!session) return
      try {
        const token = getBearerTokenForApi(session)
        await Promise.all(
          ids.map(async (id) => {
            const msg = emails.find((m) => m.id === id)
            if (!msg) return
            if (msg.folder === 'trash') {
              await deleteMailMessage(mailApiBase, token, id)
            } else {
              await moveMailMessage(mailApiBase, token, id, 'trash')
            }
          }),
        )
        await loadLiveMailbox()
      } catch (e) {
        setMailLoadError(e instanceof Error ? e.message : 'Delete failed')
      }
      setBulkSelectedIds(new Set())
      return
    }
    setEmails((prev) => {
      const idSet = new Set(ids)
      const afterPerm = prev.filter((m) => !(m.folder === 'trash' && idSet.has(m.id)))
      return afterPerm.map((m) =>
        idSet.has(m.id) && m.folder !== 'trash' ? { ...m, folder: 'trash' as const } : m,
      )
    })
    setBulkSelectedIds(new Set())
  }, [toolbarTargetIds, emails, useLiveMail, mailApiBase, loadLiveMailbox])

  const moveToolbar = useCallback(
    async (target: MailFolder) => {
      const ids = toolbarTargetIds
      if (ids.length === 0) return
      if (useLiveMail && mailApiBase) {
        const session = getSession()
        if (!session) return
        try {
          const token = getBearerTokenForApi(session)
          await Promise.all(ids.map((id) => moveMailMessage(mailApiBase, token, id, target)))
          await loadLiveMailbox()
        } catch (e) {
          setMailLoadError(e instanceof Error ? e.message : 'Move failed')
        }
        setBulkSelectedIds(new Set())
        return
      }
      setEmails((prev) => prev.map((m) => (ids.includes(m.id) ? { ...m, folder: target } : m)))
      setBulkSelectedIds(new Set())
    },
    [toolbarTargetIds, useLiveMail, mailApiBase, loadLiveMailbox],
  )

  const moveTargets = useMemo(() => {
    const sys: { value: MailFolder; label: string }[] = [
      { value: 'inbox', label: 'Inbox' },
      { value: 'sent', label: 'Sent' },
      { value: 'drafts', label: 'Drafts' },
      { value: 'spam', label: 'Spam' },
      { value: 'trash', label: 'Trash' },
    ]
    const custom = userFolders.map((uf) => ({
      value: customFolderKey(uf.id),
      label: uf.name,
    }))
    return [...sys, ...custom]
  }, [userFolders])

  const createFolderQuick = useCallback(async () => {
    const name = newFolderName.trim()
    if (!name) return
    if (useLiveMail && mailApiBase) {
      const session = getSession()
      if (!session) return
      try {
        const created = await createUserFolderApi(mailApiBase, getBearerTokenForApi(session), name)
        setNewFolderName('')
        setNewFolderOpen(false)
        setSidebarOpen(false)
        await loadLiveMailbox()
        setFolder(customFolderKey(created.id))
      } catch (e) {
        setMailLoadError(e instanceof Error ? e.message : 'Could not create folder')
      }
      return
    }
    const id = crypto.randomUUID()
    setUserFolders((prev) => [...prev, { id, name }])
    setFolder(customFolderKey(id))
    setNewFolderName('')
    setNewFolderOpen(false)
    setSidebarOpen(false)
  }, [newFolderName, useLiveMail, mailApiBase, loadLiveMailbox])

  const deleteUserFolder = useCallback(
    async (uf: UserFolder) => {
      const key = customFolderKey(uf.id)
      const n = emails.filter((m) => m.folder === key).length
      const ok = window.confirm(
        n > 0
          ? `Delete folder “${uf.name}” and move ${n} message(s) to Inbox?`
          : `Delete folder “${uf.name}”?`,
      )
      if (!ok) return
      if (useLiveMail && mailApiBase) {
        const session = getSession()
        if (!session) return
        try {
          await deleteUserFolderApi(mailApiBase, getBearerTokenForApi(session), uf.id)
          await loadLiveMailbox()
          if (folder === key) setFolder('inbox')
        } catch (e) {
          setMailLoadError(e instanceof Error ? e.message : 'Could not delete folder')
        }
        return
      }
      setEmails((prev) =>
        prev.map((m) => (m.folder === key ? { ...m, folder: 'inbox' as const } : m)),
      )
      setUserFolders((prev) => prev.filter((f) => f.id !== uf.id))
      if (folder === key) setFolder('inbox')
    },
    [emails, folder, useLiveMail, mailApiBase, loadLiveMailbox],
  )

  const resetCompose = useCallback(() => {
    setComposeTo('')
    setComposeCc('')
    setComposeBcc('')
    setComposeSubject('')
    setComposeBody('')
    setComposeFiles([])
    setComposeShowCcBcc(false)
    setComposeError(null)
    setComposeSending(false)
  }, [])

  const submitCompose = useCallback(async () => {
    const to = composeTo.trim()
    if (!to) {
      setComposeError('Enter at least one recipient.')
      return
    }
    if (!useLiveMail || !mailApiBase) {
      setComposeError('Sending requires the mail API (build with VITE_MAIL_API_URL).')
      return
    }
    const session = getSession()
    if (!session) {
      setComposeError('Sign in to send mail.')
      return
    }
    setComposeSending(true)
    setComposeError(null)
    try {
      const attachments = composeFiles.length ? await encodeFilesForMail(composeFiles) : undefined
      const payload = {
        to,
        cc: composeCc.trim() || undefined,
        bcc: composeBcc.trim() || undefined,
        subject: composeSubject.trim(),
        body: composeBody,
        attachments,
      }
      const approx = new Blob([JSON.stringify(payload)]).size
      if (approx > 5.5 * 1024 * 1024) {
        setComposeError('Message + attachments are too large for one request (keep under ~5MB).')
        setComposeSending(false)
        return
      }
      await sendMailMessage(mailApiBase, getBearerTokenForApi(session), payload)
      setComposeOpen(false)
      resetCompose()
      await loadLiveMailbox()
    } catch (e) {
      setComposeError(e instanceof Error ? e.message : 'Send failed.')
    } finally {
      setComposeSending(false)
    }
  }, [
    composeTo,
    composeCc,
    composeBcc,
    composeSubject,
    composeBody,
    composeFiles,
    useLiveMail,
    mailApiBase,
    resetCompose,
    loadLiveMailbox,
  ])

  const openCompose = useCallback(() => {
    resetCompose()
    setComposeOpen(true)
  }, [resetCompose])

  const openReply = useCallback(() => {
    if (!selected) return
    resetCompose()
    setComposeTo(selected.from.email || '')
    const subj = selected.subject.trim()
    setComposeSubject(subj.toLowerCase().startsWith('re:') ? subj : `Re: ${subj}`)
    const plain = looksLikeHtmlBody(selected.body, selected.bodyIsHtml)
      ? stripHtml(selected.body)
      : selected.body
    setComposeBody(
      `\n\n---\nOn ${formatFullDate(selected.sentAt)}, ${selected.from.name} wrote:\n${plain.slice(0, 8000)}`,
    )
    setComposeOpen(true)
  }, [selected, resetCompose])

  const openForward = useCallback(() => {
    if (!selected) return
    resetCompose()
    setComposeTo('')
    const subj = selected.subject.trim()
    setComposeSubject(subj.toLowerCase().startsWith('fwd:') ? subj : `Fwd: ${subj}`)
    const plain = looksLikeHtmlBody(selected.body, selected.bodyIsHtml)
      ? stripHtml(selected.body)
      : selected.body
    setComposeBody(
      `\n\n---------- Forwarded message ----------\nFrom: ${selected.from.name} <${selected.from.email}>\nDate: ${formatFullDate(selected.sentAt)}\nSubject: ${selected.subject}\n\n${plain.slice(0, 12000)}`,
    )
    setComposeOpen(true)
  }, [selected, resetCompose])

  return (
    <div className={`cm-shell ${theme === 'dark' ? 'cm-shell--dark' : ''}`}>
      {mailLoadError ? (
        <div
          className="cm-alert cm-alert--err"
          role="alert"
          style={{ margin: '0.5rem 1rem 0', maxWidth: 720 }}
        >
          {mailLoadError}
        </div>
      ) : null}
      <header className="cm-topbar" role="banner">
        <div className="cm-topbar__left">
          <button
            type="button"
            className="cm-icon-btn cm-icon-btn--ghost cm-topbar__menu"
            aria-label="Open menu"
            onClick={() => setSidebarOpen(true)}
          >
            <IconMenu className="cm-icon" />
          </button>
          <div className="cm-brand" aria-hidden="true">
            <span className="cm-brand__mark">C</span>
            <span className="cm-brand__text">mail</span>
          </div>
        </div>

        <div className="cm-search" role="search">
          <IconSearch className="cm-search__icon" title="" />
          <input
            type="search"
            className="cm-search__input"
            placeholder="Search mail, people, or labels"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          {search ? (
            <button
              type="button"
              className="cm-search__clear"
              aria-label="Clear search"
              onClick={() => setSearch('')}
            >
              <IconClose className="cm-icon cm-icon--sm" />
            </button>
          ) : null}
        </div>

        <div className="cm-topbar__right">
          {useLiveMail && mailLoading ? (
            <span
              className="cm-toolbar__meta"
              style={{ marginRight: '0.35rem' }}
              aria-live="polite"
            >
              Loading…
            </span>
          ) : null}
          <button
            type="button"
            className="cm-icon-btn"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            onClick={toggleTheme}
          >
            {theme === 'dark' ? <IconSun className="cm-icon" /> : <IconMoon className="cm-icon" />}
          </button>
          <button
            type="button"
            className="cm-icon-btn"
            aria-label="Refresh"
            title="Refresh"
            onClick={() => {
              if (useLiveMail) void loadLiveMailbox()
            }}
            disabled={useLiveMail && mailLoading}
          >
            <IconRefresh className="cm-icon" />
          </button>
          <button
            type="button"
            className="cm-icon-btn"
            aria-label="Settings"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <IconSettings className="cm-icon" />
          </button>
          <button type="button" className="cm-avatar" aria-label="Account menu" title="Account">
            <span className="cm-avatar__initials">OP</span>
          </button>
          {onLogout ? (
            <button type="button" className="cm-btn cm-btn--ghost cm-topbar__logout" onClick={onLogout}>
              Sign out
            </button>
          ) : null}
        </div>
      </header>

      <div className="cm-body">
        <aside
          className={`cm-sidebar ${sidebarOpen ? 'cm-sidebar--open' : ''}`}
          aria-label="Mail folders"
        >
          <div className="cm-sidebar__inner">
            <div className="cm-sidebar__mobile-head">
              <span className="cm-sidebar__mobile-head-title">Mail</span>
              <button
                type="button"
                className="cm-icon-btn cm-icon-btn--ghost cm-sidebar__mobile-close"
                aria-label="Close menu"
                onClick={() => setSidebarOpen(false)}
              >
                <IconClose className="cm-icon" />
              </button>
            </div>
            <button
              type="button"
              className="cm-compose"
              onClick={() => {
                openCompose()
                setSidebarOpen(false)
              }}
            >
              <IconCompose className="cm-compose__icon" />
              Compose
            </button>

            <nav className="cm-nav" aria-label="System folders">
              {SYSTEM_NAV.map(({ id, label, icon: Icon }) => {
                const total = id === 'starred' ? counts.starred ?? 0 : counts[id] ?? 0
                const displayCount =
                  id === 'inbox' && unreadInInbox > 0 ? unreadInInbox : total
                return (
                  <button
                    key={id}
                    type="button"
                    className={`cm-nav__item ${folder === id ? 'cm-nav__item--active' : ''}`}
                    onClick={() => {
                      setFolder(id)
                      setSidebarOpen(false)
                    }}
                  >
                    <Icon className="cm-nav__icon" />
                    <span className="cm-nav__label">{label}</span>
                    <span className="cm-nav__count" aria-label={`${displayCount} messages`}>
                      {displayCount > 0 ? displayCount : ''}
                    </span>
                  </button>
                )
              })}
            </nav>

            <div className="cm-user-folders">
              <div className="cm-user-folders__head">
                <span className="cm-user-folders__title">Your folders</span>
                <button
                  type="button"
                  className="cm-user-folders__add"
                  onClick={() => setNewFolderOpen((v) => !v)}
                  aria-expanded={newFolderOpen}
                  title="New folder"
                >
                  <IconFolderPlus className="cm-icon cm-icon--sm" />
                </button>
              </div>
              <p className="cm-sidebar__hint cm-user-folders__hint">
                Labels live in your mailbox index (not empty S3 paths). Move messages here to fill a folder.
              </p>
              {newFolderOpen ? (
                <div className="cm-new-folder">
                  <input
                    className="cm-new-folder__input"
                    placeholder="Folder name"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void createFolderQuick()
                      if (e.key === 'Escape') {
                        setNewFolderOpen(false)
                        setNewFolderName('')
                      }
                    }}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="cm-btn cm-btn--primary cm-btn--sm"
                    onClick={() => void createFolderQuick()}
                  >
                    Add
                  </button>
                </div>
              ) : null}
              <nav className="cm-nav cm-nav--user" aria-label="Custom folders">
                {userFolders.map((uf) => {
                  const fid = customFolderKey(uf.id)
                  const cnt = counts[fid] ?? 0
                  return (
                    <div key={uf.id} className="cm-nav__row">
                      <button
                        type="button"
                        className={`cm-nav__item ${folder === fid ? 'cm-nav__item--active' : ''}`}
                        onClick={() => {
                          setFolder(fid)
                          setSidebarOpen(false)
                        }}
                      >
                        <IconFolder className="cm-nav__icon" />
                        <span className="cm-nav__label">{uf.name}</span>
                        <span className="cm-nav__count">{cnt > 0 ? cnt : ''}</span>
                      </button>
                      <button
                        type="button"
                        className="cm-nav__delete"
                        aria-label={`Delete folder ${uf.name}`}
                        title="Delete folder"
                        onClick={() => deleteUserFolder(uf)}
                      >
                        ×
                      </button>
                    </div>
                  )
                })}
              </nav>
            </div>

            <div className="cm-sidebar__footer">
              <p className="cm-sidebar__hint">AWS SES · Draft UI</p>
            </div>
          </div>
        </aside>

        {sidebarOpen ? (
          <button
            type="button"
            className="cm-sidebar__scrim"
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
          />
        ) : null}

        <section
          ref={(el) => {
            panesRef.current = el
          }}
          className={`cm-panes ${mobileShowDetail ? 'cm-panes--detail' : ''}`}
          aria-label="Mail content"
          style={{ '--cm-list-pane-width': `${listWidth}px` } as CSSProperties}
        >
          <div className="cm-list-pane">
            <div className="cm-toolbar">
              <label className="cm-toolbar__check">
                <input
                  ref={selectAllCheckboxRef}
                  type="checkbox"
                  className="cm-checkbox"
                  aria-label="Select all"
                  checked={allBulkSelected}
                  onChange={toggleSelectAll}
                  disabled={listEmails.length === 0}
                />
              </label>
              <div className="cm-toolbar__actions">
                <button
                  type="button"
                  className="cm-toolbar__btn"
                  title="Archive (move to Trash from Inbox)"
                  disabled={
                    !toolbarTargetIds.some(
                      (id) => emails.find((m) => m.id === id)?.folder === 'inbox',
                    )
                  }
                  onClick={() => void archiveToolbar()}
                >
                  <IconArchive className="cm-icon" />
                  <span className="cm-toolbar__btn-text">Archive</span>
                </button>
                <button
                  type="button"
                  className="cm-toolbar__btn"
                  title={
                    toolbarTargetIds.some((id) => emails.find((m) => m.id === id)?.folder === 'trash')
                      ? 'Delete permanently'
                      : 'Move to Trash'
                  }
                  disabled={toolbarTargetIds.length === 0}
                  onClick={() => void deleteToolbar()}
                >
                  <IconTrash className="cm-icon" />
                  <span className="cm-toolbar__btn-text">Delete</span>
                </button>
                {toolbarTargetIds.length > 0 ? (
                  <label className="cm-toolbar__move">
                    <IconMove className="cm-icon" />
                    <span className="cm-toolbar__btn-text">Move</span>
                    <select
                      className="cm-move-select"
                      aria-label={
                        toolbarTargetIds.length > 1
                          ? `Move ${toolbarTargetIds.length} messages`
                          : 'Move selected message'
                      }
                      value=""
                      onChange={(e) => {
                        const v = e.target.value as MailFolder
                        if (v) void moveToolbar(v)
                        e.target.value = ''
                      }}
                    >
                      <option value="">Move to…</option>
                      {moveTargets.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
              <span className="cm-toolbar__meta">
                {bulkSelectedIds.size > 0
                  ? `${bulkSelectedIds.size} selected`
                  : `${listEmails.length} conversation${listEmails.length === 1 ? '' : 's'}`}
              </span>
            </div>

            <ul className="cm-list" role="listbox" aria-label="Messages">
              {listEmails.map((m) => (
                <li key={m.id} role="none">
                  <div
                    className={`cm-row ${selectedId === m.id ? 'cm-row--active' : ''} ${!m.read ? 'cm-row--unread' : ''}`}
                    role="option"
                    aria-selected={selectedId === m.id}
                  >
                    <label
                      className="cm-row__bulk"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        className="cm-checkbox"
                        checked={bulkSelectedIds.has(m.id)}
                        onChange={() => toggleBulkRow(m.id)}
                        aria-label={`Select “${m.subject}”`}
                      />
                    </label>
                    <button
                      type="button"
                      className="cm-row__star"
                      aria-label={m.starred ? 'Remove star' : 'Star'}
                      onClick={(e) => toggleStar(m.id, e)}
                    >
                      <IconStar
                        className={`cm-icon cm-row__star-icon ${m.starred ? 'cm-row__star-icon--on' : ''}`}
                      />
                    </button>
                    <button
                      type="button"
                      className="cm-row__main"
                      onClick={() => openMail(m.id)}
                    >
                      <span className="cm-row__from">{m.from.name}</span>
                      <span className="cm-row__subject-block">
                        <span className="cm-row__subject">{m.subject}</span>
                        <span className="cm-row__sep"> — </span>
                        <span className="cm-row__snippet">{m.snippet}</span>
                      </span>
                      <span className="cm-row__meta">
                        {m.hasAttachment || (m.attachments?.length ?? 0) > 0 ? (
                          <IconPaperclip className="cm-icon cm-icon--sm cm-row__clip" title="" />
                        ) : null}
                        <time className="cm-row__time" dateTime={m.sentAt}>
                          {formatListTime(m.sentAt)}
                        </time>
                      </span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            {listEmails.length === 0 ? (
              <div className="cm-empty">
                <p className="cm-empty__title">
                  {useLiveMail && mailLoading
                    ? 'Loading mail…'
                    : mailLoadError
                      ? 'Could not load mail'
                      : 'No messages'}
                </p>
                <p className="cm-empty__text">
                  {useLiveMail && mailLoadError
                    ? 'Check the message above or try refreshing after signing in.'
                    : 'Try another folder or adjust your search.'}
                </p>
              </div>
            ) : null}
          </div>

          <div
            className="cm-splitter"
            role="separator"
            aria-label="Resize message list"
            aria-orientation="vertical"
            tabIndex={0}
            onPointerDown={beginResize}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 24 : 12
              if (e.key === 'ArrowLeft') setListWidth((w) => Math.max(280, w - step))
              if (e.key === 'ArrowRight') setListWidth((w) => w + step)
            }}
          />

          <div className="cm-read-pane">
            {selected ? (
              <>
                <div className="cm-read__bar">
                  <button
                    type="button"
                    className="cm-read__back cm-icon-btn cm-icon-btn--ghost"
                    aria-label="Back to list"
                    onClick={goBackMobile}
                  >
                    <IconChevronLeft className="cm-icon" />
                  </button>
                  <div className="cm-read__bar-actions">
                    <label className="cm-read__move">
                      <IconMove className="cm-icon" />
                      <select
                        className="cm-move-select cm-move-select--read"
                        aria-label="Move message"
                        value=""
                        onChange={(e) => {
                          const v = e.target.value as MailFolder
                          if (v) void moveMessage(selected.id, v)
                          e.target.value = ''
                        }}
                      >
                        <option value="">Move</option>
                        {moveTargets.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="cm-icon-btn"
                      title="Archive (from Inbox only)"
                      disabled={selected.folder !== 'inbox'}
                      onClick={() => void archiveFromInbox(selected.id)}
                    >
                      <IconArchive className="cm-icon" />
                    </button>
                    <button
                      type="button"
                      className="cm-icon-btn"
                      title={selected.folder === 'trash' ? 'Delete permanently' : 'Move to Trash'}
                      onClick={() => void deleteOrTrashMessage(selected.id)}
                    >
                      <IconTrash className="cm-icon" />
                    </button>
                  </div>
                </div>
                <article className="cm-read">
                  <div className="cm-read__meta-panel">
                  <header className="cm-read__head">
                    <h1 className="cm-read__subject">{selected.subject}</h1>
                    <div className="cm-read__participants">
                      <div className="cm-read__chip">
                        <span className="cm-read__chip-avatar" aria-hidden="true">
                          {selected.from.name.slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <div className="cm-read__from-line">
                            <strong>{selected.from.name}</strong>
                            <span className="cm-read__email">&lt;{selected.from.email}&gt;</span>
                          </div>
                          <div className="cm-read__to-line">
                            To:{' '}
                            {selected.to.length > 0 ? (
                              selected.to.map((t) => (
                                <span key={`${t.email}-${t.name}`}>
                                  {t.name} &lt;{t.email}&gt;{' '}
                                </span>
                              ))
                            ) : (
                              <span className="cm-read__to-fallback">
                                {emailFromIdToken() ? (
                                  <>
                                    You &lt;{emailFromIdToken()}&gt;
                                  </>
                                ) : (
                                  '—'
                                )}
                              </span>
                            )}
                          </div>
                          {selected.cc?.length ? (
                            <div className="cm-read__cc-line">
                              Cc:{' '}
                              {selected.cc.map((c) => (
                                <span key={c.email}>
                                  {c.name} &lt;{c.email}&gt;{' '}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          {selected.bcc?.length ? (
                            <div className="cm-read__cc-line">
                              Bcc:{' '}
                              {selected.bcc.map((b) => (
                                <span key={b.email}>
                                  {b.name} &lt;{b.email}&gt;{' '}
                                </span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <time className="cm-read__when" dateTime={selected.sentAt}>
                        {formatFullDate(selected.sentAt)}
                      </time>
                    </div>
                    {selected.labels?.length ? (
                      <div className="cm-read__labels">
                        {selected.labels.map((lb) => (
                          <span key={lb} className="cm-label">
                            {lb}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {(selected.attachments?.length ?? 0) > 0 ? (
                      <div className="cm-attachments">
                        <p className="cm-attachments__title">
                          <IconPaperclip className="cm-icon cm-icon--sm" title="" /> Attachments
                        </p>
                        <ul className="cm-attachments__list">
                          {selected.attachments!.map((a) => (
                            <li key={a.name}>
                              <button type="button" className="cm-attachment-chip">
                                <span className="cm-attachment-chip__name">{a.name}</span>
                                {a.size != null ? (
                                  <span className="cm-attachment-chip__size">{formatBytes(a.size)}</span>
                                ) : null}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </header>
                  <div className="cm-read__actions" role="toolbar" aria-label="Message actions">
                    <button type="button" className="cm-read__action-btn" onClick={() => openReply()}>
                      <IconReply className="cm-icon" />
                      Reply
                    </button>
                    <button type="button" className="cm-read__action-btn" onClick={() => openForward()}>
                      <IconForward className="cm-icon" />
                      Forward
                    </button>
                    <button
                      type="button"
                      className="cm-read__action-btn cm-read__action-btn--danger"
                      onClick={() => void deleteOrTrashMessage(selected.id)}
                    >
                      <IconTrash className="cm-icon" />
                      {selected.folder === 'trash' ? 'Delete permanently' : 'Trash'}
                    </button>
                  </div>
                  </div>
                  {selected.inlineImages && selected.inlineImages.length > 0 && !allowInlineImages ? (
                    <div className="cm-read__images-banner" role="region" aria-label="Embedded images">
                      <p className="cm-read__images-banner__text">
                        This message has embedded images (for example logos). They stay off until you load
                        them.
                      </p>
                      <div className="cm-read__images-banner__actions">
                        <button
                          type="button"
                          className="cm-btn cm-btn--primary cm-btn--sm"
                          onClick={() => showEmbeddedImagesOnce()}
                        >
                          Show images
                        </button>
                        {emailDomainFromAddress(selected.from.email) ? (
                          <button
                            type="button"
                            className="cm-btn cm-btn--ghost cm-btn--sm"
                            onClick={() => trustSenderImagesDomain()}
                          >
                            Always show from @{emailDomainFromAddress(selected.from.email)}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                  <div className="cm-read__body-zone">
                  <div
                    className={`cm-read__body ${looksLikeHtmlBody(selected.body, selected.bodyIsHtml) ? 'cm-read__body--html' : ''}`}
                  >
                    {contentBusyId === selected.id ? (
                      <p className="cm-read__loading">Loading message…</p>
                    ) : looksLikeHtmlBody(selected.body, selected.bodyIsHtml) ? (
                      <EmailHtmlIframe
                        html={selected.body}
                        dark={theme === 'dark'}
                        loadInlineImages={allowInlineImages}
                        inlineImages={selected.inlineImages}
                      />
                    ) : (
                      selected.body.split('\n').map((line, i) => (
                        <p key={`${selected.id}-L${i}`}>{line}</p>
                      ))
                    )}
                  </div>
                  </div>
                </article>
              </>
            ) : (
              <div className="cm-read-empty">
                <p>Select a message to read</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {composeOpen ? (
        <div className="cm-compose-modal" role="dialog" aria-modal="true" aria-labelledby="cm-compose-title">
          <div className="cm-compose-modal__panel">
            <div className="cm-compose-modal__head">
              <h2 id="cm-compose-title" className="cm-compose-modal__title">
                New message
              </h2>
              <button
                type="button"
                className="cm-icon-btn"
                aria-label="Close compose"
                onClick={() => {
                  setComposeOpen(false)
                  resetCompose()
                }}
              >
                <IconClose className="cm-icon" />
              </button>
            </div>
            <div className="cm-compose-modal__fields">
              <label className="cm-field">
                <span className="cm-field__label">To</span>
                <input
                  className="cm-field__input"
                  type="text"
                  placeholder="name@company.com"
                  value={composeTo}
                  onChange={(e) => setComposeTo(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <button
                type="button"
                className="cm-compose-cc-toggle"
                onClick={() => setComposeShowCcBcc((v) => !v)}
              >
                {composeShowCcBcc ? 'Hide Cc / Bcc' : 'Cc / Bcc'}
              </button>
              {composeShowCcBcc ? (
                <>
                  <label className="cm-field">
                    <span className="cm-field__label">Cc</span>
                    <input
                      className="cm-field__input"
                      type="text"
                      placeholder="Optional"
                      value={composeCc}
                      onChange={(e) => setComposeCc(e.target.value)}
                    />
                  </label>
                  <label className="cm-field">
                    <span className="cm-field__label">Bcc</span>
                    <input
                      className="cm-field__input"
                      type="text"
                      placeholder="Optional"
                      value={composeBcc}
                      onChange={(e) => setComposeBcc(e.target.value)}
                    />
                  </label>
                </>
              ) : null}
              <label className="cm-field">
                <span className="cm-field__label">Subject</span>
                <input
                  className="cm-field__input"
                  type="text"
                  placeholder="Subject"
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                />
              </label>
              <div className="cm-field cm-field--attach">
                <span className="cm-field__label">Attachments</span>
                <div className="cm-attach-zone">
                  <label className="cm-attach-zone__hit">
                    <input
                      type="file"
                      className="cm-attach-zone__input"
                      multiple
                      onChange={(e) => {
                        const list = e.target.files
                        if (!list?.length) return
                        setComposeFiles((prev) => [...prev, ...Array.from(list)])
                        e.target.value = ''
                      }}
                    />
                    <span className="cm-attach-zone__card">
                      <IconPaperclip className="cm-attach-zone__icon" title="" />
                      <span className="cm-attach-zone__title">Add attachments</span>
                      <span className="cm-attach-zone__hint">Drop files here or click to browse</span>
                      <span className="cm-attach-zone__limit">Up to 25 MB per file</span>
                    </span>
                  </label>
                  {composeFiles.length > 0 ? (
                    <ul className="cm-attach-list">
                      {composeFiles.map((f, idx) => (
                        <li key={`${f.name}-${idx}`} className="cm-attach-list__item">
                          <IconPaperclip className="cm-attach-list__file-icon" title="" />
                          <span className="cm-attach-list__name">{f.name}</span>
                          <span className="cm-attach-list__size">{formatBytes(f.size)}</span>
                          <button
                            type="button"
                            className="cm-attach-list__remove"
                            aria-label={`Remove ${f.name}`}
                            onClick={() =>
                              setComposeFiles((prev) => prev.filter((_, i) => i !== idx))
                            }
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
              <div className="cm-field cm-field--grow">
                <span className="cm-field__label">Body</span>
                <Suspense
                  fallback={<div className="cm-compose-editor-fallback" aria-hidden />}
                >
                  <ComposeRichEditor
                    value={composeBody}
                    onChange={setComposeBody}
                    theme={theme}
                  />
                </Suspense>
              </div>
            </div>
            <div className="cm-compose-modal__foot">
              {composeError ? (
                <p className="cm-compose-modal__err" role="alert">
                  {composeError}
                </p>
              ) : null}
              <button
                type="button"
                className="cm-btn cm-btn--primary"
                disabled={composeSending}
                onClick={() => void submitCompose()}
              >
                {composeSending ? 'Sending…' : 'Send'}
              </button>
              <button
                type="button"
                className="cm-btn cm-btn--ghost"
                onClick={() => {
                  setComposeOpen(false)
                  resetCompose()
                }}
              >
                Discard
              </button>
            </div>
          </div>
          <button
            type="button"
            className="cm-compose-modal__scrim"
            aria-label="Close compose"
            onClick={() => {
              setComposeOpen(false)
              resetCompose()
            }}
          />
        </div>
      ) : null}

      <button
        type="button"
        className="cm-fab"
        aria-label="Compose new message"
        onClick={openCompose}
      >
        <IconCompose className="cm-fab__icon" />
      </button>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onToggleTheme={toggleTheme}
        primaryEmail={emailFromIdToken()}
        trustedDomains={[...trustedImageDomains].sort((a, b) => a.localeCompare(b))}
        onRemoveTrustedDomain={removeTrustedDomain}
        onClearTrustedDomains={clearTrustedDomains}
      />
    </div>
  )
}
