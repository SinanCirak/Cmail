import type { ReactNode } from 'react'

type IconProps = { className?: string; title?: string }
function Icon({ className, title, children }: IconProps & { children: ReactNode }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true}>
    {title ? <title>{title}</title> : null}{children}
  </svg>
}

export function IconInbox(props: IconProps) {
  return <Icon {...props}><path d="m4 4-2 9v5a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5l-2-9H4Z"/><path d="M2 13h6l2 3h4l2-3h6"/></Icon>
}

export function IconStar(props: IconProps) {
  return <Icon {...props}><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z"/></Icon>
}

export function IconSend(props: IconProps) {
  return <Icon {...props}><path d="m21 3-7 18-4-7-7-4L21 3Z"/><path d="m10 14 5-5"/></Icon>
}

export function IconDraft(props: IconProps) {
  return <Icon {...props}><path d="M14 3H5v18h14V8l-5-5Z"/><path d="M14 3v5h5M8 12h8M8 16h5"/></Icon>
}

export function IconSpam(props: IconProps) {
  return <Icon {...props}><path d="m8 3-5 5v8l5 5h8l5-5V8l-5-5H8Z"/><path d="M12 7v6m0 4h.01"/></Icon>
}

export function IconTrash(props: IconProps) {
  return <Icon {...props}><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/></Icon>
}

export function IconSearch(props: IconProps) {
  return <Icon {...props}><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/></Icon>
}

export function IconMenu(props: IconProps) {
  return <Icon {...props}><path d="M4 6h16M4 12h16M4 18h16"/></Icon>
}

export function IconRefresh(props: IconProps) {
  return <Icon {...props}><path d="M20 4v6h-6"/><path d="M20 10a8 8 0 1 0 .5 5"/></Icon>
}

export function IconSettings(props: IconProps) {
  return <Icon {...props}><path d="m9 3-.6 2.2-1.7 1-2.2-.6-2 3.5 1.6 1.6v2.6l-1.6 1.6 2 3.5 2.2-.6 1.7 1L9 21h6l.6-2.2 1.7-1 2.2.6 2-3.5-1.6-1.6v-2.6l1.6-1.6-2-3.5-2.2.6-1.7-1L15 3H9Z"/><circle cx="12" cy="12" r="3"/></Icon>
}

export function IconPaperclip(props: IconProps) {
  return <Icon {...props}><path d="m8 13 7-7a3.5 3.5 0 0 1 5 5l-9 9a5 5 0 0 1-7-7l9-9M7 16l9-9"/></Icon>
}

export function IconArchive(props: IconProps) {
  return <Icon {...props}><rect x="3" y="3" width="18" height="4" rx="1.5"/><path d="M5 7v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7M10 11h4"/></Icon>
}

export function IconChevronLeft(props: IconProps) {
  return <Icon {...props}><path d="m15 5-7 7 7 7"/></Icon>
}

export function IconClose(props: IconProps) {
  return <Icon {...props}><path d="m6 6 12 12M18 6 6 18"/></Icon>
}

export function IconCompose(props: IconProps) {
  return <Icon {...props}><path d="m15 5 4 4M4 20l1-5L16.5 3.5a2.8 2.8 0 0 1 4 4L9 19l-5 1Z"/></Icon>
}

export function IconFolder(props: IconProps) {
  return <Icon {...props}><path d="M3 8V5a2 2 0 0 1 2-2h4l3 4h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z"/></Icon>
}

export function IconFolderPlus(props: IconProps) {
  return <Icon {...props}><path d="M3 8V5a2 2 0 0 1 2-2h4l3 4h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z"/><path d="M12 10v7m-3.5-3.5h7"/></Icon>
}

export function IconMoon(props: IconProps) {
  return <Icon {...props}><path d="M20.8 13.2A8.5 8.5 0 0 1 10.8 3 8.8 8.8 0 1 0 20.8 13.2Z"/></Icon>
}

export function IconSun(props: IconProps) {
  return <Icon {...props}><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></Icon>
}

export function IconMove(props: IconProps) {
  return <Icon {...props}><path d="M3 8V5a2 2 0 0 1 2-2h4l3 4h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z"/><path d="M8 13h8m-3-3 3 3-3 3"/></Icon>
}

export function IconReply(props: IconProps) {
  return <Icon {...props}><path d="m9 5-6 6 6 6"/><path d="M3 11h11a7 7 0 0 1 7 7v2"/></Icon>
}

export function IconForward(props: IconProps) {
  return <Icon {...props}><path d="m15 5 6 6-6 6"/><path d="M21 11H10a7 7 0 0 0-7 7v2"/></Icon>
}

export function IconPrint(props: IconProps) {
  return <Icon {...props}><path d="M6 8V3h12v5M6 17H3V8h18v9h-3"/><path d="M6 14h12v7H6zM17 11h1"/></Icon>
}

export function IconExpand(props: IconProps) {
  return <Icon {...props}><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><path d="m3 3 6 6m12-6-6 6M3 21l6-6m12 6-6-6"/></Icon>
}

export function IconCollapse(props: IconProps) {
  return <Icon {...props}><path d="M9 3v6H3m12-6v6h6M3 15h6v6m6 0v-6h6"/></Icon>
}
