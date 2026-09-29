import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentUser } from '../agents/agent.types.js';
import { MoraOrchestratorService } from './mora-orchestrator.service.js';

function buildService(overrides: { crossScopeEnabled?: boolean } = {}) {
  const routerService = { classify: vi.fn() };
  const personalAgent = { handle: vi.fn() };
  const professionalAgent = { handle: vi.fn() };
  const conversationsService = {
    getOrCreateConversation: vi.fn(async () => ({ id: 'conv-1' })),
    addMessage: vi.fn(async ({ role }: { role: string }) => ({
      id: role === 'USER' ? 'user-msg-1' : 'assistant-msg-1',
    })),
    getScopedHistory: vi.fn(async () => []),
    getActiveScope: vi.fn(async () => null as { scope: string; space: string } | null),
  };
  const routerDecisionsService = { save: vi.fn() };
  const auditService = { log: vi.fn() };
  const memoryQueue = { enqueueExtraction: vi.fn(), enqueueSummary: vi.fn(), enqueueEmbedding: vi.fn() };
  const conversationSummaryService = { shouldSummarize: vi.fn(async () => false) };
  const configService = {
    get: vi.fn(() => overrides.crossScopeEnabled ?? false),
  };
  const toolExecutor = { requestExecution: vi.fn() };
  const llmService = { complete: vi.fn(async () => ({ configured: false, content: '', provider: 'none', model: null })) };
  const profileFactsService = { getEssential: vi.fn(async () => [] as Array<{ key: string; value: string }>) };

  const service = new MoraOrchestratorService(
    routerService as never,
    personalAgent as never,
    professionalAgent as never,
    conversationsService as never,
    routerDecisionsService as never,
    auditService as never,
    memoryQueue as never,
    conversationSummaryService as never,
    toolExecutor as never,
    llmService as never,
    profileFactsService as never,
    configService as never,
  );

  return {
    service,
    routerService,
    personalAgent,
    professionalAgent,
    conversationsService,
    routerDecisionsService,
    auditService,
    memoryQueue,
    conversationSummaryService,
    toolExecutor,
    llmService,
    profileFactsService,
  };
}

/** Background jobs are fired via `void promise.catch(...)` — awaiting one tick lets them settle. */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const user: AgentUser = { id: 'u1', email: 'a@b.com', displayName: 'A' };

describe('MoraOrchestratorService', () => {
  let ctx: ReturnType<typeof buildService>;

  beforeEach(() => {
    ctx = buildService();
  });

  it('answers "direct" without calling any agent', async () => {
    ctx.routerService.classify.mockResolvedValue({
      route: 'direct',
      scope: 'direct',
      space: 'direct',
      intent: 'greeting',
      complexity: 'low',
      securityLevel: 'low',
      confidence: 0.9,
      method: 'rules',
    });

    const result = await ctx.service.handleMessage({ user, message: 'Bonjour' });

    expect(ctx.personalAgent.handle).not.toHaveBeenCalled();
    expect(ctx.professionalAgent.handle).not.toHaveBeenCalled();
    expect(result.route).toBe('direct');
    expect(result.response).toMatch(/bonjour/i);
  });

  it('routes "personal" to PersonalAgentService with the conversation id', async () => {
    ctx.routerService.classify.mockResolvedValue({
      route: 'personal',
      scope: 'personal',
      space: 'personal',
      intent: 'task',
      complexity: 'low',
      securityLevel: 'low',
      confidence: 0.85,
      method: 'rules',
    });
    ctx.personalAgent.handle.mockResolvedValue({ content: 'ok perso', metadata: {} });

    const result = await ctx.service.handleMessage({ user, message: 'Rappelle-moi mon rdv' });

    expect(ctx.personalAgent.handle).toHaveBeenCalledOnce();
    expect(ctx.personalAgent.handle).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1' }),
    );
    expect(ctx.professionalAgent.handle).not.toHaveBeenCalled();
    expect(result.route).toBe('personal');
    expect(result.response).toBe('ok perso');
  });

  it('routes "professional" to ProfessionalAgentService with the conversation id', async () => {
    ctx.routerService.classify.mockResolvedValue({
      route: 'professional',
      scope: 'professional',
      space: 'logistiga',
      intent: 'question',
      complexity: 'low',
      securityLevel: 'medium',
      confidence: 0.9,
      method: 'rules',
    });
    ctx.professionalAgent.handle.mockResolvedValue({ content: 'ok pro', metadata: {} });

    const result = await ctx.service.handleMessage({ user, message: 'Statut Logistiga ?' });

    expect(ctx.professionalAgent.handle).toHaveBeenCalledOnce();
    expect(ctx.professionalAgent.handle).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'conv-1' }),
    );
    expect(ctx.personalAgent.handle).not.toHaveBeenCalled();
    expect(result.space).toBe('logistiga');
  });

  it('blocks "hybrid" by default (cross-scope disabled) without calling any agent', async () => {
    ctx.routerService.classify.mockResolvedValue({
      route: 'hybrid',
      scope: 'hybrid',
      space: 'hybrid',
      intent: 'task',
      complexity: 'medium',
      securityLevel: 'medium',
      confidence: 0.7,
      method: 'rules',
    });

    const result = await ctx.service.handleMessage({ user, message: 'perso + logistiga' });

    expect(ctx.personalAgent.handle).not.toHaveBeenCalled();
    expect(ctx.professionalAgent.handle).not.toHaveBeenCalled();
    expect(result.route).toBe('hybrid');
    expect(result.response).toMatch(/cross-scope est désactivé/i);
    expect(ctx.auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ crossScopeBlocked: true }) }),
    );
  });

  it('answers a general "direct" question with a real LLM reply instead of "D\'accord."', async () => {
    ctx.routerService.classify.mockResolvedValue({
      route: 'direct',
      scope: 'direct',
      space: 'direct',
      intent: 'question',
      complexity: 'low',
      securityLevel: 'low',
      confidence: 0.8,
      method: 'rules',
    });
    ctx.llmService.complete.mockResolvedValue({
      configured: true,
      content: 'La capitale du Maroc est Rabat.',
      provider: 'openai',
      model: null,
    });

    const result = await ctx.service.handleMessage({ user, message: 'Quelle est la capitale du Maroc ?' });

    expect(ctx.llmService.complete).toHaveBeenCalledOnce();
    expect(result.response).toBe('La capitale du Maroc est Rabat.');
    expect(result.response).not.toMatch(/^D'accord\.$/);
  });

  it('falls back to a plain reply for a "direct" question when no LLM is configured', async () => {
    ctx.routerService.classify.mockResolvedValue({
      route: 'direct',
      scope: 'direct',
      space: 'direct',
      intent: 'unknown',
      complexity: 'low',
      securityLevel: 'low',
      confidence: 0.4,
      method: 'rules',
    });

    const result = await ctx.service.handleMessage({ user, message: 'hmm' });

    expect(result.response).toMatch(/pas certain de bien comprendre/i);
  });

  it('keeps a follow-up inside the conversation scope instead of answering it as "direct"', async () => {
    ctx.routerService.classify.mockResolvedValue({
      route: 'direct',
      scope: 'direct',
      space: 'direct',
      intent: 'question',
      complexity: 'low',
      securityLevel: 'low',
      confidence: 0.5,
      method: 'default-fallback',
    });
    ctx.conversationsService.getActiveScope.mockResolvedValue({ scope: 'personal', space: 'personal' });
    ctx.personalAgent.handle.mockResolvedValue({ content: 'Le montant est 1 250 EUR.', metadata: {} });

    const result = await ctx.service.handleMessage({
      user,
      message: 'Et quel est le montant exact en chiffres ?',
      conversationId: 'conv-1',
    });

    expect(ctx.personalAgent.handle).toHaveBeenCalledOnce();
    expect(result.route).toBe('personal');
    expect(result.space).toBe('personal');
    expect(result.response).toBe('Le montant est 1 250 EUR.');
  });

  it('continues a cross-scope-looking follow-up in the conversation scope rather than blocking it', async () => {
    ctx.routerService.classify.mockResolvedValue({
      route: 'hybrid',
      scope: 'hybrid',
      space: 'hybrid',
      intent: 'question',
      complexity: 'low',
      securityLevel: 'low',
      confidence: 0.6,
      method: 'rules',
    });
    ctx.conversationsService.getActiveScope.mockResolvedValue({ scope: 'personal', space: 'personal' });
    ctx.personalAgent.handle.mockResolvedValue({ content: 'Jean Dupont.', metadata: {} });

    const result = await ctx.service.handleMessage({
      user,
      message: 'Rappelle-moi le nom du client sur cette facture.',
      conversationId: 'conv-1',
    });

    expect(result.route).toBe('personal');
    expect(result.response).toBe('Jean Dupont.');
  });

  it('never overrides an explicitly scoped classification with the conversation scope', async () => {
    ctx.routerService.classify.mockResolvedValue({
      route: 'professional',
      scope: 'professional',
      space: 'code',
      intent: 'question',
      complexity: 'low',
      securityLevel: 'low',
      confidence: 0.9,
      method: 'rules',
    });
    ctx.conversationsService.getActiveScope.mockResolvedValue({ scope: 'personal', space: 'personal' });
    ctx.professionalAgent.handle.mockResolvedValue({ content: 'ok pro', metadata: {} });

    const result = await ctx.service.handleMessage({ user, message: 'Comment marche ce script ?', conversationId: 'conv-1' });

    expect(result.route).toBe('professional');
    expect(result.space).toBe('code');
  });

  it('persists the user message, the assistant message, and the router decision', async () => {
    ctx.routerService.classify.mockResolvedValue({
      route: 'direct',
      scope: 'direct',
      space: 'direct',
      intent: 'greeting',
      complexity: 'low',
      securityLevel: 'low',
      confidence: 0.9,
      method: 'rules',
    });

    await ctx.service.handleMessage({ user, message: 'Bonjour' });

    expect(ctx.conversationsService.addMessage).toHaveBeenCalledTimes(2);
    expect(ctx.routerDecisionsService.save).toHaveBeenCalledWith(
      'conv-1',
      'user-msg-1',
      expect.objectContaining({ route: 'direct' }),
    );
    expect(ctx.auditService.log).toHaveBeenCalledOnce();
  });

  it('recomputes route/scope/space/intent on every new turn in the same conversation', async () => {
    ctx.routerService.classify
      .mockResolvedValueOnce({
        route: 'personal',
        scope: 'personal',
        space: 'personal',
        intent: 'explanation',
        complexity: 'low',
        securityLevel: 'low',
        confidence: 0.9,
        method: 'rules',
      })
      .mockResolvedValueOnce({
        route: 'professional',
        scope: 'professional',
        space: 'code',
        intent: 'question',
        complexity: 'low',
        securityLevel: 'low',
        confidence: 0.92,
        method: 'rules',
      })
      .mockResolvedValueOnce({
        route: 'professional',
        scope: 'professional',
        space: 'general',
        intent: 'question',
        complexity: 'low',
        securityLevel: 'low',
        confidence: 0.93,
        method: 'rules',
      });
    ctx.personalAgent.handle.mockResolvedValue({ content: 'Sujet A', metadata: {} });
    ctx.professionalAgent.handle.mockResolvedValue({ content: 'Sujet B/C', metadata: {} });

    const first = await ctx.service.handleMessage({ user, conversationId: 'conv-1', message: 'Explique-moi les rappels dans Mora.' });
    const second = await ctx.service.handleMessage({ user, conversationId: 'conv-1', message: 'Non, parle-moi plutôt de PostgreSQL.' });
    const third = await ctx.service.handleMessage({ user, conversationId: 'conv-1', message: 'En fait, parle-moi maintenant des index SQL.' });

    expect(ctx.routerService.classify).toHaveBeenNthCalledWith(1, 'Explique-moi les rappels dans Mora.', 'u1');
    expect(ctx.routerService.classify).toHaveBeenNthCalledWith(2, 'Non, parle-moi plutôt de PostgreSQL.', 'u1');
    expect(ctx.routerService.classify).toHaveBeenNthCalledWith(3, 'En fait, parle-moi maintenant des index SQL.', 'u1');
    expect(first.conversationId).toBe('conv-1');
    expect(second.conversationId).toBe('conv-1');
    expect(third.conversationId).toBe('conv-1');
    expect(first.route).toBe('personal');
    expect(second.space).toBe('code');
    expect(ctx.professionalAgent.handle).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: 'En fait, parle-moi maintenant des index SQL.',
        routerDecision: expect.objectContaining({ intent: 'question', space: 'general' }),
      }),
    );
  });

  it('schedules a memory-extraction job for personal/professional but not for direct', async () => {
    ctx.routerService.classify.mockResolvedValue({
      route: 'personal',
      scope: 'personal',
      space: 'personal',
      intent: 'task',
      complexity: 'low',
      securityLevel: 'low',
      confidence: 0.85,
      method: 'rules',
    });
    ctx.personalAgent.handle.mockResolvedValue({ content: 'ok', metadata: {} });

    await ctx.service.handleMessage({ user, message: 'Rappelle-moi mon rdv' });
    await flushMicrotasks();

    expect(ctx.memoryQueue.enqueueExtraction).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'personal', space: 'personal' }),
    );
  });

  it('does not schedule a memory-extraction job for a direct reply', async () => {
    ctx.routerService.classify.mockResolvedValue({
      route: 'direct',
      scope: 'direct',
      space: 'direct',
      intent: 'greeting',
      complexity: 'low',
      securityLevel: 'low',
      confidence: 0.9,
      method: 'rules',
    });

    await ctx.service.handleMessage({ user, message: 'Bonjour' });
    await flushMicrotasks();

    expect(ctx.memoryQueue.enqueueExtraction).not.toHaveBeenCalled();
  });

  it('does not schedule a memory-extraction job for a blocked hybrid reply', async () => {
    ctx.routerService.classify.mockResolvedValue({
      route: 'hybrid',
      scope: 'hybrid',
      space: 'hybrid',
      intent: 'task',
      complexity: 'medium',
      securityLevel: 'medium',
      confidence: 0.7,
      method: 'rules',
    });

    await ctx.service.handleMessage({ user, message: 'perso + logistiga' });
    await flushMicrotasks();

    expect(ctx.memoryQueue.enqueueExtraction).not.toHaveBeenCalled();
  });

  describe('learning-core: direct route + Essential User Profile (test B/G fixture)', () => {
    it('fetches the Essential User Profile for a direct-route greeting (root cause of the "Salam" bug)', async () => {
      ctx.routerService.classify.mockResolvedValue({
        route: 'direct',
        scope: 'direct',
        space: 'direct',
        intent: 'greeting',
        complexity: 'low',
        securityLevel: 'low',
        confidence: 0.9,
        method: 'rules',
      });

      await ctx.service.handleMessage({ user, message: 'Salam.' });

      // This is the regression guard for the real bug under investigation:
      // greetings used to short-circuit with a hardcoded string BEFORE ever
      // looking at the user's profile. Now every direct-route turn — greeting
      // or not — always consults it first.
      expect(ctx.profileFactsService.getEssential).toHaveBeenCalledWith('u1');
    });

    it('passes essential facts into the direct-route system prompt so the LLM can honour them', async () => {
      ctx.routerService.classify.mockResolvedValue({
        route: 'direct',
        scope: 'direct',
        space: 'direct',
        intent: 'greeting',
        complexity: 'low',
        securityLevel: 'low',
        confidence: 0.9,
        method: 'rules',
      });
      ctx.profileFactsService.getEssential.mockResolvedValue([
        { key: 'language_behavior', value: "Répond dans la langue utilisée par l'utilisateur" },
      ]);
      ctx.llmService.complete.mockResolvedValue({
        configured: true,
        content: 'مرحباً! كيف يمكنني مساعدتك؟',
        provider: 'openai',
        model: null,
      });

      const result = await ctx.service.handleMessage({ user, message: 'Salam.' });

      const [request] = ctx.llmService.complete.mock.calls[0] as unknown as [{ messages: Array<{ content: string }> }];
      const systemMessage = request.messages[0].content;
      expect(systemMessage).toContain('language_behavior');
      expect(systemMessage).toContain("Répond dans la langue utilisée par l'utilisateur");
      expect(result.response).toBe('مرحباً! كيف يمكنني مساعدتك؟');
    });

    it('falls back to an honest, non-hardcoded-language greeting (never a silent French default) when no LLM is configured but a language preference exists', async () => {
      ctx.routerService.classify.mockResolvedValue({
        route: 'direct',
        scope: 'direct',
        space: 'direct',
        intent: 'greeting',
        complexity: 'low',
        securityLevel: 'low',
        confidence: 0.9,
        method: 'rules',
      });
      ctx.profileFactsService.getEssential.mockResolvedValue([
        { key: 'language_behavior', value: "Répond dans la langue utilisée par l'utilisateur" },
      ]);
      // llmService.complete defaults to `configured: false` in this test file.

      const result = await ctx.service.handleMessage({ user, message: 'Salam.' });

      expect(result.response).not.toBe("Bonjour ! Comment puis-je vous aider aujourd'hui ?");
      expect(result.response).toMatch(/مرحباً/);
    });

    it('still defaults to French when no language preference is stored at all (no over-guessing)', async () => {
      ctx.routerService.classify.mockResolvedValue({
        route: 'direct',
        scope: 'direct',
        space: 'direct',
        intent: 'greeting',
        complexity: 'low',
        securityLevel: 'low',
        confidence: 0.9,
        method: 'rules',
      });
      // No essential facts stored (default mock) and no LLM configured.

      const result = await ctx.service.handleMessage({ user, message: 'Salam.' });

      expect(result.response).toBe("Bonjour ! Comment puis-je vous aider aujourd'hui ?");
    });
  });

  describe('tool-calling confirmation contract (post-review correction)', () => {
    const personalDecision = {
      route: 'personal',
      scope: 'personal',
      space: 'personal',
      intent: 'task',
      complexity: 'low',
      securityLevel: 'low',
      confidence: 0.85,
      method: 'rules',
    };

    it('never fabricates an `action` when the agent returned no real toolCalls, even if the text mimics a confirmation', async () => {
      ctx.routerService.classify.mockResolvedValue(personalDecision);
      ctx.personalAgent.handle.mockResolvedValue({
        content: 'Créer une tâche : "X". Veux-tu confirmer ?', // LLM narrating without a real tool call
        metadata: {},
        // toolCalls intentionally absent — this is the exact case under review
      });

      const result = await ctx.service.handleMessage({ user, message: 'Ajoute une tâche X' });

      expect(result.action).toBeUndefined();
      expect(ctx.toolExecutor.requestExecution).not.toHaveBeenCalled();
    });

    it('`action` only ever comes from a real ToolExecutor pending_confirmation outcome, never from agent text', async () => {
      ctx.routerService.classify.mockResolvedValue(personalDecision);
      ctx.personalAgent.handle.mockResolvedValue({
        content: 'ignored — the backend template replaces this',
        metadata: {},
        toolCalls: [{ name: 'create_task', arguments: { title: 'X' }, providerCallId: 'call_1' }],
      });
      ctx.toolExecutor.requestExecution.mockResolvedValue({
        kind: 'pending_confirmation',
        pendingActionId: 'pa-1',
        summary: 'Créer une tâche : "X"',
        securityLevel: 'N2',
      });

      const result = await ctx.service.handleMessage({ user, message: 'Ajoute une tâche X' });

      expect(ctx.toolExecutor.requestExecution).toHaveBeenCalledWith(
        'create_task',
        { title: 'X' },
        expect.objectContaining({ scope: 'personal', space: 'personal' }),
      );
      expect(result.action).toEqual({
        type: 'confirmation_required',
        pendingActionId: 'pa-1',
        tool: 'create_task',
        securityLevel: 'N2',
        summary: 'Créer une tâche : "X"',
      });
    });

    it('a second real tool call in the SAME conversation produces a distinct pending_action, never a stale/reused one', async () => {
      ctx.routerService.classify.mockResolvedValue(personalDecision);
      ctx.toolExecutor.requestExecution
        .mockResolvedValueOnce({
          kind: 'pending_confirmation',
          pendingActionId: 'pa-1',
          summary: 'Créer une tâche : "Appeler Jean"',
          securityLevel: 'N2',
        })
        .mockResolvedValueOnce({
          kind: 'pending_confirmation',
          pendingActionId: 'pa-2',
          summary: 'Créer une tâche : "Préparer le dossier"',
          securityLevel: 'N2',
        });

      ctx.personalAgent.handle.mockResolvedValueOnce({
        content: '',
        metadata: {},
        toolCalls: [{ name: 'create_task', arguments: { title: 'Appeler Jean' }, providerCallId: 'call_1' }],
      });
      const first = await ctx.service.handleMessage({ user, conversationId: 'conv-1', message: 'Ajoute une tâche appeler Jean' });

      ctx.personalAgent.handle.mockResolvedValueOnce({
        content: '',
        metadata: {},
        toolCalls: [{ name: 'create_task', arguments: { title: 'Préparer le dossier' }, providerCallId: 'call_2' }],
      });
      const second = await ctx.service.handleMessage({ user, conversationId: 'conv-1', message: 'Ajoute aussi une tâche préparer le dossier' });

      expect(first.action?.pendingActionId).toBe('pa-1');
      expect(second.action?.pendingActionId).toBe('pa-2');
      expect(first.action?.pendingActionId).not.toBe(second.action?.pendingActionId);
      expect(ctx.toolExecutor.requestExecution).toHaveBeenCalledTimes(2);
    });

    it('a rejected/unknown tool call never produces an `action` field', async () => {
      ctx.routerService.classify.mockResolvedValue(personalDecision);
      ctx.personalAgent.handle.mockResolvedValue({
        content: '',
        metadata: {},
        toolCalls: [{ name: 'delete_everything', arguments: {}, providerCallId: 'call_1' }],
      });
      ctx.toolExecutor.requestExecution.mockResolvedValue({ kind: 'rejected', reason: 'unknown_tool' });

      const result = await ctx.service.handleMessage({ user, message: 'fais un truc dangereux' });
      expect(result.action).toBeUndefined();
    });
  });
});
