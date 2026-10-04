import { describe, expect, it, vi } from 'vitest';
import { CalendarProviderRouter } from './calendar-provider.router.js';

function build(provider: 'mora' | 'google' | undefined) {
  const mora = { listEvents: vi.fn(async () => [{ id: 'mora-1' }]) };
  const google = { listEvents: vi.fn(async () => [{ id: 'google-1' }]) };
  const userSkills = { getConfig: vi.fn(async () => (provider ? { provider } : {})) };
  const router = new CalendarProviderRouter(mora as never, google as never, userSkills as never);
  return { router, mora, google, userSkills };
}

const from = new Date('2026-10-01');
const to = new Date('2026-10-31');

describe('CalendarProviderRouter', () => {
  it('uses the internal Mora calendar by default, so existing data is untouched', async () => {
    const { router, mora, google } = build(undefined);
    expect(await router.listEvents('u1', 'personal', undefined, from, to)).toEqual([{ id: 'mora-1' }]);
    expect(mora.listEvents).toHaveBeenCalled();
    expect(google.listEvents).not.toHaveBeenCalled();
  });

  it('uses Google only when the user explicitly switched the calendar skill to google', async () => {
    const { router, mora, google } = build('google');
    expect(await router.listEvents('u1', 'personal', undefined, from, to)).toEqual([{ id: 'google-1' }]);
    expect(google.listEvents).toHaveBeenCalled();
    expect(mora.listEvents).not.toHaveBeenCalled();
  });

  it('reads the provider per call, so a switch takes effect without a restart', async () => {
    const { router, userSkills } = build('mora');
    await router.listEvents('u1', 'personal', undefined, from, to);
    userSkills.getConfig.mockResolvedValueOnce({ provider: 'google' });
    expect(await router.listEvents('u1', 'personal', undefined, from, to)).toEqual([{ id: 'google-1' }]);
  });
});
