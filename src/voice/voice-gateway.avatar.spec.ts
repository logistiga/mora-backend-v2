import { describe, expect, it, vi } from 'vitest';
import { AvatarStateService } from '../avatar/avatar-state.service.js';
import { VoiceGateway } from './voice.gateway.js';
import { VoiceRuntimeRegistry } from './voice-runtime.registry.js';
import { EndOfTurnService } from './vad/end-of-turn.service.js';

describe('VoiceGateway — avatar realtime contract', () => {
  it('emits interrupted and recovery avatar states during barge-in', () => {
    const registry = new VoiceRuntimeRegistry();
    const gateway = new VoiceGateway(
      {} as never,
      {} as never,
      {} as never,
      { transition: vi.fn(async () => undefined) } as never,
      { interrupt: vi.fn(async () => undefined) } as never,
      registry,
      {} as never,
      {} as never,
      new EndOfTurnService(),
      { markMessageInterrupted: vi.fn(async () => undefined) } as never,
      { cancel: vi.fn(async () => ({ status: 'cancelled' })) } as never,
      new AvatarStateService(),
    );

    registry.create({
      sessionId: 'session-1',
      userId: 'user-1',
      scope: 'personal',
      space: 'personal',
      language: 'fr',
      conversationId: 'conv-1',
    });

    const socket = { readyState: 1, send: vi.fn() };
    (gateway as any).sockets.set('session-1', socket);

    (gateway as any).interrupt('session-1');

    const events = socket.send.mock.calls.map(([payload]) => JSON.parse(payload as string));
    expect(events.map((event) => event.event)).toContain('session.interrupted');
    expect(events.filter((event) => event.event === 'avatar.state').map((event) => event.data.state)).toEqual(['interrupted', 'listening']);
    expect(events.find((event) => event.event === 'assistant.expression')?.data.state).toBe('interrupted');
  });

  it('emits a reconnecting avatar state before session ready on reconnect', async () => {
    const registry = new VoiceRuntimeRegistry();
    const transition = vi.fn(async () => undefined);
    const gateway = new VoiceGateway(
      {} as never,
      {} as never,
      {} as never,
      {
        getById: vi.fn(async () => ({
          id: 'session-1',
          userId: 'user-1',
          scope: 'personal',
          space: 'personal',
          language: 'fr',
          conversationId: 'conv-1',
          status: 'paused',
        })),
        isExpired: vi.fn(() => false),
        transition,
      } as never,
      {} as never,
      registry,
      {} as never,
      {} as never,
      new EndOfTurnService(),
      {} as never,
      {} as never,
      new AvatarStateService(),
    );

    const socket = { readyState: 1, send: vi.fn(), close: vi.fn() };

    await (gateway as any).handleMessage(
      socket,
      'user-1',
      'connection-1',
      false,
      Buffer.from(JSON.stringify({ event: 'session.start', data: { sessionId: 'session-1' } })),
      null,
      vi.fn(),
    );

    const events = socket.send.mock.calls.map(([payload]) => JSON.parse(payload as string));
    expect(transition).toHaveBeenCalledWith('session-1', 'listening');
    expect(events.slice(0, 3).map((event) => event.event)).toEqual(['avatar.state', 'session.ready', 'avatar.state']);
    expect(events[0].data.connection).toBe('reconnecting');
    expect(events[2].data.connection).toBe('connected');
  });
});
