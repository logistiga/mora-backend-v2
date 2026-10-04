import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleCalendarProvider } from './google-calendar.provider.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function build() {
  const oauth = { getAccessToken: vi.fn(async () => 'AT') };
  return { provider: new GoogleCalendarProvider(oauth as never), oauth };
}

const base = {
  userId: 'u1',
  scope: 'professional' as const,
  space: 'logistiga',
  title: 'Point client',
  startsAt: new Date('2026-10-05T09:00:00.000Z'),
  endsAt: new Date('2026-10-05T10:00:00.000Z'),
  timezone: 'Africa/Libreville',
};

describe('GoogleCalendarProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('creates an event on the primary calendar with its Mora scope/space as private labels', async () => {
    const { provider } = build();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 'g1',
        summary: 'Point client',
        start: { dateTime: base.startsAt.toISOString(), timeZone: base.timezone },
        end: { dateTime: base.endsAt.toISOString(), timeZone: base.timezone },
        extendedProperties: { private: { mora_scope: 'professional', mora_space: 'logistiga' } },
      }),
    );

    const record = await provider.createEvent(base);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer AT');
    const sent = JSON.parse(init.body);
    expect(sent.extendedProperties.private).toEqual({ mora_scope: 'professional', mora_space: 'logistiga' });
    expect(record.id).toBe('g1');
    expect(record.scope).toBe('professional');
    expect(record.space).toBe('logistiga');
    expect(record.source).toBe('google');
  });

  it('never returns another scope\'s labelled events from a listing', async () => {
    const { provider } = build();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          { id: 'mine', summary: 'A', start: { dateTime: base.startsAt.toISOString() }, end: { dateTime: base.endsAt.toISOString() }, extendedProperties: { private: { mora_scope: 'professional', mora_space: 'logistiga' } } },
          { id: 'perso', summary: 'B', start: { dateTime: base.startsAt.toISOString() }, end: { dateTime: base.endsAt.toISOString() }, extendedProperties: { private: { mora_scope: 'personal', mora_space: 'personal' } } },
        ],
      }),
    );

    const events = await provider.listEvents('u1', 'professional', 'logistiga', new Date('2026-10-01'), new Date('2026-10-31'));
    expect(events.map((e) => e.id)).toEqual(['mine']);
  });

  it('keeps unlabelled events created directly in Google visible to the user', async () => {
    const { provider } = build();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [{ id: 'direct', summary: 'Dentiste', start: { date: '2026-10-07' }, end: { date: '2026-10-07' } }] }),
    );
    const events = await provider.listEvents('u1', 'personal', undefined, new Date('2026-10-01'), new Date('2026-10-31'));
    expect(events.map((e) => e.id)).toEqual(['direct']);
    expect(events[0].title).toBe('Dentiste');
  });

  it('returns null for an unknown event instead of throwing', async () => {
    const { provider } = build();
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'not found' }, 404));
    expect(await provider.getEvent('u1', 'missing')).toBeNull();
  });

  it('surfaces other Google API errors without leaking the response body beyond a short excerpt', async () => {
    const { provider } = build();
    fetchMock.mockResolvedValueOnce(new Response('x'.repeat(500), { status: 500 }));
    await expect(provider.getEvent('u1', 'e1')).rejects.toThrow(/Google Calendar API 500/);
  });

  it('computes free slots from the busy intervals inside working hours', async () => {
    const { provider } = build();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        calendars: { primary: { busy: [{ start: '2026-10-05T10:00:00.000Z', end: '2026-10-05T11:00:00.000Z' }] } },
      }),
    );
    const slots = await provider.findFreeSlots(
      'u1',
      'professional',
      'logistiga',
      new Date('2026-10-05T08:00:00.000Z'),
      new Date('2026-10-05T14:00:00.000Z'),
      30,
    );
    const starts = slots.map((s) => s.startsAt.toISOString());
    expect(starts).toContain('2026-10-05T08:00:00.000Z');
    expect(starts).toContain('2026-10-05T11:00:00.000Z');
    expect(slots.every((s) => s.endsAt.getTime() - s.startsAt.getTime() >= 30 * 60 * 1000)).toBe(true);
  });

  it('cancels by deleting the Google event and reports it as cancelled', async () => {
    const { provider } = build();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: 'g1', summary: 'X', start: { dateTime: base.startsAt.toISOString() }, end: { dateTime: base.endsAt.toISOString() } }),
    );
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const record = await provider.cancelEvent('u1', 'g1');
    expect(record.status).toBe('cancelled');
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
  });
});
