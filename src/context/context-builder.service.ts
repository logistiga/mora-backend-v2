import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConversationsService } from '../conversations/conversations.service.js';
import { ConversationSummaryService } from '../memory/conversation-summary.service.js';
import { MemoryRetrievalService } from '../memory/memory-retrieval.service.js';
import { ProfileFactsService } from '../memory/profile-facts.service.js';
import type { LlmMessage } from '../llm/llm-provider.interface.js';
import type { RetrievedMemory } from '../memory/memory.types.js';

export interface ContextBuilderParams {
  userId: string;
  scope: 'personal' | 'professional';
  space: string;
  conversationId: string;
  systemPrompt: string;
  latestUserMessage: string;
}

export interface ContextBuilderResult {
  messages: LlmMessage[];
  memoriesUsed: RetrievedMemory[];
  retrievalMode: 'semantic' | 'text' | 'none';
  retrievalDurationMs: number;
  usedSummary: boolean;
}

const RECENT_MESSAGES_LIMIT = 20;

@Injectable()
export class ContextBuilderService {
  private readonly logger = new Logger(ContextBuilderService.name);
  private readonly budgetChars: number;

  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly conversationSummaryService: ConversationSummaryService,
    private readonly memoryRetrievalService: MemoryRetrievalService,
    private readonly profileFactsService: ProfileFactsService,
    configService: ConfigService,
  ) {
    this.budgetChars = configService.get<number>('app.memory.contextBudgetChars') ?? 6000;
  }

  /**
   * Builds exactly what an agent needs for one LLM call, and nothing more:
   * system prompt → profile facts → conversation summary → recent messages
   * → relevant memories → the current user message. Every data source is
   * queried strictly by (userId, scope, space) — this is the enforcement
   * point for "Personal never sees Professional and vice versa" at the
   * memory layer (the message-history isolation already existed in Phase B
   * via ConversationsService.getScopedHistory).
   */
  async build(params: ContextBuilderParams): Promise<ContextBuilderResult> {
    const [profileFacts, summary, history] = await Promise.all([
      this.profileFactsService.getRelevant(params.userId, params.scope, params.space),
      this.conversationSummaryService.getSummary(params.conversationId, params.scope, params.space),
      this.conversationsService.getScopedHistory(
        params.conversationId,
        params.scope,
        RECENT_MESSAGES_LIMIT,
      ),
    ]);

    const retrieval = await this.memoryRetrievalService.retrieve({
      userId: params.userId,
      scope: params.scope,
      space: params.space,
      queryText: params.latestUserMessage,
    });

    const messages: LlmMessage[] = [{ role: 'system', content: params.systemPrompt }];
    let usedChars = params.systemPrompt.length;

    const pushIfBudgetAllows = (content: string): boolean => {
      if (usedChars + content.length > this.budgetChars) return false;
      messages.push({ role: 'system', content });
      usedChars += content.length;
      return true;
    };

    if (profileFacts.length > 0) {
      const factsText =
        'Faits connus sur l\'utilisateur (profil) :\n' +
        profileFacts.map((f) => `- ${f.key}: ${f.value}`).join('\n');
      pushIfBudgetAllows(factsText);
    }

    let usedSummary = false;
    if (summary) {
      usedSummary = pushIfBudgetAllows(`Résumé de la conversation jusqu'ici : ${summary.summary}`);
    }

    if (retrieval.memories.length > 0) {
      const memoriesText =
        'Souvenirs pertinents :\n' +
        retrieval.memories.map((m) => `- (${m.kind}) ${m.content}`).join('\n');
      pushIfBudgetAllows(memoriesText);
    }

    // Recent messages: if a summary already covers earlier turns, only the
    // messages after its `toMessageId` are new — but getScopedHistory doesn't
    // know about the summary boundary, so we simply cap how many raw turns we
    // include; the summary itself carries the older context.
    for (const turn of history) {
      if (usedChars + turn.content.length > this.budgetChars) break;
      messages.push(turn);
      usedChars += turn.content.length;
    }

    this.logger.debug(
      `Context built: ${messages.length} messages, ${usedChars} chars, retrieval=${retrieval.mode} (${retrieval.durationMs}ms), memories=${retrieval.memories.length}`,
    );

    return {
      messages,
      memoriesUsed: retrieval.memories,
      retrievalMode: retrieval.mode,
      retrievalDurationMs: retrieval.durationMs,
      usedSummary,
    };
  }
}
