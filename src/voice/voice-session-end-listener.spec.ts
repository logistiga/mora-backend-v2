import { describe, expect, it, vi } from 'vitest';
import { VoiceSessionService } from './voice-session.service.js';
import type { PrismaService } from '../database/prisma.service.js';

function buildService(status: string) {
  const session = { id: 'session-1', userId: 'user-1', status };
  const prisma = {
    voiceSession: {
      findUnique: vi.fn().mockResolvedValue(session),
      update: vi.fn().mockResolvedValue({ ...session, status: 'ended' }),
    },
  } as unknown as PrismaService;
  return { service: new VoiceSessionService(prisma), prisma };
}

describe('VoiceSessionService end listeners (regression, stabilization S)', () => {
  it('notifies listeners so the WebSocket transport can close a REST-ended session', async () => {
    const { service } = buildService('listening');
    const listener = vi.fn();
    service.onSessionEnded(listener);

    await service.end('user-1', 'session-1');

    expect(listener).toHaveBeenCalledWith('session-1');
  });

  it('does not notify again for an already ended session', async () => {
    const { service } = buildService('ended');
    const listener = vi.fn();
    service.onSessionEnded(listener);

    await service.end('user-1', 'session-1');

    expect(listener).not.toHaveBeenCalled();
  });
});
