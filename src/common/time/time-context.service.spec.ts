import { describe, expect, it } from 'vitest';
import { ClockService } from './clock.service.js';
import { TimeContextService } from './time-context.service.js';

function buildService(fixedNow: Date, timezone = 'UTC') {
  const clock = new ClockService();
  clock.now = () => fixedNow;
  const configService = { get: () => timezone };
  return new TimeContextService(clock as never, configService as never);
}

describe('TimeContextService', () => {
  it('now() reflects the injected clock, never a hardcoded value', () => {
    const fixedNow = new Date('2026-09-23T09:00:00.000Z');
    const service = buildService(fixedNow);
    expect(service.now()).toEqual(fixedNow);
  });

  it('describeNow() embeds the exact ISO UTC instant from the clock', () => {
    const fixedNow = new Date('2026-09-23T09:00:00.000Z');
    const service = buildService(fixedNow);
    expect(service.describeNow()).toContain('2026-09-23T09:00:00.000Z');
  });

  it('describeNow() recomputes on every call — two different clock values never produce the same string', () => {
    let current = new Date('2026-09-23T09:00:00.000Z');
    const clock = new ClockService();
    clock.now = () => current;
    const service = new TimeContextService(clock as never, { get: () => 'UTC' } as never);

    const first = service.describeNow();
    current = new Date('2026-09-24T10:30:00.000Z');
    const second = service.describeNow();

    expect(first).not.toBe(second);
    expect(second).toContain('2026-09-24T10:30:00.000Z');
  });

  it('uses app.defaultTimezone (documented explicit default), defaulting to UTC when unset', () => {
    const withoutConfig = new TimeContextService(new ClockService(), { get: () => undefined } as never);
    expect(withoutConfig.timezone).toBe('UTC');

    const withConfig = new TimeContextService(new ClockService(), { get: () => 'Europe/Paris' } as never);
    expect(withConfig.timezone).toBe('Europe/Paris');
  });

  it('describeNow() instructs the model to use this reference and never invent one', () => {
    const service = buildService(new Date('2026-09-23T09:00:00.000Z'));
    const line = service.describeNow();
    expect(line).toMatch(/n'invente jamais/i);
    expect(line).toMatch(/référence/i);
  });
});
