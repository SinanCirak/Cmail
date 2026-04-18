import type { MailMessage } from '../types/mail'

export const mockEmails: MailMessage[] = [
  {
    id: '1',
    folder: 'inbox',
    from: { name: 'AWS Notifications', email: 'no-reply@sns.amazonaws.com' },
    to: [{ name: 'You', email: 'ops@example.com' }],
    subject: 'SES: Bounce notification for message to user@client.org',
    snippet:
      'You have a new bounce. Diagnostic code: 5.1.1 — mailbox unavailable. Review suppression list…',
    body: `Hello,

Amazon SES recorded a bounce for one of your recipients.

**Recipient:** user@client.org  
**Bounce type:** Permanent  
**Diagnostic code:** 5.1.1 — mailbox unavailable  

We recommend checking your account suppression list and removing invalid addresses from active campaigns.

— Amazon SES`,
    sentAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    read: false,
    starred: true,
    hasAttachment: true,
    attachments: [
      { name: 'bounce-detail.json', size: 2048 },
      { name: 'headers.txt', size: 512 },
    ],
    labels: ['Transactional'],
  },
  {
    id: '2',
    folder: 'inbox',
    from: { name: 'Product Team', email: 'product@cmail.internal' },
    to: [{ name: 'You', email: 'ops@example.com' }],
    cc: [{ name: 'Design', email: 'design@cmail.internal' }],
    subject: 'Q2 roadmap — email analytics & templates',
    snippet:
      'Sharing the draft priorities: template versioning, send analytics drill-down, and…',
    body: `Hi team,

Here is the draft Q2 focus for Cmail:

1. **Template versioning** — diff view and rollback  
2. **Send analytics** — per-template and per-domain breakdown  
3. **Suppression UX** — bulk export and reason filters  

Let me know if you want this on the wiki before Friday.

Thanks,  
Product`,
    sentAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    read: false,
    starred: false,
    labels: ['Internal'],
  },
  {
    id: '3',
    folder: 'inbox',
    from: { name: 'Sarah Chen', email: 'sarah.chen@partner.io' },
    to: [{ name: 'You', email: 'ops@example.com' }],
    subject: 'Re: Dedicated IP warm-up schedule',
    snippet:
      'Thanks for the numbers — we can align sends to 50k/day from Monday. Attached the…',
    body: `Thanks for the warm-up numbers.

We can align outbound volume to **50k/day** starting Monday. I've attached the spreadsheet with domain splits.

Ping me if you need SES configuration screenshots for audit.

Best,  
Sarah`,
    sentAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    read: true,
    starred: true,
    hasAttachment: true,
    attachments: [{ name: 'warm-up-schedule.xlsx', size: 48200 }],
  },
  {
    id: '4',
    folder: 'inbox',
    from: { name: 'Security', email: 'security@example.com' },
    to: [{ name: 'You', email: 'ops@example.com' }],
    subject: 'DMARC aggregate report — pass rate 99.2%',
    snippet:
      'Weekly DMARC report for example.com. Total messages: 124,800. Alignment: strict…',
    body: `DMARC aggregate report (xml attached in production).

- **Pass rate:** 99.2%  
- **Total messages:** 124,800  
- **Failures:** mostly forwarded mail from third parties  

No action required unless you tighten SPF further.`,
    sentAt: new Date(Date.now() - 1000 * 60 * 60 * 50).toISOString(),
    read: true,
    starred: false,
    labels: ['Security'],
  },
  {
    id: '5',
    folder: 'sent',
    from: { name: 'You', email: 'ops@example.com' },
    to: [{ name: 'Support', email: 'support@aws.amazon.com' }],
    subject: 'Case #12345 — SES sending limits increase',
    snippet:
      'We are scaling marketing sends and need a limit review for our verified domain…',
    body: `Hello AWS Support,

We are scaling marketing sends for our verified domain **mail.example.com** and would like a sending limit review.

Current daily quota: 50,000  
Requested: 200,000  

Use case: transactional + promotional with double opt-in.

Thank you.`,
    sentAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
    read: true,
    starred: false,
  },
  {
    id: '6',
    folder: 'drafts',
    from: { name: 'You', email: 'ops@example.com' },
    to: [{ name: 'Team', email: 'team@example.com' }],
    subject: 'Weekly deliverability summary',
    snippet: '',
    body: `Team,

This week's deliverability summary:

- Inbox placement: …
- Complaint rate: …

`,
    sentAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
    read: true,
    starred: false,
  },
  {
    id: '7',
    folder: 'spam',
    from: { name: 'Prize Dept', email: 'winner@not-real.net' },
    to: [{ name: 'You', email: 'ops@example.com' }],
    subject: 'You have been selected — claim now',
    snippet: 'Click here immediately to verify your account…',
    body: 'This message was filtered as spam.',
    sentAt: new Date(Date.now() - 1000 * 60 * 60 * 120).toISOString(),
    read: true,
    starred: false,
  },
  {
    id: '8',
    folder: 'trash',
    from: { name: 'Old Newsletter', email: 'news@legacy.org' },
    to: [{ name: 'You', email: 'ops@example.com' }],
    subject: 'Unsubscribe confirmation',
    snippet: 'You have been removed from this list.',
    body: 'You have been removed from this list.',
    sentAt: new Date(Date.now() - 1000 * 60 * 60 * 200).toISOString(),
    read: true,
    starred: false,
  },
]
