import { describe, expect, it } from 'vitest'
import { OptimisticMailbox, mailboxMetrics, type MailView } from './optimisticMailbox'
import type { MailMessage } from '../types/mail'
import type { MailboxPage } from './mailApi'
const view: MailView = { folder: 'inbox', query: '', unread: false, includeExcluded: false, cursor: null }
const message = (id: string, extra: Partial<MailMessage> = {}): MailMessage => ({ id, folder: 'inbox', from: { name: 'Sender', email: 'sender@example.test' }, to: [], subject: 'Mail', snippet: 'Preview', body: '', sentAt: '2026-11-09T10:00:00Z', read: false, starred: true, ...extra })
const page = (messages: MailMessage[], counts = { inbox: 2, trash: 0, starred: 1 }, unreadCounts = { inbox: 2, trash: 0, starred: 1 }): MailboxPage => ({ messages, total: counts.inbox, start: messages.length ? 1 : 0, end: messages.length, nextCursor: null, counts, unreadCounts, unreadInbox: unreadCounts.inbox })

describe('optimistic mailbox changes', () => {
 it('removes mail and updates total/unread/starred counts before the request completes', () => {
  const state = new OptimisticMailbox(), row = message('a'), data = page([row, message('b', { starred: false })])
  state.begin(row, 'trash', mailboxMetrics(data))
  expect(state.rows(data.messages, view).map((row) => row.id)).toEqual(['b'])
  expect(state.counters(mailboxMetrics(data))).toMatchObject({ inbox: 1, trash: 1, starred: 0, 'inbox:unread': 1, 'trash:unread': 1, 'starred:unread': 0, all: 1, 'all+': 2 })
  expect(state.queryTotal(data, view)).toBe(1)
 })
 it('retains changes through stale responses and releases them after index confirmation', () => {
  const state = new OptimisticMailbox(), row = message('a'), data = page([row, message('b', { starred: false })])
  const change = state.begin(row, 'trash', mailboxMetrics(data))!
  state.commit(change, { sk: 'trash-a', s3Key: 'raw/trash-a' })
  state.reconcile(data, view)
  expect(state.rows(data.messages, view).map((row) => row.id)).toEqual(['b'])
  expect(state.counters(mailboxMetrics(data)).inbox).toBe(1)
  const fresh = page([message('b', { starred: false })], { inbox: 1, trash: 1, starred: 0 }, { inbox: 1, trash: 1, starred: 0 })
  state.reconcile(fresh, view)
  expect(state.counters(mailboxMetrics(fresh)).trash).toBe(1)
  const incoming = page([...fresh.messages, message('new')], { inbox: 2, trash: 1, starred: 1 }, { inbox: 2, trash: 1, starred: 1 })
  expect(state.counters(mailboxMetrics(incoming)).inbox).toBe(2)
 })
 it('does not double count already indexed destination rows', () => {
  const state = new OptimisticMailbox(), row = message('a'), data = page([row])
  const change = state.begin(row, 'archive', mailboxMetrics(data))!
  state.commit(change, { sk: 'archive-a' })
  const archived = message('archive-a', { folder: 'archive' })
  expect(state.rows([archived], { ...view, folder: 'archive' })).toHaveLength(1)
 })
 it('restores only the failed member of a partially successful bulk operation', () => {
  const state = new OptimisticMailbox(), a = message('a'), b = message('b'), data = page([a, b])
  const first = state.begin(a, 'trash', mailboxMetrics(data))!, second = state.begin(b, 'trash', mailboxMetrics(data))!
  state.commit(first, { sk: 'trash-a' })
  state.rollback(second, mailboxMetrics(data))
  expect(state.rows([a, b], view).map((row) => row.id)).toEqual(['b'])
  expect(state.counters(mailboxMetrics(data))).toMatchObject({ inbox: 1, trash: 1, 'inbox:unread': 1 })
 })
 it('restores the original counters if all writes fail', () => {
  const state = new OptimisticMailbox(), row = message('a'), data = page([row])
  const change = state.begin(row, 'trash', mailboxMetrics(data))!
  state.rollback(change, mailboxMetrics(data))
  expect(state.rows([row], view)).toEqual([row])
  expect(state.counters(mailboxMetrics(data))).toEqual(mailboxMetrics(data))
 })
 it('permanently deletes Trash mail without increasing another folder', () => {
  const state = new OptimisticMailbox(), row = message('trash-a', { folder: 'trash' })
  const data = page([row], { inbox: 0, trash: 1, starred: 0 }, { inbox: 0, trash: 1, starred: 0 })
  state.begin(row, null, mailboxMetrics(data))
  expect(state.rows([row], { ...view, folder: 'trash' })).toEqual([])
  expect(state.counters(mailboxMetrics(data))).toMatchObject({ trash: 0, 'trash:unread': 0, 'all+': 0 })
 })
 it('keeps moved mail in all-mail searches when excluded folders are included', () => {
  const state = new OptimisticMailbox(), row = message('a'), data = page([row])
  state.begin(row, 'trash', mailboxMetrics(data))
  const all = { ...view, folder: 'all', query: 'Mail', includeExcluded: true }
  expect(state.rows([row], all)[0].folder).toBe('trash')
  expect(state.queryTotal(data, all)).toBe(data.total)
  expect(state.rows([row], { ...all, includeExcluded: false })).toEqual([])
 })
 it('does not insert arbitrary moved messages into unrelated search results', () => {
  const state = new OptimisticMailbox(), row = message('a'), data = page([row])
  state.begin(row, 'trash', mailboxMetrics(data))
  expect(state.rows([], { ...view, folder: 'trash', query: 'unrelated' })).toEqual([])
 })
 it('prevents duplicate requests while a message mutation is pending', () => {
  const state = new OptimisticMailbox(), row = message('a'), data = page([row])
  state.begin(row, 'trash', mailboxMetrics(data))
  expect(state.begin(row, 'archive', mailboxMetrics(data))).toBeNull()
 })
 it('can move a committed message again and restore its previous destination on failure', () => {
  const state = new OptimisticMailbox(), row = message('a'), data = page([row])
  const first = state.begin(row, 'archive', mailboxMetrics(data))!
  state.commit(first, { sk: 'archive-a' })
  const archived = state.rows([], { ...view, folder: 'archive' })[0]
  const second = state.begin(archived, 'trash', mailboxMetrics(data))!
  state.rollback(second, mailboxMetrics(data))
  expect(state.rows([], { ...view, folder: 'archive' })[0].id).toBe('archive-a')
  expect(state.rows([row], view)).toEqual([])
 })
 it('adopts new incoming mail totals when a delete and arrival overlap', () => {
  const state = new OptimisticMailbox(), row = message('a'), other = message('b', { starred: false }), data = page([row, other])
  const change = state.begin(row, 'trash', mailboxMetrics(data))!
  state.commit(change, { sk: 'trash-a' })
  const fresh = page([other, message('new', { starred: false })], { inbox: 2, trash: 1, starred: 0 }, { inbox: 2, trash: 1, starred: 0 })
  state.reconcile(fresh, view)
  expect(state.counters(mailboxMetrics(fresh)).inbox).toBe(2)
 })
 it('does not restore a failed Inbox operation into a different folder', () => {
  const state = new OptimisticMailbox(), row = message('a'), data = page([row])
  const change = state.begin(row, 'trash', mailboxMetrics(data))!
  state.rollback(change, mailboxMetrics(data))
  expect(state.rows([row], { ...view, folder: 'archive' })).toEqual([])
  expect(state.rows([row], view)).toEqual([row])
 })
 it('can read a moved message before the index catches up without freezing unread counters', () => {
  const state = new OptimisticMailbox(), row = message('a'), data = page([row])
  const change = state.begin(row, 'trash', mailboxMetrics(data))!
  state.commit(change, { sk: 'trash-a', s3Key: 'raw/trash-a' })
  state.patchTracked('trash-a', { read: true }, mailboxMetrics(data))
  expect(state.message('trash-a')).toMatchObject({ id: 'trash-a', read: true, s3Key: 'raw/trash-a' })
  expect(state.counters(mailboxMetrics(data))['trash:unread']).toBe(0)
  expect(state.rows([], { ...view, folder: 'trash' })[0].read).toBe(true)
 })
 it('releases settled search-result tombstones once server counts confirm the write', () => {
  const state = new OptimisticMailbox(), row = message('a'), data = page([row, message('b', { starred: false })])
  const change = state.begin(row, 'trash', mailboxMetrics(data))!
  state.commit(change, { sk: 'trash-a' })
  const fresh = page([message('b', { starred: false })], { inbox: 1, trash: 1, starred: 0 }, { inbox: 1, trash: 1, starred: 0 })
  state.reconcile(fresh, { ...view, query: 'Mail' })
  expect(state.message('trash-a')).toBeUndefined()
 })

})
