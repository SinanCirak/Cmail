/** Inline SVGs — Word-style toolbar (alignment lines, lists, link, undo/redo). */

type IconProps = { className?: string }

export function IconUndo({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 110 11H11" />
    </svg>
  )
}

export function IconRedo({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 100 11H13" />
    </svg>
  )
}

/** Lines flush left */
export function IconAlignLeft({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" aria-hidden>
      <path d="M4 6h16M4 10h10M4 14h14M4 18h8" />
    </svg>
  )
}

/** Lines centered */
export function IconAlignCenter({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" aria-hidden>
      <path d="M4 6h16M7 10h10M5 14h14M8 18h8" />
    </svg>
  )
}

/** Lines flush right */
export function IconAlignRight({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" aria-hidden>
      <path d="M4 6h16M10 10h10M6 14h14M12 18h8" />
    </svg>
  )
}

/** Justify — equal full-width lines */
export function IconAlignJustify({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" aria-hidden>
      <path d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  )
}

export function IconListBullet({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="5" cy="6" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="5" cy="18" r="1.35" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconListNumbered({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <text x="2" y="8.5" fontSize="7.5" fontFamily="system-ui, sans-serif" fontWeight="600">
        1.
      </text>
      <text x="2" y="14.5" fontSize="7.5" fontFamily="system-ui, sans-serif" fontWeight="600">
        2.
      </text>
      <text x="2" y="20.5" fontSize="7.5" fontFamily="system-ui, sans-serif" fontWeight="600">
        3.
      </text>
      <path
        d="M11 6h10M11 12h10M11 18h10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function IconLink({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 13a5 5 0 010-7l1-1a5 5 0 017 7l-1 1" />
      <path d="M14 11a5 5 0 010 7l-1 1a5 5 0 01-7-7l1-1" />
    </svg>
  )
}
