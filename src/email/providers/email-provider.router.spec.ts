import { describe, expect, it, vi } from 'vitest';
import { EmailProviderRouter } from './email-provider.router.js';

describe('EmailProviderRouter', () => {
  function build() {
    const imap = { fetchRecent: vi.fn(async () => ['imap']), send: vi.fn(async () => ({ providerMessageId: 'i' })), checkHealth: vi.fn(async () => ({ connected: true })) };
    const gmail = { fetchRecent: vi.fn(async () => ['gmail']), send: vi.fn(async () => ({ providerMessageId: 'g' })), checkHealth: vi.fn(async () => ({ connected: true })) };
    return { router: new EmailProviderRouter(imap as never, gmail as never), imap, gmail };
  }

  it('sends a gmail-backed account through the Gmail provider only', async () => {
    const { router, gmail, imap } = build();
    await router.fetchRecent({ provider: 'gmail' } as never);
    expect(gmail.fetchRecent).toHaveBeenCalled();
    expect(imap.fetchRecent).not.toHaveBeenCalled();
  });

  it('keeps every other account on IMAP/SMTP, unchanged', async () => {
    const { router, gmail, imap } = build();
    await router.checkHealth({ provider: 'imap_smtp' } as never);
    expect(imap.checkHealth).toHaveBeenCalled();
    expect(gmail.checkHealth).not.toHaveBeenCalled();
  });
});
