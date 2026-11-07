import { useRef, useState } from 'react'

const MIN_WIDTH = 240
const MAX_WIDTH = 420
const DEFAULT_WIDTH = 280

export function SidebarResizeHandle({ width, onChange }: { width: number; onChange: (width: number) => void }) {
  const drag = useRef<{ x: number; width: number } | null>(null)
  const latestWidth = useRef(width)
  const [resizing, setResizing] = useState(false)

  function change(next: number, persist = false) {
    const value = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(next)))
    latestWidth.current = value
    onChange(value)
    if (persist) {
      try { localStorage.setItem('cmail-sidebar-width', String(value)) } catch { /* Browser storage is optional. */ }
    }
  }

  return <div role="separator" aria-label="Resize folder menu" aria-orientation="vertical"
    aria-controls="cm-folder-sidebar" aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH} aria-valuenow={width}
    tabIndex={0} className="cm-sidebar-resize" data-resizing={resizing}
    title="Drag to resize folders. Double-click to reset."
    onPointerDown={(e) => {
      if (e.button !== 0) return
      drag.current = { x: e.clientX, width }
      latestWidth.current = width
      e.currentTarget.setPointerCapture(e.pointerId)
      setResizing(true)
      e.preventDefault()
    }}
    onPointerMove={(e) => {
      if (drag.current) change(drag.current.width + e.clientX - drag.current.x)
    }}
    onPointerUp={(e) => {
      if (!drag.current) return
      drag.current = null
      change(latestWidth.current, true)
      setResizing(false)
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    }}
    onLostPointerCapture={() => { drag.current = null; setResizing(false) }}
    onPointerCancel={() => { drag.current = null; setResizing(false) }}
    onDoubleClick={() => change(DEFAULT_WIDTH, true)}
    onKeyDown={(e) => {
      const step = e.shiftKey ? 40 : 10
      const next = e.key === 'ArrowLeft' ? width - step : e.key === 'ArrowRight' ? width + step
        : e.key === 'Home' ? MIN_WIDTH : e.key === 'End' ? MAX_WIDTH : null
      if (next === null) return
      e.preventDefault()
      change(next, true)
    }} />
}
