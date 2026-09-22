import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service.js';
import type { AgentInput, AgentResponse } from './agent.types.js';

const SPACE_LABELS: Record<string, string> = {
  general: 'professionnel général',
  logistiga: 'Logistiga',
  piston: 'Piston',
  code: 'développement / code',
};

@Injectable()
export class ProfessionalAgentService {
  constructor(private readonly llmService: LlmService) {}

  async handle(input: AgentInput): Promise<AgentResponse> {
    const spaceLabel = SPACE_LABELS[input.routerDecision.space] ?? input.routerDecision.space;

    const response = await this.llmService.complete({
      messages: [
        {
          role: 'system',
          content:
            `Tu es Mora, l'assistant professionnel de ${input.user.displayName}, ` +
            `dans le contexte "${spaceLabel}". Tu n'as accès à aucune information personnelle ` +
            "de l'utilisateur. Réponds de façon concise et professionnelle.",
        },
        ...input.context.history,
        { role: 'user', content: input.message },
      ],
    });

    return {
      content: response.content,
      metadata: {
        agent: 'professional',
        space: input.routerDecision.space,
        llmConfigured: response.configured,
        llmProvider: response.provider,
        intent: input.routerDecision.intent,
      },
    };
  }
}
