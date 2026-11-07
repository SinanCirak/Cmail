const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const LOCAL_PART = /^[a-z0-9.!#$%&'+/=?^_`{|}~-]+$/
const ERROR = 'Use up to 20 rules: jobs@linkedin.com, @linkedin.com, or *.linkedin.com.'

function domain(value: string): string {
  const labels = value.split('.')
  if (value.length > 253 || labels.length < 2 || labels.some((label) => !DOMAIN_LABEL.test(label)) || !/^[a-z]{2,63}$/.test(labels.at(-1) ?? '')) {
    throw new Error(ERROR)
  }
  return value
}

function email(value: string): string {
  const parts = value.split('@')
  const local = parts[0]
  if (value.length > 254 || parts.length !== 2 || !LOCAL_PART.test(local) || local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    throw new Error(ERROR)
  }
  return `${local}@${domain(parts[1])}`
}

export function parseSenderRules(text: string): string[] {
  const values = text.toLowerCase().split(/[\s,;]+/).filter(Boolean)
  if (values.length > 20) throw new Error(ERROR)
  return [...new Set(values.map((value) => {
    if (value.startsWith('*.')) return `*.${domain(value.slice(2))}`
    if (value.startsWith('@')) return `@${domain(value.slice(1))}`
    if (value.includes('@')) return email(value)
    return `@${domain(value)}`
  }))]
}

export function senderRuleCandidates(address: string): string[] {
  try {
    const sender = email(address.toLowerCase())
    const senderDomain = sender.split('@')[1]
    const labels = senderDomain.split('.')
    return [sender, `@${senderDomain}`, ...labels.slice(1, -1).map((_, i) => `*.${labels.slice(i + 1).join('.')}`)]
  } catch { return [] }
}

export function findSenderRuleFolder<T extends { senders?: string[] }>(folders: T[], sender: string): T | undefined {
  for (const rule of senderRuleCandidates(sender)) {
    const folder = folders.find((item) => item.senders?.includes(rule))
    if (folder) return folder
  }
  return undefined
}
