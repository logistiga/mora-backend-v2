import { Injectable, Logger } from '@nestjs/common';
import { PersonalAgentService } from '../agents/personal-agent.service.js';
import { ProfessionalAgentService } from '../agents/professional-agent.service.js';
import type { AgentResponse, AgentUser } from '../agents/agent.types.js';
import { AuditService } from '../audit/audit.service.js';
import { ConfigService } from '@nestjs/config';
import { ConversationsService } from '../conversations/conversations.service.js';
import { RouterDecisionsService } from '../conversations/router-decisions.service.js';
import { MessageRole } from '../generated/prisma/client.js';
import { LlmService } from '../llm/llm.service.js';
import { ConversationSummaryService } from '../memory/conversation-summary.service.js';
import { MemoryQueueService } from '../memory/queue/memory-queue.service.js';
import { ProfileFactsService } from '../memory/profile-facts.service.js';
import { detectScriptLanguage } from '../common/language/script-language.util.js';
import { LANGUAGE_POLICY_INSTRUCTION } from '../common/language/language-policy-prompt.js';
import { MoraRouterService } from '../router/mora-router.service.js';
import type { RouterDecisionResult } from '../router/router.types.js';
import { ToolExecutorService } from '../tools/tool-executor.service.js';
import type { ToolContext, ToolScope } from '../tools/tool.types.js';

export interface OrchestratorInput {
  user: AgentUser;
  message: string;
  conversationId?: string;
  channel?: 'text' | 'voice' | 'vision' | 'voice_vision';
  recentInterruption?: boolean;
  externalContextNotes?: string[];
  userMessageMetadata?: Record<string, unknown>;
  routingOverride?: Pick<RouterDecisionResult, 'route' | 'scope' | 'space'>;
}

export interface OrchestratorConfirmationAction {
  type: 'confirmation_required';
  pendingActionId: string;
  tool: string;
  securityLevel: string;
  summary: string;
}

export interface OrchestratorResult {
  conversationId: string;
  userMessageId: string;
  messageId: string;
  response: string;
  route: RouterDecisionResult['route'];
  scope: RouterDecisionResult['scope'];
  space: RouterDecisionResult['space'];
  confidence: number;
  /**
   * Phase D: present only when the LLM proposed an N2/N3 tool call that
   * needs explicit user confirmation before it runs. Absent for every
   * pre-Phase-D response shape, so existing consumers of POST /messages
   * (frontend Phase B/C) are unaffected (AGENTS Phase D §21).
   */
  action?: OrchestratorConfirmationAction;
}

const HYBRID_BLOCKED_MESSAGE =
  'Votre demande mélange des éléments personnels et professionnels. ' +
  "Le mode cross-scope est désactivé par défaut : merci de reformuler séparément " +
  "la partie personnelle et la partie professionnelle.";

const REJECTION_MESSAGES: Record<string, string> = {
  unknown_tool: "Je ne dispose pas de cette action.",
  scope_not_allowed: "Cette action n'est pas disponible dans ce contexte.",
  security_level_n4_blocked: "Cette action est critique et ne peut jamais être exécutée automatiquement.",
};

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
    private readonly toolExecutor: ToolExecutorService,
    private readonly llmService: LlmService,
    private readonly profileFactsService: ProfileFactsService,
    configService: ConfigService,
  ) {
    this.crossScopeEnabled = configService.get<boolean>('app.crossScopeEnabled') ?? false;
  }

  async handleMessage(input: OrchestratorInput): Promise<OrchestratorResult> {
    const conversation = await this.conversationsService.getOrCreateConversation(
      input.user.id,
      input.conversationId,
    );

    let decision = await this.routerService.classify(input.message, input.user.id);
    if (input.routingOverride) {
      decision = { ...decision, ...input.routingOverride, confidence: Math.max(decision.confidence, 0.95) };
    } else {
      decision = await this.applyConversationContinuity(conversation.id, decision);
    }

    // Saved BEFORE dispatch: ContextBuilderService/getScopedHistory reads
    // this same row back as the last turn of history for the agent call.
    const userMessage = await this.conversationsService.addMessage({
      conversationId: conversation.id,
      role: MessageRole.USER,
      content: input.message,
      scope: decision.scope,
      space: decision.space,
      metadata: { intent: decision.intent, method: decision.method, ...input.userMessageMetadata },
    });

    const { content: responseContent, metadata: responseMetadata, action } = await this.dispatch(
      input.user,
      input.message,
      decision,
      conversation.id,
      input.channel ?? 'text',
      input.recentInterruption ?? false,
      input.externalContextNotes ?? [],
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
        toolActionRequested: action?.type ?? null,
      },
    });

    // Fire-and-forget background jobs — never awaited, never allowed to slow
    // down or break the response the user is waiting for. Skipped when a
    // tool call is pending confirmation: nothing meaningfully "happened" in
    // the conversation yet worth extracting/summarizing.
    if ((decision.route === 'personal' || decision.route === 'professional') && !action) {
      void this.scheduleBackgroundJobs(input.user.id, conversation.id, decision, userMessage.id, input.message, responseContent).catch(
        (error) => this.logger.warn(`Failed to schedule Phase C background jobs: ${String(error)}`),
      );
    }

    return {
      conversationId: conversation.id,
      userMessageId: userMessage.id,
      messageId: assistantMessage.id,
      response: responseContent,
      route: decision.route,
      scope: decision.scope,
      space: decision.space,
      confidence: decision.confidence,
      action,
    };
  }

  private async dispatch(
    user: AgentUser,
    message: string,
    decision: RouterDecisionResult,
    conversationId: string,
    channel: 'text' | 'voice' | 'vision' | 'voice_vision',
    recentInterruption: boolean,
    externalContextNotes: string[],
  ): Promise<{ content: string; metadata: Record<string, unknown>; action?: OrchestratorConfirmationAction }> {
    if (decision.route === 'direct') {
      return this.handleDirect(user, message, decision, externalContextNotes);
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

    const scope = decision.route as ToolScope; // 'personal' | 'professional' only past this point
    const agentResponse =
      scope === 'personal'
        ? await this.personalAgent.handle({
            user,
            message,
            conversationId,
            routerDecision: decision,
            channel,
            recentInterruption,
            externalContextNotes,
          })
        : await this.professionalAgent.handle({
            user,
            message,
            conversationId,
            routerDecision: decision,
            channel,
            recentInterruption,
            externalContextNotes,
          });

    return this.resolveAgentResponse(user, message, decision, conversationId, scope, agentResponse);
  }

  /**
   * The backend authority step (AGENTS Phase D §1, §20): the LLM only ever
   * PROPOSED a tool call via `agentResponse.toolCalls` — this is the single
   * place that turns that proposal into either an immediate N1 execution, an
   * N2/N3 pending confirmation, or a controlled refusal. Only the first
   * proposed tool call is handled (a bounded, single-tool-per-turn design;
   * additional calls in the same response are ignored rather than chained).
   */
  private async resolveAgentResponse(
    user: AgentUser,
    message: string,
    decision: RouterDecisionResult,
    conversationId: string,
    scope: ToolScope,
    agentResponse: AgentResponse,
  ): Promise<{ content: string; metadata: Record<string, unknown>; action?: OrchestratorConfirmationAction }> {
    const toolCall = agentResponse.toolCalls?.[0];
    if (!toolCall) {
      return { content: agentResponse.content, metadata: agentResponse.metadata };
    }

    const context: ToolContext = {
      userId: user.id,
      conversationId,
      scope,
      space: decision.space,
      route: decision.route,
    };

    const outcome = await this.toolExecutor.requestExecution(toolCall.name, toolCall.arguments, context);

    if (outcome.kind === 'rejected') {
      const reasonKey = outcome.reason.split(':')[0].trim();
      const content = REJECTION_MESSAGES[reasonKey] ?? "Je ne peux pas exécuter cette action.";
      return {
        content,
        metadata: { ...agentResponse.metadata, toolName: toolCall.name, toolRejected: outcome.reason },
      };
    }

    if (outcome.kind === 'pending_confirmation') {
      return {
        content: `${outcome.summary}. Veux-tu confirmer ?`,
        metadata: {
          ...agentResponse.metadata,
          toolName: toolCall.name,
          pendingActionId: outcome.pendingActionId,
          securityLevel: outcome.securityLevel,
        },
        action: {
          type: 'confirmation_required',
          pendingActionId: outcome.pendingActionId,
          tool: toolCall.name,
          securityLevel: outcome.securityLevel,
          summary: outcome.summary,
        },
      };
    }

    // N1: already executed. A short second LLM call turns the raw tool
    // result into a natural-language reply — a deliberately bounded,
    // single-extra-turn summarization (not a full multi-message
    // OpenAI-style tool-role replay) so this stays cheap and testable while
    // still being a real provider call, never a fabricated string (AGENTS
    // Phase D §19, §29 scenario 2).
    const summary = await this.summarizeToolResult(user, message, toolCall.name, outcome.result, decision);
    return {
      content: summary,
      metadata: { ...agentResponse.metadata, toolName: toolCall.name, toolExecuted: true, toolCallId: outcome.toolCallId },
    };
  }

  private async summarizeToolResult(
    user: AgentUser,
    message: string,
    toolName: string,
    result: { ok: boolean; data?: unknown; errorMessage?: string },
    decision: RouterDecisionResult,
  ): Promise<string> {
    const resultText = result.ok
      ? JSON.stringify(result.data ?? {}).slice(0, 4000)
      : `Erreur: ${result.errorMessage ?? 'unknown'}`;

    const response = await this.llmService.complete(
      {
        messages: [
          {
            role: 'system',
            content:
              `Tu es Mora, l'assistant de ${user.displayName}. L'utilisateur a demandé : "${message}". ` +
              `Tu as exécuté l'outil "${toolName}" qui a retourné ce résultat JSON : ${resultText}. ` +
              "Réponds à l'utilisateur en français, de façon naturelle et concise, en te basant " +
              "uniquement sur ce résultat. Ne mentionne jamais de JSON brut.",
          },
          { role: 'user', content: message },
        ],
        temperature: 0.5,
        maxTokens: 300,
      },
      { userId: user.id, scope: decision.scope, space: decision.space, route: 'tool-result-summary' },
    );

    if (response.configured) {
      return response.content;
    }
    // No LLM available to phrase a natural summary — never fabricate one;
    // fall back to a plain, honest statement of the raw outcome.
    return result.ok ? 'Action effectuée.' : "L'action a échoué.";
  }

  /**
   * The router classifies each message from its text alone, so a follow-up
   * that only makes sense against the previous turn ("Et le montant exact
   * ?", "Rappelle-moi le nom du client sur cette facture.") gets its own
   * route: 'direct' (canned reply, no history, no vision context) or
   * 'hybrid' (blocked as cross-scope). Both drop the thread the user is
   * clearly still in — this is the root cause behind the "vision follow-up
   * loses the image" report.
   *
   * A conversation that already has a scope therefore keeps it whenever
   * the new turn is not itself scoped. This never widens access: it moves
   * a turn from no-scope/both-scopes into the single scope whose history
   * the user is already reading, and an explicitly scoped classification
   * ('personal'/'professional') is always left untouched, so switching
   * subject mid-conversation still works.
   */
  private async applyConversationContinuity(
    conversationId: string,
    decision: RouterDecisionResult,
  ): Promise<RouterDecisionResult> {
    if (decision.route !== 'direct' && decision.route !== 'hybrid') {
      return decision;
    }
    if (decision.route === 'direct' && decision.intent === 'greeting') {
      return decision;
    }

    const active = await this.conversationsService.getActiveScope(conversationId);
    if (!active || (active.scope !== 'personal' && active.scope !== 'professional')) {
      return decision;
    }

    this.logger.debug(
      `Conversation continuity: "${decision.route}" turn continued as ${active.scope}/${active.space}`,
    );
    return {
      ...decision,
      route: active.scope as RouterDecisionResult['route'],
      scope: active.scope as RouterDecisionResult['scope'],
      space: active.space as RouterDecisionResult['space'],
      method: 'continuity',
    };
  }

  /**
   * `direct` is the no-scope lane: small talk and general-knowledge
   * questions that belong to neither the personal nor the professional
   * agent. "No scope/domain retrieval" (no memories, no documents, no
   * tools — nothing that could leak personal/professional data) must NOT
   * mean "memoryless of the user entirely": the small, bounded Essential
   * User Profile (language behaviour, address form, greeting/response
   * style — see ProfileFactsService.getEssential) is always fetched and
   * handed to the model here, including for greetings.
   *
   * This used to short-circuit greetings with a single hardcoded French
   * string and skip the LLM call entirely — found (learning-core phase
   * audit) to be the root cause of a taught "always answer in the language
   * I used" preference never applying to a later "Salam": the greeting
   * branch never looked at the Essential Profile, never called the model,
   * and so could not have honoured any preference no matter how it was
   * stored. Every direct-route message, greeting or not, now takes the
   * same path: fetch the Essential Profile, ask the model, and only fall
   * back to a fixed string if no LLM is configured at all.
   */
  private async handleDirect(
    user: AgentUser,
    message: string,
    decision: RouterDecisionResult,
    externalContextNotes: string[] = [],
  ): Promise<{ content: string; metadata: Record<string, unknown> }> {
    const essentialFacts = await this.profileFactsService.getEssential(user.id);
    const essentialFactsText =
      essentialFacts.length > 0
        ? "\nPréférences essentielles de l'utilisateur (s'appliquent à toute réponse, y compris une simple " +
          'salutation) :\n' +
          essentialFacts.map((f) => `- ${f.key}: ${f.value}`).join('\n')
        : '';
    const notesText = externalContextNotes.length > 0 ? `\n\n${externalContextNotes.join('\n')}` : '';

    const response = await this.llmService.complete(
      {
        messages: [
          {
            role: 'system',
            content:
              `Tu es Mora, l'assistant de ${user.displayName}. ` +
              'Réponds directement et de façon concise au message ci-dessous.\n\n' +
              LANGUAGE_POLICY_INSTRUCTION +
              '\n\n' +
              "Tu n'as ici accès ni aux données personnelles ni aux données professionnelles de l'utilisateur : " +
              "réponds uniquement sur des connaissances générales et les préférences essentielles ci-dessous. " +
              "Si la demande nécessite réellement ses données personnelles ou professionnelles, dis-le " +
              'simplement et demande la précision utile — sans jamais inventer de contenu le concernant.' +
              essentialFactsText +
              notesText,
          },
          { role: 'user', content: message },
        ],
        temperature: 0.4,
        maxTokens: 500,
      },
      { userId: user.id, scope: decision.scope, space: decision.space, route: 'direct' },
    );

    if (response.configured && response.content.trim().length > 0) {
      return {
        content: response.content,
        metadata: {
          agent: 'direct',
          llmConfigured: true,
          llmProvider: response.provider,
          essentialFactsUsed: essentialFacts.length,
        },
      };
    }

    return {
      content: this.buildDirectFallbackReply(decision, message, essentialFacts),
      metadata: { agent: 'direct', llmConfigured: false, essentialFactsUsed: essentialFacts.length },
    };
  }

  /**
   * No LLM configured at all: the only path left is a fixed string — never
   * fabricate a real answer. This still makes a best-effort, generic
   * (non-user-specific) attempt at a learned language preference via a
   * plain script/vocabulary heuristic (see detectScriptLanguage) — a real
   * model is always preferred and used whenever one is configured; this
   * branch only exists for the fully-degraded case.
   */
  private buildDirectFallbackReply(
    decision: RouterDecisionResult,
    message: string,
    essentialFacts: Array<{ key: string; value: string }>,
  ): string {
    if (decision.intent === 'greeting') {
      const languagePref = essentialFacts.find((f) => f.key === 'language_behavior');
      const detected = detectScriptLanguage(message);
      const GREETINGS: Record<'ar' | 'fr' | 'en' | 'darija', string> = {
        ar: 'مرحباً! كيف يمكنني مساعدتك اليوم؟',
        fr: "Bonjour ! Comment puis-je vous aider aujourd'hui ?",
        en: 'Hello! How can I help you today?',
        darija: 'Salam! Kifach n9der n3awnek lyoum?',
      };
      // Only ever reacts to the CURRENT message's own detected script — this
      // is not "if languagePref mentions arabic, always reply in arabic"
      // (that would need real language understanding this heuristic doesn't
      // have); it only confirms a preference exists before trusting the
      // detector over the fixed French default.
      if (languagePref && detected !== 'unknown') {
        return GREETINGS[detected];
      }
      return GREETINGS.fr;
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
