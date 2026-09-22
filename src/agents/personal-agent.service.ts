import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service.js';
import type { AgentInput, AgentResponse } from './agent.types.js';

@Injectable()
export class PersonalAgentService {
  constructor(private readonly llmService: LlmService) {}

  async handle(input: AgentInput): Promise<AgentResponse> {
    const response = await this.llmService.complete({
      messages: [
        {
          role: 'system',
          content:
            `Tu es Mora, l'assistant personnel de ${input.user.displayName}. ` +
            "Tu réponds uniquement dans le cadre personnel de l'utilisateur (vie privée, famille, " +
            "santé, organisation perso). Tu n'as accès à aucune information professionnelle. " +
            'Réponds de façon concise et utile.',
        },
        ...input.context.history,
        { role: 'user', content: input.message },
      ],
    });

    return {
      content: response.content,
      metadata: {
        agent: 'personal',
        llmConfigured: response.configured,
        llmProvider: response.provider,
        intent: input.routerDecision.intent,
      },
    };
  }
}
