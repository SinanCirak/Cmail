import type { Editor } from '@tiptap/core'
import { TextStyleKit } from '@tiptap/extension-text-style/text-style-kit'
import { Link } from '@tiptap/extension-link'
import { Placeholder } from '@tiptap/extension-placeholder'
import { TextAlign } from '@tiptap/extension-text-align'
import { Underline } from '@tiptap/extension-underline'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useCallback } from 'react'
import {
  IconAlignCenter,
  IconAlignJustify,
  IconAlignLeft,
  IconAlignRight,
  IconLink,
  IconListBullet,
  IconListNumbered,
  IconRedo,
  IconUndo,
} from './composeToolbarIcons'
import './ComposeRichEditor.css'

const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: 'Default', value: '' },
  { label: 'System UI', value: 'system-ui, sans-serif' },
  { label: 'Inter', value: '"Inter", system-ui, sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Merriweather', value: '"Merriweather", Georgia, serif' },
  { label: 'Monospace', value: 'ui-monospace, Consolas, monospace' },
]

const SIZE_OPTIONS: { label: string; value: string }[] = [
  { label: 'Size', value: '' },
  { label: '12', value: '12px' },
  { label: '14', value: '14px' },
  { label: '16', value: '16px' },
  { label: '18', value: '18px' },
  { label: '20', value: '20px' },
  { label: '24', value: '24px' },
]

type Props = {
  value: string
  onChange: (html: string) => void
  theme: 'light' | 'dark'
}

function ComposeToolbar({ editor, theme }: { editor: Editor; theme: 'light' | 'dark' }) {
  useEditorState({
    editor,
    selector: (s) => s.transactionNumber,
  })

  const ts = editor.getAttributes('textStyle') as {
    fontFamily?: string | null
    fontSize?: string | null
    color?: string | null
    backgroundColor?: string | null
  }

  const setLink = useCallback(() => {
    const prev = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Link URL', prev ?? 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }, [editor])

  const textColor = ts.color && /^#[0-9a-fA-F]{6}$/.test(ts.color) ? ts.color : '#0f172a'
  const hiColor =
    ts.backgroundColor && /^#[0-9a-fA-F]{6}$/.test(ts.backgroundColor)
      ? ts.backgroundColor
      : theme === 'dark'
        ? '#1e293b'
        : '#ffffff'

  return (
    <div className="cm-rich-toolbar" role="toolbar" aria-label="Text formatting">
      <span className="cm-rich-toolbar__group">
        <button
          type="button"
          className="cm-rich-btn cm-rich-btn--icon-only"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Undo"
          aria-label="Undo"
        >
          <IconUndo className="cm-rich-toolbar-icon" />
        </button>
        <button
          type="button"
          className="cm-rich-btn cm-rich-btn--icon-only"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Redo"
          aria-label="Redo"
        >
          <IconRedo className="cm-rich-toolbar-icon" />
        </button>
      </span>

      <span className="cm-rich-toolbar__sep" aria-hidden />

      <span className="cm-rich-toolbar__group">
        <button
          type="button"
          className={`cm-rich-btn cm-rich-btn--icon ${editor.isActive('bold') ? 'cm-rich-btn--on' : ''}`}
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold"
        >
          <strong>B</strong>
        </button>
        <button
          type="button"
          className={`cm-rich-btn cm-rich-btn--icon ${editor.isActive('italic') ? 'cm-rich-btn--on' : ''}`}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic"
        >
          <em>I</em>
        </button>
        <button
          type="button"
          className={`cm-rich-btn cm-rich-btn--icon ${editor.isActive('strike') ? 'cm-rich-btn--on' : ''}`}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          title="Strikethrough"
        >
          <s>S</s>
        </button>
        <button
          type="button"
          className={`cm-rich-btn cm-rich-btn--icon ${editor.isActive('underline') ? 'cm-rich-btn--on' : ''}`}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          title="Underline"
        >
          <span className="cm-rich-ul">U</span>
        </button>
      </span>

      <span className="cm-rich-toolbar__sep" aria-hidden />

      <span className="cm-rich-toolbar__group cm-rich-toolbar__group--select">
        <label className="cm-rich-select-label">
          <span className="cm-sr-only">Font family</span>
          <select
            className="cm-rich-select"
            aria-label="Font family"
            value={ts.fontFamily ?? ''}
            onChange={(e) => {
              const v = e.target.value
              if (!v) editor.chain().focus().unsetFontFamily().run()
              else editor.chain().focus().setFontFamily(v).run()
            }}
          >
            {FONT_OPTIONS.map((o) => (
              <option key={o.label} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="cm-rich-select-label">
          <span className="cm-sr-only">Font size</span>
          <select
            className="cm-rich-select cm-rich-select--narrow"
            aria-label="Font size"
            value={ts.fontSize ?? ''}
            onChange={(e) => {
              const v = e.target.value
              if (!v) editor.chain().focus().unsetFontSize().run()
              else editor.chain().focus().setFontSize(v).run()
            }}
          >
            {SIZE_OPTIONS.map((o) => (
              <option key={o.label + o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </span>

      <span className="cm-rich-toolbar__sep" aria-hidden />

      <span className="cm-rich-toolbar__group cm-rich-toolbar__group--color">
        <label className="cm-rich-color">
          <span className="cm-sr-only">Text color</span>
          <input
            type="color"
            className="cm-rich-color__input"
            title="Text color"
            value={textColor}
            onInput={(e) => {
              editor.chain().focus().setColor((e.target as HTMLInputElement).value).run()
            }}
          />
          <span className="cm-rich-color__swatch" aria-hidden>
            A
          </span>
        </label>
        <label className="cm-rich-color">
          <span className="cm-sr-only">Highlight</span>
          <input
            type="color"
            className="cm-rich-color__input"
            title="Highlight color"
            value={hiColor}
            onInput={(e) => {
              editor.chain().focus().setBackgroundColor((e.target as HTMLInputElement).value).run()
            }}
          />
          <span className="cm-rich-color__swatch cm-rich-color__swatch--hi" aria-hidden>
            ■
          </span>
        </label>
      </span>

      <span className="cm-rich-toolbar__sep" aria-hidden />

      <span className="cm-rich-toolbar__group cm-rich-toolbar__group--align">
        <button
          type="button"
          className={`cm-rich-btn cm-rich-btn--icon-only ${editor.isActive({ textAlign: 'left' }) ? 'cm-rich-btn--on' : ''}`}
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          title="Align left"
          aria-label="Align left"
        >
          <IconAlignLeft className="cm-rich-toolbar-icon" />
        </button>
        <button
          type="button"
          className={`cm-rich-btn cm-rich-btn--icon-only ${editor.isActive({ textAlign: 'center' }) ? 'cm-rich-btn--on' : ''}`}
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          title="Align center"
          aria-label="Align center"
        >
          <IconAlignCenter className="cm-rich-toolbar-icon" />
        </button>
        <button
          type="button"
          className={`cm-rich-btn cm-rich-btn--icon-only ${editor.isActive({ textAlign: 'right' }) ? 'cm-rich-btn--on' : ''}`}
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          title="Align right"
          aria-label="Align right"
        >
          <IconAlignRight className="cm-rich-toolbar-icon" />
        </button>
        <button
          type="button"
          className={`cm-rich-btn cm-rich-btn--icon-only ${editor.isActive({ textAlign: 'justify' }) ? 'cm-rich-btn--on' : ''}`}
          onClick={() => editor.chain().focus().setTextAlign('justify').run()}
          title="Justify"
          aria-label="Justify"
        >
          <IconAlignJustify className="cm-rich-toolbar-icon" />
        </button>
      </span>

      <span className="cm-rich-toolbar__sep" aria-hidden />

      <span className="cm-rich-toolbar__group">
        <button
          type="button"
          className={`cm-rich-btn cm-rich-btn--icon-only ${editor.isActive('bulletList') ? 'cm-rich-btn--on' : ''}`}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          title="Bulleted list"
          aria-label="Bulleted list"
        >
          <IconListBullet className="cm-rich-toolbar-icon" />
        </button>
        <button
          type="button"
          className={`cm-rich-btn cm-rich-btn--icon-only ${editor.isActive('orderedList') ? 'cm-rich-btn--on' : ''}`}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          title="Numbered list"
          aria-label="Numbered list"
        >
          <IconListNumbered className="cm-rich-toolbar-icon" />
        </button>
        <button
          type="button"
          className="cm-rich-btn cm-rich-btn--icon-only"
          onClick={setLink}
          title="Insert link"
          aria-label="Insert link"
        >
          <IconLink className="cm-rich-toolbar-icon" />
        </button>
      </span>
    </div>
  )
}

export function ComposeRichEditor({ value, onChange, theme }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
      }),
      TextStyleKit.configure({
        lineHeight: false,
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          rel: 'noopener noreferrer',
          target: '_blank',
          class: 'cm-editor-link',
        },
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({
        placeholder: 'Write something…',
      }),
    ],
    content: value?.trim() ? value : '<p></p>',
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML())
    },
    editorProps: {
      attributes: {
        class: 'tiptap cm-editor-prose',
      },
    },
  })

  if (!editor) {
    return <div className={`cm-editor-skeleton cm-editor-skeleton--${theme}`} aria-hidden />
  }

  return (
    <div className={`cm-rich-editor cm-rich-editor--${theme}`}>
      <ComposeToolbar editor={editor} theme={theme} />
      <EditorContent editor={editor} className="cm-editor-content" />
    </div>
  )
}
