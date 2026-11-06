import { useRef, useState } from 'react'
import type { UserFolder } from '../types/mail'

type Props = {
  folders: UserFolder[]
  onSave: (id: string, senders: string[]) => Promise<UserFolder>
}

function FolderSenderEditor({ folder, onSave, onBusy }: {
  folder: UserFolder
  onSave: Props['onSave']
  onBusy: (busy: boolean) => void
}) {
  const [text, setText] = useState(() => (folder.senders ?? []).join('\n'))
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function save() {
    if (running.current) return
    const senders = [...new Set(text.split(/[\s,;]+/).filter(Boolean).map((address) => address.toLowerCase()))]
    if (senders.length > 20 || senders.some((address) => !/^[^\s@<>*]+@[^\s@<>*]+\.[^\s@<>*]+$/.test(address))) {
      setSaved(false)
      setError('Enter up to 20 complete email addresses, separated by commas or new lines.')
      return
    }
    running.current = true
    setBusy(true)
    onBusy(true)
    setError(null)
    setSaved(false)
    try {
      const updated = await onSave(folder.id, senders)
      setText((updated.senders ?? []).join('\n'))
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save sender rules.')
    } finally {
      running.current = false
      setBusy(false)
      onBusy(false)
    }
  }

  return <div className="cm-folder-rules__editor">
    <label className="cm-field" htmlFor="settings-folder-senders">
      <span className="cm-field__label">Automatically move mail from</span>
      <textarea id="settings-folder-senders" className="cm-field__input cm-folder-rules__addresses"
        rows={5} maxLength={5200} value={text} disabled={busy} placeholder="jobs@linkedin.com"
        onChange={(e) => { setText(e.target.value); setError(null); setSaved(false) }} />
    </label>
    <p className="cm-settings__note">Use complete email addresses, separated by commas or new lines. Up to 20 addresses per folder.</p>
    <p className="cm-settings__note">Changes apply to new incoming mail. Existing messages stay in their current folders. Leave this list empty to stop automatic moves.</p>
    {error ? <p role="alert" className="cm-alert cm-alert--err">{error}</p> : null}
    {saved ? <p role="status" className="cm-alert cm-alert--ok">Sender rules saved.</p> : null}
    <div className="cm-settings__actions">
      <button type="button" className="cm-btn cm-btn--primary" disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save rules'}
      </button>
      <button type="button" className="cm-btn cm-btn--ghost" disabled={busy} onClick={() => {
        setText((folder.senders ?? []).join('\n')); setError(null); setSaved(false)
      }}>Discard</button>
    </div>
  </div>
}

export function FolderRulesSettings({ folders, onSave }: Props) {
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)
  const selected = folders.find((folder) => folder.id === selectedId) ?? folders[0]
  return <div className="cm-settings">
    <section className="cm-settings__section">
      <h3 className="cm-settings__h">Folder sender rules</h3>
      {selected ? <>
        <label className="cm-field">
          <span className="cm-field__label">Folder</span>
          <select className="cm-field__input" value={selected.id} disabled={busy}
            onChange={(e) => setSelectedId(e.target.value)}>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </label>
        <FolderSenderEditor key={selected.id} folder={selected} onSave={onSave} onBusy={setBusy} />
      </> : <p className="cm-settings__note">Create a folder from “Your folders” to add automatic sender rules.</p>}
    </section>
    <section className="cm-settings__section cm-folder-rules__deletion">
      <h3 className="cm-settings__h">When you delete a folder</h3>
      <p className="cm-settings__note">Messages in the folder move back to Inbox. The folder’s sender rules are removed, so future messages from those senders arrive in Inbox.</p>
    </section>
  </div>
}
