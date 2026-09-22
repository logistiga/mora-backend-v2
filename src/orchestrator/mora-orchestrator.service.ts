import { Injectable, Logger } from '@nestjs/common';
import { PersonalAgentService } from '../agents/personal-agent.service.js';
import { ProfessionalAgentService } from '../agents/professional-agent.service.js';
import type { AgentUser } from '../agents/agent.types.js';
import { AuditService } from '../audit/audit.service.js';
import { ConfigService } from '@nestjs/config';
import { ConversationsService } from '../conversations/conversations.service.js';
import { RouterDecisionsService } from '../conversations/router-decisions.service.js';
import { MessageRole } from '../generated/prisma/client.js';
import { ConversationSummaryService } from '../memory/conversation-summary.service.js';
import { MemoryQueueService } from '../memory/queue/memory-queue.service.js';
import { MoraRouterService } from '../router/mora-router.service.js';
import type { RouterDecisionResult } from '../router/router.types.js';

export interface OrchestratorInput {
  user: AgentUser;
  message: string;
  conversationId?: string;
}

export interface OrchestratorResult {
  conversationId: string;
  messageId: string;
  response: string;
  route: RouterDecisionResult['route'];
  scope: RouterDecisionResult['scope'];
  space: RouterDecisionResult['space'];
  confidence: number;
}

const HYBRID_BLOCKED_MESSAGE =
  'Votre demande mélange des éléments personnels et professionnels. ' +
  "Le mode cross-scope est désactivé par défaut : merci de reformuler séparément " +
  "la partie personnelle et la partie professionnelle.";

@Injectable()
export class MoraOrchestratorService {
  private readonly logger = new Logger(MoraOrchestratorService.name);
  private readonly crossScopeEnabled: boolean;

  constructor(
    private readonly routerService: MoraRouterService,
    private readonly personalAgent: PersonalAgentService,
    private readonly professionalAgent: ProfessionalAgentService,
    private readonly conversationsService: ConversationsService,
    private readonly routerDecisionsService: RouterDecisionsService,
    private readonly auditService: AuditService,
    private readonly memoryQueue: MemoryQueueService,
    private readonly conversationSummaryService: ConversationSummaryService,
    configService: ConfigService,
  ) {
    this.crossScopeEnabled = configService.get<boolean>('app.crossScopeEnabled') ?? false;
  }

  async handleMessage(input: OrchestratorInput): Promise<OrchestratorResult> {
    const conversation = await this.conversationsService.getOrCreateConversation(
      input.user.id,
      input.conversationId,
    );

    const decision = await this.routerService.classify(input.message, input.user.id);

    // Saved BEFORE dispatch: ContextBuilderService/getScopedHistory reads
    // this same row back as the last turn of history for the agent call.
    const userMessage = await this.conversationsService.addMessage({
      conversationId: conversation.id,
      role: MessageRole.USER,
      content: input.message,
      scope: decision.scope,
      space: decision.space,
      metadata: { intent: decision.intent, method: decision.method },
    });

    const { content: responseContent, metadata: responseMetadata } = await this.dispatch(
      input.user,
      input.message,
      decision,
      conversation.id,
    );

    const assistantMessage = await this.conversationsService.addMessage({
      conversationId: conversation.id,
      role: MessageRole.ASSISTANT,
      content: responseContent,
      scope: decision.scope,
      space: decision.space,
      metadata: responseMetadata,
    });

    await this.routerDecisionsService.save(conversation.id, userMessage.id, decision);

    await this.auditService.log({
      userId: input.user.id,
      conversationId: conversation.id,
      action: 'message_processed',
      scope: decision.scope,
      space: decision.space,
      metadata: {
        route: decision.route,
        confidence: decision.confidence,
        method: decision.method,
        crossScopeBlocked: responseMetadata.crossScopeBlocked ?? false,
      },
    });

    // Fire-and-forget background jobs — never awaited, never allowed to slow
    // down or break the response the user is waiting for.
    if (decision.route === 'personal' || decision.route === 'professional') {
      void this.scheduleBackgroundJobs(input.user.id, conversation.id, decision, userMessage.id, input.message, responseContent).catch(
        (error) => this.logger.warn(`Failed to schedule Phase C background jobs: ${String(error)}`),
      );
    }

    return {
      conversationId: conversation.id,
      messageId: assistantMessage.id,
      response: responseContent,
      route: decision.route,
      scope: decision.scope,
      space: decision.space,
      confidence: decision.confidence,
    };
  }

  private async dispatch(
    user: AgentUser,
    message: string,
    decision: RouterDecisionResult,
    conversationId: string,
  ): Promise<{ content: string; metadata: Record<string, unknown> }> {
    if (decision.route === 'direct') {
      return { content: this.buildDirectReply(decision), metadata: { agent: 'direct' } };
    }

    if (decision.route === 'hybrid') {
      if (!this.crossScopeEnabled) {
        this.logger.debug('Hybrid request blocked: cross-scope is disabled');
        return { content: HYBRID_BLOCKED_MESSAGE, metadata: { agent: 'hybrid', crossScopeBlocked: true } };
      }
      // Cross-scope is explicitly enabled, but Phase B/C do not implement real
      // hybrid merging (Personal+Professional combined context/actions) — that
      // is out of scope here. Degrade safely rather than fabricate a merge.
      return {
        content:
          "Le mode cross-scope est activé mais le traitement hybride combiné n'est pas " +
          'encore implémenté (prévu à une phase ultérieure). Merci de reformuler séparément.',
        metadata: { agent: 'hybrid', crossScopeBlocked: false, notImplemented: true },
      };
    }

    if (decision.route === 'personal') {
      return this.personalAgent.handle({ user, message, conversationId, routerDecision: decision });
    }

    return this.professionalAgent.handle({ user, message, conversationId, routerDecision: decision });
  }

  private buildDirectReply(decision: RouterDecisionResult): string {
    if (decision.intent === 'greeting') {
      return 'Bonjour ! Comment puis-je vous aider aujourd\'hui ?';
    }
    if (decision.intent === 'unknown') {
      return "Je ne suis pas certain de bien comprendre votre demande. Pouvez-vous préciser s'il s'agit d'un sujet personnel ou professionnel ?";
    }
    return "D'accord.";
  }

  private async scheduleBackgroundJobs(
    userId: string,
    conversationId: string,
    decision: RouterDecisionResult,
    sourceMessageId: string,
    userMessage: string,
    assistantResponse: string,
  ): Promise<void> {
    const scope = decision.scope as 'personal' | 'professional';

    await this.memoryQueue.enqueueExtraction({
      userId,
      conversationId,
      scope,
      space: decision.space,
      sourceMessageId,
      userMessage,
      assistantResponse,
    });

    if (await this.conversationSummaryService.shouldSummarize(conversationId, scope, decision.space)) {
      await this.memoryQueue.enqueueSummary({ conversationId, userId, scope, space: decision.space });
    }
  }
}
