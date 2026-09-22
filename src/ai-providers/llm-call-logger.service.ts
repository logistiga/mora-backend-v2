import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

export interface LogCallParams {
  userId?: string;
  providerId?: string;
  kind: string;
  model: string;
  route?: string;
  scope?: string;
  space?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  latencyMs: number;
  status: 'success' | 'error';
  errorCode?: string;
}

/**
 * Writes one observability row per call attempt. Never receives (and so
 * never stores) the API key, the raw prompt, or the raw completion — only
 * token counts, timing, and a short error code (see AGENTS §16).
 */
@Injectable()
export class LlmCallLogger {
  private readonly logger = new Logger(LlmCallLogger.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(params: LogCallParams): Promise<void> {
    try {
      await this.prisma.llmCall.create({
        data: {
          userId: params.userId,
          providerId: params.providerId,
          kind: params.kind,
          model: params.model,
          route: params.route,
          scope: params.scope,
          space: params.space,
          promptTokens: params.promptTokens,
          completionTokens: params.completionTokens,
          totalTokens: params.totalTokens,
          latencyMs: params.latencyMs,
          status: params.status,
          errorCode: params.errorCode,
        },
      });
    } catch (error) {
      // Observability must never break the actual call it's observing.
      this.logger.warn(`Failed to write llm_calls row: ${String(error)}`);
    }
  }
}
