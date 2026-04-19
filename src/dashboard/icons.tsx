type IconProps = { className?: string; title?: string }

export function IconInbox({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d="M4 6h16v12H4V6z" strokeLinejoin="round" />
      <path d="M4 10l4 4h8l4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconStar({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d="M12 3.5l2.1 5.1 5.5.4-4.2 3.6 1.3 5.4L12 15.9 7.3 18l1.3-5.4-4.2-3.6 5.5-.4L12 3.5z" />
    </svg>
  )
}

export function IconSend({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d="M22 2L11 13" strokeLinecap="round" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" strokeLinejoin="round" />
    </svg>
  )
}

export function IconDraft({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d="M4 20h16" strokeLinecap="round" />
      <path d="M4 4h10l6 6v10H4V4z" strokeLinejoin="round" />
      <path d="M14 4v6h6" strokeLinejoin="round" />
    </svg>
  )
}

export function IconSpam({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d="M12 9v4" strokeLinecap="round" />
      <circle cx="12" cy="16" r="1" fill="currentColor" stroke="none" />
      <path d="M5 20l1.5-12A2 2 0 019.5 6h5a2 2 0 011.9 1.5L19 20" strokeLinecap="round" />
    </svg>
  )
}

export function IconTrash({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d="M4 7h16" strokeLinecap="round" />
      <path d="M10 11v6M14 11v6" strokeLinecap="round" />
      <path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2" />
      <path d="M6 7l1 14a2 2 0 002 1.8h8a2 2 0 002-1.8l1-14" strokeLinejoin="round" />
    </svg>
  )
}

export function IconSearch({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3-3" strokeLinecap="round" />
    </svg>
  )
}

export function IconMenu({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
    </svg>
  )
}

export function IconRefresh({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d="M21 12a9 9 0 11-3-7" strokeLinecap="round" />
      <path d="M21 3v6h-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconSettings({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M2 12h2M20 12h2M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5" strokeLinecap="round" />
    </svg>
  )
}

export function IconPaperclip({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d="M21.4 12.6a5 5 0 01-7 0l-7-7a5 5 0 117 7l-7 7a5 5 0 01-7 0" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconArchive({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d="M4 8h16v12H4V8z" strokeLinejoin="round" />
      <path d="M4 8l2-3h12l2 3" strokeLinejoin="round" />
      <path d="M10 12h4" strokeLinecap="round" />
    </svg>
  )
}

export function IconChevronLeft({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconClose({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  )
}

export function IconCompose({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d="M12 20h9" strokeLinecap="round" />
      <path d="M16.5 3.5a2.1 2.1 0 013 3L8 18l-4 1 1-4 11.5-11.5z" strokeLinejoin="round" />
    </svg>
  )
}

export function IconFolder({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d="M4 6h6l2 2h8v10H4V6z" strokeLinejoin="round" />
    </svg>
  )
}

export function IconFolderPlus({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d="M4 6h6l2 2h8v10H4V6z" strokeLinejoin="round" />
      <path d="M12 11v6M9 14h6" strokeLinecap="round" />
    </svg>
  )
}

export function IconMoon({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d="M21 12.8A8.5 8.5 0 0111.2 3a7 7 0 109.8 9.8z" strokeLinejoin="round" />
    </svg>
  )
}

export function IconSun({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" strokeLinecap="round" />
    </svg>
  )
}

export function IconMove({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d="M5 9h14M9 5l-4 4 4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19 15h-6a2 2 0 00-2 2v4" strokeLinecap="round" />
    </svg>
  )
}

export function IconReply({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d="M9 14L4 9l5-5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 9h10.5a5.5 5.5 0 010 11H12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function IconForward({ className, title }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <path d="M15 14l5-5-5-5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 9H9.5a5.5 5.5 0 100 11H12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
