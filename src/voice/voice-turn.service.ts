import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { VoiceTurn } from '../generated/prisma/client.js';
import type { VoiceTurnLatency } from './voice.types.js';

/**
 * Persists one row per voice turn (AGENTS Phase F §22): transcript,
 * response text, interruption flag, and per-stage latency. Never stores raw
 * audio (§45 — no raw audio anywhere in Postgres).
 */
@Injectable()
export class VoiceTurnService {
  constructor(private readonly prisma: PrismaService) {}

  async start(sessionId: string): Promise<VoiceTurn> {
    return this.prisma.voiceTurn.create({ data: { sessionId, status: 'in_progress' } });
  }

  async complete(
    id: string,
    data: {
      transcript: string;
      responseText: string;
      pendingActionId?: string;
      latency: VoiceTurnLatency;
    },
  ): Promise<VoiceTurn> {
    const claimed = await this.prisma.voiceTurn.updateMany({
      where: { id, status: 'in_progress' },
      data: {
        transcript: data.transcript,
        responseText: data.responseText,
        pendingActionId: data.pendingActionId,
        status: 'completed',
        sttLatencyMs: data.latency.sttLatencyMs,
        llmLatencyMs: data.latency.llmLatencyMs,
        ttsFirstByteMs: data.latency.ttsFirstByteMs,
        totalLatencyMs: data.latency.totalLatencyMs,
        endedAt: new Date(),
      },
    });

    if (claimed.count === 0) {
      return this.prisma.voiceTurn.findUniqueOrThrow({ where: { id } });
    }

    return this.prisma.voiceTurn.findUniqueOrThrow({ where: { id } });
  }

  async interrupt(id: string): Promise<VoiceTurn> {
    return this.prisma.voiceTurn.update({
      where: { id },
      data: { status: 'interrupted', interrupted: true, endedAt: new Date() },
    });
  }

  async fail(id: string, errorCode: string): Promise<VoiceTurn> {
    return this.prisma.voiceTurn.update({
      where: { id },
      data: { status: 'failed', errorCode, endedAt: new Date() },
    });
  }

  async listBySession(sessionId: string): Promise<VoiceTurn[]> {
    return this.prisma.voiceTurn.findMany({ where: { sessionId }, orderBy: { startedAt: 'asc' } });
  }
}
