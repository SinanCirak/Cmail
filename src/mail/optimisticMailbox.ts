import type { MailFolder, MailMessage } from '../types/mail'
import type { MailboxPage } from './mailApi'

export type MailView = { folder: string; query: string; unread: boolean; includeExcluded: boolean; cursor: string | null }
type Change = { before: MailMessage; indexedBefore: MailMessage; after: MailMessage | null; pending: boolean; sourceSeenGone: boolean; previous?: Change; hiddenIds: Set<string>; delta: Record<string, number> }
type Expected = { value: number; baseline: number }

function memberships(message: MailMessage | null): Set<string> {
  if (!message) return new Set()
  const scopes = new Set([message.folder, 'all+'])
  if (message.folder !== 'spam' && message.folder !== 'trash') {
    scopes.add('all')
    if (message.starred) scopes.add('starred')
  }
  if (!message.read) for (const scope of [...scopes]) scopes.add(`${scope}:unread`)
  return scopes
}

export function mailboxMetrics(page: MailboxPage | null): Record<string, number> {
  if (!page) return {}
  const result = { ...page.counts }
  const unread = { inbox: page.unreadInbox, ...page.unreadCounts }
  for (const [scope, total] of Object.entries(unread)) result[`${scope}:unread`] = total
  for (const [suffix, values] of [['', page.counts], [':unread', unread]] as const) {
    const folders = Object.entries(values).filter(([key]) => key !== 'starred' && key !== 'all' && key !== 'all+')
    result[`all+${suffix}`] = folders.reduce((sum, [, count]) => sum + count, 0)
    result[`all${suffix}`] = folders.reduce((sum, [key, count]) => sum + (key === 'spam' || key === 'trash' ? 0 : count), 0)
  }
  return result
}

function belongs(message: MailMessage, view: MailView): boolean {
  if (view.unread && message.read) return false
  return memberships(message).has(view.folder === 'all' && view.includeExcluded ? 'all+' : view.folder)
}

/** Keep local writes visible while asynchronous index responses catch up. */
export class OptimisticMailbox {
  private changes = new Map<string, Change>()
  private expected = new Map<string, Expected>()

  private find(id: string) {
    return [...this.changes.entries()].find(([, change]) => change.before.id === id || change.after?.id === id)
  }

  isPending(id: string): boolean { return this.find(id)?.[1].pending ?? false }

  message(id: string): MailMessage | undefined { return this.find(id)?.[1].after ?? undefined }

  patchTracked(id: string, patch: Partial<Pick<MailMessage, 'read' | 'starred'>>, metrics: Record<string, number>, skipStarred = false) {
    const change = this.find(id)?.[1]
    if (!change?.after) return
    const old = memberships(change.after)
    const updated = { ...change.after, ...patch }
    const next = memberships(updated)
    for (const key of new Set([...old, ...next])) {
      const delta = Number(next.has(key)) - Number(old.has(key))
      if (delta && !(skipStarred && key === 'starred')) this.shift(key, delta, metrics)
    }
    change.after = updated
  }

  begin(message: MailMessage, target: MailFolder | null, metrics: Record<string, number>, indexedBefore = message): Change | null {
    const existing = this.find(message.id)
    if (existing?.[1].pending) return null
    const previous = existing?.[1]
    const after = target ? { ...message, folder: target } : null
    const beforeScopes = memberships(previous ? message : indexedBefore)
    const afterScopes = memberships(after)
    const delta: Record<string, number> = {}
    for (const key of new Set([...beforeScopes, ...afterScopes])) {
      const value = Number(afterScopes.has(key)) - Number(beforeScopes.has(key))
      if (value) { delta[key] = value; this.shift(key, value, metrics) }
    }
    const change: Change = { before: previous?.before ?? message, indexedBefore: previous?.indexedBefore ?? indexedBefore,
      after, pending: true, sourceSeenGone: false, previous, hiddenIds: new Set([...(previous?.hiddenIds ?? []), message.id]), delta }
    this.changes.set(existing?.[0] ?? message.id, change)
    return change
  }

  shift(key: string, delta: number, metrics: Record<string, number>) {
    const old = this.expected.get(key)
    this.expected.set(key, { baseline: old?.baseline ?? metrics[key] ?? 0, value: Math.max(0, (old?.value ?? metrics[key] ?? 0) + delta) })
  }

  commit(change: Change, receipt?: { sk?: string; s3Key?: string }) {
    change.pending = false
    if (change.after) change.after = { ...change.after, id: receipt?.sk ?? change.after.id, s3Key: receipt?.s3Key ?? change.after.s3Key }
  }

  rollback(change: Change, metrics: Record<string, number>) {
    const entry = [...this.changes.entries()].find(([, value]) => value === change)
    if (!entry) return
    for (const [key, delta] of Object.entries(change.delta)) this.shift(key, -delta, metrics)
    if (change.previous) this.changes.set(entry[0], change.previous)
    else this.changes.delete(entry[0])
    if (!this.changes.size) this.expected.clear()
  }

  counters(metrics: Record<string, number>): Record<string, number> {
    return { ...metrics, ...Object.fromEntries([...this.expected].map(([key, value]) => [key, value.value])) }
  }

  reconcile(page: MailboxPage, view: MailView) {
    const metrics = mailboxMetrics(page)
    const rows = page.messages
    for (const change of this.changes.values()) {
      if (change.pending) continue
      const source = change.indexedBefore
      if (!view.query && !view.unread && view.folder === source.folder && !rows.some((row) => row.id === source.id)) {
        const time = Date.parse(source.sentAt)
        const oldest = rows.at(-1)
        const newest = rows[0]
        const complete = !view.cursor && !page.nextCursor
        const withinPage = oldest && time > Date.parse(oldest.sentAt) && (!view.cursor || time <= Date.parse(newest.sentAt))
        if (complete || withinPage) change.sourceSeenGone = true
      }
    }
    const pending = [...this.changes.values()].some((change) => change.pending)
    if (!pending) {
      for (const [key, value] of this.expected) if ((metrics[key] ?? 0) === value.value) this.expected.delete(key)
      // Once source removals and destination increments are visible, adopt live
      // totals too, including unrelated mail that arrived during the operation.
      const gone = this.changes.size > 0 && [...this.changes.values()].every((change) => change.sourceSeenGone)
      const destinationsReady = [...this.expected].every(([key, value]) => value.value <= value.baseline || (metrics[key] ?? 0) >= value.value)
      if (gone && destinationsReady) this.expected.clear()
      if (!this.expected.size) {
        for (const [id, change] of this.changes) {
          const afterSeen = change.after && change.after.id !== change.before.id && rows.some((row) => row.id === change.after?.id)
          if (change.sourceSeenGone || afterSeen || !rows.some((row) => change.hiddenIds.has(row.id))) this.changes.delete(id)
        }
      }
    }
  }

  rows(rows: MailMessage[], view: MailView): MailMessage[] {
    const hidden = new Set([...this.changes.values()].flatMap((change) => [...change.hiddenIds]))
    const result = rows.filter((message) => !hidden.has(message.id) && belongs(message, view))
    for (const change of this.changes.values()) {
      const after = change.after
      if (!after || !belongs(after, view)) continue
      const indexed = result.findIndex((message) => message.id === after.id)
      if (indexed >= 0) result[indexed] = { ...result[indexed], starred: after.starred, read: after.read }
      else if (rows.some((message) => change.hiddenIds.has(message.id)) || (!view.query && !view.cursor)) result.push(after)
    }
    result.sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt))
    return result.slice(0, 25)
  }

  queryTotal(page: MailboxPage, view: MailView): number {
    const rows = this.rows(page.messages, view)
    if (!view.query) {
      const scope = view.folder === 'all' && view.includeExcluded ? 'all+' : view.folder
      return this.counters(mailboxMetrics(page))[scope + (view.unread ? ':unread' : '')] ?? page.total
    }
    const visible = new Set(rows.map((message) => message.id))
    const removed = page.messages.filter((message) => !visible.has(message.id)).length
    return Math.max(0, page.total - removed)
  }
}
