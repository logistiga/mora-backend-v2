import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { VoiceSession } from '../generated/prisma/client.js';
import { VOICE_STATE_TRANSITIONS, type VoiceMode, type VoiceSessionState } from './voice.types.js';

export interface CreateVoiceSessionParams {
  userId: string;
  conversationId?: string;
  scope: 'personal' | 'professional';
  space: string;
  language: string;
  mode: VoiceMode;
  timezone: string;
  sttProvider?: string;
  ttsProvider?: string;
}

const MAX_SESSION_DURATION_MS = 2 * 60 * 60 * 1000; // 2h hard cap (AGENTS Phase F §26)

/**
 * DB-backed lifecycle for VoiceSession rows: creation, ownership-checked
 * reads, and validated state transitions (AGENTS Phase F §4). Runtime-only
 * objects (live STT session, VAD instance, TTS AbortController) are never
 * stored here — see VoiceRuntimeRegistry for those; this service is the
 * single source of truth for the PERSISTED session state and metadata.
 */
@Injectable()
export class VoiceSessionService {
  private readonly logger = new Logger(VoiceSessionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(params: CreateVoiceSessionParams): Promise<VoiceSession> {
    let conversationId = params.conversationId;
    if (!conversationId) {
      const conversation = await this.prisma.conversation.create({
        data: { userId: params.userId },
      });
      conversationId = conversation.id;
    } else {
      const owned = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
      if (!owned || owned.userId !== params.userId) {
        throw new ForbiddenException('This conversation does not belong to you');
      }
    }

    return this.prisma.voiceSession.create({
      data: {
        userId: params.userId,
        conversationId,
        scope: params.scope,
        space: params.space,
        status: 'created',
        language: params.language,
        mode: params.mode,
        timezone: params.timezone,
        sttProvider: params.sttProvider,
        ttsProvider: params.ttsProvider,
      },
    });
  }

  async getOwned(userId: string, id: string): Promise<VoiceSession> {
    const session = await this.prisma.voiceSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Voice session not found');
    if (session.userId !== userId) {
      // Cross-user session access must be refused, never even confirm existence beyond 403 (AGENTS §27).
      throw new ForbiddenException('This voice session does not belong to you');
    }
    return session;
  }

  /** Same as getOwned but used internally by the gateway, which has already authenticated the socket. */
  async getById(id: string): Promise<VoiceSession | null> {
    return this.prisma.voiceSession.findUnique({ where: { id } });
  }

  async transition(id: string, to: VoiceSessionState): Promise<VoiceSession> {
    const session = await this.prisma.voiceSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundException('Voice session not found');

    const from = session.status as VoiceSessionState;
    const allowed = VOICE_STATE_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(`Invalid voice session transition: ${from} -> ${to}`);
    }

    return this.prisma.voiceSession.update({
      where: { id },
      data: { status: to, ...(to === 'ended' ? { endedAt: new Date() } : {}) },
    });
  }

  async end(userId: string, id: string): Promise<VoiceSession> {
    const session = await this.getOwned(userId, id);
    if (session.status === 'ended') return session;
    return this.prisma.voiceSession.update({
      where: { id },
      data: { status: 'ended', endedAt: new Date() },
    });
  }

  /** Enforces the hard max-duration cap; called on each inbound socket event. */
  isExpired(session: VoiceSession): boolean {
    return Date.now() - session.startedAt.getTime() > MAX_SESSION_DURATION_MS;
  }

  /** Cleanup sweep for stale sessions (never-ended, disconnected clients) — called by a scheduled task or on reconnect. */
  async endStaleSessions(olderThanMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const result = await this.prisma.voiceSession.updateMany({
      where: { status: { notIn: ['ended', 'error'] }, updatedAt: { lt: cutoff } },
      data: { status: 'ended', endedAt: new Date() },
    });
    if (result.count > 0) this.logger.log(`Ended ${result.count} stale voice session(s)`);
    return result.count;
  }
}
