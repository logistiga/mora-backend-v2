import { describe, expect, it, vi } from 'vitest';
import { AvatarStateService } from '../avatar/avatar-state.service.js';
import { VoiceGateway } from './voice.gateway.js';
import { VoiceRuntimeRegistry } from './voice-runtime.registry.js';
import { EndOfTurnService } from './vad/end-of-turn.service.js';

function makeGateway(session: unknown, expired: boolean) {
  const sessionService = {
    transition: vi.fn(async () => undefined),
    getById: vi.fn(async () => session),
    isExpired: vi.fn(() => expired),
    end: vi.fn(),
  };

  const gateway = new VoiceGateway(
    {} as never,
    {} as never,
    {} as never,
    sessionService as never,
    { start: vi.fn(), interrupt: vi.fn(), complete: vi.fn(), fail: vi.fn() } as never,
    new VoiceRuntimeRegistry(),
    { run: vi.fn() } as never,
    { createStt: vi.fn(), createTts: vi.fn() } as never,
    new EndOfTurnService(),
    { markMessageInterrupted: vi.fn() } as never,
    { cancel: vi.fn() } as never,
    new AvatarStateService(),
  );

  const socket = { readyState: 1, send: vi.fn(), close: vi.fn() };
  return { gateway, socket };
}

async function sendStart(gateway: VoiceGateway, socket: unknown, sessionId: string) {
  const raw = Buffer.from(JSON.stringify({ event: 'session.start', data: { sessionId } }));
  await (gateway as never as { handleMessage: (...args: unknown[]) => Promise<void> }).handleMessage(
    socket,
    'user-1',
    'connection-1',
    false,
    raw,
    null,
    () => undefined,
  );
}

describe('VoiceGateway close codes (regression, stabilization T)', () => {
  it('closes with 4004 when the session exceeded its max duration', async () => {
    const session = {
      id: 'session-1',
      userId: 'user-1',
      status: 'listening',
      scope: 'personal',
      space: 'default',
      language: 'fr',
      conversationId: 'conv-1',
      startedAt: new Date(0),
    };
    const { gateway, socket } = makeGateway(session, true);

    await sendStart(gateway, socket, 'session-1');

    expect(socket.close).toHaveBeenCalledWith(4004, 'session_expired');
    const errors = socket.send.mock.calls
      .map(([payload]) => JSON.parse(payload as string))
      .filter((payload) => payload.event === 'error');
    expect(errors[0].data.code).toBe('session_expired');
  });

  it('closes with 4003 when the session does not belong to the authenticated user', async () => {
    const session = { id: 'session-1', userId: 'someone-else', status: 'listening', startedAt: new Date() };
    const { gateway, socket } = makeGateway(session, false);

    await sendStart(gateway, socket, 'session-1');

    expect(socket.close).toHaveBeenCalledWith(4003, 'session_not_found');
  });
});
