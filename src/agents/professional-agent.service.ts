import { Injectable } from '@nestjs/common';
import { TimeContextService } from '../common/time/time-context.service.js';
import { ContextBuilderService } from '../context/context-builder.service.js';
import { LlmService } from '../llm/llm.service.js';
import { ToolRegistryService } from '../tools/tool-registry.service.js';
import { TOOL_USAGE_RULES } from './agent-prompts.js';
import type { AgentInput, AgentResponse } from './agent.types.js';

const SPACE_LABELS: Record<string, string> = {
  general: 'professionnel général',
  logistiga: 'Logistiga',
  piston: 'Piston',
  code: 'développement / code',
};

const SYSTEM_PROMPT_PREFIX = (displayName: string, spaceLabel: string, timeContext: string) =>
  `Tu es Mora, l'assistant professionnel de ${displayName}, ` +
  `dans le contexte "${spaceLabel}". Tu n'as accès à aucune information personnelle ` +
  "de l'utilisateur. Réponds de façon concise et professionnelle. " +
  `${timeContext} ` +
  TOOL_USAGE_RULES;

const VOICE_INTERRUPTION_NOTE =
  "Contexte voice : si l'utilisateur vient d'interrompre Mora et change de sujet, réponds directement à la nouvelle demande. " +
  "Ne reprends pas, ne résume pas, et ne conclus pas la réponse interrompue sauf si l'utilisateur le demande explicitement.";

@Injectable()
export class ProfessionalAgentService {
  constructor(
    private readonly llmService: LlmService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly timeContext: TimeContextService,
  ) {}

  async handle(input: AgentInput): Promise<AgentResponse> {
    const spaceLabel = SPACE_LABELS[input.routerDecision.space] ?? input.routerDecision.space;

    const context = await this.contextBuilder.build({
      userId: input.user.id,
      scope: 'professional',
      space: input.routerDecision.space,
      conversationId: input.conversationId,
      systemPrompt:
        SYSTEM_PROMPT_PREFIX(input.user.displayName, spaceLabel, this.timeContext.describeNow()) +
        (input.channel === 'voice' && input.recentInterruption ? ` ${VOICE_INTERRUPTION_NOTE}` : ''),
      latestUserMessage: input.message,
      externalContextNotes: input.externalContextNotes,
    });

    const response = await this.llmService.complete(
      { messages: context.messages, tools: this.toolRegistry.toLlmToolDefinitions('professional') },
      { userId: input.user.id, scope: 'professional', space: input.routerDecision.space, route: 'professional' },
    );

    return {
      content: response.content,
      toolCalls: response.toolCalls,
      metadata: {
        agent: 'professional',
        space: input.routerDecision.space,
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
