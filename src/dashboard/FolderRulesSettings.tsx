import { useRef, useState } from 'react'
import type { UserFolder } from '../types/mail'
import type { FolderRuleBatch } from '../mail/mailApi'
import { parseSenderRules } from '../mail/senderRules'

type Props = {
  folders: UserFolder[]
  onSave: (id: string, senders: string[], name: string) => Promise<UserFolder>
  onApply: (id: string, cursor: string | null, senders: string[]) => Promise<FolderRuleBatch>
}

function FolderSenderEditor({ folder, onSave, onApply, onBusy }: {
  folder: UserFolder
  onSave: Props['onSave']
  onApply: Props['onApply']
  onBusy: (busy: boolean) => void
}) {
  const serverText = (folder.senders ?? []).join('\n')
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const name = nameDraft ?? folder.name
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? serverText
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [savedName, setSavedName] = useState<string | null>(null)
  const [savedRules, setSavedRules] = useState<string | null>(null)
  const [applyExisting, setApplyExisting] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const migration = useRef<{ cursor: string | null; moved: number; senders: string[] } | null>(null)

  async function save() {
    if (running.current) return
    if (!name.trim() || name.trim().length > 500) {
      setError('Folder name must be between 1 and 500 characters.'); return
    }
    let senders: string[]
    try { senders = parseSenderRules(text) }
    catch (e) { setError(e instanceof Error ? e.message : 'Invalid sender rules.'); return }
    if (applyExisting && !senders.length) {
      setError('Add a rule before applying it to existing Inbox messages.')
      return
    }
    running.current = true
    setBusy(true)
    onBusy(true)
    setError(null)
    setSavedRules(null)
    if (!migration.current) setProgress(null)
    try {
      if (!migration.current) {
        const updated = await onSave(folder.id, senders, name.trim())
        senders = updated.senders ?? []
        setDraft(null)
        setNameDraft(null)
        setSavedName(updated.name)
        if (applyExisting) migration.current = { cursor: null, moved: 0, senders }
      }
      const job = migration.current
      if (job) {
        let complete = false
        while (!complete) {
          setProgress(`Checking Inbox… ${job.moved} moved`)
          const batch = await onApply(folder.id, job.cursor, job.senders)
          job.moved += batch.moved
          job.cursor = batch.nextCursor
          setProgress(`Checking Inbox… ${job.moved} moved`)
          if (batch.error) throw new Error(batch.error)
          complete = batch.complete
        }
        senders = job.senders
        setProgress(`Finished: ${job.moved} messages moved to this folder.`)
        migration.current = null
        setApplyExisting(false)
      }
      setSavedRules(senders.join('\n'))
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not save sender rules.'
      setError(migration.current ? `Rules were saved, but moving existing messages stopped. ${message}` : message)
    } finally {
      running.current = false
      setBusy(false)
      onBusy(false)
    }
  }

  return <div className="cm-folder-rules__editor">
    <label className="cm-field" htmlFor="settings-folder-name">
      <span className="cm-field__label">Folder name</span>
      <input id="settings-folder-name" className="cm-field__input" value={name} maxLength={500}
        disabled={busy || !!migration.current}
        onChange={(e) => { setNameDraft(e.target.value); setError(null); setSavedRules(null); setProgress(null) }} />
    </label>
    <p className="cm-settings__note cm-folder-rules__rename-note">Renaming keeps your messages and sender rules in this folder.</p>
    <label className="cm-field" htmlFor="settings-folder-senders">
      <span className="cm-field__label">Automatically move mail from</span>
      <textarea id="settings-folder-senders" className="cm-field__input cm-folder-rules__addresses"
        rows={5} maxLength={5200} value={text} disabled={busy || !!migration.current}
        placeholder={'jobs@linkedin.com\n@linkedin.com\n*.linkedin.com'}
        onChange={(e) => { setDraft(e.target.value); setError(null); setSavedRules(null); setProgress(null) }} />
    </label>
    <p className="cm-settings__note">Use an email address, @linkedin.com for that exact domain, or *.linkedin.com for its subdomains. Separate up to 20 rules with commas or new lines.</p>
    <p className="cm-settings__note">Exact addresses take priority over domain rules. Leave the list empty to stop automatic moves. Existing mail stays in place unless you select the option below.</p>
    <label className="cm-folder-rules__apply">
      <input type="checkbox" checked={applyExisting} disabled={busy || !!migration.current}
        onChange={(e) => { setApplyExisting(e.target.checked); setSavedRules(null) }} />
      Also move matching messages already in Inbox
    </label>
    {progress ? <p role="status" className="cm-settings__note">{progress}</p> : null}
    {error ? <p role="alert" className="cm-alert cm-alert--err">{error}</p> : null}
    {savedRules !== null && savedRules === serverText && savedName === folder.name && draft === null && nameDraft === null ? <p role="status" className="cm-alert cm-alert--ok">Folder settings saved.</p> : null}
    <div className="cm-settings__actions">
      <button type="button" className="cm-btn cm-btn--primary" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : migration.current ? 'Retry moving messages' : 'Save changes'}
      </button>
      <button type="button" className="cm-btn cm-btn--ghost" disabled={busy || !!migration.current} onClick={() => {
        setDraft(null); setNameDraft(null); setError(null); setSavedRules(null); setProgress(null); setApplyExisting(false)
      }}>Discard</button>
    </div>
  </div>
}

export function FolderRulesSettings({ folders, onSave, onApply }: Props) {
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)
  const selected = folders.find((folder) => folder.id === selectedId) ?? folders[0]
  return <div className="cm-settings">
    <section className="cm-settings__section">
      <h3 className="cm-settings__h">Folder settings</h3>
      {selected ? <>
        <label className="cm-field">
          <span className="cm-field__label">Folder</span>
          <select className="cm-field__input" value={selected.id} disabled={busy}
            onChange={(e) => setSelectedId(e.target.value)}>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </label>
        <FolderSenderEditor key={selected.id} folder={selected} onSave={(id, senders, name) => { setSelectedId(id); return onSave(id, senders, name) }} onApply={onApply} onBusy={setBusy} />
      </> : <p className="cm-settings__note">Create a folder from “Your folders” to add automatic sender rules.</p>}
    </section>
    <section className="cm-settings__section cm-folder-rules__deletion">
      <h3 className="cm-settings__h">When you delete a folder</h3>
      <p className="cm-settings__note">Messages in the folder move back to Inbox. The folder’s sender rules are removed, so future messages from those senders arrive in Inbox.</p>
    </section>
  </div>
}
