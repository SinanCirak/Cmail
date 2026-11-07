import { describe, expect, it } from 'vitest'
import { parseSenderRules, senderRuleCandidates, findSenderRuleFolder } from './senderRules'

describe('sender email and domain rules', () => {
  it('normalizes and deduplicates exact addresses and domains', () => {
    expect(parseSenderRules('JOBS@LinkedIn.com, linkedin.com; @linkedin.com\n*.LinkedIn.com')).toEqual(['jobs@linkedin.com', '@linkedin.com', '*.linkedin.com'])
  })
  it.each(['*@linkedin.com', '*linkedin.com', '@linkedin..com', '@-linkedin.com', 'Name <jobs@linkedin.com>', 'https://linkedin.com', '*.com'])('rejects invalid rule %s', (value) => {
    expect(() => parseSenderRules(value)).toThrow()
  })
  it('rejects more than twenty rules', () => {
    expect(() => parseSenderRules(Array.from({ length: 21 }, (_, i) => `user${i}@example.test`).join(','))).toThrow()
  })
  it('keeps a root domain separate from its subdomains', () => {
    const folder = { id: 'root', senders: ['@linkedin.com'] }
    expect(findSenderRuleFolder([folder], 'jobs@linkedin.com')?.id).toBe('root')
    expect(findSenderRuleFolder([folder], 'jobs@mail.linkedin.com')).toBeUndefined()
    expect(findSenderRuleFolder([folder], 'jobs@notlinkedin.com')).toBeUndefined()
  })
  it('matches wildcard subdomains with label boundaries and no root match', () => {
    const folder = { id: 'subdomains', senders: ['*.linkedin.com'] }
    expect(findSenderRuleFolder([folder], 'jobs@mail.linkedin.com')?.id).toBe('subdomains')
    expect(findSenderRuleFolder([folder], 'jobs@a.b.linkedin.com')?.id).toBe('subdomains')
    for (const address of ['jobs@linkedin.com', 'jobs@linkedin.com.evil', 'jobs@evil-linkedin.com']) {
      expect(findSenderRuleFolder([folder], address)).toBeUndefined()
    }
  })
  it('prefers exact addresses, then exact domains, then nearest wildcard parents', () => {
    expect(senderRuleCandidates('jobs@a.b.linkedin.com')).toEqual(['jobs@a.b.linkedin.com', '@a.b.linkedin.com', '*.b.linkedin.com', '*.linkedin.com'])
    const folders = [
      { id: 'broad', senders: ['*.linkedin.com'] },
      { id: 'parent', senders: ['*.b.linkedin.com'] },
      { id: 'domain', senders: ['@a.b.linkedin.com'] },
      { id: 'address', senders: ['jobs@a.b.linkedin.com'] },
    ]
    expect(findSenderRuleFolder(folders, 'jobs@a.b.linkedin.com')?.id).toBe('address')
    expect(findSenderRuleFolder(folders.slice(0, 3), 'jobs@a.b.linkedin.com')?.id).toBe('domain')
    expect(findSenderRuleFolder(folders.slice(0, 2), 'jobs@a.b.linkedin.com')?.id).toBe('parent')
  })
})
