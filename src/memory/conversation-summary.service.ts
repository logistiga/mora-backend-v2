import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service.js';
import { MessageRole, type ConversationSummary } from '../generated/prisma/client.js';
import { LlmService } from '../llm/llm.service.js';

const APPROX_CHARS_PER_TOKEN = 4;

@Injectable()
export class ConversationSummaryService {
  private readonly logger = new Logger(ConversationSummaryService.name);
  private readonly messageThreshold: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    configService: ConfigService,
  ) {
    this.messageThreshold = configService.get<number>('app.memory.summaryMessageThreshold') ?? 20;
  }

  async getSummary(conversationId: string, scope: string, space: string): Promise<ConversationSummary | null> {
    return this.prisma.conversationSummary.findUnique({
      where: { conversationId_scope_space: { conversationId, scope, space } },
    });
  }

  /** True only when there are enough NEW (unsummarized) messages to be worth an LLM call. */
  async shouldSummarize(conversationId: string, scope: string, space: string): Promise<boolean> {
    const existing = await this.getSummary(conversationId, scope, space);
    const newMessageCount = await this.prisma.message.count({
      where: {
        conversationId,
        scope: { in: [scope, 'direct'] },
        ...(existing?.toMessageId ? { createdAt: { gt: (await this.messageCreatedAt(existing.toMessageId)) ?? new Date(0) } } : {}),
      },
    });
    return newMessageCount >= this.messageThreshold;
  }

  private async messageCreatedAt(messageId: string): Promise<Date | null> {
    const message = await this.prisma.message.findUnique({ where: { id: messageId } });
    return message?.createdAt ?? null;
  }

  /**
   * Progressively updates the (conversationId, scope, space) summary: only
   * the messages since the last summarized point are sent to the LLM, along
   * with the previous summary text to extend rather than replace it.
   */
  async summarize(
    conversationId: string,
    userId: string,
    scope: string,
    space: string,
  ): Promise<ConversationSummary | null> {
    const existing = await this.getSummary(conversationId, scope, space);
    const since = existing?.toMessageId ? await this.messageCreatedAt(existing.toMessageId) : null;

    const newMessages = await this.prisma.message.findMany({
      where: {
        conversationId,
        scope: { in: [scope, 'direct'] },
        ...(since ? { createdAt: { gt: since } } : {}),
      },
      orderBy: { createdAt: 'asc' },
    });

    if (newMessages.length === 0) {
      return existing;
    }

    const transcript = newMessages
      .map((m) => `${m.role === MessageRole.USER ? 'Utilisateur' : 'Assistant'}: ${m.content}`)
      .join('\n');

    const response = await this.llmService.complete(
      {
        messages: [
          {
            role: 'system',
            content: existing
              ? 'Tu mets à jour un résumé de conversation existant avec de nouveaux messages. ' +
                'Réponds uniquement avec le résumé mis à jour (français, condensé, factuel, sans ' +
                'préambule).'
              : 'Tu résumes une conversation (français, condensé, factuel, sans préambule).',
          },
          ...(existing ? [{ role: 'system' as const, content: `Résumé actuel: ${existing.summary}` }] : []),
          { role: 'user', content: transcript },
        ],
        temperature: 0.2,
        maxTokens: 400,
      },
      { userId, scope, space, route: 'conversation-summary' },
    );

    if (!response.configured) {
      this.logger.debug('Skipping conversation summary: no LLM provider configured (env or DB)');
      return existing;
    }

    const summaryText = response.content.trim();
    const lastMessage = newMessages[newMessages.length - 1];
    const messageCount = (existing?.messageCount ?? 0) + newMessages.length;
    const approxTokenCount = Math.ceil(summaryText.length / APPROX_CHARS_PER_TOKEN);

    return this.prisma.conversationSummary.upsert({
      where: { conversationId_scope_space: { conversationId, scope, space } },
      create: {
        conversationId,
        userId,
        scope,
        space,
        summary: summaryText,
        fromMessageId: newMessages[0].id,
        toMessageId: lastMessage.id,
        messageCount,
        approxTokenCount,
      },
      update: {
        summary: summaryText,
        toMessageId: lastMessage.id,
        messageCount,
        approxTokenCount,
      },
    });
  }
}
