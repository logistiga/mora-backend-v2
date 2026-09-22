import { Injectable } from '@nestjs/common';
import { ContextBuilderService } from '../context/context-builder.service.js';
import { LlmService } from '../llm/llm.service.js';
import type { AgentInput, AgentResponse } from './agent.types.js';

const SYSTEM_PROMPT_PREFIX = (displayName: string) =>
  `Tu es Mora, l'assistant personnel de ${displayName}. ` +
  "Tu réponds uniquement dans le cadre personnel de l'utilisateur (vie privée, famille, " +
  "santé, organisation perso). Tu n'as accès à aucune information professionnelle. " +
  'Réponds de façon concise et utile.';

@Injectable()
export class PersonalAgentService {
  constructor(
    private readonly llmService: LlmService,
    private readonly contextBuilder: ContextBuilderService,
  ) {}

  async handle(input: AgentInput): Promise<AgentResponse> {
    const context = await this.contextBuilder.build({
      userId: input.user.id,
      scope: 'personal',
      space: input.routerDecision.space,
      conversationId: input.conversationId,
      systemPrompt: SYSTEM_PROMPT_PREFIX(input.user.displayName),
      latestUserMessage: input.message,
    });

    const response = await this.llmService.complete({ messages: context.messages });

    return {
      content: response.content,
      metadata: {
        agent: 'personal',
        llmConfigured: response.configured,
        llmProvider: response.provider,
        intent: input.routerDecision.intent,
        retrievalMode: context.retrievalMode,
        memoriesUsed: context.memoriesUsed.length,
        usedSummary: context.usedSummary,
      },
    };
  }
}
